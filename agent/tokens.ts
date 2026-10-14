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
