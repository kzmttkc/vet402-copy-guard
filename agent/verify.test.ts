// verify.mjs is a second writing of the hash, the rules and the chain checks, with no
// dependency and no import from the agent. These tests hold the two writings against
// each other, and run the whole recheck against saved RPC answers: every way it should
// say MATCH, MISMATCH or NOT CHECKED.
import { describe, expect, test } from 'bun:test'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { keccak256 as viemKeccak } from 'viem'
import anchorReceipt from '../rwa-verify/fixtures/anchor-receipt.json'
import anchored from '../rwa-verify/fixtures/anchored-record.json'
import anchorCode from '../rwa-verify/fixtures/rwaanchor-code.json'
import verifyConfig from '../rwa-verify/config.json'
import { ANCHORED_TOPIC, canonicalJson, commitment, RWA_ANCHOR_ADDRESS, RWA_ANCHOR_RUNTIME_KECCAK, subjectHash } from '../rwa-verify/verify'
import trailConfig from '../trail-anchor/config.json'
// @ts-expect-error verify.mjs is plain JavaScript on purpose and ships no types
import * as V from '../verify.mjs'
import { DECISION_TOPIC, RECORD_CHECKED_TOPIC } from './check-trail'
import r68837431 from './fixtures/receipt-68837431.json'
import r73953009 from './fixtures/receipt-73953009.json'
import r81262132 from './fixtures/receipt-81262132.json'
import paymentReceipt from './fixtures/verify/payment-receipt.json'
import t68837431 from './fixtures/verify/trail-receipt-68837431.json'
import t73953009 from './fixtures/verify/trail-receipt-73953009.json'
import t81262132 from './fixtures/verify/trail-receipt-81262132.json'
import verdictReceipt from './fixtures/verify/verdict-receipt.json'
import { groupMovements, TRANSFER_TOPIC } from './movement'
import { recordInputs } from './record'
import { CONCLUSION_CODE, type DecisionInputs, decide, MAX_PRICE_ATOMIC, PAY_TO, RULES, USDG } from './rules'
import { CRE_MATCH, FAKE_NVDA, FAKE_USDG, inputs, LIVE, liveRecord, profitableRecord, QQQ_BUY, WALLET } from './test-helpers'
import { recheckTrail, trailHash } from './trail'

const REPO = join(import.meta.dir, '..')
const RUN = join(REPO, 'docs/agent/first-paid-run')
const json = (p: string) => JSON.parse(readFileSync(p, 'utf8'))
const TRAILS = ['trail-68837431-0eac7685.json', 'trail-73953009-1b838f40.json', 'trail-81262132-f7cb51a2.json']

describe('verify.mjs against the agent: same hash', () => {
	test('its keccak256 gives what viem gives, across block boundaries', () => {
		expect(V.checkKeccak()).toBe(true)
		let seed = 7
		const next = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) & 0xff
		for (const n of [0, 1, 31, 32, 55, 135, 136, 137, 271, 272, 273, 1000, 4096, 14466]) {
			const bytes = Uint8Array.from({ length: n }, next)
			expect(V.keccak256(bytes)).toBe(viemKeccak(bytes))
		}
		expect(V.keccak256('héllo ✓ 株')).toBe(viemKeccak(new TextEncoder().encode('héllo ✓ 株')))
	})

	test('the same canonical JSON and the same factsHash for every record in this repo', () => {
		const records = [LIVE, anchored.facts, json(join(RUN, 'record.json')), json(join(REPO, 'docs/agent/replay-dry-run/record.json'))]
		for (const r of records) {
			expect(V.canonicalJson(r)).toBe(canonicalJson(r))
			expect(V.factsHash(r)).toBe(commitment(r as any).hash)
		}
		expect(V.factsHash(anchored.facts)).toBe(anchored.facts_hash)
		expect(V.subjectOf(WALLET)).toBe(subjectHash(WALLET))
		// older method versions bind five fields only
		const old = { ...(LIVE as any), method_version: 'rwa-recon-0.2' }
		expect(V.factsHash(old)).toBe(commitment(old).hash)
		expect(() => V.factsHash({ ...(LIVE as any), method_version: 'rwa-recon-9' })).toThrow()
	})

	test('the same record fields for the rules', () => {
		const meta = { source_url: 'https://example.test/x', x_facts_hash: `0x${'AB'.repeat(32)}` }
		for (const r of [LIVE, json(join(RUN, 'record.json'))]) expect(V.recordFields(r, meta)).toEqual(recordInputs(r, meta))
	})

	test('the same addresses, topics and limits', () => {
		expect(V.USDG).toBe(USDG)
		expect(V.CLAIMS.payee).toBe(PAY_TO)
		expect(V.CLAIMS.priceAtomic).toBe(MAX_PRICE_ATOMIC)
		expect(V.CLAIMS.wallet).toBe(WALLET)
		expect(V.CLAIMS.anchorTx).toBe(verifyConfig.anchorTx)
		expect(V.RWA_ANCHOR).toBe(RWA_ANCHOR_ADDRESS)
		expect(V.RWA_ANCHOR_RUNTIME_KECCAK).toBe(RWA_ANCHOR_RUNTIME_KECCAK)
		expect(V.VERDICT_RECEIVER).toBe(verifyConfig.receiverAddress.toLowerCase())
		expect(V.TRAIL_RECEIVER).toBe(trailConfig.receiverAddress.toLowerCase())
		expect(V.TRANSFER_TOPIC).toBe(TRANSFER_TOPIC)
		expect(V.ANCHORED_TOPIC).toBe(ANCHORED_TOPIC)
		expect(V.DECISION_TOPIC).toBe(DECISION_TOPIC)
		expect(V.RECORD_CHECKED_TOPIC).toBe(RECORD_CHECKED_TOPIC)
		expect(V.CONCLUSION_CODE).toEqual(CONCLUSION_CODE)
		expect([V.RULES_ID, V.RULES_VERSION]).toEqual([RULES.id, RULES.version])
		expect(V.CHAINS.mainnet.rpcs[0]).toBe(verifyConfig.robinhoodRpc)
	})
})

// ---------------------------------------------------------------- the rules, twice

type Mut = (i: DecisionInputs) => void
const OTHER = '0x1111111111111111111111111111111111111111'
const MUTATIONS: Record<string, Mut> = {
	'terms.scheme': (i) => void (i.terms.scheme = 'upto'),
	'terms.network': (i) => void (i.terms.network = 'eip155:1'),
	'terms.asset': (i) => void (i.terms.asset = OTHER),
	'terms.amount over': (i) => void (i.terms.amount = '10001'),
	'terms.amount zero': (i) => void (i.terms.amount = '0'),
	'terms.amount text': (i) => void (i.terms.amount = '1e4'),
	'terms.payTo': (i) => void (i.terms.payTo = OTHER),
	'terms.method': (i) => void (i.terms.assetTransferMethod = 'eip3009'),
	'record.header none': (i) => void (i.record.x_facts_hash = ''),
	'record.header other': (i) => void (i.record.x_facts_hash = `0x${'12'.repeat(32)}`),
	'record.address': (i) => void (i.record.address = OTHER),
	'record.chain': (i) => void (i.record.chain_id = 1),
	'record.method': (i) => void (i.record.method_version = 'other-1.0'),
	'record.unverified': (i) => void (i.record.r1_status = 'unverified'),
	'record.reconstructed': (i) => void (i.record.r1_status = 'reconstructed'),
	'record.partial': (i) => void (i.record.r1_status = 'partial'),
	'record.realized null': (i) => void (i.record.realized_usd = null),
	'record.realized zero': (i) => void (i.record.realized_usd = '0.00'),
	'record.realized plus': (i) => void (i.record.realized_usd = '12.50'),
	'record.realized minus': (i) => void (i.record.realized_usd = '-0.01'),
	'record.realized text': (i) => void (i.record.realized_usd = 'lots'),
	'record.lookalike counted': (i) => void (i.record.lookalikes[0].counted = true),
	'record.lookalike review': (i) => void (i.record.lookalikes[0].needs_review = true),
	'record.no lookalikes': (i) => void (i.record.lookalikes = []),
	'record.old block': (i) => void (i.record.as_of_block = 1),
	'record.no price': (i) => void i.record.tokens.forEach((t) => (t.usd = null)),
	'record.no shares': (i) => void i.record.tokens.forEach((t) => (t.shares_ui = '0.00000000')),
	'record.not canonical': (i) => void i.record.tokens.forEach((t) => (t.canonical = false)),
	'cre.mismatch': (i) => void ((i.cre.verdict = 'MISMATCH'), (i.cre.reason_bits = 32)),
	'cre.no anchor': (i) => void ((i.cre.verdict = 'NO_ANCHOR'), (i.cre.anchor_tx = '')),
	'cre.hashes': (i) => void (i.cre.anchored_facts_hash = `0x${'34'.repeat(32)}`),
	'move.none': (i) => void (i.movement.transfers = []),
	'move.unknown token': (i) => void i.movement.transfers.slice(0, 1).forEach((t) => (t.token = OTHER)),
	'move.out': (i) => void i.movement.transfers.forEach((t) => (t.direction = 'out')),
	'move.upper case': (i) => void i.movement.transfers.forEach((t) => (t.token = t.token.toUpperCase().replace('0X', '0x'))),
}

describe('verify.mjs against the agent: same rules', () => {
	const bases = [QQQ_BUY, FAKE_NVDA, FAKE_USDG].flatMap((m) => [inputs(m), inputs(m, { record: profitableRecord() })])
	const names = Object.keys(MUTATIONS)

	test('every base case, every single change and every pair of changes gives the same rows and conclusion', () => {
		const conclusions = new Set<string>()
		const passed = new Set<string>()
		const failed = new Set<string>()
		let cases = 0
		const compare = (inp: DecisionInputs) => {
			const a = decide(inp)
			const b = V.decide(inp)
			expect(canonicalJson(b)).toBe(canonicalJson(a))
			conclusions.add(a.conclusion)
			for (const r of a.rule_results) (r.ok ? passed : failed).add(r.id)
			cases++
		}
		for (const base of bases) {
			compare(structuredClone(base))
			for (let x = 0; x < names.length; x++) {
				const one = structuredClone(base)
				MUTATIONS[names[x]](one)
				compare(one)
				for (let y = x + 1; y < names.length; y++) {
					const two = structuredClone(base)
					MUTATIONS[names[x]](two)
					MUTATIONS[names[y]](two)
					compare(two)
				}
			}
		}
		// the comparison was not vacuous: all three conclusions, and every rule both passing and failing
		expect([...conclusions].sort()).toEqual(['COPY', 'DO_NOT_COPY', 'HOLD'])
		const ids = V.RULE_TABLE.map((r: { id: string }) => r.id)
		expect(ids).toEqual(['A1', 'A2', 'A3', 'A4', 'A5', 'A6', 'B1', 'B2', 'C1', 'C2', 'C3', 'C4', 'C5'])
		expect([...passed].sort()).toEqual(ids)
		expect([...failed].sort()).toEqual(ids)
		expect(cases).toBeGreaterThan(3000)
	}, 120_000)

	test('every saved trail: no problem for either checker, and the same hash', () => {
		for (const dir of ['first-paid-run', 'replay-dry-run']) {
			for (const f of TRAILS) {
				const file = json(join(REPO, 'docs/agent', dir, f))
				expect(V.trailProblems(file.trail).problems).toEqual([])
				expect(recheckTrail(file.trail).ok).toBe(true)
				expect(V.keccak256(V.canonicalJson(file.trail))).toBe(trailHash(file.trail))
				expect(trailHash(file.trail)).toBe(file.trail_hash)
			}
		}
	})

	test('a trail whose conclusion, row or input was edited is refused by both', () => {
		const edits: ((t: any) => void)[] = [
			(t) => void (t.decision.conclusion = 'COPY'),
			(t) => void (t.decision.rule_results[8].ok = true),
			(t) => void (t.decision.rule_results[0].detail = 'edited'),
			(t) => void (t.decision.rule_results[0].rule = 'a kinder rule'),
			(t) => void t.decision.rule_results.pop(),
			(t) => void (t.decision.decisive = []),
			(t) => void (t.decision.paper_trade = { side: 'buy' }),
			(t) => void (t.inputs.record.realized_usd = '999.00'),
			(t) => void (t.purchase.payment_tx = null),
			(t) => void (t.purchase.mode = 'dry-run'),
			(t) => void (t.trail_version = 2),
			(t) => void (t.rules.version = 2),
		]
		for (const edit of edits) {
			const t = json(join(RUN, TRAILS[1])).trail
			edit(t)
			expect(V.trailProblems(t).problems.length).toBeGreaterThan(0)
			expect(recheckTrail(t).ok).toBe(false)
		}
	})

	test('the same reading of Transfer logs', () => {
		for (const r of [r68837431, r73953009, r81262132]) {
			const [m] = groupMovements(WALLET, r.logs as any)
			expect(V.movementFromLogs(WALLET, m.tx, r.logs)).toEqual(m)
		}
		expect(V.movementFromLogs(OTHER, r73953009.logs[0].transactionHash, r73953009.logs)).toBeNull()
	})
})

// ---------------------------------------------------------------- the whole recheck, against saved RPC answers

/** One recheck hashes about 100 kB with BigInt arithmetic, which is slow in Bun. These tests run many. */
const SLOW = 120_000
const MAIN = 'https://rpc.mainnet.chain.robinhood.com'
const BACKUP = 'https://robinhood-rpc.publicnode.com'
const TEST = 'https://rpc.testnet.chain.robinhood.com'
type Receipt = { transactionHash: string; blockNumber: string; status: string; logs: any[] }

function world() {
	const clone = <T>(x: T) => structuredClone(x) as T
	return {
		main: Object.fromEntries([anchorReceipt, paymentReceipt, r68837431, r73953009, r81262132].map((r) => [(r as Receipt).transactionHash.toLowerCase(), clone(r) as Receipt])),
		test: Object.fromEntries([verdictReceipt, t68837431, t73953009, t81262132].map((r) => [(r as Receipt).transactionHash.toLowerCase(), clone(r) as Receipt])),
		code: anchorCode.code,
		chainIds: { [MAIN]: '0x1237', [BACKUP]: '0x1237', [TEST]: '0xb626' } as Record<string, string>,
		/** Per URL: how many requests fail before it starts answering, and how. */
		broken: {} as Record<string, { left: number; how: 'throw' | number }>,
		calls: [] as { url: string; method: string }[],
	}
}
type World = ReturnType<typeof world>

function fetchFor(w: World) {
	return async (url: string, init: any) => {
		const call = JSON.parse(init.body)
		w.calls.push({ url, method: call.method })
		const b = w.broken[url]
		if (b && b.left > 0) {
			b.left--
			if (b.how === 'throw') throw Object.assign(new TypeError('fetch failed'), { cause: { code: 'ECONNREFUSED' } })
			return new Response('busy', { status: b.how })
		}
		const receipts = url === TEST ? w.test : w.main
		let result: unknown = null
		if (call.method === 'eth_chainId') result = w.chainIds[url]
		else if (call.method === 'eth_getTransactionReceipt') result = receipts[call.params[0].toLowerCase()] ?? null
		else if (call.method === 'eth_getCode') result = call.params[0].toLowerCase() === RWA_ANCHOR_ADDRESS ? w.code : '0x'
		else if (call.method === 'eth_getLogs') {
			const f = call.params[0]
			result = Object.values(receipts)
				.flatMap((r) => r.logs)
				.filter((l) => BigInt(l.blockNumber) >= BigInt(f.fromBlock) && BigInt(l.blockNumber) <= BigInt(f.toBlock))
				.filter((l) => (f.topics as (string | null)[]).every((t, i) => t === null || l.topics[i]?.toLowerCase() === t.toLowerCase()))
		}
		return new Response(JSON.stringify({ jsonrpc: '2.0', id: call.id, result }), { status: 200 })
	}
}

async function recheck(w: World, argv: string[] = []) {
	const lines: string[] = []
	const code = await V.run(argv, { print: (l: string) => lines.push(l), fetchImpl: fetchFor(w), pauseMs: 0 })
	const rows = (mark: string) => lines.filter((l) => l.startsWith(`  ${mark}`))
	return { code, lines, fail: rows('FAIL'), open: rows('----'), ok: rows('OK'), last: lines[lines.length - 1] }
}

const usdgLog = (w: World) => w.main[V.CLAIMS.paymentTx].logs.find((l) => l.address.toLowerCase() === USDG)
const pad32 = (addr: string) => `0x${'0'.repeat(24)}${addr.slice(2)}`

describe('verify.mjs: the whole recheck', () => {
	test('the saved evidence and the saved chain answers: 26 lines OK, MATCH, exit code 0', async () => {
		const r = await recheck(world())
		expect(r.fail).toEqual([])
		expect(r.open).toEqual([])
		expect(r.ok).toHaveLength(26)
		expect(r.last).toBe('RESULT: MATCH')
		expect(r.code).toBe(0)
	}, SLOW)

	test('the payment: another amount, payer, payee, token, a second transfer, a failed or missing tx are each MISMATCH', async () => {
		const breaks: [string, (w: World) => void][] = [
			['amount', (w) => void (usdgLog(w).data = `0x${(9_999).toString(16).padStart(64, '0')}`)],
			['payer', (w) => void (usdgLog(w).topics[1] = pad32(OTHER))],
			['payee', (w) => void (usdgLog(w).topics[2] = pad32(OTHER))],
			['token', (w) => void (usdgLog(w).address = OTHER)],
			['second transfer', (w) => void w.main[V.CLAIMS.paymentTx].logs.push({ ...usdgLog(w), topics: [TRANSFER_TOPIC, pad32(V.CLAIMS.payee), pad32(V.CLAIMS.payer)] })],
			['failed tx', (w) => void (w.main[V.CLAIMS.paymentTx].status = '0x0')],
			['no such tx', (w) => void delete w.main[V.CLAIMS.paymentTx]],
		]
		for (const [name, brk] of breaks) {
			const w = world()
			brk(w)
			const r = await recheck(w)
			expect([name, r.code, r.last]).toEqual([name, 1, 'RESULT: MISMATCH'])
			expect(r.fail.some((l) => l.includes('USDG moved') || l.includes('settlement tx'))).toBe(true)
		}
	}, SLOW)

	test('the anchor: another hash, wallet, operator, contract, contract code or date is MISMATCH', async () => {
		const log = (w: World) => w.main[V.CLAIMS.anchorTx].logs[0]
		const breaks: ((w: World) => void)[] = [
			(w) => void (log(w).topics[2] = `0x${'ab'.repeat(32)}`),
			(w) => void (log(w).topics[1] = `0x${'ab'.repeat(32)}`),
			(w) => void (log(w).topics[3] = pad32(OTHER)),
			(w) => void (log(w).address = OTHER),
			(w) => void (w.code = `${w.code}00`),
			(w) => void (log(w).data = `${log(w).data.slice(0, -1)}0`),
		]
		for (const brk of breaks) {
			const w = world()
			brk(w)
			const r = await recheck(w)
			expect([r.code, r.last]).toEqual([1, 'RESULT: MISMATCH'])
			expect(r.fail.some((l) => l.includes('anchored hash') || l.includes('anchor contract'))).toBe(true)
		}
	}, SLOW)

	test('the onchain events: another trail hash, conclusion, payment tx, emitter or CRE verdict is MISMATCH', async () => {
		const decision = (w: World) => w.test[t73953009.transactionHash].logs[0]
		const verdict = (w: World) => w.test[verdictReceipt.transactionHash].logs[0]
		const breaks: [string, (w: World) => void][] = [
			['trail onchain', (w) => void (decision(w).topics[1] = `0x${'ab'.repeat(32)}`)],
			['trail onchain', (w) => void (decision(w).topics[3] = `0x${'0'.repeat(63)}2`)],
			['trail onchain', (w) => void (decision(w).data = decision(w).data.replace(V.CLAIMS.paymentTx.slice(2), 'ab'.repeat(32)))],
			['trail onchain', (w) => void (decision(w).address = OTHER)],
			['trail onchain', (w) => void delete w.test[t73953009.transactionHash]],
			['CRE verdict', (w) => void (verdict(w).topics[3] = `0x${'0'.repeat(64)}`)],
			['CRE verdict', (w) => void (verdict(w).address = OTHER)],
			['move on chain', (w) => void (w.main[r73953009.transactionHash].logs = [])],
		]
		for (const [row, brk] of breaks) {
			const w = world()
			brk(w)
			const r = await recheck(w)
			expect([row, r.code, r.last]).toEqual([row, 1, 'RESULT: MISMATCH'])
			expect(r.fail.every((l) => l.includes(row))).toBe(true)
			expect(r.fail.length).toBeGreaterThan(0)
		}
	}, SLOW)

	test('an RPC that cannot be reached is NOT CHECKED, exit code 3, and never a FAIL', async () => {
		for (const how of ['throw', 503, 429] as const) {
			const w = world()
			w.broken = { [MAIN]: { left: 1e9, how }, [BACKUP]: { left: 1e9, how }, [TEST]: { left: 1e9, how } }
			const r = await recheck(w)
			expect(r.fail).toEqual([])
			expect(r.open).toHaveLength(12)
			expect(r.ok).toHaveLength(14)
			expect([r.code, r.last]).toEqual([3, 'RESULT: NOT CHECKED'])
		}
		const offline = await recheck(world(), ['--offline'])
		expect([offline.code, offline.last, offline.fail.length, offline.open.length]).toEqual([3, 'RESULT: NOT CHECKED', 0, 12])
		expect(world().calls).toEqual([])
	}, SLOW)

	test('a failed check wins over an unreachable RPC: MISMATCH, exit code 1', async () => {
		const w = world()
		w.broken = { [TEST]: { left: 1e9, how: 'throw' } }
		usdgLog(w).data = `0x${'0'.repeat(64)}`
		const r = await recheck(w)
		expect(r.open.length).toBeGreaterThan(0)
		expect([r.code, r.last]).toEqual([1, 'RESULT: MISMATCH'])
	}, SLOW)

	test('a busy RPC is asked again, a dead one is replaced by the second, an RPC of another chain is not believed', async () => {
		const busy = world()
		busy.broken = { [MAIN]: { left: 2, how: 429 }, [TEST]: { left: 1, how: 502 } }
		expect((await recheck(busy)).code).toBe(0)

		const dead = world()
		dead.broken = { [MAIN]: { left: 1e9, how: 'throw' } }
		const r = await recheck(dead)
		expect(r.code).toBe(0)
		// given up on after three tries, then not asked again
		expect(dead.calls.filter((c) => c.url === MAIN)).toHaveLength(3)

		const wrong = world()
		wrong.chainIds[MAIN] = '0x1'
		wrong.chainIds[BACKUP] = '0x1'
		const x = await recheck(wrong)
		expect([x.code, x.fail.length]).toEqual([3, 0])
		expect(x.open[0]).toContain('is chain 1, not Robinhood Chain 4663')
	}, SLOW)

	test('one decision by block number or by file; an edited copy is MISMATCH', async () => {
		const byBlock = await recheck(world(), ['73953009'])
		expect([byBlock.code, byBlock.last, byBlock.ok.length]).toEqual([0, 'RESULT: MATCH', 9])
		expect(byBlock.lines.some((l) => l.includes('trail-73953009-1b838f40.json'))).toBe(true)
		expect(byBlock.lines.some((l) => l.includes('68837431'))).toBe(false)

		const dir = mkdtempSync(join(tmpdir(), 'verify-'))
		const copy = join(dir, 'trail.json')
		const file = json(join(RUN, TRAILS[0]))
		writeFileSync(copy, JSON.stringify(file))
		expect((await recheck(world(), [copy])).code).toBe(0)

		// one character of the trail changed, the stated hash left alone
		file.trail.inputs.record.realized_usd = '-273.02'
		writeFileSync(copy, JSON.stringify(file))
		const edited = await recheck(world(), [copy])
		expect(edited.code).toBe(1)
		expect(edited.fail.map((l) => l.trim().split(/\s{2,}/)[1])).toEqual(['trail hash', 'rules', 'trail onchain'])

		// the same edit with the hash recomputed to match: the rules and the chain still refuse it
		file.trail_hash = trailHash(file.trail)
		writeFileSync(copy, JSON.stringify(file))
		const rehashed = await recheck(world(), [copy])
		expect(rehashed.code).toBe(1)
		expect(rehashed.fail.map((l) => l.trim().split(/\s{2,}/)[1])).toEqual(['rules', 'trail onchain'])
	}, SLOW)

	test('wrong arguments: exit code 2 and no check is run', async () => {
		for (const argv of [['123'], ['--nope'], ['a.json', 'b.json'], ['--rpc'], ['/no/such/trail.json'], ['--help']]) {
			const w = world()
			const r = await recheck(w, argv)
			expect(r.code).toBe(2)
			expect(w.calls).toEqual([])
			expect(r.lines.join('\n')).toContain('usage: node verify.mjs')
		}
	}, SLOW)

	test('from the command line with no network: the exit code is 3 and the last line says NOT CHECKED', () => {
		const node = spawnSync('node', ['--version']).status === 0 ? 'node' : process.execPath
		const r = spawnSync(node, [join(REPO, 'verify.mjs'), '--offline'], { encoding: 'utf8' })
		expect(r.status).toBe(3)
		expect(r.stdout.trimEnd().split('\n').pop()).toBe('RESULT: NOT CHECKED')
		expect(r.stdout).not.toContain('FAIL  ')
	}, SLOW)
})
