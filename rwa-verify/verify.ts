// The verification core. Pure functions, no network and no CRE imports, so the
// same code runs inside the CRE workflow (WASM), in `bun test`, and in the local
// runner under scripts/.
//
// It follows packages/rwa/scripts/verify-record.mjs in the vet402 repo line by
// line: the same canonical JSON, the same hash material per method_version, the
// same Anchored log decoding and the same checks. Only the keccak comes from
// viem instead of a hand-written one.
import { keccak256 } from 'viem'

export const RWA_ANCHOR_ADDRESS = '0x1955137e7773f2459eb75fb88842026c6517c22d'
export const ROBINHOOD_CHAIN_ID = 4663
/** keccak256 of eth_getCode(RwaAnchor). vet402 pins the same value in its forge test and onchain.json. */
export const RWA_ANCHOR_RUNTIME_KECCAK = '0x9032fa493b888a32b4773a18ae74814d4f492d136c4cd55ade593eb783f9b5b0'
/** keccak256("Anchored(bytes32,bytes32,uint32,uint64,address)") */
export const ANCHORED_TOPIC = '0x6e444efa5833ba2e7827d2af0e549ecabc47b47c0b03a83c17760929be369360'
const METHOD_NUMBERS: Record<string, number> = { 'rwa-recon-0.1': 1, 'rwa-recon-0.2': 2, 'rwa-recon-0.3': 3 }

/** One bit per failed check. The receiver contract stores the same number. */
export const Reason = {
	TX_FAILED: 1,
	NO_ANCHOR_LOG: 2,
	CONTRACT_CODE: 4,
	ANCHORED_BY: 8,
	SUBJECT: 16,
	FACTS_HASH: 32,
	METHOD_VERSION: 64,
	AS_OF: 128,
	RECORD_FACTS_HASH: 256,
	RECORD_UNREADABLE: 512,
	RECORD_CONTRACT: 1024,
	WRONG_CHAIN: 2048,
} as const

export const REASON_TEXT: Record<number, string> = {
	[Reason.TX_FAILED]: 'anchor tx missing or failed',
	[Reason.NO_ANCHOR_LOG]: 'no Anchored log from RwaAnchor in that tx',
	[Reason.CONTRACT_CODE]: 'RwaAnchor runtime code is not the pinned build',
	[Reason.ANCHORED_BY]: 'anchor was written by a different operator',
	[Reason.SUBJECT]: 'wallet in the record is not the anchored subject',
	[Reason.FACTS_HASH]: 'record hash differs from the anchored factsHash',
	[Reason.METHOD_VERSION]: 'method_version differs from the anchor',
	[Reason.AS_OF]: 'as_of differs from the anchor',
	[Reason.RECORD_FACTS_HASH]: 'facts_hash written in the record differs from its own content',
	[Reason.RECORD_UNREADABLE]: 'record could not be read or has an unknown method_version',
	[Reason.RECORD_CONTRACT]: 'record names a different anchor contract',
	[Reason.WRONG_CHAIN]: 'RPC is not Robinhood Chain (4663)',
}

export function reasonList(bits: number): string[] {
	return Object.keys(REASON_TEXT)
		.map(Number)
		.sort((a, b) => a - b)
		.filter((b) => (bits & b) !== 0)
		.map((b) => REASON_TEXT[b])
}

// ---------------------------------------------------------------- bytes

/** UTF-8 encode without TextEncoder, which the CRE WASM runtime may not provide. */
export function utf8(s: string): Uint8Array {
	const out: number[] = []
	for (let i = 0; i < s.length; i++) {
		let c = s.charCodeAt(i)
		if (c >= 0xd800 && c <= 0xdbff && i + 1 < s.length) {
			const d = s.charCodeAt(i + 1)
			if (d >= 0xdc00 && d <= 0xdfff) {
				c = 0x10000 + ((c - 0xd800) << 10) + (d - 0xdc00)
				i++
			}
		}
		if (c < 0x80) out.push(c)
		else if (c < 0x800) out.push(0xc0 | (c >> 6), 0x80 | (c & 63))
		else if (c < 0x10000) out.push(0xe0 | (c >> 12), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63))
		else out.push(0xf0 | (c >> 18), 0x80 | ((c >> 12) & 63), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63))
	}
	return Uint8Array.from(out)
}

/** UTF-8 decode without TextDecoder. */
export function fromUtf8(b: Uint8Array): string {
	let out = ''
	for (let i = 0; i < b.length; ) {
		const c = b[i]
		let cp: number
		if (c < 0x80) {
			cp = c
			i += 1
		} else if (c >= 0xc0 && c < 0xe0) {
			cp = ((c & 31) << 6) | (b[i + 1] & 63)
			i += 2
		} else if (c >= 0xe0 && c < 0xf0) {
			cp = ((c & 15) << 12) | ((b[i + 1] & 63) << 6) | (b[i + 2] & 63)
			i += 3
		} else {
			cp = ((c & 7) << 18) | ((b[i + 1] & 63) << 12) | ((b[i + 2] & 63) << 6) | (b[i + 3] & 63)
			i += 4
		}
		if (cp > 0xffff) {
			cp -= 0x10000
			out += String.fromCharCode(0xd800 + (cp >> 10), 0xdc00 + (cp & 1023))
		} else {
			out += String.fromCharCode(cp)
		}
	}
	return out
}

export function keccakText(s: string): string {
	return keccak256(utf8(s))
}

export function keccakHex(hex: string): string {
	return keccak256(hex as `0x${string}`)
}

// ---------------------------------------------------------------- the commitment

/** Sorted keys, no spaces, undefined dropped. Same rules as verify-record.mjs. */
export function canonicalJson(v: unknown): string {
	if (v === null) return 'null'
	if (Array.isArray(v)) return `[${v.map((x) => (x === undefined ? 'null' : canonicalJson(x))).join(',')}]`
	switch (typeof v) {
		case 'string':
		case 'boolean':
			return JSON.stringify(v)
		case 'number':
			if (!Number.isFinite(v)) throw new Error('canonical JSON: non-finite number')
			return JSON.stringify(v)
		case 'object': {
			const o = v as Record<string, unknown>
			const keys = Object.keys(o)
				.filter((k) => o[k] !== undefined)
				.sort()
			return `{${keys.map((k) => `${JSON.stringify(k)}:${canonicalJson(o[k])}`).join(',')}}`
		}
		default:
			throw new Error(`canonical JSON: cannot encode ${typeof v}`)
	}
}

export type Facts = {
	address: string
	as_of: string
	method_version: string
	r1_status: string
	realized_usd?: string | null
	[k: string]: unknown
}

export function methodVersionNumber(mv: string): number {
	const n = METHOD_NUMBERS[mv]
	if (n === undefined) throw new Error(`unknown method_version ${mv}`)
	return n
}

/** factsHash for a facts record: five fields (0.1, 0.2) or five fields plus the keccak of the whole JSON (0.3+). */
export function commitment(facts: Facts): { material: 1 | 2; preimage: string; hash: string } {
	const material = methodVersionNumber(facts.method_version) >= 3 ? 2 : 1
	const address = String(facts.address).toLowerCase()
	const fields = [facts.method_version, address, facts.as_of, facts.r1_status, facts.realized_usd ?? 'null']
	if (material === 2) fields.push(keccakText(canonicalJson({ ...facts, address })))
	const preimage = fields.join('\n')
	return { material, preimage, hash: keccakText(preimage) }
}

export function subjectHash(address: string): string {
	return keccakText(String(address).toLowerCase())
}

// ---------------------------------------------------------------- record side

/** What the check needs from a record. Small, so it fits through CRE consensus. */
export type RecordSummary = {
	readable: boolean
	error: string
	address: string
	methodVersion: string
	methodNumber: number
	asOf: string
	asOfUnix: string
	subject: string
	factsHash: string
	material: number
	/** Fields an anchor record (fixtures/rwa/anchors/*.json) carries next to `facts`; empty for bare facts. */
	recordFactsHash: string
	recordContract: string
	recordAnchoredBy: string
	recordAnchorTx: string
}

/** Accepts an anchor record (with `facts` inside) or a bare facts JSON as /api/v1/rwa/facts returns it. */
export function summarizeRecord(record: unknown): RecordSummary {
	const empty: RecordSummary = {
		readable: false,
		error: '',
		address: '',
		methodVersion: '',
		methodNumber: 0,
		asOf: '',
		asOfUnix: '0',
		subject: '',
		factsHash: '',
		material: 0,
		recordFactsHash: '',
		recordContract: '',
		recordAnchoredBy: '',
		recordAnchorTx: '',
	}
	try {
		if (!record || typeof record !== 'object') throw new Error('record is not a JSON object')
		const r = record as Record<string, unknown>
		const facts = (r.facts ?? r) as Facts
		if (typeof facts.address !== 'string' || typeof facts.as_of !== 'string') {
			throw new Error('record has no address or as_of')
		}
		const c = commitment(facts)
		return {
			readable: true,
			error: '',
			address: facts.address.toLowerCase(),
			methodVersion: facts.method_version,
			methodNumber: methodVersionNumber(facts.method_version),
			asOf: facts.as_of,
			asOfUnix: String(Math.floor(Date.parse(facts.as_of) / 1000)),
			subject: subjectHash(facts.address),
			factsHash: c.hash,
			material: c.material,
			recordFactsHash: typeof r.facts_hash === 'string' ? r.facts_hash.toLowerCase() : '',
			recordContract: typeof r.contract === 'string' ? r.contract.toLowerCase() : '',
			recordAnchoredBy: typeof r.anchored_by === 'string' ? r.anchored_by.toLowerCase() : '',
			recordAnchorTx: typeof r.anchor_tx === 'string' ? r.anchor_tx.toLowerCase() : '',
		}
	} catch (e) {
		return { ...empty, error: String((e as Error)?.message ?? e).slice(0, 200) }
	}
}

// ---------------------------------------------------------------- chain side

export type AnchoredLog = {
	address: string
	subject: string
	factsHash: string
	anchoredBy: string
	methodVersion: number
	asOf: string
}

type RpcLog = { address: string; topics?: string[]; data: string }
export type RpcReceipt = { status?: string; blockNumber?: string; logs?: RpcLog[] } | null

/** Decode every Anchored log in a receipt; the caller decides which emitter it trusts. */
export function anchoredLogs(receipt: RpcReceipt): AnchoredLog[] {
	return (receipt?.logs ?? [])
		.filter((l) => l.topics?.[0]?.toLowerCase() === ANCHORED_TOPIC && l.topics.length === 4)
		.map((l) => {
			const topics = l.topics as string[]
			const data = l.data.slice(2)
			return {
				address: l.address.toLowerCase(),
				subject: topics[1].toLowerCase(),
				factsHash: topics[2].toLowerCase(),
				anchoredBy: `0x${topics[3].slice(-40)}`.toLowerCase(),
				methodVersion: Number(BigInt(`0x${data.slice(0, 64)}`)),
				asOf: BigInt(`0x${data.slice(64, 128)}`).toString(),
			}
		})
}

/** What the check needs from the chain. Also small enough for consensus. */
export type ChainSummary = {
	chainId: number
	txFound: boolean
	txSuccess: boolean
	blockNumber: number
	logs: AnchoredLog[]
	codeKeccak: string
}

export function summarizeChain(chainIdHex: string, receipt: RpcReceipt, code: string): ChainSummary {
	return {
		chainId: Number(BigInt(chainIdHex)),
		txFound: Boolean(receipt),
		txSuccess: receipt?.status === '0x1',
		blockNumber: receipt?.blockNumber ? Number(BigInt(receipt.blockNumber)) : 0,
		logs: anchoredLogs(receipt),
		codeKeccak: code && code !== '0x' ? keccakHex(code) : '',
	}
}

// ---------------------------------------------------------------- the check

export type Row = { name: string; ok: boolean; detail: string }
export type Verdict = {
	match: boolean
	reasons: number
	rows: Row[]
	subject: string
	recomputedFactsHash: string
	anchoredFactsHash: string
	asOfUnix: string
	anchorBlock: number
}

const ZERO32 = `0x${'0'.repeat(64)}`

export function short(h: string): string {
	return h ? `${h.slice(0, 10)}…${h.slice(-6)}` : '(none)'
}

/**
 * Compare a record with its anchor. Same rows as verify-record.mjs, plus a bit
 * per failed row so the result fits in one uint32 onchain.
 */
export function compare(
	rec: RecordSummary,
	chain: ChainSummary,
	opts: { contract?: string; operator?: string } = {},
): Verdict {
	const contract = (opts.contract ?? RWA_ANCHOR_ADDRESS).toLowerCase()
	const rows: Row[] = []
	let reasons = 0
	const row = (name: string, ok: boolean, detail: string, bit: number) => {
		rows.push({ name, ok, detail })
		if (!ok) reasons |= bit
	}

	row('chain', chain.chainId === ROBINHOOD_CHAIN_ID, `chain id ${chain.chainId}`, Reason.WRONG_CHAIN)
	row(
		'tx status',
		chain.txSuccess,
		chain.txFound ? `${chain.txSuccess ? 'success' : 'failed'} in block ${chain.blockNumber}` : 'no receipt',
		Reason.TX_FAILED,
	)
	const log = chain.logs.find((l) => l.address === contract)
	const others = chain.logs.filter((l) => l.address !== contract).length
	row(
		'contract',
		Boolean(log),
		log
			? `Anchored log from ${log.address} (RwaAnchor)`
			: `no Anchored log from ${contract}${others ? `, ${others} from other addresses ignored` : ''}`,
		Reason.NO_ANCHOR_LOG,
	)
	if (rec.recordContract && rec.recordContract !== contract) {
		row('record contract', false, `record names ${rec.recordContract}, expected ${contract}`, Reason.RECORD_CONTRACT)
	}
	row(
		'contract code',
		chain.codeKeccak === RWA_ANCHOR_RUNTIME_KECCAK,
		chain.codeKeccak === RWA_ANCHOR_RUNTIME_KECCAK
			? 'runtime equals the build of RwaAnchor.sol: no owner, no upgrade path'
			: `runtime keccak ${chain.codeKeccak || 'none'} != ${RWA_ANCHOR_RUNTIME_KECCAK}`,
		Reason.CONTRACT_CODE,
	)

	const base = {
		subject: rec.subject || ZERO32,
		recomputedFactsHash: rec.factsHash || ZERO32,
		anchoredFactsHash: log?.factsHash ?? ZERO32,
		asOfUnix: rec.asOfUnix || '0',
		anchorBlock: chain.blockNumber,
	}
	if (!rec.readable) {
		row('record', false, rec.error || 'unreadable', Reason.RECORD_UNREADABLE)
		return { match: false, reasons, rows, ...base }
	}
	if (!log) return { match: false, reasons, rows, ...base }

	const expectedBy = (opts.operator ?? rec.recordAnchoredBy ?? '').toLowerCase()
	if (expectedBy) {
		row(
			'anchoredBy',
			log.anchoredBy === expectedBy,
			`${log.anchoredBy}${log.anchoredBy === expectedBy ? '' : ` != expected ${expectedBy}`}`,
			Reason.ANCHORED_BY,
		)
	} else {
		row('anchoredBy', true, `${log.anchoredBy} (not compared: no operator given)`, Reason.ANCHORED_BY)
	}
	row(
		'subject',
		log.subject === rec.subject,
		`${short(log.subject)} = keccak(${rec.address})${log.subject === rec.subject ? '' : ` recomputed ${short(rec.subject)}`}`,
		Reason.SUBJECT,
	)
	row(
		'factsHash',
		log.factsHash === rec.factsHash,
		`${short(log.factsHash)} ${log.factsHash === rec.factsHash ? '=' : '!='} recomputed ${short(rec.factsHash)} (material v${rec.material}${rec.material === 2 ? ', binds the whole JSON' : ', five fields'})`,
		Reason.FACTS_HASH,
	)
	if (rec.recordFactsHash) {
		row(
			'record facts_hash',
			rec.recordFactsHash === rec.factsHash,
			`record says ${short(rec.recordFactsHash)}`,
			Reason.RECORD_FACTS_HASH,
		)
	}
	row(
		'methodVersion',
		log.methodVersion === rec.methodNumber,
		`${log.methodVersion} = ${rec.methodVersion}${log.methodVersion === rec.methodNumber ? '' : ` (expected ${rec.methodNumber})`}`,
		Reason.METHOD_VERSION,
	)
	row(
		'asOf',
		log.asOf === rec.asOfUnix,
		`${log.asOf} = ${rec.asOf}${log.asOf === rec.asOfUnix ? '' : ` (record gives ${rec.asOfUnix})`}`,
		Reason.AS_OF,
	)
	return { match: reasons === 0, reasons, rows, ...base }
}

/** Plain-text report, the same layout verify-record.mjs prints. */
export function renderVerdict(v: Verdict, rec: RecordSummary, tx: string, source: string): string {
	const lines = [
		'vet402 /rwa record check (Robinhood Chain 4663, no key)',
		`  record    ${source}`,
		`  wallet    ${rec.address || '?'}  ${rec.methodVersion || '?'}  as_of ${rec.asOf || '?'}`,
		`  tx        ${tx}`,
		'',
		...v.rows.map((r) => `  ${r.ok ? 'OK  ' : 'FAIL'}  ${r.name.padEnd(18)} ${r.detail}`),
		'',
		v.match
			? 'RESULT: MATCH. The JSON is the record that was anchored.'
			: `RESULT: MISMATCH. ${reasonList(v.reasons).join('; ')}.`,
	]
	return lines.join('\n')
}
