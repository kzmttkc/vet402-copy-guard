// CRE workflow: a compliance check an agent runs before it acts on a transfer.
//
//   HTTP trigger { tx, wallet, block? }
//     -> HTTP POST Robinhood Chain JSON-RPC (batches):
//          eth_chainId, eth_blockNumber, eth_getTransactionByHash (only without `block`)
//          eth_getLogs x2   the Transfer logs of that block that name the wallet
//          per token        eth_getCode, eth_getStorageAt (EIP-1967 beacon slot),
//                           symbol(), name(), uiMultiplier(),
//                           the factory's TokenDeployed log, UIMultiplierUpdated logs
//     -> check.ts decides, per token: GENUINE_STOCK_TOKEN, USDG,
//        NOT_A_STOCK_TOKEN, LOOKALIKE or UNVERIFIED, with reason bits
//     -> returns { tx, wallet, block, allow, reasonBits, tokens }
//
// No vet402 API is called. Every input of the decision is read from the chain's
// own RPC, or comes from the list bundled in registry-snapshot.json.
//
// Robinhood Chain mainnet (4663) is not a chain CRE lists, so it is read over
// the HTTP capability. The public RPC keeps no historical state, so the state
// reads are `latest`. Nothing is written onchain.
import {
	bytesToHex,
	consensusIdenticalAggregation,
	cre,
	HTTPCapability,
	type HTTPPayload,
	type HTTPSendRequester,
	hexToBase64,
	type Runtime,
} from '@chainlink/cre-sdk'
import { z } from 'zod'
import { canonicalJson, fromUtf8, utf8 } from '../rwa-verify/verify'
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
	/** Public Robinhood Chain (4663) JSON-RPC endpoint. */
	robinhoodRpc: z.string(),
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
/** The public RPC answers a log query over at most this many blocks. */
export const LOG_SPAN_BLOCKS = 10_000_000
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

// ---------------------------------------------------------------- the handler

export const onHttpTrigger = (runtime: Runtime<Config>, payload: HTTPPayload): string => {
	const cfg = runtime.config
	const raw = payload.input && payload.input.length > 0 ? fromUtf8(payload.input) : '{}'
	const input = payloadSchema.parse(JSON.parse(raw))
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
