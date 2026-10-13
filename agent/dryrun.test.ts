// The dry-run path end to end, with the network replaced by the real responses
// saved in fixtures: the 402 from vet402, the free record, and the RPC reads.
import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { randomBytes } from 'node:crypto'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { privateKeyToAccount } from 'viem/accounts'
import liveHeaders from '../rwa-verify/fixtures/live-facts-2026-10-08.headers.json'
import { parseSimulation } from './cre'
import { LIVE, PAYMENT_REQUIRED } from './test-helpers'
import { CapReached } from './x402'

const dir = mkdtempSync(join(tmpdir(), 'copy-guard-'))
const LEDGER = join(dir, 'spend.json')
const PAYER = '0xc380D9F41D90765A4820429B9Da151889E8bED94'
process.env.BLI_AGENT_KEY_FILE = join(dir, 'no-such.key')
process.env.BLI_AGENT_LEDGER = LEDGER

type Seen = { url: string; headers: Record<string, string>; body?: string }
/** USDG logs the mocked chain returns for the payer: none unless a test sets them. */
let payerTransfers: { data: string }[] = []
const chainLogs = (f: any) => (f.topics?.[0] === '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef' ? payerTransfers : [])
const seen: Seen[] = []
/** What the mocked chain answers to eth_call (USDG balanceOf and allowance): zero unless a test sets it. */
let callResult = `0x${'0'.repeat(64)}`
/** How the mocked paid route treats a request that carries a payment: unset means it is not expected. */
let onPaidRequest: ((init: any) => Promise<Response>) | null = null
const realFetch = globalThis.fetch

beforeAll(() => {
	globalThis.fetch = (async (input: any, init?: any) => {
		const url = String(input?.url ?? input)
		const headers: Record<string, string> = {}
		new Headers(init?.headers ?? {}).forEach((v, k) => (headers[k] = v))
		seen.push({ url, headers, body: init?.body })
		if (url.startsWith('https://vet402.com/api/v1/rwa/paid/facts/')) {
			if (headers['payment-signature']) return onPaidRequest ? onPaidRequest(init) : new Response('a payment was sent in a test that expects none', { status: 599 })
			return new Response(JSON.stringify(PAYMENT_REQUIRED.decoded), {
				status: 402,
				headers: { 'PAYMENT-REQUIRED': PAYMENT_REQUIRED.payment_required_header, 'content-type': 'application/json' },
			})
		}
		if (url.startsWith('https://vet402.com/api/v1/rwa/facts/')) {
			return new Response(JSON.stringify(LIVE), { status: 200, headers: { 'X-Facts-Hash': liveHeaders['x-facts-hash'] } })
		}
		if (url === 'https://rpc.mainnet.chain.robinhood.com') {
			const call = JSON.parse(init.body)
			const result =
				call.method === 'eth_getCode'
					? '0x6080'
					: call.method === 'eth_call'
						? callResult
						: call.method === 'eth_blockNumber'
							? '0x4fc5a00'
							: call.method === 'eth_getLogs'
								? chainLogs(call.params[0])
								: null
			return new Response(JSON.stringify({ jsonrpc: '2.0', id: call.id, result }), { status: 200 })
		}
		return new Response('not mocked', { status: 599 })
	}) as typeof fetch
})
afterAll(() => {
	globalThis.fetch = realFetch
})

describe('dry run', () => {
	test('reads the 402, builds the payment, signs nothing, sends nothing, reads the same JSON for free', async () => {
		const { buyRecord } = await import('./main')
		const out = mkdtempSync(join(tmpdir(), 'out-'))
		const b = await buyRecord('0xE9B08727131E34010b34006c660D4c1B436EC25f', { wallet: '', max: 1, pay: false, approve: false, broadcast: false }, PAYER, out)
		expect(b.purchase.mode).toBe('dry-run')
		expect(b.purchase.payment_tx).toBeNull()
		expect(b.purchase.settlement).toBe('not-sent')
		expect(b.purchase.permit2_digest).toMatch(/^0x[0-9a-f]{64}$/)
		expect(b.terms.amount).toBe('10000')
		expect(b.xFactsHash).toBe(liveHeaders['x-facts-hash'])
		expect(b.facts.address).toBe(LIVE.address)
		// no payment header ever left, no key was needed, no spend was recorded
		expect(seen.some((s) => s.headers['payment-signature'])).toBe(false)
		expect(existsSync(process.env.BLI_AGENT_KEY_FILE as string)).toBe(false)
		expect(existsSync(LEDGER)).toBe(false)
		const saved = JSON.parse(readFileSync(join(out, 'x402-dry-run.json'), 'utf8'))
		expect(saved.signed).toBe(false)
		expect(saved.permit2_typed_data.message.spender).toBe('0x402085c248EeA27D92E8b30b2C58ed07f9E20001')
		expect(saved.permit2_typed_data.message.witness.to).toBe('0x973cD8a91A771C2C04C6036888F8175D6b4F6227')
		expect(saved.payer).toBe(PAYER)
	})

	test('a wallet already at the cap stops before anything is built into a payment', async () => {
		const { buyRecord } = await import('./main')
		writeFileSync(LEDGER, JSON.stringify({ payer: PAYER, cap_atomic: '1000000', entries: [{ at: '', resource: '', amount_atomic: '995000', status: 'settled', tx: null }] }))
		const out = mkdtempSync(join(tmpdir(), 'out-'))
		await expect(buyRecord('0xE9B08727131E34010b34006c660D4c1B436EC25f', { wallet: '', max: 1, pay: false, approve: false, broadcast: false }, PAYER, out)).rejects.toThrow(CapReached)
		expect(existsSync(join(out, 'x402-dry-run.json'))).toBe(false)
	})

	test('a deleted ledger does not reset the count: USDG already sent onchain stops the run', async () => {
		const { buyRecord } = await import('./main')
		const { LedgerMissing } = await import('./pay')
		rmSync(LEDGER, { force: true })
		payerTransfers = [{ data: '0x2710' }]
		const out = mkdtempSync(join(tmpdir(), 'out-'))
		try {
			await expect(buyRecord('0xE9B08727131E34010b34006c660D4c1B436EC25f', { wallet: '', max: 1, pay: false, approve: false, broadcast: false }, PAYER, out)).rejects.toThrow(LedgerMissing)
		} finally {
			payerTransfers = []
		}
	})

	test('arguments: --approve needs --pay, the default is a dry run on the demo wallet', async () => {
		const { parseArgs } = await import('./main')
		expect(() => parseArgs(['--approve'])).toThrow()
		const a = parseArgs([])
		expect(a.pay).toBe(false)
		expect(a.broadcast).toBe(false)
		expect(a.wallet).toBe('0xE9B08727131E34010b34006c660D4c1B436EC25f')
	})
})

describe('the paid request', () => {
	test('a paid route that never answers is given up on, and the payment counts as spent', async () => {
		const { buyRecord } = await import('./main')
		const { ledgerPath } = await import('./pay')
		// Nothing here can reach a network or a real wallet: fetch is the mock above, the
		// ledger is the temp file, and the key is random bytes made for this test.
		expect(ledgerPath()).toBe(LEDGER)
		rmSync(LEDGER, { force: true })
		const keyFile = process.env.BLI_AGENT_KEY_FILE as string
		const key = `0x${randomBytes(32).toString('hex')}` as const
		const payer = privateKeyToAccount(key).address
		writeFileSync(keyFile, key)
		callResult = `0x${(10_000).toString(16).padStart(64, '0')}`
		let aborted = false
		onPaidRequest = (init) =>
			new Promise((_resolve, reject) => {
				if (!init?.signal) return reject(new Error('the paid request has no time limit'))
				init.signal.addEventListener('abort', () => ((aborted = true), reject(init.signal.reason)))
			})
		const out = mkdtempSync(join(tmpdir(), 'out-'))
		const started = Date.now()
		try {
			await expect(
				buyRecord('0xE9B08727131E34010b34006c660D4c1B436EC25f', { wallet: '', max: 1, pay: true, approve: false, broadcast: false }, payer, out, { paidTimeoutMs: 50 }),
			).rejects.toMatchObject({ name: 'TimeoutError' })
			expect(aborted).toBe(true)
			expect(Date.now() - started).toBeLessThan(5000)
			const ledger = JSON.parse(readFileSync(LEDGER, 'utf8'))
			expect(ledger.entries).toHaveLength(1)
			expect(ledger.entries[0]).toMatchObject({ status: 'unknown', amount_atomic: '10000', tx: null })
			expect(existsSync(`${LEDGER}.lock`)).toBe(false)
		} finally {
			onPaidRequest = null
			callResult = `0x${'0'.repeat(64)}`
			rmSync(keyFile, { force: true })
			rmSync(LEDGER, { force: true })
		}
	})

	test('the default time limit is one minute, under the ten minutes after which a lock may be taken over', async () => {
		const { PAID_REQUEST_TIMEOUT_MS } = await import('./main')
		const { LOCK_STALE_MS } = await import('./pay')
		expect(PAID_REQUEST_TIMEOUT_MS).toBe(60_000)
		expect(PAID_REQUEST_TIMEOUT_MS).toBeLessThan(LOCK_STALE_MS)
	})
})

describe('reading the CRE simulator output', () => {
	test('a simulated run gives the verdict and no tx', () => {
		const r = parseSimulation<{ verdict: string; reasonBits: number }>(readFileSync(join(import.meta.dir, '../docs/simulate-match.txt'), 'utf8'))
		expect(r.result.verdict).toBe('MATCH')
		expect(r.tx).toBeNull()
	})

	test('a broadcast run gives the verdict and the testnet tx', () => {
		const r = parseSimulation<{ verdict: string; reasonBits: number }>(readFileSync(join(import.meta.dir, '../docs/broadcast-mismatch-one-char.txt'), 'utf8'))
		expect(r.result.verdict).toBe('MISMATCH')
		expect(r.result.reasonBits).toBe(288)
		expect(r.tx).toBe('0x7c5fd35427be3e1e2531d957f7fd2712adc1c591d6c3ec7937bfca8372ffebeb')
	})
})
