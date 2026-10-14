// The batch check. Pure functions, no network and no CRE imports.
//
// Question it answers: for each address in a list, is the token at that address
// the issuer's Robinhood Stock Token, on what grounds, under which ticker, and
// how many times has its share multiplier been changed, as of one block?
//
// The decision itself is `judge` in check.ts, the same one the one-transaction
// check uses. This file turns its answer into the row an agent's ledger keeps:
//
//   { issuer_token, ticker, reasons, multiplier_updates, checked_block }
//
// Every reason code states something that was read: a list entry, a code hash,
// a storage slot, a log, a string a contract answered. None of them says who
// made a token or why.
import { canonicalJson, keccakText } from '../rwa-verify/verify'
import { decimal18, judge, listedToken, MULTIPLIER_ONE, Reason, SNAPSHOT, showText, type TokenState, USDG, type Verdict } from './check'

// ---------------------------------------------------------------- reasons

export const BATCH_REASON_TEXT = {
	IN_ISSUER_LIST: "the address is in the issuer's asset list (snapshot)",
	NOT_IN_ISSUER_LIST: "the address is not in the issuer's asset list (snapshot)",
	USDG_ADDRESS: 'the address is USDG (matched by address)',
	CODE_HASH_MATCHES: 'EXTCODEHASH of the address is the Stock Token proxy code hash',
	CODE_HASH_DIFFERS: 'EXTCODEHASH of the address is not the Stock Token proxy code hash',
	NO_CONTRACT_CODE: 'the address has no contract code at the checked block',
	BEACON_MATCHES: 'the EIP-1967 beacon slot holds the Stock Token beacon',
	BEACON_DIFFERS: 'the EIP-1967 beacon slot does not hold the Stock Token beacon',
	FACTORY_LOG_NAMES_TOKEN: 'a TokenDeployed log of the Stock Token factory names the address',
	FACTORY_LOG_MISSING: 'no TokenDeployed log of the Stock Token factory names the address',
	TICKER_MATCHES_LIST: 'symbol() answers the ticker the list gives for the address',
	TICKER_DIFFERS_FROM_LIST: 'symbol() does not answer the ticker the list gives for the address',
	TICKER_SAME_AS_ISSUER_TOKEN: 'symbol() is the ticker of a listed token, and the listed token is at another address',
	TICKER_SAME_AFTER_FOLDING: 'symbol() equals a listed ticker once invisible characters are removed and homoglyphs are folded to Latin',
	NAME_SAME_AS_ISSUER_TOKEN: 'name() is the name of a listed token, and the listed token is at another address',
	NAME_ENDS_LIKE_ISSUER_TOKEN: 'name() ends with "Robinhood Token" or a close form of it',
	TICKER_OR_NAME_READS_AS_USDG: 'symbol() reads as USDG or name() as Global Dollar, and USDG is at another address',
	INVISIBLE_CHARACTERS: 'symbol() or name() carries characters that render as nothing',
	HOMOGLYPH_CHARACTERS: 'symbol() or name() uses a digit or a non-Latin letter that renders like a Latin one',
	ISSUER_CODE_AT_UNLISTED_ADDRESS: 'the Stock Token proxy code and beacon are at an address outside the list (the list may be older than the token)',
	MULTIPLIER_NOT_ONE: 'uiMultiplier() is not 1 at the checked block',
	MULTIPLIER_UNREADABLE: 'uiMultiplier() did not answer',
} as const
export type BatchReason = keyof typeof BATCH_REASON_TEXT
export const BATCH_REASONS = Object.keys(BATCH_REASON_TEXT) as BatchReason[]

/**
 * The reasons that say a token outside the list carries a mark of a listed token
 * (its ticker, its name, its code) or of USDG. A consumer that wants one test for
 * "do not treat this as the listed token" can use this list.
 */
export const SHARES_A_LISTED_MARK: BatchReason[] = [
	'TICKER_SAME_AS_ISSUER_TOKEN',
	'TICKER_SAME_AFTER_FOLDING',
	'NAME_SAME_AS_ISSUER_TOKEN',
	'NAME_ENDS_LIKE_ISSUER_TOKEN',
	'TICKER_OR_NAME_READS_AS_USDG',
	'ISSUER_CODE_AT_UNLISTED_ADDRESS',
]

/** check.ts reason bit -> the batch code, for a token outside the list. */
const UNLISTED: [number, BatchReason][] = [
	[Reason.NO_CONTRACT_CODE, 'NO_CONTRACT_CODE'],
	[Reason.CODE_HASH_DIFFERS, 'CODE_HASH_DIFFERS'],
	[Reason.BEACON_DIFFERS, 'BEACON_DIFFERS'],
	[Reason.SYMBOL_COPIES_LISTED, 'TICKER_SAME_AS_ISSUER_TOKEN'],
	[Reason.SYMBOL_DISGUISES_LISTED, 'TICKER_SAME_AFTER_FOLDING'],
	[Reason.NAME_COPIES_LISTED, 'NAME_SAME_AS_ISSUER_TOKEN'],
	[Reason.NAME_CLAIMS_ROBINHOOD_TOKEN, 'NAME_ENDS_LIKE_ISSUER_TOKEN'],
	[Reason.IMITATES_USDG, 'TICKER_OR_NAME_READS_AS_USDG'],
	[Reason.HIDDEN_CHARACTERS, 'INVISIBLE_CHARACTERS'],
	[Reason.CONFUSABLE_CHARACTERS, 'HOMOGLYPH_CHARACTERS'],
	[Reason.STOCK_TOKEN_CODE_UNLISTED, 'ISSUER_CODE_AT_UNLISTED_ADDRESS'],
]

// ---------------------------------------------------------------- one token

/** keccak256 of no bytes: what EXTCODEHASH answers for an account that exists and has no code. */
export const EMPTY_CODE_HASH = '0xc5d2460186f7233c927e7db2dcc703c0e500b653ca82273b7bfad8045d85a470'
const ZERO_WORD = `0x${'0'.repeat(64)}`

/** What one run read about one token, all of it as of one block. */
export type BatchTokenState = {
	token: string
	/** the 32-byte word EXTCODEHASH answered: zero for no account, EMPTY_CODE_HASH for no code */
	codeHash: string
	/** the raw word in the EIP-1967 beacon slot */
	beaconSlot: string
	/** symbol() and name(), null when the call reverted or returned nothing readable */
	symbol: string | null
	name: string | null
	/** uiMultiplier() as an integer string (18 decimals), null when the call reverted */
	multiplier: string | null
	/** did the factory emit a TokenDeployed log naming this token. Null when not read (address outside the list) */
	factoryLog: boolean | null
	/** UIMultiplierUpdated logs of the token from its deployment to the checked block. Null when not read (address outside the list) */
	multiplierUpdates: number | null
}

/** The row of docs/token-check/results.json. These five keys and no other. */
export type BatchTokenResult = {
	issuer_token: boolean
	ticker: string
	reasons: BatchReason[]
	multiplier_updates: number
	checked_block: number
}

/** What stands behind a row, for a person who wants to look. Kept next to the results, not in them. */
export type BatchTokenDetail = {
	verdict: Verdict
	symbol: string | null
	name: string | null
	code_hash: string
	beacon: string
	/** uiMultiplier at the checked block as a decimal ("1.000700791241405425"), null when it did not answer */
	multiplier: string | null
	factory_log: boolean | null
}

export function judgeBatchToken(s: BatchTokenState, block: number): { result: BatchTokenResult; detail: BatchTokenDetail } {
	const token = s.token.toLowerCase()
	const word = s.codeHash.toLowerCase()
	const state: TokenState = {
		token,
		codeHash: word === ZERO_WORD || word === EMPTY_CODE_HASH ? null : word,
		beaconSlot: s.beaconSlot,
		symbol: s.symbol,
		name: s.name,
		multiplier: s.multiplier,
		factoryLog: s.factoryLog,
		multiplierUpdates: null,
		multiplierLogsComplete: false,
	}
	const j = judge(state)
	const has = (bit: number) => (j.bits & bit) !== 0
	const listed = listedToken(token)
	const reasons: BatchReason[] = []
	let ticker: string
	let updates = 0

	if (listed) {
		if (s.multiplierUpdates === null) throw new Error(`${token} is in the list but its multiplier logs were not read`)
		updates = s.multiplierUpdates
		ticker = listed.symbol
		reasons.push('IN_ISSUER_LIST')
		reasons.push(has(Reason.NO_CONTRACT_CODE) ? 'NO_CONTRACT_CODE' : has(Reason.CODE_HASH_DIFFERS) ? 'CODE_HASH_DIFFERS' : 'CODE_HASH_MATCHES')
		reasons.push(has(Reason.BEACON_DIFFERS) ? 'BEACON_DIFFERS' : 'BEACON_MATCHES')
		reasons.push(has(Reason.FACTORY_LOG_MISSING) ? 'FACTORY_LOG_MISSING' : 'FACTORY_LOG_NAMES_TOKEN')
		reasons.push(has(Reason.LISTED_SYMBOL_DIFFERS) ? 'TICKER_DIFFERS_FROM_LIST' : 'TICKER_MATCHES_LIST')
		if (s.multiplier === null) reasons.push('MULTIPLIER_UNREADABLE')
		else if (s.multiplier !== MULTIPLIER_ONE) reasons.push('MULTIPLIER_NOT_ONE')
	} else if (token === USDG) {
		ticker = 'USDG'
		reasons.push('USDG_ADDRESS')
		if (has(Reason.NO_CONTRACT_CODE)) reasons.push('NO_CONTRACT_CODE')
	} else {
		ticker = s.symbol === null ? '' : showText(s.symbol)
		reasons.push('NOT_IN_ISSUER_LIST')
		for (const [bit, name] of UNLISTED) if (has(bit)) reasons.push(name)
	}

	return {
		result: { issuer_token: j.verdict === 'GENUINE_STOCK_TOKEN', ticker, reasons, multiplier_updates: updates, checked_block: block },
		detail: {
			verdict: j.verdict,
			symbol: s.symbol === null ? null : showText(s.symbol),
			name: s.name === null ? null : showText(s.name),
			code_hash: word,
			beacon: `0x${s.beaconSlot.slice(2).padStart(64, '0').slice(24)}`.toLowerCase(),
			multiplier: s.multiplier === null ? null : decimal18(s.multiplier),
			factory_log: s.factoryLog,
		},
	}
}

// ---------------------------------------------------------------- one run

/** What one run read. `blockHash` is the hash both RPCs gave for `block`. */
export type BatchRead = { chainId: number; block: number; blockHash: string; tokens: BatchTokenState[] }

export type BatchResult = {
	block: number
	blockHash: string
	/** keccak256 of the canonical JSON of `tokens`. This is what the run writes onchain. */
	batchHash: string
	/** keccak256 of the vet402 registry file the bundled list was cut from */
	listHash: string
	tokens: Record<string, BatchTokenResult>
	details: Record<string, BatchTokenDetail>
	issuerTokens: number
}

/** keccak256 of the canonical JSON (sorted keys, no spaces) of a map of rows. */
export function batchHash(tokens: Record<string, BatchTokenResult>): string {
	return keccakText(canonicalJson(tokens))
}

export const LIST_HASH = SNAPSHOT.source_file_keccak256.toLowerCase()

export function judgeBatch(read: BatchRead): BatchResult {
	const tokens: Record<string, BatchTokenResult> = {}
	const details: Record<string, BatchTokenDetail> = {}
	for (const s of read.tokens) {
		const { result, detail } = judgeBatchToken(s, read.block)
		tokens[s.token.toLowerCase()] = result
		details[s.token.toLowerCase()] = detail
	}
	return {
		block: read.block,
		blockHash: read.blockHash.toLowerCase(),
		batchHash: batchHash(tokens),
		listHash: LIST_HASH,
		tokens,
		details,
		issuerTokens: Object.values(tokens).filter((t) => t.issuer_token).length,
	}
}

/** The lines a run logs. Each stays far under CRE's 1 kb log line limit. */
export function renderBatch(r: BatchResult): string[] {
	const lines: string[] = []
	for (const [token, t] of Object.entries(r.tokens)) {
		lines.push(`${t.issuer_token ? 'ISSUER_TOKEN    ' : 'NOT_ISSUER_TOKEN'}  ${token}  ${JSON.stringify(t.ticker)}  updates ${t.multiplier_updates}  ${t.reasons.join(' ')}`)
	}
	const n = Object.keys(r.tokens).length
	lines.push(`RESULT: ${n} tokens at block ${r.block}, ${r.issuerTokens} the issuer's, ${n - r.issuerTokens} not`)
	lines.push(`batch hash ${r.batchHash} (keccak256 of the canonical JSON of the rows)`)
	return lines
}

// ---------------------------------------------------------------- planning: what fits in one run

/** The public RPC answers a log query with one address over at most this many blocks. */
export const LOG_SPAN_BLOCKS = 10_000_000
/** Tokens one run takes. With the caps below the answer the nodes agree on stays under CRE's 25 kb. */
export const MAX_BATCH_TOKENS = 60
/** The canonical JSON of what one run read may be this long. CRE's consensus limit is 25 kb. */
export const MAX_OBSERVATION_BYTES = 24_000
/**
 * JSON-RPC items per HTTP request to Robinhood's own RPC. It answers 429 to a whole
 * batch that is larger than what the caller's address has left of its rate. Ten went
 * through on a quiet line (2026-10-14); with a second reader on the same address, three did not.
 */
export const ITEMS_PER_CALL = 10
/** JSON-RPC items per HTTP request to a second RPC that is used for state only. */
export const STATE_ITEMS_PER_CALL = 400
/** HTTP requests a run is planned with. CRE allows 15 per execution, the rest is left for retries. */
export const PLAN_HTTP_CALLS = 11
/** State reads per token: EXTCODEHASH, the beacon slot, symbol(), name(), uiMultiplier(). */
export const STATE_ITEMS_PER_TOKEN = 5
/** Identity reads per RPC: eth_chainId and the header of the checked block. */
const IDENTITY_ITEMS = 2

/** The block ranges a token's multiplier logs are read over: from its deployment to `block`, LOG_SPAN_BLOCKS at a time. */
export function logWindows(deployedBlock: number, block: number): [number, number][] {
	const out: [number, number][] = []
	for (let a = deployedBlock; a <= block; a += LOG_SPAN_BLOCKS) out.push([a, Math.min(block, a + LOG_SPAN_BLOCKS - 1)])
	return out
}

/** Log queries a token needs: none outside the list, else the factory log and one per window. */
export function logItems(token: string, block: number): number {
	const listed = listedToken(token)
	if (!listed) return 0
	return listed.deployed_block === null ? 0 : 1 + logWindows(listed.deployed_block, block).length
}

/**
 * HTTP requests one run over `tokens` at `block` needs when every request is answered the
 * first time. `itemsPerCall`: how many JSON-RPC items go into one request to Robinhood's RPC.
 */
export function plannedHttpCalls(tokens: string[], block: number, separateStateRpc: boolean, itemsPerCall: number = ITEMS_PER_CALL): number {
	const state = tokens.length * STATE_ITEMS_PER_TOKEN + IDENTITY_ITEMS
	const logs = tokens.reduce((n, t) => n + logItems(t, block), 0)
	const head = 1
	if (separateStateRpc) return head + Math.ceil(state / STATE_ITEMS_PER_CALL) + Math.ceil((logs + IDENTITY_ITEMS) / itemsPerCall)
	return head + Math.ceil((state + logs) / itemsPerCall)
}

/** Split `tokens` into runs, in order, each within MAX_BATCH_TOKENS and PLAN_HTTP_CALLS. */
export function planRuns(tokens: string[], block: number, separateStateRpc: boolean, itemsPerCall: number = ITEMS_PER_CALL): string[][] {
	const runs: string[][] = []
	let current: string[] = []
	for (const t of tokens) {
		const next = [...current, t]
		if (current.length > 0 && (next.length > MAX_BATCH_TOKENS || plannedHttpCalls(next, block, separateStateRpc, itemsPerCall) > PLAN_HTTP_CALLS)) {
			runs.push(current)
			current = [t]
		} else {
			current = next
		}
	}
	if (current.length > 0) runs.push(current)
	return runs
}

// ---------------------------------------------------------------- the results file

export type ResultsFile = {
	generated_at: string
	cre_runs: { tx: string; simulate_log: string }[]
	tokens: Record<string, BatchTokenResult>
}

const TX = /^0x[0-9a-f]{64}$/
const ADDRESS = /^0x[0-9a-f]{40}$/
const ISO_UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/
const sameKeys = (o: object, keys: string[]) => canonicalJson(Object.keys(o).sort()) === canonicalJson([...keys].sort())

/**
 * Is `v` a results file in the fixed shape, with nothing in it this code does not
 * define? Returns the problem as a sentence, or null. A reason code outside
 * BATCH_REASON_TEXT is a problem, so no other wording can be anchored.
 */
export function resultsProblem(v: unknown): string | null {
	if (!v || typeof v !== 'object' || Array.isArray(v)) return 'the results are not a JSON object'
	const o = v as Record<string, unknown>
	if (!sameKeys(o, ['generated_at', 'cre_runs', 'tokens'])) return 'the results must have exactly generated_at, cre_runs and tokens'
	if (typeof o.generated_at !== 'string' || !ISO_UTC.test(o.generated_at)) return 'generated_at is not an ISO time in UTC'
	if (!Array.isArray(o.cre_runs) || o.cre_runs.length === 0) return 'cre_runs is empty'
	for (const r of o.cre_runs as Record<string, unknown>[]) {
		if (!r || typeof r !== 'object' || !sameKeys(r, ['tx', 'simulate_log'])) return 'a run must have exactly tx and simulate_log'
		if (typeof r.tx !== 'string' || !TX.test(r.tx)) return 'a run has no transaction hash'
		if (typeof r.simulate_log !== 'string' || r.simulate_log === '') return 'a run has no simulate_log'
	}
	if (!o.tokens || typeof o.tokens !== 'object' || Array.isArray(o.tokens)) return 'tokens is not an object'
	const entries = Object.entries(o.tokens as Record<string, Record<string, unknown>>)
	if (entries.length === 0) return 'tokens is empty'
	for (const [address, t] of entries) {
		if (!ADDRESS.test(address)) return `${address} is not a lower-case address`
		if (!t || typeof t !== 'object' || !sameKeys(t, ['issuer_token', 'ticker', 'reasons', 'multiplier_updates', 'checked_block'])) return `${address} does not have exactly the five keys of a row`
		if (typeof t.issuer_token !== 'boolean' || typeof t.ticker !== 'string') return `${address}: issuer_token or ticker has the wrong type`
		if (!Number.isInteger(t.multiplier_updates) || (t.multiplier_updates as number) < 0) return `${address}: multiplier_updates is not a count`
		if (!Number.isInteger(t.checked_block) || (t.checked_block as number) <= 0) return `${address}: checked_block is not a block number`
		if (!Array.isArray(t.reasons) || t.reasons.length === 0) return `${address}: no reasons`
		for (const r of t.reasons) if (!(BATCH_REASONS as string[]).includes(r as string)) return `${address}: ${String(r)} is not a reason code of this check`
	}
	return null
}
