// The batch check, pure part: what one token is from what was read, the wording
// of the reasons, what fits in one run, and the shape of the results file.
import { describe, expect, test } from 'bun:test'
import { canonicalJson, keccakText } from '../rwa-verify/verify'
import {
	BATCH_REASON_TEXT,
	BATCH_REASONS,
	type BatchTokenState,
	batchHash,
	EMPTY_CODE_HASH,
	ITEMS_PER_CALL,
	judgeBatch,
	judgeBatchToken,
	LIST_HASH,
	LOG_SPAN_BLOCKS,
	logItems,
	logWindows,
	MAX_BATCH_TOKENS,
	PLAN_HTTP_CALLS,
	planRuns,
	plannedHttpCalls,
	renderBatch,
	resultsProblem,
	SHARES_A_LISTED_MARK,
} from './batch'
import { MULTIPLIER_ONE, SNAPSHOT, STOCK_TOKEN_BEACON, STOCK_TOKEN_CODE_HASH, USDG } from './check'

const BLOCK = 87_990_000
const NVDA = SNAPSHOT.tokens.find((t) => t.symbol === 'NVDA')!
const QQQ = SNAPSHOT.tokens.find((t) => t.symbol === 'QQQ')!
const STRANGER = '0x5dd716fe12275b69f04b26beeca343843c8e3539'
const OTHER_CODE = `0x${'ab'.repeat(32)}`
const slot = (a: string) => `0x${'0'.repeat(24)}${a.slice(2)}`

const genuine = (t: { token: string; symbol: string; name: string }, over: Partial<BatchTokenState> = {}): BatchTokenState => ({
	token: t.token,
	codeHash: STOCK_TOKEN_CODE_HASH,
	beaconSlot: slot(STOCK_TOKEN_BEACON),
	symbol: t.symbol,
	name: `${t.name} • Robinhood Token`,
	multiplier: MULTIPLIER_ONE,
	factoryLog: true,
	multiplierUpdates: 0,
	...over,
})
const stranger = (symbol: string | null, name: string | null, over: Partial<BatchTokenState> = {}): BatchTokenState => ({
	token: STRANGER,
	codeHash: OTHER_CODE,
	beaconSlot: `0x${'0'.repeat(64)}`,
	symbol,
	name,
	multiplier: null,
	factoryLog: null,
	multiplierUpdates: null,
	...over,
})
const row = (s: BatchTokenState) => judgeBatchToken(s, BLOCK).result

describe('one token', () => {
	test("the issuer's token: every ground is named, and the row has the five keys and no other", () => {
		const r = row(genuine(NVDA))
		expect(r).toEqual({
			issuer_token: true,
			ticker: 'NVDA',
			reasons: ['IN_ISSUER_LIST', 'CODE_HASH_MATCHES', 'BEACON_MATCHES', 'FACTORY_LOG_NAMES_TOKEN', 'TICKER_MATCHES_LIST'],
			multiplier_updates: 0,
			checked_block: BLOCK,
		})
		expect(Object.keys(r)).toEqual(['issuer_token', 'ticker', 'reasons', 'multiplier_updates', 'checked_block'])
	})

	test('a changed multiplier is counted and noted, and the token is still the issuer\'s', () => {
		const r = row(genuine(QQQ, { multiplier: '1000700791241405425', multiplierUpdates: 1 }))
		expect(r.issuer_token).toBe(true)
		expect(r.multiplier_updates).toBe(1)
		expect(r.reasons).toEqual(['IN_ISSUER_LIST', 'CODE_HASH_MATCHES', 'BEACON_MATCHES', 'FACTORY_LOG_NAMES_TOKEN', 'TICKER_MATCHES_LIST', 'MULTIPLIER_NOT_ONE'])
		expect(judgeBatchToken(genuine(QQQ, { multiplier: '1000700791241405425', multiplierUpdates: 1 }), BLOCK).detail.multiplier).toBe('1.000700791241405425')
		// an update that is logged and not yet in effect: the count is 1 while the multiplier is still 1
		expect(row(genuine(QQQ, { multiplierUpdates: 1 }))).toMatchObject({ issuer_token: true, multiplier_updates: 1 })
		expect(row(genuine(QQQ, { multiplier: null })).reasons).toContain('MULTIPLIER_UNREADABLE')
	})

	test('a listed address the chain does not confirm is not passed, and each failed ground is named', () => {
		const cases: [Partial<BatchTokenState>, string, string][] = [
			[{ codeHash: OTHER_CODE }, 'CODE_HASH_DIFFERS', 'CODE_HASH_MATCHES'],
			[{ codeHash: EMPTY_CODE_HASH }, 'NO_CONTRACT_CODE', 'CODE_HASH_MATCHES'],
			[{ codeHash: `0x${'0'.repeat(64)}` }, 'NO_CONTRACT_CODE', 'CODE_HASH_MATCHES'],
			[{ beaconSlot: slot(STRANGER) }, 'BEACON_DIFFERS', 'BEACON_MATCHES'],
			[{ factoryLog: false }, 'FACTORY_LOG_MISSING', 'FACTORY_LOG_NAMES_TOKEN'],
			[{ symbol: 'NVDX' }, 'TICKER_DIFFERS_FROM_LIST', 'TICKER_MATCHES_LIST'],
		]
		for (const [over, has, hasNot] of cases) {
			const r = row(genuine(NVDA, over))
			expect(r.issuer_token).toBe(false)
			expect(r.ticker).toBe('NVDA')
			expect(r.reasons).toContain('IN_ISSUER_LIST')
			expect(r.reasons).toContain(has as never)
			expect(r.reasons).not.toContain(hasNot as never)
		}
		expect(() => row(genuine(NVDA, { multiplierUpdates: null }))).toThrow(/multiplier logs were not read/)
	})

	test('USDG is matched by address and is not a Stock Token', () => {
		const r = row({ token: USDG, codeHash: OTHER_CODE, beaconSlot: `0x${'0'.repeat(64)}`, symbol: 'USDG', name: 'Global Dollar', multiplier: null, factoryLog: null, multiplierUpdates: null })
		expect(r).toEqual({ issuer_token: false, ticker: 'USDG', reasons: ['USDG_ADDRESS'], multiplier_updates: 0, checked_block: BLOCK })
	})

	test('an address outside the list: what it shares with a listed token is stated, nothing more', () => {
		expect(row(stranger('WETH', 'Wrapped Ether'))).toEqual({ issuer_token: false, ticker: 'WETH', reasons: ['NOT_IN_ISSUER_LIST', 'CODE_HASH_DIFFERS', 'BEACON_DIFFERS'], multiplier_updates: 0, checked_block: BLOCK })
		expect(row(stranger('NVDA', 'NVIDIA Robinhood Coin')).reasons).toEqual([
			'NOT_IN_ISSUER_LIST',
			'CODE_HASH_DIFFERS',
			'BEACON_DIFFERS',
			'TICKER_SAME_AS_ISSUER_TOKEN',
			'NAME_SAME_AS_ISSUER_TOKEN',
			'NAME_ENDS_LIKE_ISSUER_TOKEN',
		])
		const hidden = row(stranger('U⁯S⁯DG', 'Global Dollar'))
		expect(hidden.ticker).toBe('U[U+206F]S[U+206F]DG')
		expect(hidden.reasons).toEqual(['NOT_IN_ISSUER_LIST', 'CODE_HASH_DIFFERS', 'BEACON_DIFFERS', 'TICKER_OR_NAME_READS_AS_USDG', 'INVISIBLE_CHARACTERS'])
		expect(row(stranger('NVDА', 'x')).reasons).toEqual(['NOT_IN_ISSUER_LIST', 'CODE_HASH_DIFFERS', 'BEACON_DIFFERS', 'TICKER_SAME_AFTER_FOLDING', 'HOMOGLYPH_CHARACTERS'])
		const sameCode = row(stranger('NVDA', 'NVIDIA', { codeHash: STOCK_TOKEN_CODE_HASH, beaconSlot: slot(STOCK_TOKEN_BEACON) }))
		expect(sameCode.issuer_token).toBe(false)
		expect(sameCode.reasons).toEqual(['NOT_IN_ISSUER_LIST', 'TICKER_SAME_AS_ISSUER_TOKEN', 'NAME_SAME_AS_ISSUER_TOKEN', 'ISSUER_CODE_AT_UNLISTED_ADDRESS'])
		expect(row(stranger(null, null, { codeHash: EMPTY_CODE_HASH }))).toMatchObject({ issuer_token: false, ticker: '', reasons: ['NOT_IN_ISSUER_LIST', 'NO_CONTRACT_CODE', 'BEACON_DIFFERS'] })
		for (const r of SHARES_A_LISTED_MARK) expect(BATCH_REASONS).toContain(r)
	})

	test('no reason code and no reason text says who made a token or why', () => {
		const loaded = /fake|scam|fraud|imitat|disguis|counterfeit|malicious|steal|phish|spoof|copies|claims|pretend|decei|attack|victim/i
		for (const code of BATCH_REASONS) {
			expect(code).not.toMatch(loaded)
			expect(BATCH_REASON_TEXT[code]).not.toMatch(loaded)
		}
		const lines = renderBatch(judgeBatch({ chainId: 4663, block: BLOCK, blockHash: `0x${'11'.repeat(32)}`, tokens: [genuine(NVDA), stranger('NVDA', 'NVIDIA Robinhood Coin')] }))
		for (const line of lines) expect(line).not.toMatch(loaded)
	})
})

describe('one run', () => {
	test('the batch hash is the keccak256 of the canonical JSON of the rows, whatever their order', () => {
		const a = judgeBatch({ chainId: 4663, block: BLOCK, blockHash: `0x${'11'.repeat(32)}`, tokens: [genuine(NVDA), genuine(QQQ), stranger('WETH', 'Wrapped Ether')] })
		const b = judgeBatch({ chainId: 4663, block: BLOCK, blockHash: `0x${'11'.repeat(32)}`, tokens: [stranger('WETH', 'Wrapped Ether'), genuine(QQQ), genuine(NVDA)] })
		expect(a.batchHash).toBe(b.batchHash)
		expect(a.batchHash).toBe(keccakText(canonicalJson(a.tokens)))
		expect(a.batchHash).toBe(batchHash(a.tokens))
		expect(a.issuerTokens).toBe(2)
		expect(a.listHash).toBe(LIST_HASH)
		expect(LIST_HASH).toMatch(/^0x[0-9a-f]{64}$/)
		expect(renderBatch(a).at(-2)).toBe(`RESULT: 3 tokens at block ${BLOCK}, 2 the issuer's, 1 not`)
		// one changed row changes the hash
		expect(batchHash({ ...a.tokens, [NVDA.token]: { ...a.tokens[NVDA.token], issuer_token: false } })).not.toBe(a.batchHash)
	})
})

describe('what fits in one run', () => {
	test('log windows run from the deployment to the checked block, 10,000,000 blocks at a time', () => {
		expect(logWindows(100, 100)).toEqual([[100, 100]])
		expect(logWindows(100, 100 + LOG_SPAN_BLOCKS)).toEqual([
			[100, 99 + LOG_SPAN_BLOCKS],
			[100 + LOG_SPAN_BLOCKS, 100 + LOG_SPAN_BLOCKS],
		])
		expect(logItems(STRANGER, BLOCK)).toBe(0)
		expect(logItems(USDG, BLOCK)).toBe(0)
		expect(logItems(NVDA.token, BLOCK)).toBe(1 + Math.ceil((BLOCK - NVDA.deployed_block! + 1) / LOG_SPAN_BLOCKS))
	})

	test('a plan keeps every run inside the token cap and the request budget, and loses no token', () => {
		const all = SNAPSHOT.tokens.map((t) => t.token)
		for (const separate of [true, false]) {
			const runs = planRuns(all, BLOCK, separate)
			expect(runs.flat()).toEqual(all)
			for (const run of runs) {
				expect(run.length).toBeLessThanOrEqual(MAX_BATCH_TOKENS)
				expect(plannedHttpCalls(run, BLOCK, separate)).toBeLessThanOrEqual(PLAN_HTTP_CALLS)
			}
			expect(runs.length).toBeGreaterThan(1)
		}
		// addresses outside the list cost state reads only
		const strangers = Array.from({ length: MAX_BATCH_TOKENS + 1 }, (_, i) => `0x${(i + 1).toString(16).padStart(40, '0')}`)
		expect(planRuns(strangers, BLOCK, true).map((r) => r.length)).toEqual([MAX_BATCH_TOKENS, 1])
		expect(plannedHttpCalls(strangers.slice(0, 8), BLOCK, true)).toBe(3)
		expect(plannedHttpCalls(strangers.slice(0, 8), BLOCK, false)).toBe(1 + Math.ceil((8 * 5 + 2) / ITEMS_PER_CALL))
	})
})

describe('the results file', () => {
	const rows = judgeBatch({ chainId: 4663, block: BLOCK, blockHash: `0x${'11'.repeat(32)}`, tokens: [genuine(NVDA), stranger('NVDA', 'NVIDIA Robinhood Coin')] }).tokens
	const file = () => ({ generated_at: '2026-10-14T02:00:00.000Z', cre_runs: [{ tx: `0x${'aa'.repeat(32)}`, simulate_log: 'docs/token-check/batch/batch-1.cre.txt' }], tokens: structuredClone(rows) })

	test('the fixed shape passes', () => {
		expect(resultsProblem(file())).toBeNull()
	})

	test('anything else is named as a problem', () => {
		const bad = (change: (f: any) => void) => {
			const f = file() as any
			change(f)
			return resultsProblem(f)
		}
		expect(bad((f) => void (f.note = 'x'))).toMatch(/exactly generated_at/)
		expect(bad((f) => void (f.generated_at = '2026-10-14 02:00'))).toMatch(/ISO/)
		expect(bad((f) => void (f.cre_runs = []))).toMatch(/cre_runs is empty/)
		expect(bad((f) => void (f.cre_runs[0].tx = '0x12'))).toMatch(/transaction hash/)
		expect(bad((f) => void (f.cre_runs[0].extra = 1))).toMatch(/exactly tx and simulate_log/)
		expect(bad((f) => void (f.tokens = {}))).toMatch(/tokens is empty/)
		expect(bad((f) => void (f.tokens[NVDA.token.toUpperCase()] = f.tokens[NVDA.token]))).toMatch(/lower-case address/)
		expect(bad((f) => void (f.tokens[NVDA.token].name = 'NVIDIA'))).toMatch(/five keys/)
		expect(bad((f) => void (f.tokens[NVDA.token].issuer_token = 'yes'))).toMatch(/wrong type/)
		expect(bad((f) => void (f.tokens[NVDA.token].multiplier_updates = -1))).toMatch(/not a count/)
		expect(bad((f) => void (f.tokens[NVDA.token].checked_block = 0))).toMatch(/block number/)
		expect(bad((f) => void (f.tokens[NVDA.token].reasons = []))).toMatch(/no reasons/)
		expect(bad((f) => void f.tokens[STRANGER].reasons.push('SCAM_TOKEN'))).toMatch(/SCAM_TOKEN is not a reason code of this check/)
		expect(resultsProblem(null)).toMatch(/not a JSON object/)
		expect(resultsProblem([])).toMatch(/not a JSON object/)
	})
})
