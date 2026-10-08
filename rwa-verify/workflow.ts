// CRE workflow: re-verify a vet402 /rwa record against its onchain anchor and
// write the verdict to a receiver contract.
//
//   HTTP trigger  { tx?, recordUrl?, record?, operator? }
//     -> HTTP  GET  vet402.com /api/v1/rwa/facts/<wallet>   live record, check X-Facts-Hash
//     -> HTTP  GET  recordUrl (or take `record` from the payload)   the record under test
//     -> HTTP  POST Robinhood Chain JSON-RPC                eth_chainId, receipt, eth_getCode(RwaAnchor)
//     -> compare (verify.ts, same rules as vet402's verify-record.mjs)
//     -> report + EVM write to RwaVerdictReceiver on Robinhood Testnet
//
// RwaAnchor lives on Robinhood Chain mainnet (4663), which CRE does not list as
// a supported chain, so the anchor is read over plain JSON-RPC through the HTTP
// capability. The verdict is written through CRE's EVM capability on a chain it
// does support.
import {
	bytesToHex,
	consensusIdenticalAggregation,
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
import {
	type ChainSummary,
	commitment,
	compare,
	type Facts,
	fromUtf8,
	RWA_ANCHOR_ADDRESS,
	type RecordSummary,
	reasonList,
	renderVerdict,
	type RpcReceipt,
	summarizeChain,
	summarizeRecord,
	utf8,
	type Verdict,
} from './verify'

export const configSchema = z.object({
	/** Wallet whose live record is read from vet402 /rwa. */
	wallet: z.string(),
	/** vet402 /rwa facts route; `<address>` is replaced. */
	factsApi: z.string(),
	/** Default record under test: the anchored snapshot, pinned to a commit. */
	recordUrl: z.string(),
	/** Default anchor tx on Robinhood Chain. */
	anchorTx: z.string(),
	/** Operator whose anchor is accepted when the record does not name one. */
	operator: z.string(),
	/** Public Robinhood Chain (4663) JSON-RPC endpoint. */
	robinhoodRpc: z.string(),
	/** Where the verdict is written. */
	chainSelectorName: z.string(),
	receiverAddress: z.string(),
	gasLimit: z.string(),
})
export type Config = z.infer<typeof configSchema>

export const payloadSchema = z
	.object({
		tx: z
			.string()
			.regex(/^0x[0-9a-fA-F]{64}$/)
			.optional(),
		// zod's .url() rejected a valid https URL inside `cre workflow simulate`
		// (2026-10-09, it passes under bun), so a plain https check is used instead.
		recordUrl: z
			.string()
			.regex(/^https:\/\/[^\s/]+\/\S*$/)
			.optional(),
		record: z.record(z.unknown()).optional(),
		operator: z
			.string()
			.regex(/^0x[0-9a-fA-F]{40}$/)
			.optional(),
	})
	.strict()
export type Payload = z.infer<typeof payloadSchema>

export const REPORT_ABI = parseAbiParameters(
	'bytes32 anchorTx, bytes32 subject, bool isMatch, uint32 reasons, bytes32 recomputedFactsHash, bytes32 anchoredFactsHash, uint64 asOf, uint64 anchorBlock',
)

function bodyText(body: Uint8Array): string {
	return fromUtf8(body)
}

function header(headers: Record<string, string> | undefined, name: string): string {
	if (!headers) return ''
	const k = Object.keys(headers)
		.sort()
		.find((h) => h.toLowerCase() === name)
	return k ? headers[k] : ''
}

// ---------------------------------------------------------------- node-mode fetches

export type LiveSummary = {
	status: number
	asOf: string
	methodVersion: string
	headerHash: string
	recomputedHash: string
	headerMatchesBody: boolean
}

/** Live record from vet402 /rwa. Checks that X-Facts-Hash is the hash of the body it came with. */
export const fetchLive = (sr: HTTPSendRequester, url: string): LiveSummary => {
	const res = sr.sendRequest({ method: 'GET', url, headers: { accept: 'application/json' } }).result()
	if (res.statusCode !== 200) {
		return { status: res.statusCode, asOf: '', methodVersion: '', headerHash: '', recomputedHash: '', headerMatchesBody: false }
	}
	const facts = JSON.parse(bodyText(res.body)) as Facts
	const headerHash = header(res.headers, 'x-facts-hash').toLowerCase()
	const recomputedHash = commitment(facts).hash
	return {
		status: res.statusCode,
		asOf: facts.as_of,
		methodVersion: facts.method_version,
		headerHash,
		recomputedHash,
		headerMatchesBody: headerHash === recomputedHash,
	}
}

/** The record under test, reduced to what the check needs. */
export const fetchRecord = (sr: HTTPSendRequester, url: string): RecordSummary => {
	const res = sr.sendRequest({ method: 'GET', url }).result()
	if (res.statusCode !== 200) return summarizeRecord(null)
	try {
		return summarizeRecord(JSON.parse(bodyText(res.body)))
	} catch {
		return summarizeRecord(null)
	}
}

function rpc(sr: HTTPSendRequester, url: string, method: string, params: unknown[]): unknown {
	const body = JSON.stringify({ jsonrpc: '2.0', id: 1, method, params })
	const res = sr
		.sendRequest({
			method: 'POST',
			url,
			headers: { 'content-type': 'application/json' },
			body: hexToBase64(bytesToHex(utf8(body))),
		})
		.result()
	if (res.statusCode !== 200) throw new Error(`${method}: HTTP ${res.statusCode}`)
	const out = JSON.parse(bodyText(res.body)) as { result?: unknown; error?: { message?: string } }
	if (out.error) throw new Error(`${method}: ${out.error.message ?? 'rpc error'}`)
	return out.result
}

/** Robinhood Chain reads: chain id, the anchor tx receipt, RwaAnchor's runtime code. */
export const fetchChain = (sr: HTTPSendRequester, url: string, tx: string, anchor: string): ChainSummary => {
	const chainId = rpc(sr, url, 'eth_chainId', []) as string
	const receipt = rpc(sr, url, 'eth_getTransactionReceipt', [tx]) as RpcReceipt
	const code = rpc(sr, url, 'eth_getCode', [anchor, 'latest']) as string
	return summarizeChain(chainId, receipt, code)
}

// ---------------------------------------------------------------- the handler

export function encodeVerdict(tx: string, v: Verdict): `0x${string}` {
	return encodeAbiParameters(REPORT_ABI, [
		tx as `0x${string}`,
		v.subject as `0x${string}`,
		v.match,
		v.reasons,
		v.recomputedFactsHash as `0x${string}`,
		v.anchoredFactsHash as `0x${string}`,
		BigInt(v.asOfUnix),
		BigInt(v.anchorBlock),
	])
}

export const onHttpTrigger = (runtime: Runtime<Config>, payload: HTTPPayload): string => {
	const cfg = runtime.config
	const raw = payload.input && payload.input.length > 0 ? bodyText(payload.input) : '{}'
	const input = payloadSchema.parse(JSON.parse(raw))
	const tx = (input.tx ?? cfg.anchorTx).toLowerCase()
	const http = new cre.capabilities.HTTPClient()

	// 1. Live record from vet402 /rwa.
	const liveUrl = cfg.factsApi.replace('<address>', cfg.wallet)
	const live = http.sendRequest(runtime, fetchLive, consensusIdenticalAggregation<LiveSummary>())(liveUrl).result()
	runtime.log(
		`live /rwa record: HTTP ${live.status}, as_of ${live.asOf}, X-Facts-Hash ${live.headerMatchesBody ? 'matches' : 'does NOT match'} the body`,
	)

	// 2. The record under test.
	let source: string
	let rec: RecordSummary
	if (input.record) {
		source = 'record passed in the trigger payload'
		rec = summarizeRecord(input.record)
	} else {
		source = input.recordUrl ?? cfg.recordUrl
		rec = http.sendRequest(runtime, fetchRecord, consensusIdenticalAggregation<RecordSummary>())(source).result()
	}
	runtime.log(`record under test: ${rec.address} ${rec.methodVersion} as_of ${rec.asOf}, recomputed factsHash ${rec.factsHash}`)

	// 3. The anchor on Robinhood Chain.
	const chain = http
		.sendRequest(runtime, fetchChain, consensusIdenticalAggregation<ChainSummary>())(
			cfg.robinhoodRpc,
			tx,
			RWA_ANCHOR_ADDRESS,
		)
		.result()

	// 4. Compare.
	const verdict = compare(rec, chain, { operator: input.operator ?? (rec.recordAnchoredBy ? undefined : cfg.operator) })
	for (const line of renderVerdict(verdict, rec, tx, source).split('\n')) runtime.log(line)
	if (live.status === 200 && live.asOf && rec.asOf && live.asOf !== rec.asOf) {
		runtime.log(`note: the live /rwa record (as_of ${live.asOf}) is newer than the record under test (as_of ${rec.asOf})`)
	}

	// 5. Write the verdict.
	const network = getNetwork({ chainFamily: 'evm', chainSelectorName: cfg.chainSelectorName, isTestnet: true })
	if (!network) throw new Error(`unknown chain ${cfg.chainSelectorName}`)
	const evm = new EVMClient(network.chainSelector.selector)
	const encoded = encodeVerdict(tx, verdict)
	const report = runtime.report(prepareReportRequest(encoded)).result()
	const write = evm
		.writeReport(runtime, {
			receiver: cfg.receiverAddress,
			report,
			gasConfig: { gasLimit: cfg.gasLimit },
		})
		.result()
	if (write.txStatus !== TxStatus.SUCCESS) {
		throw new Error(`writeReport failed: ${write.errorMessage || write.txStatus}`)
	}
	runtime.log(`verdict written to ${cfg.receiverAddress} on ${cfg.chainSelectorName}, tx ${bytesToHex(write.txHash ?? new Uint8Array(32))}`)

	return JSON.stringify({
		verdict: verdict.match ? 'MATCH' : 'MISMATCH',
		reasons: reasonList(verdict.reasons),
		reasonBits: verdict.reasons,
		anchorTx: tx,
		anchorBlock: verdict.anchorBlock,
		subject: verdict.subject,
		recomputedFactsHash: verdict.recomputedFactsHash,
		anchoredFactsHash: verdict.anchoredFactsHash,
		record: { source, wallet: rec.address, methodVersion: rec.methodVersion, asOf: rec.asOf },
		live: { asOf: live.asOf, xFactsHashMatchesBody: live.headerMatchesBody },
	})
}

export function initWorkflow(_config: Config) {
	const http = new HTTPCapability()
	return [cre.handler(http.trigger({}), onHttpTrigger)]
}
