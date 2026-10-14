// The token check. Pure functions, no network and no CRE imports, so the same
// code runs inside the CRE workflow (WASM) and in `bun test`.
//
// Question it answers: in one transaction on Robinhood Chain (4663), which
// ERC-20 tokens moved in or out of a wallet, and is each of them the issuer's
// Robinhood Stock Token, USDG, an ordinary token, or a token that uses a listed
// ticker or name at an address the issuer did not list?
//
// What "the issuer's Stock Token" means here (measured by vet402, see
// packages/rwa/identity.ts in github.com/kzmttkc/vet402):
//   1. the address is in Robinhood's own asset list (registry-snapshot.json),
//   2. keccak256(eth_getCode) is the one Stock Token beacon-proxy code,
//   3. the EIP-1967 beacon slot holds the one Stock Token beacon,
//   4. the Stock Token factory emitted a TokenDeployed log that names the address,
//   5. symbol() answers the ticker the list gives for that address.
// A code hash alone proves nothing, because anyone can deploy the same proxy
// bytecode pointing at the same beacon. The list and the factory log are the roots.
import { keccak256 } from 'viem'
import { fromUtf8 } from '../rwa-verify/verify'
import snapshot from './registry-snapshot.json'

export const ROBINHOOD_CHAIN_ID = 4663
/** keccak256(eth_getCode) of every listed Stock Token. */
export const STOCK_TOKEN_CODE_HASH = '0x6c1fdd40002dcb440c7fff6a84171404d279ccb057803b65826f7546acd65630'
/** The beacon every Stock Token proxy delegates through. */
export const STOCK_TOKEN_BEACON = '0xe10b6f6b275de231345c20d14ab812db62151b00'
/** bytes32(uint256(keccak256("eip1967.proxy.beacon")) - 1) */
export const EIP1967_BEACON_SLOT = '0xa3f0ad74e5423aebfd80d3ef4346578335a9a72aeaee59ff6cb3582b35133d50'
/** The Stock Token factory. */
export const STOCK_TOKEN_FACTORY = '0x4783c67b63de2b358ac5951a7d41f47a38f3c046'
/** topic0 of the factory's deployment log. Data: (address token, string name, string symbol). */
export const TOKEN_DEPLOYED_TOPIC = '0xd9b0c6a1c0de228715ad0fa09f3259686ee84f8cc675e03ef7e47a9cdafa76d6'
/** keccak256("Transfer(address,address,uint256)") */
export const TRANSFER_TOPIC = '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef'
/** keccak256("UIMultiplierUpdated(uint256,uint256,uint256)"): multiplier before, multiplier after, unix time it takes effect. */
export const UI_MULTIPLIER_UPDATED_TOPIC = '0x2205df4534432b2f60654a3fdb48737ffdaf3e9edb1a498bd985bc026b15b055'
export const SELECTOR = {
	symbol: '0x95d89b41',
	name: '0x06fdde03',
	/** uiMultiplier(): shares shown to a person are raw balance x uiMultiplier / 1e18 */
	uiMultiplier: '0xa60bf13d',
} as const
/** A Stock Token starts with this multiplier. A split or a reinvested dividend changes it. */
export const MULTIPLIER_ONE = '1000000000000000000'

export type ListedToken = { token: string; symbol: string; name: string; feed: string | null; deployed_block: number | null }
export const SNAPSHOT = snapshot as {
	list_taken_at: string
	source: string
	source_file_keccak256: string
	count: number
	usdg: { token: string; symbol: string; name: string }
	tokens: ListedToken[]
}
export const USDG = SNAPSHOT.usdg.token.toLowerCase()
const BY_ADDRESS = new Map(SNAPSHOT.tokens.map((t) => [t.token.toLowerCase(), t]))

export function listedToken(address: string): ListedToken | null {
	return BY_ADDRESS.get(address.toLowerCase()) ?? null
}

// ---------------------------------------------------------------- reasons

/** One bit per reason. `reasonBits` in the result is the OR of these. */
export const Reason = {
	WRONG_CHAIN: 1,
	TX_NOT_FOUND: 2,
	NO_WALLET_TRANSFER: 4,
	TOO_MANY_TRANSFERS: 8,
	NOT_IN_LIST: 16,
	CODE_HASH_DIFFERS: 32,
	BEACON_DIFFERS: 64,
	FACTORY_LOG_MISSING: 128,
	LISTED_SYMBOL_DIFFERS: 256,
	NO_CONTRACT_CODE: 512,
	SYMBOL_COPIES_LISTED: 1024,
	SYMBOL_DISGUISES_LISTED: 2048,
	NAME_COPIES_LISTED: 4096,
	NAME_CLAIMS_ROBINHOOD_TOKEN: 8192,
	IMITATES_USDG: 16384,
	HIDDEN_CHARACTERS: 32768,
	CONFUSABLE_CHARACTERS: 65536,
	STOCK_TOKEN_CODE_UNLISTED: 131072,
	MULTIPLIER_CHANGED: 262144,
	MULTIPLIER_CHANGED_AFTER_TX: 524288,
	MULTIPLIER_UNREADABLE: 1048576,
} as const
export type ReasonName = keyof typeof Reason

/** `blocks`: allow is false. `explains`: says why a token got its verdict. `notice`: allow is unchanged. */
export type ReasonKind = 'blocks' | 'explains' | 'notice'

export const REASON_INFO: Record<ReasonName, { kind: ReasonKind; text: string }> = {
	WRONG_CHAIN: { kind: 'blocks', text: 'the RPC is not Robinhood Chain (4663)' },
	TX_NOT_FOUND: { kind: 'blocks', text: 'the transaction is not in a block' },
	NO_WALLET_TRANSFER: { kind: 'blocks', text: 'no ERC-20 Transfer to or from the wallet in that transaction and block, so nothing was checked' },
	TOO_MANY_TRANSFERS: { kind: 'blocks', text: 'the transaction has more transfers or tokens of the wallet than one run reads, so some were not checked' },
	NOT_IN_LIST: { kind: 'explains', text: "the address is not in Robinhood's asset list (snapshot)" },
	CODE_HASH_DIFFERS: { kind: 'explains', text: 'the runtime code is not the Stock Token proxy code' },
	BEACON_DIFFERS: { kind: 'explains', text: 'the EIP-1967 beacon slot does not hold the Stock Token beacon' },
	FACTORY_LOG_MISSING: { kind: 'explains', text: 'no TokenDeployed log of the Stock Token factory names the address' },
	LISTED_SYMBOL_DIFFERS: { kind: 'explains', text: 'symbol() does not answer the ticker the list gives for the address' },
	NO_CONTRACT_CODE: { kind: 'explains', text: 'the address has no contract code now' },
	SYMBOL_COPIES_LISTED: { kind: 'explains', text: 'symbol() is a listed ticker, at another address' },
	SYMBOL_DISGUISES_LISTED: { kind: 'explains', text: 'symbol() becomes a listed ticker once hidden or look-alike characters are removed' },
	NAME_COPIES_LISTED: { kind: 'explains', text: 'name() is a listed company name, at another address' },
	NAME_CLAIMS_ROBINHOOD_TOKEN: { kind: 'explains', text: 'name() ends like a Robinhood Stock Token ("Robinhood Token", "Robinhood Coin")' },
	IMITATES_USDG: { kind: 'explains', text: 'symbol() or name() reads as USDG or Global Dollar, at another address' },
	HIDDEN_CHARACTERS: { kind: 'explains', text: 'symbol() or name() carries invisible characters' },
	CONFUSABLE_CHARACTERS: { kind: 'explains', text: 'symbol() or name() uses a digit or a non-Latin letter that looks like a Latin one' },
	STOCK_TOKEN_CODE_UNLISTED: { kind: 'explains', text: 'the Stock Token proxy code and beacon at an address outside the list (the list may be older than the token)' },
	MULTIPLIER_CHANGED: { kind: 'notice', text: 'uiMultiplier is not 1, the token has had a corporate action' },
	MULTIPLIER_CHANGED_AFTER_TX: { kind: 'notice', text: 'uiMultiplier changed after this transaction, the same raw amount shows a different number of shares now' },
	MULTIPLIER_UNREADABLE: { kind: 'notice', text: 'uiMultiplier() did not answer' },
}

const REASON_NAMES = (Object.keys(Reason) as ReasonName[]).sort((a, b) => Reason[a] - Reason[b])
const BLOCKING = REASON_NAMES.filter((n) => REASON_INFO[n].kind === 'blocks').reduce((acc, n) => acc | Reason[n], 0)

export function reasonNames(bits: number): ReasonName[] {
	return REASON_NAMES.filter((n) => (bits & Reason[n]) !== 0)
}

// ---------------------------------------------------------------- text

// Explicit code point tables instead of \p{...} and String.normalize, so every
// runtime (bun, the CRE WASM engine, any node of a DON) folds text the same way.

/** Code points that render as nothing: Unicode default-ignorables, format controls, the braille blank. */
const HIDDEN: [number, number][] = [
	[0x00ad, 0x00ad],
	[0x034f, 0x034f],
	[0x0600, 0x0605],
	[0x061c, 0x061c],
	[0x06dd, 0x06dd],
	[0x070f, 0x070f],
	[0x0890, 0x0891],
	[0x08e2, 0x08e2],
	[0x115f, 0x1160],
	[0x17b4, 0x17b5],
	[0x180b, 0x180f],
	[0x200b, 0x200f],
	[0x202a, 0x202e],
	[0x2060, 0x206f],
	[0x2800, 0x2800],
	[0x3164, 0x3164],
	[0xfe00, 0xfe0f],
	[0xfeff, 0xfeff],
	[0xffa0, 0xffa0],
	[0xfff0, 0xfffb],
	[0x110bd, 0x110bd],
	[0x110cd, 0x110cd],
	[0x13430, 0x1343f],
	[0x1bca0, 0x1bca3],
	[0x1d173, 0x1d17a],
	[0xe0000, 0xe0fff],
]
/** Combining marks (a ticker has none). */
const MARKS: [number, number][] = [
	[0x0300, 0x036f],
	[0x0483, 0x0489],
	[0x1ab0, 0x1aff],
	[0x1dc0, 0x1dff],
	[0x20d0, 0x20ff],
	[0xfe20, 0xfe2f],
]
const SPACES: [number, number][] = [
	[0x0009, 0x000d],
	[0x0020, 0x0020],
	[0x00a0, 0x00a0],
	[0x1680, 0x1680],
	[0x2000, 0x200a],
	[0x2028, 0x2029],
	[0x202f, 0x202f],
	[0x205f, 0x205f],
	[0x3000, 0x3000],
]
const within = (table: [number, number][], cp: number) => table.some(([a, b]) => cp >= a && cp <= b)

/** Full-width and mathematical letters and digits to their ASCII form. Other code points unchanged. */
function foldStyled(cp: number): number {
	if (cp >= 0xff01 && cp <= 0xff5e) return cp - 0xfee0
	if (cp >= 0x1d400 && cp <= 0x1d6a3) {
		const i = (cp - 0x1d400) % 52
		return i < 26 ? 0x41 + i : 0x61 + (i - 26)
	}
	if (cp >= 0x1d7ce && cp <= 0x1d7ff) return 0x30 + ((cp - 0x1d7ce) % 10)
	return cp
}

/** Letters that pass for Latin capitals in a ticker: digit zero, Cyrillic and Greek homoglyphs. */
const CONFUSABLE: Record<string, string> = {
	'0': 'O',
	'\u0410': 'A', '\u0412': 'B', '\u0421': 'C', '\u0415': 'E', '\u041d': 'H', '\u0406': 'I', '\u0408': 'J', '\u041a': 'K',
	'\u041c': 'M', '\u041e': 'O', '\u0420': 'P', '\u0405': 'S', '\u0422': 'T', '\u0425': 'X', '\u0423': 'Y',
	'\u0430': 'A', '\u0441': 'C', '\u0435': 'E', '\u0456': 'I', '\u0458': 'J', '\u043e': 'O', '\u0440': 'P', '\u0455': 'S',
	'\u0445': 'X', '\u0443': 'Y',
	'\u0391': 'A', '\u0392': 'B', '\u0395': 'E', '\u0396': 'Z', '\u0397': 'H', '\u0399': 'I', '\u039a': 'K', '\u039c': 'M',
	'\u039d': 'N', '\u039f': 'O', '\u03a1': 'P', '\u03a4': 'T', '\u03a5': 'Y', '\u03a7': 'X', '\u03bf': 'O', '\u03bd': 'V',
}

function codePoints(s: string): number[] {
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
		out.push(c)
	}
	return out
}

function fromCodePoint(cp: number): string {
	if (cp <= 0xffff) return String.fromCharCode(cp)
	const v = cp - 0x10000
	return String.fromCharCode(0xd800 + (v >> 10), 0xdc00 + (v & 1023))
}

/** What a reader's eye sees: hidden characters and marks removed, styled letters plain, every space an ASCII space. */
export function stripHidden(s: string): string {
	let out = ''
	for (const cp of codePoints(s)) {
		if (within(HIDDEN, cp) || within(MARKS, cp)) continue
		out += within(SPACES, cp) ? ' ' : fromCodePoint(foldStyled(cp))
	}
	return out
}

export function hasHidden(s: string): boolean {
	return codePoints(s).some((cp) => within(HIDDEN, cp) || within(MARKS, cp))
}

function foldConfusable(s: string, zeroToO: boolean): string {
	let out = ''
	for (const ch of s.split('')) out += ch === '0' && !zeroToO ? ch : (CONFUSABLE[ch] ?? ch)
	return out
}

/** True when the text uses a styled letter or a Cyrillic or Greek letter that passes for a Latin one. */
function hasConfusableLetter(s: string): boolean {
	return codePoints(s).some((cp) => foldStyled(cp) !== cp || (cp > 0x7f && CONFUSABLE[fromCodePoint(cp)] !== undefined))
}

/** The comparison key for a ticker: hidden characters out, look-alikes folded to Latin, no spaces, upper case. */
export function tickerKey(s: string): string {
	return foldConfusable(stripHidden(s), true).replace(/ /g, '').toUpperCase()
}

const ROBINHOOD_ENDING = /[ \u2022\u00b7|:\-\u2013\u2014]*\brobinhood *(?:stock *)?(?:token|coin|share|shares|stock)s? *$/i
const TRAILING_SEPARATORS = /[ \u2022\u00b7|:\-\u2013\u2014]+$/

/** The comparison key for a name: hidden characters out, look-alikes folded, the Robinhood ending dropped, lower case. */
export function nameKey(s: string): string {
	return foldConfusable(stripHidden(s), false)
		.replace(ROBINHOOD_ENDING, '')
		.replace(TRAILING_SEPARATORS, '')
		.replace(/ +/g, ' ')
		.trim()
		.toLowerCase()
}

export function claimsRobinhoodToken(name: string): boolean {
	return ROBINHOOD_ENDING.test(foldConfusable(stripHidden(name), false))
}

/** The raw string with everything outside printable ASCII shown as [U+XXXX] (the bullet of "• Robinhood Token" excepted). */
export function showText(s: string): string {
	let out = ''
	for (const cp of codePoints(s)) {
		if ((cp >= 0x20 && cp <= 0x7e) || cp === 0x2022) out += fromCodePoint(cp)
		else out += `[U+${cp.toString(16).toUpperCase().padStart(4, '0')}]`
	}
	return out
}

const BY_TICKER = new Map(SNAPSHOT.tokens.map((t) => [tickerKey(t.symbol), t]))
const BY_SYMBOL = new Map(SNAPSHOT.tokens.map((t) => [t.symbol, t]))
const BY_NAME = new Map(SNAPSHOT.tokens.map((t) => [nameKey(t.name), t]))

// ---------------------------------------------------------------- decoding RPC answers

const HEX = /^0x[0-9a-fA-F]*$/

function hexBytes(hex: string): Uint8Array {
	const h = hex.slice(2)
	const out = new Uint8Array(h.length >> 1)
	for (let i = 0; i < out.length; i++) out[i] = Number.parseInt(h.slice(2 * i, 2 * i + 2), 16)
	return out
}

/**
 * The string an eth_call to symbol() or name() returned: an ABI `string`, or a
 * bytes32 as some older tokens answer. Null when the call gave nothing readable.
 * At most `max` characters are kept.
 */
export function decodeAbiText(result: string | null | undefined, max = 96): string | null {
	if (!result || !HEX.test(result) || result.length < 66) return null
	const bytes = hexBytes(result)
	let text: string | null = null
	if (bytes.length >= 64) {
		const offset = Number(BigInt(`0x${result.slice(2, 66)}`))
		if (offset + 32 <= bytes.length) {
			const length = Number(BigInt(`0x${result.slice(2 + 2 * offset, 2 + 2 * offset + 64)}`))
			if (offset + 32 + length <= bytes.length) text = fromUtf8(bytes.slice(offset + 32, offset + 32 + length))
		}
	}
	if (text === null && bytes.length === 32) {
		let end = 32
		while (end > 0 && bytes[end - 1] === 0) end--
		text = fromUtf8(bytes.slice(0, end))
	}
	if (text === null) return null
	return codePoints(text).slice(0, max).map(fromCodePoint).join('')
}

/** The first 32-byte word of an eth_call answer as a decimal string, or null. */
export function decodeUint(result: string | null | undefined): string | null {
	if (!result || !HEX.test(result) || result.length < 66) return null
	return BigInt(`0x${result.slice(2, 66)}`).toString()
}

/** keccak256 of eth_getCode, or null when the address has no code. */
export function codeHashOf(code: string | null | undefined): string | null {
	if (!code || code === '0x' || !HEX.test(code)) return null
	return keccak256(code as `0x${string}`)
}

/** The address in the low 20 bytes of a storage word. */
export function addressInWord(word: string | null | undefined): string {
	if (!word || !HEX.test(word)) return ''
	return `0x${word.slice(2).padStart(64, '0').slice(24)}`.toLowerCase()
}

/** `n / 1e18` as a decimal string with trailing zeros cut ("1.000700791241405425", "2", "0.5"). */
export function decimal18(n: string): string {
	const v = BigInt(n)
	const whole = v / 10n ** 18n
	const frac = (v % 10n ** 18n).toString().padStart(18, '0').replace(/0+$/, '')
	return frac ? `${whole}.${frac}` : whole.toString()
}

// ---------------------------------------------------------------- logs

export type Log = { address: string; topics: string[]; data: string; blockNumber: string; transactionHash: string; logIndex: string }

export type WalletTransfer = { token: string; from: string; to: string; amountRaw: string; direction: 'in' | 'out'; logIndex: number }

/** The ERC-20 Transfers of `tx` that name `wallet` as sender or receiver, in log order, each log once. */
export function walletTransfers(wallet: string, tx: string, logs: Log[]): WalletTransfer[] {
	const w = wallet.toLowerCase()
	const seen = new Set<number>()
	const out: WalletTransfer[] = []
	for (const l of logs) {
		if (!l || !l.topics || l.topics.length !== 3 || l.topics[0].toLowerCase() !== TRANSFER_TOPIC) continue
		if (l.transactionHash.toLowerCase() !== tx.toLowerCase()) continue
		const from = `0x${l.topics[1].slice(-40)}`.toLowerCase()
		const to = `0x${l.topics[2].slice(-40)}`.toLowerCase()
		if (from !== w && to !== w) continue
		const logIndex = Number(BigInt(l.logIndex))
		if (seen.has(logIndex)) continue
		seen.add(logIndex)
		out.push({
			token: l.address.toLowerCase(),
			from,
			to,
			amountRaw: l.data && l.data.length >= 66 ? BigInt(l.data.slice(0, 66)).toString() : '0',
			direction: to === w ? 'in' : 'out',
			logIndex,
		})
	}
	return out.sort((a, b) => a.logIndex - b.logIndex)
}

/** Token addresses of the transfers, in order of first appearance. */
export function tokensOf(transfers: WalletTransfer[]): string[] {
	return [...new Set(transfers.map((t) => t.token))]
}

export type MultiplierUpdate = {
	block: number
	logIndex: number
	tx: string
	/** uiMultiplier before and after, 18 decimals, as integer strings */
	before: string
	after: string
	/** unix seconds from which the token applies the new multiplier */
	effectiveAt: number
}

/** Decode the UIMultiplierUpdated logs of `token`. Any other log is skipped. */
export function multiplierUpdates(token: string, logs: Log[]): MultiplierUpdate[] {
	const out: MultiplierUpdate[] = []
	for (const l of logs) {
		if (!l || l.address.toLowerCase() !== token.toLowerCase()) continue
		if (!l.topics || l.topics.length !== 1 || l.topics[0].toLowerCase() !== UI_MULTIPLIER_UPDATED_TOPIC) continue
		const data = l.data.slice(2)
		if (data.length !== 64 * 3) continue
		const word = (i: number) => BigInt(`0x${data.slice(64 * i, 64 * (i + 1))}`)
		out.push({
			block: Number(BigInt(l.blockNumber)),
			logIndex: Number(BigInt(l.logIndex)),
			tx: l.transactionHash.toLowerCase(),
			before: word(0).toString(),
			after: word(1).toString(),
			effectiveAt: Number(word(2)),
		})
	}
	return out.sort((a, b) => a.block - b.block || a.logIndex - b.logIndex)
}

/** True when one of `logs` is the factory's TokenDeployed log and its first data word is `token`. */
export function factoryNames(token: string, logs: Log[]): boolean {
	return logs.some(
		(l) =>
			l &&
			l.address.toLowerCase() === STOCK_TOKEN_FACTORY &&
			l.topics?.[0]?.toLowerCase() === TOKEN_DEPLOYED_TOPIC &&
			l.data.length >= 66 &&
			addressInWord(l.data.slice(0, 66)) === token.toLowerCase(),
	)
}

// ---------------------------------------------------------------- the check

/** What was read from the chain about one token. Everything is the `latest` state, except the logs. */
export type TokenState = {
	token: string
	/** keccak256(eth_getCode), null when the address has no code */
	codeHash: string | null
	/** the raw word in the EIP-1967 beacon slot */
	beaconSlot: string
	/** symbol() and name(), null when the call reverted or returned nothing readable */
	symbol: string | null
	name: string | null
	/** uiMultiplier() as an integer string (18 decimals), null when the call reverted */
	multiplier: string | null
	/** did the factory emit a TokenDeployed log naming this token. Null when it was not read */
	factoryLog: boolean | null
	/** UIMultiplierUpdated logs from the block of the tx on. Null when they were not read */
	multiplierUpdates: MultiplierUpdate[] | null
	/** false when the log window stopped before the head of the chain */
	multiplierLogsComplete: boolean
}

export type CheckInput = {
	chainId: number
	tx: string
	wallet: string
	/** is the tx in a block */
	txFound: boolean
	block: number
	/** Transfer logs of that block that name the wallet (other txs of the block are filtered out here) */
	logs: Log[]
	tokens: TokenState[]
	/** transfer logs and tokens of the wallet in the tx that were left out because one run has a cap */
	skipped: number
}

export type Verdict = 'GENUINE_STOCK_TOKEN' | 'USDG' | 'NOT_A_STOCK_TOKEN' | 'LOOKALIKE' | 'UNVERIFIED'

export type TokenResult = {
	token: string
	verdict: Verdict
	reasons: ReasonName[]
	reasonBits: number
	/** symbol() and name() as the token answers them, with every non-ASCII character shown as [U+XXXX] */
	symbol: string | null
	name: string | null
	/** the listed ticker (or "USDG") the token is, or reads as */
	ticker: string | null
	direction: 'in' | 'out' | 'both'
	amountInRaw: string
	amountOutRaw: string
	/** uiMultiplier now, as a decimal ("1.000700791241405425"). Null unless the token is a genuine Stock Token */
	multiplier: string | null
	/** has the token ever had its multiplier changed. Null unless the token is a genuine Stock Token */
	multiplierChanged: boolean | null
	/** did it change after this tx. Null when unknown */
	multiplierChangedAfterTx: boolean | null
	multiplierUpdates: { block: number; tx: string; before: string; after: string; effectiveAt: number; afterTx: boolean }[]
}

export type Result = {
	tx: string
	wallet: string
	chainId: number
	block: number
	allow: boolean
	reasonBits: number
	reasons: ReasonName[]
	tokens: TokenResult[]
	list: { takenAt: string; source: string; sourceFileKeccak256: string; count: number }
}

const ALLOWED: Verdict[] = ['GENUINE_STOCK_TOKEN', 'USDG', 'NOT_A_STOCK_TOKEN']

function judge(state: TokenState): { verdict: Verdict; bits: number; ticker: string | null } {
	const token = state.token.toLowerCase()
	const codeOk = state.codeHash !== null && state.codeHash.toLowerCase() === STOCK_TOKEN_CODE_HASH
	const beaconOk = addressInWord(state.beaconSlot) === STOCK_TOKEN_BEACON
	const identity = (state.codeHash === null ? Reason.NO_CONTRACT_CODE : codeOk ? 0 : Reason.CODE_HASH_DIFFERS) | (beaconOk ? 0 : Reason.BEACON_DIFFERS)

	// 1. An address in the list: genuine only when the chain agrees with every pinned value.
	const listed = listedToken(token)
	if (listed) {
		let bits = identity
		if (state.factoryLog !== true) bits |= Reason.FACTORY_LOG_MISSING
		if (state.symbol !== listed.symbol) bits |= Reason.LISTED_SYMBOL_DIFFERS
		return { verdict: bits === 0 ? 'GENUINE_STOCK_TOKEN' : 'UNVERIFIED', bits, ticker: listed.symbol }
	}

	// 2. USDG is matched by address.
	if (token === USDG) {
		return state.codeHash === null ? { verdict: 'UNVERIFIED', bits: Reason.NO_CONTRACT_CODE, ticker: 'USDG' } : { verdict: 'USDG', bits: 0, ticker: 'USDG' }
	}

	// 3. Any other address. Does it use a listed ticker or name, or USDG's?
	const symbol = state.symbol ?? ''
	const name = state.name ?? ''
	let bits = Reason.NOT_IN_LIST
	let ticker: string | null = null
	const exact = symbol ? BY_SYMBOL.get(symbol) : undefined
	const folded = symbol ? BY_TICKER.get(tickerKey(symbol)) : undefined
	if (exact) {
		bits |= Reason.SYMBOL_COPIES_LISTED
		ticker = exact.symbol
	} else if (folded) {
		bits |= Reason.SYMBOL_DISGUISES_LISTED
		ticker = folded.symbol
	}
	const byName = name ? BY_NAME.get(nameKey(name)) : undefined
	if (byName) {
		bits |= Reason.NAME_COPIES_LISTED
		ticker ??= byName.symbol
	}
	const usdg = tickerKey(symbol) === 'USDG' || nameKey(name) === 'global dollar'
	if (usdg) {
		bits |= Reason.IMITATES_USDG
		ticker ??= 'USDG'
	}
	const copies = bits !== Reason.NOT_IN_LIST
	const ending = name !== '' && claimsRobinhoodToken(name)
	if (ending) bits |= Reason.NAME_CLAIMS_ROBINHOOD_TOKEN
	if (copies || ending) {
		if (hasHidden(symbol) || hasHidden(name)) bits |= Reason.HIDDEN_CHARACTERS
		const zeroForO = !exact && Boolean(folded) && symbol.includes('0') && !folded!.symbol.includes('0')
		if (zeroForO || hasConfusableLetter(symbol) || hasConfusableLetter(name)) bits |= Reason.CONFUSABLE_CHARACTERS
	}

	if (codeOk && beaconOk) {
		// The issuer's proxy code and beacon at an address outside the list. With a listed ticker, a
		// listed name or USDG's it is a look-alike: the listed token lives at another address. With
		// neither it may be a token listed after the snapshot, so it is left unverified, never allowed.
		bits |= Reason.STOCK_TOKEN_CODE_UNLISTED
		return { verdict: copies ? 'LOOKALIKE' : 'UNVERIFIED', bits, ticker }
	}
	bits |= identity
	if (copies || ending) return { verdict: 'LOOKALIKE', bits, ticker }
	return { verdict: 'NOT_A_STOCK_TOKEN', bits, ticker: null }
}

export function check(input: CheckInput): Result {
	const tx = input.tx.toLowerCase()
	const wallet = input.wallet.toLowerCase()
	const base = {
		tx,
		wallet,
		chainId: input.chainId,
		block: input.block,
		list: {
			takenAt: SNAPSHOT.list_taken_at,
			source: SNAPSHOT.source,
			sourceFileKeccak256: SNAPSHOT.source_file_keccak256,
			count: SNAPSHOT.count,
		},
	}
	const refuse = (bits: number): Result => ({ ...base, allow: false, reasonBits: bits, reasons: reasonNames(bits), tokens: [] })
	if (input.chainId !== ROBINHOOD_CHAIN_ID) return refuse(Reason.WRONG_CHAIN)
	if (!input.txFound) return refuse(Reason.TX_NOT_FOUND)

	const transfers = walletTransfers(wallet, tx, input.logs)
	if (transfers.length === 0) return refuse(Reason.NO_WALLET_TRANSFER)
	const lastLogIndex = transfers[transfers.length - 1].logIndex
	const states = new Map(input.tokens.map((s) => [s.token.toLowerCase(), s]))

	let all = input.skipped > 0 ? Reason.TOO_MANY_TRANSFERS : 0
	const tokens: TokenResult[] = []
	for (const token of tokensOf(transfers)) {
		const state = states.get(token)
		if (!state) {
			all |= Reason.TOO_MANY_TRANSFERS
			continue
		}
		const j = judge(state)
		let bits = j.bits
		const mine = transfers.filter((t) => t.token === token)
		const sum = (d: 'in' | 'out') => mine.filter((t) => t.direction === d).reduce((acc, t) => acc + BigInt(t.amountRaw), 0n)
		const hasIn = mine.some((t) => t.direction === 'in')
		const hasOut = mine.some((t) => t.direction === 'out')

		let multiplier: string | null = null
		let changed: boolean | null = null
		let changedAfterTx: boolean | null = null
		let updates: TokenResult['multiplierUpdates'] = []
		if (j.verdict === 'GENUINE_STOCK_TOKEN') {
			const logs = state.multiplierUpdates ?? []
			updates = logs.map((u) => ({
				block: u.block,
				tx: u.tx,
				before: decimal18(u.before),
				after: decimal18(u.after),
				effectiveAt: u.effectiveAt,
				afterTx: u.block > input.block || (u.block === input.block && u.logIndex > lastLogIndex),
			}))
			if (state.multiplier === null) {
				bits |= Reason.MULTIPLIER_UNREADABLE
			} else {
				multiplier = decimal18(state.multiplier)
				changed = state.multiplier !== MULTIPLIER_ONE || logs.length > 0
			}
			if (updates.some((u) => u.afterTx)) changedAfterTx = true
			else if (state.multiplier === MULTIPLIER_ONE) changedAfterTx = false
			else if (state.multiplierUpdates !== null && state.multiplierLogsComplete) changedAfterTx = false
			if (changed) bits |= Reason.MULTIPLIER_CHANGED
			if (changedAfterTx) bits |= Reason.MULTIPLIER_CHANGED_AFTER_TX
		}

		all |= bits
		tokens.push({
			token,
			verdict: j.verdict,
			reasons: reasonNames(bits),
			reasonBits: bits,
			symbol: state.symbol === null ? null : showText(state.symbol),
			name: state.name === null ? null : showText(state.name),
			ticker: j.ticker,
			direction: hasIn && hasOut ? 'both' : hasIn ? 'in' : 'out',
			amountInRaw: sum('in').toString(),
			amountOutRaw: sum('out').toString(),
			multiplier,
			multiplierChanged: changed,
			multiplierChangedAfterTx: changedAfterTx,
			multiplierUpdates: updates,
		})
	}

	const allow = (all & BLOCKING) === 0 && tokens.length > 0 && tokens.every((t) => ALLOWED.includes(t.verdict))
	return { ...base, allow, reasonBits: all, reasons: reasonNames(all), tokens }
}

/** The lines the workflow logs before it reads the chain. */
export function renderHeader(tx: string, wallet: string): string[] {
	return [
		`token check (Robinhood Chain ${ROBINHOOD_CHAIN_ID}, read over JSON-RPC, no vet402 API)`,
		`tx      ${tx}`,
		`wallet  ${wallet}`,
		`list    ${SNAPSHOT.count} Stock Tokens, taken ${SNAPSHOT.list_taken_at}, ${SNAPSHOT.source}`,
	]
}

/** The lines the workflow logs once it has decided. Each stays far under the 1 kb log line limit. */
export function render(r: Result): string[] {
	const lines = [`block   ${r.block}`]
	for (const t of r.tokens) {
		lines.push(`${t.verdict}  ${t.token}  symbol ${JSON.stringify(t.symbol)}  name ${JSON.stringify(t.name)}  ${t.direction}`)
		for (const n of t.reasons) lines.push(`- ${REASON_INFO[n].kind} ${n}: ${REASON_INFO[n].text}`)
		if (t.multiplier !== null) lines.push(`- uiMultiplier ${t.multiplier}`)
		for (const u of t.multiplierUpdates) {
			lines.push(`- UIMultiplierUpdated in block ${u.block}: ${u.before} to ${u.after}, in effect from unix ${u.effectiveAt}${u.afterTx ? ' (after this tx)' : ''}`)
		}
	}
	for (const n of r.reasons.filter((x) => REASON_INFO[x].kind === 'blocks')) lines.push(`- blocks ${n}: ${REASON_INFO[n].text}`)
	lines.push(`RESULT: ${r.allow ? 'ALLOW' : 'DO NOT ALLOW'}  reasonBits ${r.reasonBits}`)
	return lines
}
