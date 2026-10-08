// Robinhood Chain (4663) reads over the public RPC. No key.
import { pad } from 'viem'
import { ANCHORED_TOPIC, anchoredLogs, RWA_ANCHOR_ADDRESS, subjectHash } from '../rwa-verify/verify'
import { groupMovements, type Log, TRANSFER_TOPIC } from './movement'
import type { Movement } from './rules'

export { groupMovements, TRANSFER_TOPIC }

export const RPC = 'https://rpc.mainnet.chain.robinhood.com'
/** The public RPC refuses log queries without an address filter over more than 30,000 blocks. */
export const LOG_SPAN = 30_000
/** With an address filter it allows 10,000,000. */
const ADDRESS_LOG_SPAN = 10_000_000
/** RwaAnchor was deployed before this block. */
const RWA_ANCHOR_FROM_BLOCK = 74_000_000

const METHOD_NAMES: Record<number, string> = { 1: 'rwa-recon-0.1', 2: 'rwa-recon-0.2', 3: 'rwa-recon-0.3' }

export type Rpc = (method: string, params: unknown[]) => Promise<any>

export function httpRpc(url: string = RPC): Rpc {
	let id = 0
	return async (method, params) => {
		for (let attempt = 0; ; attempt++) {
			const res = await fetch(url, {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ jsonrpc: '2.0', id: ++id, method, params }),
			})
			if ((res.status === 429 || res.status >= 500) && attempt < 3) {
				await new Promise((r) => setTimeout(r, 1000 * (attempt + 1)))
				continue
			}
			const body = (await res.json()) as { result?: unknown; error?: { message?: string } }
			if (body.error) throw new Error(`${method}: ${body.error.message ?? 'rpc error'}`)
			return body.result
		}
	}
}

const hex = (n: number) => `0x${n.toString(16)}`
const topicOf = (addr: string) => pad(addr.toLowerCase() as `0x${string}`, { size: 32 }).toLowerCase()

/** Every ERC-20 Transfer log that names the wallet as sender or receiver, any token, grouped by tx. */
export async function movements(rpc: Rpc, wallet: string, fromBlock: number, toBlock: number): Promise<Movement[]> {
	const w = topicOf(wallet)
	const logs: Log[] = []
	for (let a = fromBlock; a <= toBlock; a += LOG_SPAN) {
		const b = Math.min(toBlock, a + LOG_SPAN - 1)
		const range = { fromBlock: hex(a), toBlock: hex(b) }
		const [sent, received] = await Promise.all([
			rpc('eth_getLogs', [{ ...range, topics: [TRANSFER_TOPIC, w] }]) as Promise<Log[]>,
			rpc('eth_getLogs', [{ ...range, topics: [TRANSFER_TOPIC, null, w] }]) as Promise<Log[]>,
		])
		logs.push(...sent, ...received)
	}
	return groupMovements(wallet, logs)
}

export type AnchorRef = { tx: string; block: number; methodVersion: string; factsHash: string; recordUrl: string }

/**
 * The wallet's newest anchor in RwaAnchor: highest method_version, then highest
 * block, the same order the vet402 record page uses. The anchored record is the
 * file vet402 keeps for it in its public repo.
 */
export async function newestAnchor(rpc: Rpc, wallet: string, latest: number, repoRaw: string): Promise<AnchorRef | null> {
	const found: AnchorRef[] = []
	for (let a = RWA_ANCHOR_FROM_BLOCK; a <= latest; a += ADDRESS_LOG_SPAN) {
		const b = Math.min(latest, a + ADDRESS_LOG_SPAN - 1)
		const logs = (await rpc('eth_getLogs', [
			{ address: RWA_ANCHOR_ADDRESS, fromBlock: hex(a), toBlock: hex(b), topics: [ANCHORED_TOPIC, subjectHash(wallet)] },
		])) as Log[]
		for (const l of logs) {
			const [d] = anchoredLogs({ logs: [l] })
			if (!d) continue
			const mv = METHOD_NAMES[d.methodVersion]
			if (!mv) continue
			const block = Number(BigInt(l.blockNumber))
			const file = mv === 'rwa-recon-0.1' ? 'fixtures/rwa/anchor.json' : `fixtures/rwa/anchors/${mv}-${block}.json`
			found.push({ tx: l.transactionHash.toLowerCase(), block, methodVersion: mv, factsHash: d.factsHash, recordUrl: `${repoRaw}/${file}` })
		}
	}
	found.sort((x, y) => (x.methodVersion === y.methodVersion ? y.block - x.block : x.methodVersion < y.methodVersion ? 1 : -1))
	return found[0] ?? null
}
