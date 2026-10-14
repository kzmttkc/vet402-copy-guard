// The batch check and the anchor in the CRE SDK's test runtime. The two RPCs are
// the SDK's HTTP mock answering from a small table of chain state, the EVM write
// is captured and decoded, and the EVM read answers with the receipts of the
// writes the test itself made.
import { describe, expect } from 'bun:test'
import { getNetwork, TxStatus } from '@chainlink/cre-sdk'
import { EvmMock, HttpActionsMock, newTestRuntime, test } from '@chainlink/cre-sdk/test'
import { decodeAbiParameters, encodeAbiParameters } from 'viem'
import { fromUtf8, keccakText, utf8 } from '../rwa-verify/verify'
import { batchHash, EMPTY_CODE_HASH, ITEMS_PER_CALL, LIST_HASH, MAX_BATCH_TOKENS, type BatchTokenResult } from './batch'
import { EIP1967_BEACON_SLOT, SELECTOR, SNAPSHOT, STOCK_TOKEN_BEACON, STOCK_TOKEN_CODE_HASH, STOCK_TOKEN_FACTORY, TOKEN_DEPLOYED_TOPIC, UI_MULTIPLIER_UPDATED_TOPIC, USDG } from './check'
import config from './config.json'
import { type Config, extcodehashCall, HEAD_MARGIN, KIND_BATCH, KIND_RESULTS, MAX_HTTP_CALLS, onHttpTrigger, TOKEN_BATCH_CHECKED_TOPIC, TOKEN_CHECK_REPORT_ABI } from './workflow'

const STATE = config.stateRpc
const LOGS = config.robinhoodRpc
const HEAD = 87_990_008
const BLOCK = HEAD - HEAD_MARGIN
const BLOCK_HASH = `0x${'b1'.repeat(32)}`
const b64 = (s: string) => Buffer.from(utf8(s)).toString('base64')
const b64hex = (h: string) => Buffer.from(h.slice(2), 'hex').toString('base64')
const hex = (n: number) => `0x${n.toString(16)}`
const word = (a: string) => `0x${'0'.repeat(24)}${a.slice(2)}`
const abiString = (s: string) => encodeAbiParameters([{ type: 'string' }], [s])
const abiUint = (n: bigint) => encodeAbiParameters([{ type: 'uint256' }], [n])

const NVDA = SNAPSHOT.tokens.find((t) => t.symbol === 'NVDA')!
const QQQ = SNAPSHOT.tokens.find((t) => t.symbol === 'QQQ')!
const SPY = SNAPSHOT.tokens.find((t) => t.symbol === 'SPY')!
const SAME_TICKER = '0x5dd716fe12275b69f04b26beeca343843c8e3539'
const PLAIN = '0x0bd7d308f8e1639fab988df18a8011f41eacad73'
const NO_CODE = `0x${'77'.repeat(20)}`

type TokenWorld = { codeHash: string; beacon?: string; symbol?: string; name?: string; multiplier?: bigint; updates?: number[] }
type World = {
	tokens: Record<string, TokenWorld>
	chainId?: Record<string, string>
	blockHash?: Record<string, string | null>
	status?: (url: string, n: number) => number
	rateLimitOnce?: string
}
type Seen = { requests: { url: string; items: number; methods: string[] }[]; tags: Set<string>; reports: string[]; receiptsAsked: string[] }

const genuine = (t: { symbol: string; name: string }, over: Partial<TokenWorld> = {}): TokenWorld => ({
	codeHash: STOCK_TOKEN_CODE_HASH,
	beacon: STOCK_TOKEN_BEACON,
	symbol: t.symbol,
	name: `${t.name} • Robinhood Token`,
	multiplier: 10n ** 18n,
	updates: [],
	...over,
})

const world = (): World => ({
	tokens: {
		[NVDA.token]: genuine(NVDA),
		[QQQ.token]: genuine(QQQ, { multiplier: 1000700791241405425n, updates: [69210998] }),
		[USDG]: { codeHash: `0x${'5d'.repeat(32)}`, symbol: 'USDG', name: 'Global Dollar' },
		[SAME_TICKER]: { codeHash: `0x${'ab'.repeat(32)}`, symbol: 'NVDA', name: 'NVIDIA Robinhood Coin' },
		[PLAIN]: { codeHash: `0x${'cd'.repeat(32)}`, symbol: 'WETH', name: 'Wrapped Ether' },
		[NO_CODE]: { codeHash: EMPTY_CODE_HASH },
	},
})

/** Wires both RPCs and the EVM capability to `w`. Reports written become receipts the EVM read finds. */
function wire(w: World): Seen {
	const seen: Seen = { requests: [], tags: new Set(), reports: [], receiptsAsked: [] }
	const counts: Record<string, number> = {}
	let limited = false
	const http = HttpActionsMock.testInstance()
	http.sendRequest = (req) => {
		if (req.url !== STATE && req.url !== LOGS) return { statusCode: 404, body: '' }
		counts[req.url] = (counts[req.url] ?? 0) + 1
		const calls = JSON.parse(fromUtf8(req.body)) as { id: number; method: string; params: any[] }[]
		seen.requests.push({ url: req.url, items: calls.length, methods: [...new Set(calls.map((c) => c.method))] })
		const status = w.status?.(req.url, counts[req.url]) ?? 200
		if (status !== 200) return { statusCode: status, body: '' }
		const out = calls.map((c) => {
			const ok = (result: unknown) => ({ jsonrpc: '2.0', id: c.id, result })
			const err = (message: string) => ({ jsonrpc: '2.0', id: c.id, error: { code: -32000, message } })
			if (w.rateLimitOnce === c.method && !limited) {
				limited = true
				return err('Too Many Requests')
			}
			if (c.method === 'eth_chainId') return ok(w.chainId?.[req.url] ?? '0x1237')
			if (c.method === 'eth_blockNumber') return ok(hex(HEAD))
			if (c.method === 'eth_getBlockByNumber') {
				const h = w.blockHash && req.url in w.blockHash ? w.blockHash[req.url] : BLOCK_HASH
				return ok(h === null ? null : { number: c.params[0], hash: h, transactions: [] })
			}
			if (c.method === 'eth_getStorageAt') {
				seen.tags.add(c.params[2])
				if (c.params[1] !== EIP1967_BEACON_SLOT) return err('unexpected slot')
				const t = w.tokens[c.params[0]]
				return ok(t?.beacon ? word(t.beacon) : `0x${'0'.repeat(64)}`)
			}
			if (c.method === 'eth_call') {
				seen.tags.add(c.params[1])
				const { to, data } = c.params[0] as { to?: string; data: string }
				if (!to) {
					const token = `0x${data.slice(4, 44)}`
					if (data !== extcodehashCall(token)) return err('unexpected init code')
					return ok(w.tokens[token]?.codeHash ?? `0x${'0'.repeat(64)}`)
				}
				const t = w.tokens[to]
				if (data === SELECTOR.symbol && t?.symbol !== undefined) return ok(abiString(t.symbol))
				if (data === SELECTOR.name && t?.name !== undefined) return ok(abiString(t.name))
				if (data === SELECTOR.uiMultiplier && t?.multiplier !== undefined) return ok(abiUint(t.multiplier))
				return err('execution reverted')
			}
			if (c.method === 'eth_getLogs') {
				const f = c.params[0] as { address: string; topics: string[]; fromBlock: string; toBlock: string }
				const from = Number(BigInt(f.fromBlock))
				const to = Number(BigInt(f.toBlock))
				if (Array.isArray(f.address)) return err('one address per query')
				if (f.address === STOCK_TOKEN_FACTORY && f.topics[0] === TOKEN_DEPLOYED_TOPIC) {
					return ok(
						SNAPSHOT.tokens
							.filter((t) => t.deployed_block !== null && t.deployed_block >= from && t.deployed_block <= to && w.tokens[t.token]?.updates !== undefined)
							.map((t) => ({ address: STOCK_TOKEN_FACTORY, topics: [TOKEN_DEPLOYED_TOPIC], data: word(t.token), blockNumber: hex(t.deployed_block!), transactionHash: `0x${'d0'.repeat(32)}`, logIndex: '0x0' })),
					)
				}
				if (f.topics[0] === UI_MULTIPLIER_UPDATED_TOPIC) {
					if (to - from + 1 > 10_000_000) return err('query spans too many blocks')
					return ok(
						(w.tokens[f.address]?.updates ?? [])
							.filter((b) => b >= from && b <= to)
							.map((b, i) => ({ address: f.address, topics: [UI_MULTIPLIER_UPDATED_TOPIC], data: `0x${'0'.repeat(63)}1${'0'.repeat(63)}2${'0'.repeat(63)}3`, blockNumber: hex(b), transactionHash: `0x${'e0'.repeat(32)}`, logIndex: hex(i) })),
					)
				}
			}
			return err(`not in the test world: ${c.method}`)
		})
		return { statusCode: 200, body: b64(JSON.stringify(out)) }
	}
	const net = getNetwork({ chainFamily: 'evm', chainSelectorName: config.chainSelectorName, isTestnet: true })
	if (!net) throw new Error('robinhood-testnet not in the SDK chain list')
	const evm = EvmMock.testInstance(net.chainSelector.selector)
	evm.writeReport = (input) => {
		seen.reports.push(`0x${Buffer.from(input.report!.rawReport).toString('hex')}`)
		return { txStatus: TxStatus.SUCCESS, txHash: Uint8Array.from(Buffer.from(txOf(seen.reports.length).slice(2), 'hex')) }
	}
	evm.getTransactionReceipt = (input) => {
		const tx = `0x${Buffer.from(input.hash).toString('hex')}`
		seen.receiptsAsked.push(tx)
		return receipts[tx] ? { receipt: receipts[tx] } : {}
	}
	return seen
}
const txOf = (n: number) => `0x${n.toString(16).padStart(2, '0').repeat(32)}`
let receipts: Record<string, { status: string; logs: { address: string; topics: string[]; data: string }[] }> = {}

function decodeReport(raw: string) {
	const [kind, hash, listHash, blockHash, checkedBlock, tokens, issuerTokens, runs] = decodeAbiParameters(TOKEN_CHECK_REPORT_ABI, `0x${raw.slice(2 + 109 * 2)}` as `0x${string}`)
	return { kind, hash, listHash, blockHash, checkedBlock: Number(checkedBlock), tokens, issuerTokens, runs }
}

const run = (payload: object, cfg: object = config) => {
	const runtime = newTestRuntime<Config>(null, undefined, cfg as Config)
	const out = onHttpTrigger(runtime as any, { input: utf8(JSON.stringify(payload)) } as any)
	return { out: JSON.parse(out), logs: runtime.getLogs().join('\n') }
}
const ALL = [NVDA.token, QQQ.token, USDG, SAME_TICKER, PLAIN, NO_CODE]

describe('token-check, many tokens at once', () => {
	test('six tokens in one run: two the issuer\'s, four not, each with its grounds, and the hash of the rows written once', () => {
		const seen = wire(world())
		const { out, logs } = run({ tokens: ALL })
		expect(out.mode).toBe('batch')
		expect(out.block).toBe(BLOCK)
		expect(out.blockHash).toBe(BLOCK_HASH)
		expect(Object.keys(out.tokens)).toEqual(ALL)
		expect(out.tokens[NVDA.token]).toEqual({ issuer_token: true, ticker: 'NVDA', reasons: ['IN_ISSUER_LIST', 'CODE_HASH_MATCHES', 'BEACON_MATCHES', 'FACTORY_LOG_NAMES_TOKEN', 'TICKER_MATCHES_LIST'], multiplier_updates: 0, checked_block: BLOCK })
		expect(out.tokens[QQQ.token]).toMatchObject({ issuer_token: true, ticker: 'QQQ', multiplier_updates: 1 })
		expect(out.tokens[QQQ.token].reasons).toContain('MULTIPLIER_NOT_ONE')
		expect(out.tokens[USDG]).toMatchObject({ issuer_token: false, ticker: 'USDG', reasons: ['USDG_ADDRESS'] })
		expect(out.tokens[SAME_TICKER]).toMatchObject({ issuer_token: false, ticker: 'NVDA' })
		expect(out.tokens[SAME_TICKER].reasons).toEqual(['NOT_IN_ISSUER_LIST', 'CODE_HASH_DIFFERS', 'BEACON_DIFFERS', 'TICKER_SAME_AS_ISSUER_TOKEN', 'NAME_SAME_AS_ISSUER_TOKEN', 'NAME_ENDS_LIKE_ISSUER_TOKEN'])
		expect(out.tokens[PLAIN].reasons).toEqual(['NOT_IN_ISSUER_LIST', 'CODE_HASH_DIFFERS', 'BEACON_DIFFERS'])
		expect(out.tokens[NO_CODE]).toMatchObject({ issuer_token: false, ticker: '', reasons: ['NOT_IN_ISSUER_LIST', 'NO_CONTRACT_CODE', 'BEACON_DIFFERS'] })
		expect(out.details[QQQ.token]).toMatchObject({ verdict: 'GENUINE_STOCK_TOKEN', multiplier: '1.000700791241405425', factory_log: true, code_hash: STOCK_TOKEN_CODE_HASH, beacon: STOCK_TOKEN_BEACON })
		expect(out.issuerTokens).toBe(2)
		expect(out.batchHash).toBe(batchHash(out.tokens))

		// one write, and it carries exactly what the run decided
		expect(seen.reports).toHaveLength(1)
		expect(decodeReport(seen.reports[0])).toEqual({ kind: KIND_BATCH, hash: out.batchHash, listHash: LIST_HASH, blockHash: BLOCK_HASH, checkedBlock: BLOCK, tokens: 6, issuerTokens: 2, runs: 1 })
		expect(out.batchTx).toBe(txOf(1))
		expect(logs).toContain(`batch hash written to ${config.receiverAddress} on robinhood-testnet, tx ${txOf(1)}`)
		expect(logs).toContain(`RESULT: 6 tokens at block ${BLOCK}, 2 the issuer's, 4 not`)
		expect(logs).toContain('(the same from both RPCs)')

		// the head, then the state from the second operator in one request, then the logs from Robinhood's own RPC
		// 2 identity reads, and for NVDA and QQQ the factory log and one query per 10,000,000 blocks since deployment
		const logItems = 2 + [NVDA, QQQ].reduce((n, t) => n + 1 + Math.ceil((BLOCK - t.deployed_block! + 1) / 10_000_000), 0)
		const logRequests = Math.ceil(logItems / ITEMS_PER_CALL)
		expect(seen.requests.map((r) => r.url)).toEqual([STATE, STATE, ...Array(logRequests).fill(LOGS)])
		expect(seen.requests[0]).toMatchObject({ items: 1, methods: ['eth_blockNumber'] })
		expect(seen.requests[1].items).toBe(2 + 5 * 6)
		expect(seen.requests[1].methods).not.toContain('eth_getLogs')
		expect(seen.requests[2].methods).toEqual(['eth_chainId', 'eth_getBlockByNumber', 'eth_getLogs'])
		expect(seen.requests.slice(2).reduce((n, r) => n + r.items, 0)).toBe(logItems)
		for (const r of seen.requests.slice(2)) expect(r.items).toBeLessThanOrEqual(ITEMS_PER_CALL)
		expect(seen.requests.length).toBeLessThanOrEqual(MAX_HTTP_CALLS)
		// every state read is pinned to the one block
		expect([...seen.tags]).toEqual([hex(BLOCK)])
	})

	test('a block in the payload: no head is read and the state is read at exactly that block', () => {
		const seen = wire(world())
		const { out } = run({ tokens: [NVDA.token, PLAIN], block: 87_000_000 })
		expect(out.block).toBe(87_000_000)
		expect(out.tokens[NVDA.token].checked_block).toBe(87_000_000)
		expect(seen.requests.flatMap((r) => r.methods)).not.toContain('eth_blockNumber')
		expect([...seen.tags]).toEqual([hex(87_000_000)])
	})

	test('without a second RPC everything is read from Robinhood\'s own, in requests of a bounded size', () => {
		const seen = wire(world())
		const { stateRpc: _s, ...one } = config
		const { out, logs } = run({ tokens: ALL }, one)
		expect(out.issuerTokens).toBe(2)
		expect(new Set(seen.requests.map((r) => r.url))).toEqual(new Set([LOGS]))
		for (const r of seen.requests) expect(r.items).toBeLessThanOrEqual(ITEMS_PER_CALL)
		expect(logs).not.toContain('(the same from both RPCs)')
	})

	test('the two RPCs must be Robinhood Chain and agree on the block; otherwise nothing is decided and nothing is written', () => {
		let seen = wire({ ...world(), blockHash: { [LOGS]: `0x${'ee'.repeat(32)}` } })
		expect(() => run({ tokens: ALL })).toThrow(/different hashes for block/)
		expect(seen.reports).toEqual([])
		seen = wire({ ...world(), chainId: { [STATE]: '0x1' } })
		expect(() => run({ tokens: ALL })).toThrow(/state RPC is chain 1/)
		expect(seen.reports).toEqual([])
		seen = wire({ ...world(), chainId: { [LOGS]: '0xb626' } })
		expect(() => run({ tokens: ALL })).toThrow(/log RPC is chain 46630/)
		seen = wire({ ...world(), blockHash: { [STATE]: null } })
		expect(() => run({ tokens: ALL })).toThrow(/not known to the state RPC/)
		expect(seen.reports).toEqual([])
	})

	test('a listed address whose code is not the issuer\'s is not passed', () => {
		const w = world()
		w.tokens[NVDA.token] = genuine(NVDA, { codeHash: `0x${'99'.repeat(32)}` })
		wire(w)
		const { out } = run({ tokens: [NVDA.token] })
		expect(out.tokens[NVDA.token]).toMatchObject({ issuer_token: false, ticker: 'NVDA' })
		expect(out.tokens[NVDA.token].reasons).toEqual(['IN_ISSUER_LIST', 'CODE_HASH_DIFFERS', 'BEACON_MATCHES', 'FACTORY_LOG_NAMES_TOKEN', 'TICKER_MATCHES_LIST'])
		expect(out.issuerTokens).toBe(0)
	})

	test('a listed address the factory never named is not passed', () => {
		const w = world()
		// SPY answers like a Stock Token, but the factory log of its block does not name it
		w.tokens[SPY.token] = { ...genuine(SPY), updates: undefined }
		wire(w)
		const { out } = run({ tokens: [SPY.token] })
		expect(out.tokens[SPY.token].issuer_token).toBe(false)
		expect(out.tokens[SPY.token].reasons).toContain('FACTORY_LOG_MISSING')
	})

	test('a rate-limited item is asked again, and a request the RPC refuses three more times ends the run with nothing written', () => {
		let seen = wire({ ...world(), rateLimitOnce: 'eth_getLogs' })
		const { out } = run({ tokens: ALL })
		expect(out.issuerTokens).toBe(2)
		// the first log request is followed by one more that carries only the item that was refused
		expect(seen.requests.filter((r) => r.url === LOGS).map((r) => r.items).slice(0, 2)).toEqual([ITEMS_PER_CALL, 1])
		seen = wire({ ...world(), status: (url) => (url === LOGS ? 429 : 200) })
		expect(() => run({ tokens: ALL })).toThrow(/no answer from the RPC after 4 tries/)
		expect(seen.reports).toEqual([])
	})

	test('more tokens than one run can read are refused before any state is read', () => {
		const listed = SNAPSHOT.tokens.slice(0, MAX_BATCH_TOKENS).map((t) => t.token)
		const seen = wire(world())
		expect(() => run({ tokens: listed })).toThrow(new RegExp(`one run may spend ${MAX_HTTP_CALLS}; send fewer tokens`))
		expect(seen.requests).toHaveLength(1)
		expect(seen.reports).toEqual([])
	})

	test('rejects an empty list, too long a list, a bad address, an unknown field, and a config with no receiver', () => {
		wire(world())
		expect(() => run({ tokens: [] })).toThrow()
		expect(() => run({ tokens: Array.from({ length: MAX_BATCH_TOKENS + 1 }, () => PLAIN) })).toThrow()
		expect(() => run({ tokens: ['0x1234'] })).toThrow()
		expect(() => run({ tokens: [PLAIN], wallet: PLAIN })).toThrow()
		expect(() => run({ tokens: [PLAIN], block: -1 })).toThrow()
		expect(() => run({ tokens: [PLAIN] }, { robinhoodRpc: LOGS })).toThrow(/receiverAddress/)
	})

	test('a caller on a busy line may ask for smaller requests to Robinhood\'s RPC, and the plan counts them', () => {
		let seen = wire(world())
		const { out } = run({ tokens: [NVDA.token, PLAIN], itemsPerCall: 2 })
		expect(out.issuerTokens).toBe(1)
		const logs = seen.requests.filter((r) => r.url === LOGS)
		for (const r of logs) expect(r.items).toBeLessThanOrEqual(2)
		expect(logs.length).toBeGreaterThan(4)
		expect(seen.requests.find((r) => r.url === STATE && r.items > 1)?.items).toBe(2 + 5 * 2)
		// three listed tokens at two items per request need more requests than one run may spend
		seen = wire(world())
		expect(() => run({ tokens: [NVDA.token, QQQ.token, SPY.token], itemsPerCall: 2 })).toThrow(/send fewer tokens/)
		expect(seen.reports).toEqual([])
		expect(() => run({ tokens: [PLAIN], itemsPerCall: 0 })).toThrow()
		expect(() => run({ tokens: [PLAIN], itemsPerCall: ITEMS_PER_CALL + 1 })).toThrow()
	})

	test('the same address twice is checked once', () => {
		const seen = wire(world())
		const { out } = run({ tokens: [PLAIN, PLAIN.toUpperCase().replace('0X', '0x'), PLAIN] })
		expect(Object.keys(out.tokens)).toEqual([PLAIN])
		expect(decodeReport(seen.reports[0]).tokens).toBe(1)
	})
})

describe('token-check, anchoring a results file', () => {
	/** Two real runs of the handler, their writes turned into receipts, and the file a script would build from them. */
	function twoRuns() {
		receipts = {}
		const seen = wire(world())
		const batches = [
			[NVDA.token, QQQ.token, USDG],
			[SAME_TICKER, PLAIN, NO_CODE],
		]
		const tokens: Record<string, BatchTokenResult> = {}
		const cre_runs: { tx: string; simulate_log: string }[] = []
		batches.forEach((batch, i) => {
			const { out } = run({ tokens: batch })
			Object.assign(tokens, out.tokens)
			cre_runs.push({ tx: out.batchTx, simulate_log: `docs/token-check/batch/batch-${i + 1}.cre.txt` })
			const r = decodeReport(seen.reports[i])
			receipts[out.batchTx] = {
				status: '1',
				logs: [{ address: b64hex(config.receiverAddress), topics: [b64hex(TOKEN_BATCH_CHECKED_TOPIC), b64hex(r.hash), b64hex(r.listHash), b64hex(`0x${r.checkedBlock.toString(16).padStart(64, '0')}`)], data: '' }],
			}
		})
		const file = { generated_at: '2026-10-14T02:00:00.000Z', cre_runs, tokens }
		return { seen, batches, file, text: `${JSON.stringify(file, null, 2)}\n` }
	}

	test('a file whose every run is onchain: the keccak256 of the file is written once', () => {
		const { seen, batches, text } = twoRuns()
		const { out, logs } = run({ results_json: text, batches })
		expect(out).toMatchObject({ mode: 'anchor', resultsHash: keccakText(text), tokens: 6, issuerTokens: 2, runs: 2, lastCheckedBlock: BLOCK, anchorTx: txOf(3) })
		expect(seen.receiptsAsked).toEqual([txOf(1), txOf(2)])
		expect(seen.reports).toHaveLength(3)
		expect(decodeReport(seen.reports[2])).toEqual({ kind: KIND_RESULTS, hash: keccakText(text), listHash: LIST_HASH, blockHash: `0x${'0'.repeat(64)}`, checkedBlock: BLOCK, tokens: 6, issuerTokens: 2, runs: 2 })
		expect(logs).toContain(`results hash written to ${config.receiverAddress} on robinhood-testnet, tx ${txOf(3)}`)
		expect(logs).toContain(`run 2   ${txOf(2)} holds TokenBatchChecked`)
	})

	test('a row changed after the runs is refused: the chain holds another hash', () => {
		const { seen, batches, file } = twoRuns()
		file.tokens[SAME_TICKER] = { ...file.tokens[SAME_TICKER], issuer_token: true }
		expect(() => run({ results_json: JSON.stringify(file), batches })).toThrow(/run 2 .* holds no TokenBatchChecked log/)
		expect(seen.reports).toHaveLength(2)
	})

	test('a reason code this workflow does not define is refused before the chain is read', () => {
		const { seen, batches, file } = twoRuns()
		file.tokens[SAME_TICKER].reasons.push('SCAM_TOKEN' as never)
		expect(() => run({ results_json: JSON.stringify(file), batches })).toThrow(/SCAM_TOKEN is not a reason code of this check/)
		expect(seen.receiptsAsked).toEqual([])
		expect(seen.reports).toHaveLength(2)
	})

	test('a failed transaction, a log of another contract, or a receipt that does not exist is not proof', () => {
		for (const spoil of [
			(tx: string) => void (receipts[tx].status = '0'),
			(tx: string) => void (receipts[tx].logs[0].address = b64hex(`0x${'12'.repeat(20)}`)),
			(tx: string) => void (receipts[tx].logs[0].topics[0] = b64hex(`0x${'34'.repeat(32)}`)),
			(tx: string) => void delete receipts[tx],
		]) {
			const { seen, batches, text } = twoRuns()
			spoil(txOf(1))
			expect(() => run({ results_json: text, batches })).toThrow(/run 1 .* holds no TokenBatchChecked log/)
			expect(seen.reports).toHaveLength(2)
		}
	})

	test('the batches must cover the file exactly', () => {
		const { batches, text, file } = twoRuns()
		expect(() => run({ results_json: text, batches: [batches[0]] })).toThrow(/2 runs in the file, 1 batches/)
		expect(() => run({ results_json: text, batches: [batches[0], batches[1].slice(1)] })).toThrow(/1 tokens of the file are in no batch/)
		expect(() => run({ results_json: text, batches: [batches[0], [...batches[1], NVDA.token]] })).toThrow(/is in two batches/)
		expect(() => run({ results_json: text, batches: [batches[0], [...batches[1], SPY.token]] })).toThrow(/is in a batch and not in the file/)
		expect(() => run({ results_json: 'not json', batches })).toThrow(/results_json is not JSON/)
		expect(() => run({ results_json: text, batches, extra: 1 })).toThrow()
		expect(() => run({ results_json: JSON.stringify({ ...file, note: 'x' }), batches })).toThrow(/exactly generated_at/)
	})
})
