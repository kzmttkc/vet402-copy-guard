// What the walk and the live agent share about tokens: the issuer's list, the CRE
// token-check results file, the record of a wallet that has none, and the Uniswap v4
// pool a token was bought in. No network.
import { existsSync, readFileSync } from 'node:fs'
import { keccak256, toHex } from 'viem'
import snapshot from '../token-check/registry-snapshot.json'
import type { PoolEntry } from './ledger'
import type { RecordInputs } from './rules'
import type { IssuerList, TokenCheckRef } from './rules-v2'

const lc = (s: string) => s.toLowerCase()

/** keccak256("Swap(bytes32,address,int128,int128,uint160,uint128,int24,uint24)"), the Uniswap v4 PoolManager's swap log. */
export const V4_SWAP_TOPIC = keccak256(toHex('Swap(bytes32,address,int128,int128,uint160,uint128,int24,uint24)'))

/** The issuer's list as the rules read it: every Stock Token in Robinhood's asset list. */
export const ISSUER_LIST: IssuerList = Object.fromEntries((snapshot as any).tokens.map((t: any) => [String(t.token).toLowerCase(), { symbol: t.symbol, name: t.name, feed: t.feed ? String(t.feed).toLowerCase() : null }]))

/** The record of a wallet vet402 has no record for: every field empty, so the evidence rules fail and say so. */
export const NO_RECORD: RecordInputs = { source_url: '', x_facts_hash: '', recomputed_facts_hash: '', address: '', chain_id: 0, as_of: '', as_of_block: 0, method_version: '', r1_status: 'unverified', realized_usd: null, tokens: [], lookalikes: [] }

const int = (word: string) => BigInt.asIntN(256, BigInt(`0x${word}`))

/** The v4 pool a token was bought in, and the pool's price in that swap: the Swap log of the PoolManager whose amount is exactly what the wallet received. Null when no swap matches. */
export function poolEntryOf(swaps: { topics: string[]; data: string; logIndex: string }[], amountRaw: string): PoolEntry | null {
	for (const l of swaps) {
		const d = l.data.slice(2)
		if (d.length < 64 * 3) continue
		const a0 = int(d.slice(0, 64))
		const a1 = int(d.slice(64, 128))
		const abs = (x: bigint) => (x < 0n ? -x : x)
		const want = BigInt(amountRaw)
		if (abs(a0) !== want && abs(a1) !== want) continue
		return { pool_id: lc(l.topics[1]), token_is_currency0: abs(a0) === want, sqrt_price_x96: BigInt(`0x${d.slice(128, 192)}`).toString(), log_index: Number(BigInt(l.logIndex)) }
	}
	return null
}

/** The CRE token-check results, when the file exists: what the workflow said about each token, and the keccak256 of the file. */
export function loadTokenCheck(file: string, source: string): TokenCheckRef | null {
	if (!existsSync(file)) return null
	const bytes = readFileSync(file)
	const doc = JSON.parse(bytes.toString('utf8'))
	const tokens: TokenCheckRef['tokens'] = {}
	for (const [k, v] of Object.entries(doc.tokens ?? {}) as [string, any][]) tokens[lc(k)] = { issuer_token: v.issuer_token === true, ticker: v.ticker ?? null, reasons: [...(v.reasons ?? [])] }
	return { source, keccak: keccak256(bytes), tokens }
}

/** keccak256("Swap(address,address,int256,int256,uint160,uint128,int24)"), a Uniswap v3 pool's swap log. */
export const V3_SWAP_TOPIC = '0xc42079f94a6350d7e6235f29174924f928cc2ac818eb64fed8004e115fbcca67'
/** Every log that says a liquidity position was touched. */
export const LIQUIDITY_LOGS: Record<string, string> = {
	'0x7a53080ba414158be7ec69b987b5fb7d07dee101fe85488f0853ae16239d0bde': 'Mint',
	'0x0c396cd989a39f4459b5fa1aed6a9a8dcdbc45908acfd67e028cd568da98982c': 'Burn',
	'0x70935338e69775456a85ddef226c395fb668b63fa0115f5f20610b388e6ca9c0': 'Collect',
	'0x3067048beee31b25b2f1681f88dac838c8bba36af25bfb2b7cf7473a5847e35f': 'IncreaseLiquidity',
	'0x26f6a048ee9138f2c0ce266f322cb99228e8d619ae2bff30c67f8dcf9d2377b4': 'DecreaseLiquidity',
	'0x40d0efd1a53d60ecbf40971b9daf7dc90178c3aadc7aab1765632738fa8b8f01': 'Collect',
	'0xf208f4912782fd25c7f114ca3723a2d5dd6f3bcc3ac8db5af63baa85f711d5ec': 'ModifyLiquidity',
}
const TRANSFER = '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef'

/**
 * What a whole receipt says about one wallet's move, kept so the move can be judged without the
 * receipt: the liquidity logs in it, the addresses that emitted a swap log, and for each token the
 * wallet received, which of those swapping addresses sent that token in the transaction.
 */
export function receiptFacts(logs: { address: string; topics: string[] }[], wallet: string): { liquidity: string[]; swap_emitters: string[]; token_senders: Record<string, string[]> } {
	const w = lc(wallet)
	const t0 = (l: { topics: string[] }) => lc(l.topics?.[0] ?? '')
	const liquidity = [...new Set(logs.map((l) => LIQUIDITY_LOGS[t0(l)]).filter(Boolean))].sort()
	const swap_emitters = [...new Set(logs.filter((l) => t0(l) === V3_SWAP_TOPIC || t0(l) === V4_SWAP_TOPIC).map((l) => lc(l.address)))].sort()
	const transfers = logs.filter((l) => t0(l) === TRANSFER && l.topics.length === 3).map((l) => ({ token: lc(l.address), from: `0x${l.topics[1].slice(-40)}`.toLowerCase(), to: `0x${l.topics[2].slice(-40)}`.toLowerCase() }))
	const token_senders: Record<string, string[]> = {}
	for (const token of [...new Set(transfers.filter((t) => t.to === w).map((t) => t.token))].sort()) token_senders[token] = [...new Set(transfers.filter((t) => t.token === token && swap_emitters.includes(t.from)).map((t) => t.from))].sort()
	return { liquidity, swap_emitters, token_senders }
}
