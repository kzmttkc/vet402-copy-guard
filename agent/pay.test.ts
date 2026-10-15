// The paying path without a network: ledger, lock, cap, chain floor, settlement.
import { guardCheck, resetGuardsForTests, vet402SpendGuard } from './spend-guard'
import { describe, expect, test } from 'bun:test'
import { spawn, spawnSync } from 'node:child_process'
import { existsSync, mkdtempSync, readdirSync, readFileSync, utimesSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
	APPROVAL_TOPIC,
	chainSpent,
	FIXED_LEDGER,
	LedgerLocked,
	LedgerMissing,
	LOCK_STALE_MS,
	ledgerPath,
	type PayOnceOpts,
	payOnce,
	readChainSpend,
	settlementOutcome,
	withLedgerLock,
} from './pay'
import { PAYMENT_REQUIRED } from './test-helpers'
import { CapReached, MAX_VALIDITY_SECONDS, permit2TypedData, pickAccept, validitySeconds } from './x402'

const PAYER = '0xc380D9F41D90765A4820429B9Da151889E8bED94'
const TX = `0x${'ab'.repeat(32)}`
const fresh = () => join(mkdtempSync(join(tmpdir(), 'pay-')), 'spend.json')
const ledgerAt = (file: string, spent: string[]) =>
	writeFileSync(
		file,
		JSON.stringify({ payer: PAYER, cap_atomic: '1000000', entries: spent.map((a) => ({ at: '', resource: '', amount_atomic: a, status: 'settled', tx: TX })) }),
	)
const read = (file: string) => JSON.parse(readFileSync(file, 'utf8'))
const opts = (file: string, over: Partial<PayOnceOpts> = {}): PayOnceOpts => ({
	ledgerFile: file,
	payer: PAYER,
	amount: 10_000n,
	resource: 'https://vet402.com/api/v1/rwa/paid/facts/0xE9B08727131E34010b34006c660D4c1B436EC25f',
	chainSpentAtomic: 0n,
	allowance: 1_000_000n,
	send: async () => ({ httpStatus: 200, settlement: { success: true, transaction: TX } }),
	guard: async () => () => {},
	...over,
})

describe('what the paid answer means', () => {
	test('settled, failed and unknown', () => {
		expect(settlementOutcome(200, { success: true, transaction: TX })).toEqual({ status: 'settled', tx: TX })
		expect(settlementOutcome(402, { success: false })).toEqual({ status: 'failed', tx: null })
		expect(settlementOutcome(402, null)).toEqual({ status: 'failed', tx: null })
		// a tx next to a refusal may mean money moved
		expect(settlementOutcome(402, { success: false, transaction: TX })).toEqual({ status: 'unknown', tx: TX })
		expect(settlementOutcome(200, null)).toEqual({ status: 'unknown', tx: null })
		expect(settlementOutcome(502, null)).toEqual({ status: 'unknown', tx: null })
		expect(settlementOutcome(200, { success: false, transaction: TX })).toEqual({ status: 'unknown', tx: TX })
	})
})

describe('payOnce: the ledger', () => {
	test('pending is on disk before the request, settled after; no temp file or lock is left', async () => {
		const file = fresh()
		let seenDuringSend: any = null
		const r = await payOnce(
			opts(file, {
				send: async () => {
					seenDuringSend = read(file)
					return { httpStatus: 200, settlement: { success: true, transaction: TX } }
				},
			}),
		)
		expect(seenDuringSend.entries).toHaveLength(1)
		expect(seenDuringSend.entries[0].status).toBe('pending')
		expect(r.outcome).toEqual({ status: 'settled', tx: TX })
		expect(read(file).entries[0]).toMatchObject({ status: 'settled', tx: TX, amount_atomic: '10000' })
		expect(readdirSync(join(file, '..'))).toEqual(['spend.json'])
	})

	test('a clean refusal is recorded as failed and does not count', async () => {
		const file = fresh()
		ledgerAt(file, [])
		await payOnce(opts(file, { send: async () => ({ httpStatus: 402, settlement: { success: false } }) }))
		expect(read(file).entries[0].status).toBe('failed')
		// the next payment still sees 0 spent
		const r = await payOnce(opts(file))
		expect(r.spentBefore).toBe(0n)
	})

	test('a request that throws is recorded as unknown and counts', async () => {
		const file = fresh()
		await expect(payOnce(opts(file, { send: async () => Promise.reject(new Error('socket hang up')) }))).rejects.toThrow('socket hang up')
		expect(read(file).entries[0].status).toBe('unknown')
		const r = await payOnce(opts(file))
		expect(r.spentBefore).toBe(10_000n)
	})
})

describe('payOnce: the cap', () => {
	test('up to exactly 1 USDG passes, one atomic unit more stops before anything is sent', async () => {
		const file = fresh()
		ledgerAt(file, ['990000'])
		await payOnce(opts(file))
		expect(read(file).entries).toHaveLength(2)

		const over = fresh()
		ledgerAt(over, ['990001'])
		let sent = false
		await expect(payOnce(opts(over, { send: async () => ((sent = true), { httpStatus: 200, settlement: null }) }))).rejects.toThrow(CapReached)
		expect(sent).toBe(false)
		expect(read(over).entries).toHaveLength(1)
	})

	test('the chain is a floor: a ledger that says 0 does not beat 995000 spent onchain', async () => {
		const file = fresh()
		ledgerAt(file, [])
		await expect(payOnce(opts(file, { chainSpentAtomic: 995_000n }))).rejects.toThrow(CapReached)
	})

	test('a deleted ledger does not reset the cap: the chain shows spending, so it stops', async () => {
		const file = fresh()
		let sent = false
		await expect(payOnce(opts(file, { chainSpentAtomic: 10_000n, send: async () => ((sent = true), { httpStatus: 200, settlement: null }) }))).rejects.toThrow(LedgerMissing)
		expect(sent).toBe(false)
		expect(existsSync(file)).toBe(false)
	})

	test('no ledger and nothing onchain: the first payment creates the ledger', async () => {
		const file = fresh()
		await payOnce(opts(file))
		expect(read(file).entries).toHaveLength(1)
	})

	test('a short allowance is approved for exactly the cap minus what was spent', async () => {
		const file = fresh()
		ledgerAt(file, ['300000'])
		const approved: bigint[] = []
		await payOnce(opts(file, { allowance: 0n, chainSpentAtomic: 250_000n, approve: async (n) => void approved.push(n) }))
		expect(approved).toEqual([700_000n])
	})

	test('a short allowance without --approve stops before anything is written', async () => {
		const file = fresh()
		await expect(payOnce(opts(file, { allowance: 9_999n }))).rejects.toThrow(/allowance is short/)
		expect(existsSync(file)).toBe(false)
	})
})

describe('payOnce: the lock', () => {
	test('two runs at once: one pays, the other is refused, the ledger keeps one entry', async () => {
		const file = fresh()
		let release!: () => void
		const gate = new Promise<void>((r) => (release = r))
		const slow = payOnce(opts(file, { send: async () => (await gate, { httpStatus: 200, settlement: { success: true, transaction: TX } }) }))
		await new Promise((r) => setTimeout(r, 20))
		await expect(payOnce(opts(file))).rejects.toThrow(LedgerLocked)
		release()
		await slow
		expect(read(file).entries).toHaveLength(1)
		expect(existsSync(`${file}.lock`)).toBe(false)
	})

	test('a lock held by a live process is respected', async () => {
		const file = fresh()
		writeFileSync(`${file}.lock`, `${process.pid} ${Date.now()} other`)
		await expect(withLedgerLock(file, async () => 1)).rejects.toThrow(LedgerLocked)
		expect(readFileSync(`${file}.lock`, 'utf8')).toContain('other')
	})

	test('a lock left by a process that is gone, or older than the stale limit, is cleared', async () => {
		const file = fresh()
		const dead = spawnSync('true').pid
		writeFileSync(`${file}.lock`, `${dead} ${Date.now()} old`)
		expect(await withLedgerLock(file, async () => 'ran')).toBe('ran')
		writeFileSync(`${file}.lock`, `${process.pid} ${Date.now() - LOCK_STALE_MS - 1} old`)
		expect(await withLedgerLock(file, async () => 'ran again')).toBe('ran again')
		expect(existsSync(`${file}.lock`)).toBe(false)
	})

	test('two runs that both read the same stale lock: one takes it, the other is refused', async () => {
		const file = fresh()
		const lock = `${file}.lock`
		writeFileSync(lock, `${spawnSync('true').pid} ${Date.now()} old`)
		let release!: () => void
		const gate = new Promise<void>((r) => (release = r))
		let first: Promise<string> | null = null
		let firstRan = false
		let secondRan = false
		// Run B has judged the lock stale. Before B clears it, run A clears it and takes the lock.
		const second = withLedgerLock(file, async () => ((secondRan = true), 'B'), Date.now, {
			beforeClear: () => {
				first ??= withLedgerLock(file, async () => ((firstRan = true), await gate, 'A'))
			},
		})
		await expect(second).rejects.toThrow(LedgerLocked)
		expect(firstRan).toBe(true)
		expect(secondRan).toBe(false)
		// A still holds its own lock: B did not remove it on the way out.
		expect(readFileSync(lock, 'utf8').startsWith(`${process.pid} `)).toBe(true)
		release()
		expect(await (first as unknown as Promise<string>)).toBe('A')
		expect(readdirSync(join(file, '..'))).toEqual([])
	})

	test('eight processes start on the same stale lock: exactly one runs', async () => {
		const file = fresh()
		writeFileSync(`${file}.lock`, `${spawnSync('true').pid} ${Date.now()} old`)
		const startAt = Date.now() + 400
		// The one that gets the lock holds it until the other seven have given up.
		const child = `
			import { existsSync } from 'node:fs'
			import { withLedgerLock } from './pay'
			const [file, startAt] = process.argv.slice(-2)
			while (Date.now() < Number(startAt)) {}
			try {
				await withLedgerLock(file, async () => {
					while (!existsSync(file + '.release')) await new Promise((r) => setTimeout(r, 10))
				})
				console.log('ran')
			} catch (e) {
				console.log(e.constructor.name)
			}`
		let closed = 0
		const release = () => existsSync(`${file}.release`) || writeFileSync(`${file}.release`, '')
		const giveUp = setTimeout(release, 8000)
		const outs = await Promise.all(
			Array.from({ length: 8 }, () => {
				const p = spawn(process.execPath, ['-e', child, file, String(startAt)], { cwd: import.meta.dir })
				let out = ''
				p.stdout.on('data', (d) => (out += d))
				p.stderr.on('data', (d) => (out += d))
				return new Promise<string>((r) =>
					p.on('close', () => {
						if (++closed === 7) release()
						r(out.trim())
					}),
				)
			}),
		)
		clearTimeout(giveUp)
		expect(outs.filter((o) => o === 'ran')).toHaveLength(1)
		expect(outs.filter((o) => o === 'LedgerLocked')).toHaveLength(7)
		expect(readdirSync(join(file, '..'))).toEqual(['spend.json.release'])
	}, 15_000)

	test('a lock file that is still empty belongs to a run that is writing it; only an old one is cleared', async () => {
		const file = fresh()
		const lock = `${file}.lock`
		writeFileSync(lock, '')
		await expect(withLedgerLock(file, async () => 1)).rejects.toThrow(LedgerLocked)
		expect(existsSync(lock)).toBe(true)
		const old = new Date(Date.now() - LOCK_STALE_MS - 1000)
		utimesSync(lock, old, old)
		expect(await withLedgerLock(file, async () => 'ran')).toBe('ran')
		expect(existsSync(lock)).toBe(false)
	})

	test('a takeover that was cut short leaves its marker, and nobody pays until a person removes it', async () => {
		const file = fresh()
		writeFileSync(`${file}.lock`, `${spawnSync('true').pid} ${Date.now()} old`)
		writeFileSync(`${file}.lock.break`, 'left behind')
		let sent = false
		await expect(payOnce(opts(file, { send: async () => ((sent = true), { httpStatus: 200, settlement: null }) }))).rejects.toThrow(LedgerLocked)
		expect(sent).toBe(false)
		expect(existsSync(file)).toBe(false)
		expect(readFileSync(`${file}.lock.break`, 'utf8')).toBe('left behind')
	})
})

describe('the chain as a floor', () => {
	test('spent onchain is the larger of all USDG sent and last approval minus allowance', () => {
		expect(chainSpent(0n, 0n, 0n)).toBe(0n)
		expect(chainSpent(30_000n, 1_000_000n, 980_000n)).toBe(30_000n)
		expect(chainSpent(0n, 1_000_000n, 970_000n)).toBe(30_000n)
		expect(chainSpent(0n, 0n, 5n)).toBe(0n)
	})

	test('readChainSpend sums the payer\'s USDG transfers and takes the last approval to Permit2', async () => {
		const calls: any[] = []
		const rpc = async (_m: string, params: any[]) => {
			calls.push(params[0])
			if (params[0].topics[0] === APPROVAL_TOPIC) return [{ data: '0x0f4240' }, { data: '0x0aae60' }]
			return [{ data: '0x2710' }, { data: '0x2710' }]
		}
		const s = await readChainSpend(rpc, PAYER, 83_700_000, 680_000n)
		expect(s.outflowAtomic).toBe(20_000n)
		expect(s.lastApprovedAtomic).toBe(700_000n)
		expect(s.spentAtomic).toBe(20_000n)
		expect(calls.every((c) => c.address === '0x5fc5360d0400a0fd4f2af552add042d716f1d168')).toBe(true)
	})
})

describe('fixed places and windows', () => {
	test('the ledger path moves only in a test run', () => {
		expect(ledgerPath({ BLI_AGENT_LEDGER: '/tmp/x.json' })).toBe(FIXED_LEDGER)
		expect(ledgerPath({ NODE_ENV: 'production', BLI_AGENT_LEDGER: '/tmp/x.json' })).toBe(FIXED_LEDGER)
		expect(ledgerPath({ NODE_ENV: 'test', BLI_AGENT_LEDGER: '/tmp/x.json' })).toBe('/tmp/x.json')
		expect(FIXED_LEDGER.endsWith('/.vet402/bli-agent-spend.json')).toBe(true)
	})

	test('a signature is valid for at most 120 seconds, whatever the 402 asks', () => {
		const a = pickAccept(structuredClone(PAYMENT_REQUIRED.decoded) as any)
		expect(validitySeconds({ ...a, maxTimeoutSeconds: 86_400 })).toBe(MAX_VALIDITY_SECONDS)
		expect(validitySeconds({ ...a, maxTimeoutSeconds: 90 })).toBe(90)
		expect(validitySeconds({ ...a, maxTimeoutSeconds: undefined })).toBe(120)
		expect(validitySeconds({ ...a, maxTimeoutSeconds: -5 })).toBe(120)
		const t = permit2TypedData({ ...a, maxTimeoutSeconds: 86_400 }, PAYER, 1_791_500_000, 1n)
		expect(t.authorization.deadline).toBe(String(1_791_500_000 + 120))
	})
})


describe('payOnce: vet402 SpendGuard is asked before anything is signed', () => {
	test('a refusal stops the payment: no pending entry, send never called', async () => {
		const file = fresh()
		let sent = false
		resetGuardsForTests()
		const guard = guardCheck(vet402SpendGuard(5_000n, 1_000_000n), PAYER)
		await expect(
			payOnce(opts(file, { amount: 10_000n, guard, send: async () => { sent = true; return { httpStatus: 200, settlement: { success: true, transaction: TX } } } })),
		).rejects.toThrow(/vet402 SpendGuard refused \(max_per_tx_exceeded\); nothing signed/)
		expect(sent).toBe(false)
		expect(existsSync(file) ? read(file).entries.length : 0).toBe(0)
	})

	test('one guard per process: the daily budget adds up across payments and refuses the one that would pass it', async () => {
		resetGuardsForTests()
		expect(vet402SpendGuard(10_000n, 20_000n)).toBe(vet402SpendGuard(10_000n, 20_000n))
		const file = fresh()
		const pay = () => payOnce(opts(file, { amount: 10_000n, guard: guardCheck(vet402SpendGuard(10_000n, 20_000n), PAYER) }))
		await pay()
		await pay()
		await expect(pay()).rejects.toThrow(/daily_budget_exceeded/)
		expect(read(file).entries.length).toBe(2)
	})

	test('a 1.00 budget allows exactly 100 payments of 0.01 (no floating-point drift)', async () => {
		resetGuardsForTests()
		const check = guardCheck(vet402SpendGuard(10_000n, 1_000_000n), PAYER)
		for (let i = 0; i < 100; i++) await check(10_000n)
		await expect(check(10_000n)).rejects.toThrow(/daily_budget_exceeded/)
	})

	test('the guard runs after the cap check: a payment over the cap is refused by the cap, not the guard', async () => {
		const file = fresh()
		ledgerAt(file, ['1000000'])
		let asked = false
		await expect(payOnce(opts(file, { guard: async () => { asked = true; return () => {} } }))).rejects.toBeInstanceOf(CapReached)
		expect(asked).toBe(false)
	})

	test('the guard never looks up the payee on Robinhood Chain (trustPolicy custom)', async () => {
		resetGuardsForTests()
		const d = await vet402SpendGuard(10_000n, 1_000_000n).evaluate({ payee: PAYER, amountUsd: 0.01 })
		expect(d.allow).toBe(true)
		expect(d.payeeScore).toBeNull()
	})

	test('a failed payment gives the budget back, an unknown one does not', async () => {
		resetGuardsForTests()
		const guard = () => guardCheck(vet402SpendGuard(10_000n, 20_000n), PAYER)
		const failed = async () => ({ httpStatus: 402, settlement: { success: false } })
		await payOnce(opts(fresh(), { guard: guard(), send: failed }))
		await payOnce(opts(fresh(), { guard: guard(), send: failed }))
		await payOnce(opts(fresh(), { guard: guard(), send: failed }))
		expect(vet402SpendGuard(10_000n, 20_000n).state().spentTodayUsd).toBeLessThan(0.000001)
		const unknown = async () => ({ httpStatus: 502, settlement: null })
		await payOnce(opts(fresh(), { guard: guard(), send: unknown }))
		await payOnce(opts(fresh(), { guard: guard(), send: unknown }))
		await expect(payOnce(opts(fresh(), { guard: guard(), send: unknown }))).rejects.toThrow(/daily_budget_exceeded/)
	})
})
