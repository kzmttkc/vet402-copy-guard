// Public chain facts a decision reads besides the wallet's transfers: who the Stock
// Token came from, and what the Chainlink feed said at the block of the move.
//
// The public RPC keeps no historical state, so a past price is not read with eth_call
// at an old block. It is read from the feed aggregator's AnswerUpdated logs: the last
// answer at or before the block. No key.
import type { Price, Venue } from './rules-v2'

/** JSON-RPC as a function. The same shape as agent/chain.ts, declared here so the CRE workflows can import this file. */
export type Rpc = (method: string, params: unknown[]) => Promise<any>

export const V4_POOL_MANAGER = '0x8366a39cc670b4001a1121b8f6a443a643e40951'
export const V3_FACTORY = '0x1f7d7550b1b028f7571e69a784071f0205fd2efa'
/** keccak256("AnswerUpdated(int256,uint256,uint256)") */
export const ANSWER_UPDATED_TOPIC = '0x0559884fd3a460db3073b7fc896cc77986f16e378210ded43186175bf646fc5f'
const SPAN = 10_000_000

export type Point = { block: number; answer: string; round_id: string; updated_at: string; tx: string }
export type FeedSeries = { token: string; symbol: string; feed: string; aggregator: string; decimals: number; from_block: number; to_block: number; points: Point[] }

const hex = (n: number) => `0x${n.toString(16)}`
const addr = (word: string) => `0x${word.slice(-40)}`.toLowerCase()

/** Is this address the v4 PoolManager, or a pool whose factory() is the official v3 factory? */
export async function venueOf(rpc: Rpc, address: string, cache: Map<string, Venue['kind']>): Promise<Venue> {
	const a = address.toLowerCase()
	let kind = cache.get(a)
	if (!kind) {
		kind = 'other'
		if (a === V4_POOL_MANAGER) kind = 'uniswap-v4-pool-manager'
		else {
			try {
				const f = (await rpc('eth_call', [{ to: a, data: '0xc45a0155' }, 'latest'])) as string
				if (f.length === 66 && addr(f) === V3_FACTORY) kind = 'uniswap-v3-pool'
			} catch {
				kind = 'other'
			}
		}
		cache.set(a, kind)
	}
	return { address: a, kind }
}

/** Every answer the feed's current aggregator published in [fromBlock, toBlock], oldest first. */
export async function feedSeries(rpc: Rpc, token: string, symbol: string, feed: string, fromBlock: number, toBlock: number): Promise<FeedSeries> {
	const aggregator = addr((await rpc('eth_call', [{ to: feed, data: '0x245a7bfc' }, 'latest'])) as string)
	const decimals = Number(BigInt((await rpc('eth_call', [{ to: feed, data: '0x313ce567' }, 'latest'])) as string))
	const points: Point[] = []
	for (let a = Math.max(0, fromBlock); a <= toBlock; a += SPAN) {
		const logs = (await rpc('eth_getLogs', [{ address: aggregator, fromBlock: hex(a), toBlock: hex(Math.min(toBlock, a + SPAN - 1)), topics: [ANSWER_UPDATED_TOPIC] }])) as any[]
		for (const l of logs) {
			const answer = BigInt.asIntN(256, BigInt(l.topics[1]))
			if (answer <= 0n) continue
			points.push({ block: Number(BigInt(l.blockNumber)), answer: answer.toString(), round_id: BigInt(l.topics[2]).toString(), updated_at: new Date(Number(BigInt(l.data)) * 1000).toISOString(), tx: String(l.transactionHash).toLowerCase() })
		}
	}
	points.sort((x, y) => x.block - y.block)
	return { token: token.toLowerCase(), symbol, feed: feed.toLowerCase(), aggregator, decimals, from_block: Math.max(0, fromBlock), to_block: toBlock, points }
}

/** The last point at or before a block, or null. */
export function pointAt(series: FeedSeries | undefined, block: number): Point | null {
	if (!series) return null
	let hit: Point | null = null
	for (const p of series.points) {
		if (p.block > block) break
		hit = p
	}
	return hit
}

export function priceAt(series: FeedSeries | undefined, block: number): Price | null {
	const p = pointAt(series, block)
	if (!series || !p) return null
	return { feed: series.feed, aggregator: series.aggregator, answer: p.answer, decimals: series.decimals, round_id: p.round_id, updated_at: p.updated_at, update_block: p.block, update_tx: p.tx }
}
