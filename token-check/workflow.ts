// CRE workflow: compliance checks an agent runs before it acts on a token.
//
// One HTTP trigger, three payloads.
//
// 1. { tx, wallet, block? }: one transaction.
//      -> HTTP POST Robinhood Chain JSON-RPC (batches):
//           eth_chainId, eth_blockNumber, eth_getTransactionByHash (only without `block`)
//           eth_getLogs x2   the Transfer logs of that block that name the wallet
//           per token        eth_getCode, eth_getStorageAt (EIP-1967 beacon slot),
//                            symbol(), name(), uiMultiplier(),
//                            the factory's TokenDeployed log, UIMultiplierUpdated logs
//      -> check.ts decides, per token: GENUINE_STOCK_TOKEN, USDG,
//         NOT_A_STOCK_TOKEN, LOOKALIKE or UNVERIFIED, with reason bits
//      -> returns { tx, wallet, block, allow, reasonBits, tokens }. Nothing is written.
//
// 2. { tokens: [address, ...], block? }: many tokens at once, as of one block.
//      -> HTTP: the head of the chain (median across nodes) unless `block` is given
//      -> HTTP: every token's EXTCODEHASH, beacon slot, symbol(), name() and
//         uiMultiplier() at that block; for a listed address the factory's
//         TokenDeployed log and every UIMultiplierUpdated log since its deployment.
//         With `stateRpc` in the config the state comes from a second RPC operator
//         and both must give the same hash for the block.
//      -> batch.ts decides, per token: the issuer's token or not, on which grounds
//      -> EVM write: keccak256 of the rows to TokenCheckReceiver (TokenBatchChecked)
//
// 3. { results_json, batches }: anchor a results file built from runs of payload 2.
//      -> refuses a file that is not in the fixed shape or carries a reason code
//         this workflow does not define
//      -> EVM read: the receipt of every run named in the file must hold the
//         TokenBatchChecked log for the hash recomputed from the file's rows
//      -> EVM write: keccak256 of the file to TokenCheckReceiver (TokenCheckResultsAnchored)
//
// No vet402 API is called. Every input of a decision is read from the chain's
// RPC, or comes from the list bundled in registry-snapshot.json.
//
// Robinhood Chain mainnet (4663) is not a chain CRE lists, so it is read over
// the HTTP capability. The receiver is on Robinhood Testnet, which CRE lists.
import {
	bytesToHex,
	consensusIdenticalAggregation,
	consensusMedianAggregation,
	cre,
	EVMClient,
	getNetwork,
	HTTPCapability,
	type HTTPPayload,
	type HTTPSendRequester,
	hexToBase64,
	prepareReportRequest,
	type Runtime,
	TxStatus,
} from '@chainlink/cre-sdk'
import { encodeAbiParameters, parseAbiParameters } from 'viem'
import { z } from 'zod'
import { canonicalJson, fromUtf8, keccakText, utf8 } from '../rwa-verify/verify'
import {
	type BatchRead,
	type BatchTokenState,
	batchHash,
	ITEMS_PER_CALL,
	judgeBatch,
	LIST_HASH,
	LOG_SPAN_BLOCKS,
	logWindows,
	MAX_BATCH_TOKENS,
	MAX_OBSERVATION_BYTES,
	plannedHttpCalls,
	type ResultsFile,
	renderBatch,
	resultsProblem,
	STATE_ITEMS_PER_CALL,
} from './batch'
import {
	type CheckInput,
	check,
	codeHashOf,
	decodeAbiText,
	decodeUint,
	EIP1967_BEACON_SLOT,
	factoryNames,
	type Log,
	listedToken,
	multiplierUpdates,
	render,
	renderHeader,
	ROBINHOOD_CHAIN_ID,
	SELECTOR,
	STOCK_TOKEN_FACTORY,
	type TokenState,
	TOKEN_DEPLOYED_TOPIC,
	TRANSFER_TOPIC,
	tokensOf,
	UI_MULTIPLIER_UPDATED_TOPIC,
	walletTransfers,
} from './check'

export const configSchema = z.object({
	/** Robinhood's own public JSON-RPC endpoint for Robinhood Chain (4663). Logs are always read here. */
	robinhoodRpc: z.string(),
	/** A second RPC operator for the state reads of the batch check. Without it the state is read from robinhoodRpc too. */
	stateRpc: z.string().optional(),
	/** Where the batch check and the anchor write: the CRE chain name, TokenCheckReceiver, and the gas limit of one write. */
	chainSelectorName: z.string().optional(),
	receiverAddress: z.string().optional(),
	gasLimit: z.string().optional(),
})
export type Config = z.infer<typeof configSchema>

export const payloadSchema = z
	.object({
		tx: z.string().regex(/^0x[0-9a-fA-F]{64}$/),
		wallet: z.string().regex(/^0x[0-9a-fA-F]{40}$/),
		// Optional. With it the tx object is never fetched: an airdrop to thousands of
		// addresses has an input larger than the 250 kb an HTTP answer may be in CRE.
		block: z.number().int().positive().optional(),
	})
	.strict()
export type Payload = z.infer<typeof payloadSchema>

/** Distinct tokens read per run. One batch each, so the run stays under CRE's 15 HTTP calls. */
export const MAX_TOKENS = 8
/** Transfer logs of the wallet kept per run, so what the nodes agree on stays under CRE's 25 kb. */
export const MAX_WALLET_LOGS = 32
export { LOG_SPAN_BLOCKS }
/** UIMultiplierUpdated log windows read per token, from the block of the tx on. */
export const MAX_LOG_WINDOWS = 4
/** HTTP calls one run may spend, retries included. CRE's limit is 15. */
export const MAX_HTTP_CALLS = 14
/** Times one batch is sent again when the RPC answers 429, 5xx, or rate-limits an item. */
const RETRIES = 3
/** The public RPC throttles bursts. Requests of one run go out this far apart, and a retry waits longer each time. */
const PACE_MS = 400
const RETRY_WAIT_MS = 1500
const LOG_FLUSH_MS = 500

const RATE_LIMITED = /too many requests|rate limit|deadline exceeded|try again|temporarily unavailable/i

type Call = { method: string; params: unknown[] }
type Answer = { result: unknown; error: string }
type Budget = { calls: number }

const hex = (n: number) => `0x${n.toString(16)}`

/** The CRE WASM runtime has a host `sleep`. Under bun (the tests, the recorder) there is none and none is needed. */
function pause(ms: number): void {
	const hostSleep = (globalThis as { sleep?: (ms: number) => void }).sleep
	if (typeof hostSleep === 'function') hostSleep(ms)
}

/**
 * One JSON-RPC batch. Items the RPC rate-limits are sent again, alone. A
 * JSON-RPC error that is an answer (a reverted eth_call) comes back in `error`.
 */
function rpcBatch(sr: HTTPSendRequester, url: string, calls: Call[], budget: Budget): Answer[] {
	const out: (Answer | undefined)[] = calls.map(() => undefined)
	let pending = calls.map((_, i) => i)
	for (let attempt = 0; attempt <= RETRIES && pending.length > 0; attempt++) {
		if (budget.calls >= MAX_HTTP_CALLS) throw new Error(`more than ${MAX_HTTP_CALLS} RPC requests needed, stopped`)
		if (budget.calls > 0) pause(attempt === 0 ? PACE_MS : RETRY_WAIT_MS * attempt)
		budget.calls++
		const body = JSON.stringify(pending.map((i) => ({ jsonrpc: '2.0', id: i + 1, method: calls[i].method, params: calls[i].params })))
		const res = sr
			.sendRequest({ method: 'POST', url, headers: { 'content-type': 'application/json' }, body: hexToBase64(bytesToHex(utf8(body))) })
			.result()
		if (res.statusCode === 429 || res.statusCode >= 500) continue
		if (res.statusCode !== 200) throw new Error(`${calls[pending[0]].method}: HTTP ${res.statusCode}`)
		const parsed = JSON.parse(fromUtf8(res.body)) as unknown
		const items = (Array.isArray(parsed) ? parsed : [parsed]) as { id?: number; result?: unknown; error?: { message?: string } }[]
		for (const item of items) {
			const i = typeof item.id === 'number' ? item.id - 1 : -1
			if (i < 0 || i >= calls.length || out[i] !== undefined) continue
			if (item.error) {
				const message = item.error.message ?? 'rpc error'
				if (!RATE_LIMITED.test(message)) out[i] = { result: null, error: message }
			} else {
				out[i] = { result: item.result ?? null, error: '' }
			}
		}
		pending = pending.filter((i) => out[i] === undefined)
	}
	if (pending.length > 0) throw new Error(`${calls[pending[0]].method}: no answer from the RPC after ${RETRIES + 1} tries (rate limited)`)
	return out as Answer[]
}

/** The answer of a call that must not fail. */
function must<T>(a: Answer, what: string): T {
	if (a.error) throw new Error(`${what}: ${a.error}`)
	return a.result as T
}

/** The answer of an eth_call that may revert: a revert is "the token does not answer this". */
const soft = (a: Answer): string | null => (a.error || typeof a.result !== 'string' ? null : a.result)

/**
 * Everything the check needs, read from the chain. Runs on each node. The
 * return value is canonical JSON (a string), so nodes agree on it byte for byte
 * and absent values can be null.
 */
export const readChain = (sr: HTTPSendRequester, url: string, tx: string, wallet: string, block: number): string => {
	const budget: Budget = { calls: 0 }
	const read: CheckInput = { chainId: 0, tx, wallet, txFound: false, block: 0, logs: [], tokens: [], skipped: 0 }
	const done = () => canonicalJson(read)

	// 1. Chain id, the head, and the block of the tx unless the caller named it (block > 0).
	const first: Call[] = [
		{ method: 'eth_chainId', params: [] },
		{ method: 'eth_blockNumber', params: [] },
	]
	if (block <= 0) first.push({ method: 'eth_getTransactionByHash', params: [tx] })
	const [chainIdA, headA, txA] = rpcBatch(sr, url, first, budget)
	read.chainId = Number(BigInt(must<string>(chainIdA, 'eth_chainId')))
	if (read.chainId !== ROBINHOOD_CHAIN_ID) return done()
	const head = Number(BigInt(must<string>(headA, 'eth_blockNumber')))
	if (block > 0) {
		// Not looked up. A Transfer log in that block that carries the tx hash is the proof.
		read.block = block
	} else {
		const txObject = must<{ blockNumber?: string | null } | null>(txA, 'eth_getTransactionByHash')
		if (!txObject || !txObject.blockNumber) return done()
		read.block = Number(BigInt(txObject.blockNumber))
	}
	read.txFound = true

	// 2. The wallet's Transfer logs in that block, by topic. A full receipt can be too large
	// (an address-poisoning tx carries hundreds of logs), these two queries are not.
	const w = `0x${'0'.repeat(24)}${wallet.slice(2)}`
	const range = { fromBlock: hex(read.block), toBlock: hex(read.block) }
	const [fromA, toA] = rpcBatch(
		sr,
		url,
		[
			{ method: 'eth_getLogs', params: [{ ...range, topics: [TRANSFER_TOPIC, w] }] },
			{ method: 'eth_getLogs', params: [{ ...range, topics: [TRANSFER_TOPIC, null, w] }] },
		],
		budget,
	)
	const seen = new Set<string>()
	const logs = [...must<Log[]>(fromA, 'eth_getLogs'), ...must<Log[]>(toA, 'eth_getLogs')]
		.filter((l) => l.transactionHash.toLowerCase() === tx)
		.filter((l) => (seen.has(l.logIndex) ? false : Boolean(seen.add(l.logIndex))))
		.map((l) => ({ address: l.address, topics: l.topics, data: l.data, blockNumber: l.blockNumber, transactionHash: l.transactionHash, logIndex: l.logIndex }))
		.sort((a, b) => Number(BigInt(a.logIndex)) - Number(BigInt(b.logIndex)))
	read.logs = logs.slice(0, MAX_WALLET_LOGS)
	const tokens = tokensOf(walletTransfers(wallet, tx, read.logs))
	read.skipped = logs.length - read.logs.length + Math.max(0, tokens.length - MAX_TOKENS)

	// 3. Each token, one batch: code, beacon slot, symbol, name, multiplier. For an address in
	// the list also the factory log that names it, and its multiplier logs since the tx.
	for (const token of tokens.slice(0, MAX_TOKENS)) {
		const calls: Call[] = [
			{ method: 'eth_getCode', params: [token, 'latest'] },
			{ method: 'eth_getStorageAt', params: [token, EIP1967_BEACON_SLOT, 'latest'] },
			{ method: 'eth_call', params: [{ to: token, data: SELECTOR.symbol }, 'latest'] },
			{ method: 'eth_call', params: [{ to: token, data: SELECTOR.name }, 'latest'] },
			{ method: 'eth_call', params: [{ to: token, data: SELECTOR.uiMultiplier }, 'latest'] },
		]
		const listed = listedToken(token)
		let windows = 0
		let complete = false
		if (listed) {
			const at = listed.deployed_block === null ? null : hex(listed.deployed_block)
			calls.push({
				method: 'eth_getLogs',
				params: [{ address: STOCK_TOKEN_FACTORY, topics: [TOKEN_DEPLOYED_TOPIC], fromBlock: at ?? '0x0', toBlock: at ?? '0x0' }],
			})
			for (let start = read.block; start <= head && windows < MAX_LOG_WINDOWS; start += LOG_SPAN_BLOCKS, windows++) {
				const end = Math.min(head, start + LOG_SPAN_BLOCKS - 1)
				calls.push({ method: 'eth_getLogs', params: [{ address: token, topics: [UI_MULTIPLIER_UPDATED_TOPIC], fromBlock: hex(start), toBlock: hex(end) }] })
				complete = end === head
			}
		}
		const a = rpcBatch(sr, url, calls, budget)
		const state: TokenState = {
			token,
			codeHash: codeHashOf(must<string>(a[0], 'eth_getCode')),
			beaconSlot: must<string>(a[1], 'eth_getStorageAt'),
			symbol: decodeAbiText(soft(a[2])),
			name: decodeAbiText(soft(a[3])),
			multiplier: decodeUint(soft(a[4])),
			factoryLog: null,
			multiplierUpdates: null,
			multiplierLogsComplete: false,
		}
		if (listed) {
			state.factoryLog = listed.deployed_block !== null && factoryNames(token, must<Log[]>(a[5], 'eth_getLogs (factory)'))
			const logs: Log[] = []
			for (let i = 0; i < windows; i++) logs.push(...must<Log[]>(a[6 + i], 'eth_getLogs (UIMultiplierUpdated)'))
			state.multiplierUpdates = multiplierUpdates(token, logs)
			state.multiplierLogsComplete = complete
		}
		read.tokens.push(state)
	}
	return done()
}

// ---------------------------------------------------------------- many tokens at once

const ADDRESS = z.string().regex(/^0x[0-9a-fA-F]{40}$/)

export const batchPayloadSchema = z
	.object({
		tokens: z.array(ADDRESS).min(1).max(MAX_BATCH_TOKENS),
		// Optional. With it every node of a DON reads the same block. Without it the nodes agree
		// on the head first (median) and the run checks a few blocks behind that.
		block: z.number().int().positive().optional(),
		// Optional. JSON-RPC items per request to Robinhood's RPC, when the caller has measured
		// that the line lets fewer than ITEMS_PER_CALL through at once.
		itemsPerCall: z.number().int().min(1).max(ITEMS_PER_CALL).optional(),
	})
	.strict()
export type BatchPayload = z.infer<typeof batchPayloadSchema>

/**
 * How far behind the agreed head the batch check reads, so every RPC backend already has
 * the block (about two seconds on this chain). Not further: the second RPC operator keeps
 * state for fewer than 128 blocks.
 */
export const HEAD_MARGIN = 20

/**
 * Init code that returns EXTCODEHASH of `token`, sent as an eth_call without `to`:
 * PUSH20 token, EXTCODEHASH, PUSH1 0, MSTORE, PUSH1 32, PUSH1 0, RETURN.
 * The answer is 32 bytes whatever the size of the token's code, so many tokens fit
 * in one HTTP answer. eth_getCode of an unknown contract can be 49 kb.
 */
export const extcodehashCall = (token: string) => `0x73${token.slice(2).toLowerCase()}3f60005260206000f3`

/** The head of the chain as one node sees it. The nodes' answers are aggregated by median. */
export const readHead = (sr: HTTPSendRequester, url: string): number => {
	const [a] = rpcBatch(sr, url, [{ method: 'eth_blockNumber', params: [] }], { calls: 0 })
	return Number(BigInt(must<string>(a, 'eth_blockNumber')))
}

function inChunks(sr: HTTPSendRequester, url: string, calls: Call[], size: number, budget: Budget): Answer[] {
	const out: Answer[] = []
	for (let i = 0; i < calls.length; i += size) out.push(...rpcBatch(sr, url, calls.slice(i, i + size), budget))
	return out
}

/**
 * Everything the batch check needs about `tokens` as of `block`. Runs on each node.
 * State is read from `stateRpc`, logs from `logRpc`. When they are two RPCs, both
 * must be Robinhood Chain and give the same hash for the block. The return value
 * is canonical JSON, so nodes agree on it byte for byte.
 */
export const readBatch = (sr: HTTPSendRequester, stateRpc: string, logRpc: string, tokensCsv: string, block: number, callsUsed: number, itemsPerCall: number): string => {
	const budget: Budget = { calls: callsUsed }
	const tokens = tokensCsv.split(',')
	const tag = hex(block)
	const separate = stateRpc !== logRpc
	const identity: Call[] = [
		{ method: 'eth_chainId', params: [] },
		{ method: 'eth_getBlockByNumber', params: [tag, false] },
	]

	const stateCalls: Call[] = [...identity]
	for (const token of tokens) {
		stateCalls.push(
			{ method: 'eth_call', params: [{ data: extcodehashCall(token) }, tag] },
			{ method: 'eth_getStorageAt', params: [token, EIP1967_BEACON_SLOT, tag] },
			{ method: 'eth_call', params: [{ to: token, data: SELECTOR.symbol }, tag] },
			{ method: 'eth_call', params: [{ to: token, data: SELECTOR.name }, tag] },
			{ method: 'eth_call', params: [{ to: token, data: SELECTOR.uiMultiplier }, tag] },
		)
	}

	// For a listed address: the factory log in the block the list names, and the token's
	// multiplier logs from that block to the checked one. One address per query: with
	// several the RPC allows 100,000 blocks only.
	const logCalls: Call[] = separate ? [...identity] : []
	const slots: { factory: number; windows: number[] }[] = []
	for (const token of tokens) {
		const slot = { factory: -1, windows: [] as number[] }
		const listed = listedToken(token)
		if (listed && listed.deployed_block !== null) {
			const at = hex(listed.deployed_block)
			slot.factory = logCalls.length
			logCalls.push({ method: 'eth_getLogs', params: [{ address: STOCK_TOKEN_FACTORY, topics: [TOKEN_DEPLOYED_TOPIC], fromBlock: at, toBlock: at }] })
			for (const [a, b] of logWindows(listed.deployed_block, block)) {
				slot.windows.push(logCalls.length)
				logCalls.push({ method: 'eth_getLogs', params: [{ address: token, topics: [UI_MULTIPLIER_UPDATED_TOPIC], fromBlock: hex(a), toBlock: hex(b) }] })
			}
		}
		slots.push(slot)
	}

	let stateA: Answer[]
	let logA: Answer[]
	if (separate) {
		stateA = inChunks(sr, stateRpc, stateCalls, STATE_ITEMS_PER_CALL, budget)
		logA = inChunks(sr, logRpc, logCalls, itemsPerCall, budget)
	} else {
		const all = inChunks(sr, stateRpc, [...stateCalls, ...logCalls], itemsPerCall, budget)
		stateA = all.slice(0, stateCalls.length)
		logA = all.slice(stateCalls.length)
	}

	const header = (chainIdA: Answer, blockA: Answer, who: string): string => {
		const chainId = Number(BigInt(must<string>(chainIdA, 'eth_chainId')))
		if (chainId !== ROBINHOOD_CHAIN_ID) throw new Error(`the ${who} RPC is chain ${chainId}, not Robinhood Chain ${ROBINHOOD_CHAIN_ID}`)
		const b = must<{ hash?: string } | null>(blockA, 'eth_getBlockByNumber')
		if (!b || typeof b.hash !== 'string') throw new Error(`block ${block} is not known to the ${who} RPC`)
		return b.hash.toLowerCase()
	}
	const blockHash = header(stateA[0], stateA[1], 'state')
	if (separate && header(logA[0], logA[1], 'log') !== blockHash) throw new Error(`the two RPCs give different hashes for block ${block}`)

	const read: BatchRead = { chainId: ROBINHOOD_CHAIN_ID, block, blockHash, tokens: [] }
	tokens.forEach((token, i) => {
		const a = stateA.slice(identity.length + 5 * i, identity.length + 5 * (i + 1))
		const codeHash = must<string>(a[0], `EXTCODEHASH ${token}`)
		if (typeof codeHash !== 'string' || !/^0x[0-9a-fA-F]{64}$/.test(codeHash)) throw new Error(`EXTCODEHASH ${token}: the RPC did not answer 32 bytes`)
		const state: BatchTokenState = {
			token,
			codeHash: codeHash.toLowerCase(),
			beaconSlot: must<string>(a[1], `eth_getStorageAt ${token}`),
			symbol: decodeAbiText(soft(a[2])),
			name: decodeAbiText(soft(a[3])),
			multiplier: decodeUint(soft(a[4])),
			factoryLog: null,
			multiplierUpdates: null,
		}
		const slot = slots[i]
		if (slot.factory >= 0) {
			state.factoryLog = factoryNames(token, must<Log[]>(logA[slot.factory], 'eth_getLogs (factory)'))
			const logs: Log[] = []
			for (const w of slot.windows) logs.push(...must<Log[]>(logA[w], 'eth_getLogs (UIMultiplierUpdated)'))
			state.multiplierUpdates = multiplierUpdates(token, logs).length
		} else if (listedToken(token)) {
			state.factoryLog = false
			state.multiplierUpdates = 0
		}
		read.tokens.push(state)
	})
	const out = canonicalJson(read)
	if (utf8(out).length > MAX_OBSERVATION_BYTES) throw new Error(`what was read about ${tokens.length} tokens is ${utf8(out).length} bytes, more than one consensus round carries; send fewer tokens`)
	return out
}

/** The report TokenCheckReceiver decodes. kind 1: one batch of rows. kind 2: a results file. */
export const TOKEN_CHECK_REPORT_ABI = parseAbiParameters(
	'uint8 kind, bytes32 hash, bytes32 listHash, bytes32 blockHash, uint64 checkedBlock, uint32 tokens, uint32 issuerTokens, uint32 runs',
)
export const KIND_BATCH = 1
export const KIND_RESULTS = 2
/** keccak256("TokenBatchChecked(bytes32,bytes32,uint64,bytes32,uint32,uint32,bytes32,bytes10,address)") */
export const TOKEN_BATCH_CHECKED_TOPIC = keccakText('TokenBatchChecked(bytes32,bytes32,uint64,bytes32,uint32,uint32,bytes32,bytes10,address)')
const ZERO32 = `0x${'0'.repeat(64)}`

type WriteTarget = { evm: EVMClient; receiver: string; gasLimit: string; chain: string }

function writeTarget(cfg: Config): WriteTarget {
	if (!cfg.chainSelectorName || !cfg.receiverAddress || !cfg.gasLimit) throw new Error('config needs chainSelectorName, receiverAddress and gasLimit: this run writes its hash onchain')
	const network = getNetwork({ chainFamily: 'evm', chainSelectorName: cfg.chainSelectorName, isTestnet: true })
	if (!network) throw new Error(`unknown chain ${cfg.chainSelectorName}`)
	return { evm: new EVMClient(network.chainSelector.selector), receiver: cfg.receiverAddress, gasLimit: cfg.gasLimit, chain: cfg.chainSelectorName }
}

function writeReport(
	runtime: Runtime<Config>,
	t: WriteTarget,
	r: { kind: number; hash: string; blockHash: string; checkedBlock: number; tokens: number; issuerTokens: number; runs: number },
): string {
	const encoded = encodeAbiParameters(TOKEN_CHECK_REPORT_ABI, [
		r.kind,
		r.hash as `0x${string}`,
		LIST_HASH as `0x${string}`,
		r.blockHash as `0x${string}`,
		BigInt(r.checkedBlock),
		r.tokens,
		r.issuerTokens,
		r.runs,
	])
	const report = runtime.report(prepareReportRequest(encoded)).result()
	const write = t.evm.writeReport(runtime, { receiver: t.receiver, report, gasConfig: { gasLimit: t.gasLimit } }).result()
	if (write.txStatus !== TxStatus.SUCCESS) throw new Error(`writeReport failed: ${write.errorMessage || write.txStatus}`)
	return bytesToHex(write.txHash ?? new Uint8Array(32))
}

const host = (url: string) => url.replace(/^https?:\/\//, '').replace(/\/.*$/, '')

function onBatch(runtime: Runtime<Config>, input: BatchPayload): string {
	const cfg = runtime.config
	const tokens = [...new Set(input.tokens.map((t) => t.toLowerCase()))]
	const stateRpc = cfg.stateRpc ?? cfg.robinhoodRpc
	const target = writeTarget(cfg)
	runtime.log(`token check, batch (Robinhood Chain ${ROBINHOOD_CHAIN_ID}, read over JSON-RPC, no vet402 API)`)
	runtime.log(`tokens  ${tokens.length}`)
	runtime.log(`state   ${host(stateRpc)}   logs ${host(cfg.robinhoodRpc)}`)

	const http = new cre.capabilities.HTTPClient()
	let block = input.block ?? 0
	let used = 0
	if (block === 0) {
		const head = Math.floor(http.sendRequest(runtime, readHead, consensusMedianAggregation<number>())(stateRpc).result())
		block = head - HEAD_MARGIN
		used = 1
		runtime.log(`head    ${head} (median of the nodes), checking at block ${block}`)
	}
	const itemsPerCall = input.itemsPerCall ?? ITEMS_PER_CALL
	const planned = plannedHttpCalls(tokens, block, stateRpc !== cfg.robinhoodRpc, itemsPerCall) - 1 + used
	if (planned > MAX_HTTP_CALLS) throw new Error(`${tokens.length} tokens need ${planned} RPC requests, one run may spend ${MAX_HTTP_CALLS}; send fewer tokens`)

	const read = JSON.parse(
		http.sendRequest(runtime, readBatch, consensusIdenticalAggregation<string>())(stateRpc, cfg.robinhoodRpc, tokens.join(','), block, used, itemsPerCall).result(),
	) as BatchRead
	const result = judgeBatch(read)
	runtime.log(`block   ${result.block}  hash ${result.blockHash}${stateRpc !== cfg.robinhoodRpc ? ' (the same from both RPCs)' : ''}`)
	for (const line of renderBatch(result)) runtime.log(line)

	const tx = writeReport(runtime, target, {
		kind: KIND_BATCH,
		hash: result.batchHash,
		blockHash: result.blockHash,
		checkedBlock: result.block,
		tokens: tokens.length,
		issuerTokens: result.issuerTokens,
		runs: 1,
	})
	runtime.log(`batch hash written to ${target.receiver} on ${target.chain}, tx ${tx}`)
	pause(LOG_FLUSH_MS)
	return JSON.stringify({ mode: 'batch', ...result, batchTx: tx })
}

// ---------------------------------------------------------------- anchoring a results file

export const anchorPayloadSchema = z
	.object({
		/** The results file, byte for byte. Its keccak256 is what gets written. */
		results_json: z.string().min(2),
		/** For each run of the file's cre_runs, in order: the tokens that run checked. */
		batches: z.array(z.array(ADDRESS).min(1)).min(1),
	})
	.strict()
export type AnchorPayload = z.infer<typeof anchorPayloadSchema>

/** Runs one results file may name. CRE allows 15 chain reads per execution. */
export const MAX_ANCHOR_RUNS = 15

function onAnchor(runtime: Runtime<Config>, input: AnchorPayload): string {
	const target = writeTarget(runtime.config)
	let results: ResultsFile
	try {
		results = JSON.parse(input.results_json) as ResultsFile
	} catch {
		throw new Error('results refused: results_json is not JSON')
	}
	const problem = resultsProblem(results)
	if (problem) throw new Error(`results refused: ${problem}`)
	const runs = results.cre_runs
	if (runs.length > MAX_ANCHOR_RUNS) throw new Error(`results refused: ${runs.length} runs, one anchor reads at most ${MAX_ANCHOR_RUNS} receipts`)
	if (input.batches.length !== runs.length) throw new Error(`results refused: ${runs.length} runs in the file, ${input.batches.length} batches in the payload`)
	const seen = new Set<string>()
	for (const batch of input.batches) {
		for (const raw of batch) {
			const t = raw.toLowerCase()
			if (!results.tokens[t]) throw new Error(`results refused: ${t} is in a batch and not in the file`)
			if (seen.has(t)) throw new Error(`results refused: ${t} is in two batches`)
			seen.add(t)
		}
	}
	const all = Object.keys(results.tokens)
	if (seen.size !== all.length) throw new Error(`results refused: ${all.length - seen.size} tokens of the file are in no batch`)
	const issuerTokens = all.filter((t) => results.tokens[t].issuer_token).length
	runtime.log(`token check, anchor: ${all.length} tokens (${issuerTokens} the issuer's) from ${runs.length} runs`)

	// Each run must already be onchain: its receipt holds TokenBatchChecked with the hash of the file's rows.
	runs.forEach((run, i) => {
		const rows = Object.fromEntries(input.batches[i].map((t) => [t.toLowerCase(), results.tokens[t.toLowerCase()]]))
		const want = batchHash(rows)
		const receipt = target.evm.getTransactionReceipt(runtime, { hash: hexToBase64(run.tx) }).result().receipt
		const found =
			receipt !== undefined &&
			Number(receipt.status) === 1 &&
			receipt.logs.some(
				(l) =>
					bytesToHex(l.address).toLowerCase() === target.receiver.toLowerCase() &&
					l.topics.length > 1 &&
					bytesToHex(l.topics[0]).toLowerCase() === TOKEN_BATCH_CHECKED_TOPIC &&
					bytesToHex(l.topics[1]).toLowerCase() === want,
			)
		if (!found) throw new Error(`results refused: run ${i + 1} (${run.tx}) holds no TokenBatchChecked log of ${target.receiver} with hash ${want}`)
		runtime.log(`run ${i + 1}   ${run.tx} holds TokenBatchChecked ${want} (${input.batches[i].length} tokens)`)
	})

	const resultsHash = keccakText(input.results_json)
	const lastBlock = all.reduce((m, t) => Math.max(m, results.tokens[t].checked_block), 0)
	runtime.log(`results hash ${resultsHash} (keccak256 of the file)`)
	const tx = writeReport(runtime, target, { kind: KIND_RESULTS, hash: resultsHash, blockHash: ZERO32, checkedBlock: lastBlock, tokens: all.length, issuerTokens, runs: runs.length })
	runtime.log(`results hash written to ${target.receiver} on ${target.chain}, tx ${tx}`)
	pause(LOG_FLUSH_MS)
	return JSON.stringify({ mode: 'anchor', resultsHash, listHash: LIST_HASH, tokens: all.length, issuerTokens, runs: runs.length, lastCheckedBlock: lastBlock, anchorTx: tx })
}

// ---------------------------------------------------------------- the handler

export const onHttpTrigger = (runtime: Runtime<Config>, payload: HTTPPayload): string => {
	const raw = payload.input && payload.input.length > 0 ? fromUtf8(payload.input) : '{}'
	const body = JSON.parse(raw) as Record<string, unknown>
	if (body && typeof body === 'object' && 'tokens' in body) return onBatch(runtime, batchPayloadSchema.parse(body))
	if (body && typeof body === 'object' && 'results_json' in body) return onAnchor(runtime, anchorPayloadSchema.parse(body))
	return onTransaction(runtime, payloadSchema.parse(body))
}

function onTransaction(runtime: Runtime<Config>, input: Payload): string {
	const cfg = runtime.config
	const tx = input.tx.toLowerCase()
	const wallet = input.wallet.toLowerCase()

	for (const line of renderHeader(tx, wallet)) runtime.log(line)

	const http = new cre.capabilities.HTTPClient()
	const read = JSON.parse(
		http.sendRequest(runtime, readChain, consensusIdenticalAggregation<string>())(cfg.robinhoodRpc, tx, wallet, input.block ?? 0).result(),
	) as CheckInput

	const result = check(read)
	for (const line of render(result)) runtime.log(line)
	// The log is delivered after the fact. Without this moment the last lines of a
	// run can arrive after the handler has returned, and a simulation drops them.
	pause(LOG_FLUSH_MS)

	return JSON.stringify({
		tx: result.tx,
		wallet: result.wallet,
		block: result.block,
		allow: result.allow,
		reasonBits: result.reasonBits,
		reasons: result.reasons,
		tokens: result.tokens,
		list: result.list,
	})
}

export function initWorkflow(_config: Config) {
	const http = new HTTPCapability()
	return [cre.handler(http.trigger({}), onHttpTrigger)]
}
