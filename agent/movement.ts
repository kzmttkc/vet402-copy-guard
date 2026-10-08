// Pure: ERC-20 Transfer logs to movements of one wallet. Shared by the agent,
// the CRE trail workflow (which re-reads the movement tx) and the checker.
import type { Movement, Transfer } from './rules'

export const TRANSFER_TOPIC = '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef'

export type Log = { address: string; topics: string[]; data: string; blockNumber: string; transactionHash: string; logIndex: string }

/** Pure: Transfer logs to one Movement per tx, transfers in log order, duplicates (self-transfers) once. */
export function groupMovements(wallet: string, logs: Log[]): Movement[] {
	const w = wallet.toLowerCase()
	const seen = new Set<string>()
	const byTx = new Map<string, { block: number; items: { idx: number; t: Transfer }[] }>()
	for (const l of logs) {
		if (l.topics?.[0]?.toLowerCase() !== TRANSFER_TOPIC || l.topics.length !== 3) continue
		const key = `${l.transactionHash}:${l.logIndex}`
		if (seen.has(key)) continue
		seen.add(key)
		const from = `0x${l.topics[1].slice(-40)}`.toLowerCase()
		const to = `0x${l.topics[2].slice(-40)}`.toLowerCase()
		if (from !== w && to !== w) continue
		const tx = l.transactionHash.toLowerCase()
		const entry = byTx.get(tx) ?? { block: Number(BigInt(l.blockNumber)), items: [] }
		entry.items.push({
			idx: Number(BigInt(l.logIndex)),
			t: {
				token: l.address.toLowerCase(),
				from,
				to,
				amount_raw: l.data && l.data !== '0x' ? BigInt(l.data.slice(0, 66)).toString() : '0',
				direction: to === w ? 'in' : 'out',
			},
		})
		byTx.set(tx, entry)
	}
	return [...byTx.entries()]
		.map(([tx, e]) => ({
			chain_id: 4663,
			tx,
			block: e.block,
			transfers: e.items.sort((a, b) => a.idx - b.idx).map((i) => i.t),
		}))
		.sort((a, b) => a.block - b.block || (a.tx < b.tx ? -1 : 1))
}
