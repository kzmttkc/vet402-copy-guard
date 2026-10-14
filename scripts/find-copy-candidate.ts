// Look for a wallet whose real move could reach COPY: a complete track record, a realized
// profit, and a Stock Token it still holds. Read-only. No key, no payment.
//
//   bun scripts/find-copy-candidate.ts [--blocks 3000000] [--tokens 12] [--max-facts 60] [--out docs/agent/copy-search]
//
// 1. Robinhood Chain public RPC: count the Transfer logs of each Stock Token that has a
//    Chainlink feed over a short window, and keep the quietest tokens (the busiest ones
//    are traded by bots with thousands of moves).
// 2. Scan those tokens over the last --blocks blocks and group the transfers by wallet.
// 3. Keep wallets with few transfers, at least one buy and one sell, every counterparty
//    the official Uniswap v4 PoolManager or a pool of the official v3 factory, and a
//    balance left over.
// 4. Ask vet402's free /rwa route for each candidate's record, at most --max-facts
//    times and no faster than one request every 7 seconds (the route allows 10 a minute).
// The numbers of what was searched go to <out>/search-<label>.json.
// A second pass with --usdg-quoted keeps only wallets that paid and were paid in USDG,
// because a record is complete only when every lot has a known cost.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const RPC = 'https://rpc.mainnet.chain.robinhood.com'
const VET402 = 'https://vet402.com'
const TRANSFER = '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef'
const V4_POOL_MANAGER = '0x8366a39cc670b4001a1121b8f6a443a643e40951'
const V3_FACTORY = '0x1f7d7550b1b028f7571e69a784071f0205fd2efa'
const ZERO = '0x0000000000000000000000000000000000000000'
const REPO = join(import.meta.dir, '..')

const arg = (name: string, dflt: string) => {
	const i = process.argv.indexOf(name)
	return i >= 0 ? process.argv[i + 1] : dflt
}
const WINDOW = Number(arg('--blocks', '3000000'))
const TOKENS = Number(arg('--tokens', '12'))
const MAX_FACTS = Number(arg('--max-facts', '60'))
const OUT = join(REPO, arg('--out', 'docs/agent/copy-search'))
/** Name of this pass, used in the output file names. */
const LABEL = arg('--label', '1')
/** With --usdg-quoted: keep only wallets whose every Stock Token move has USDG going the other way in the same tx, and whose sells brought in more than their share of the cost. */
const USDG_QUOTED = process.argv.includes('--usdg-quoted')
/** Wallets already asked about in an earlier pass are not asked about again. */
const SKIP = new Set<string>(process.argv.includes('--skip') ? JSON.parse(readFileSync(join(REPO, arg('--skip', '')), 'utf8')).records.map((r: any) => r.wallet) : [])
const USDG = '0x5fc5360d0400a0fd4f2af552add042d716f1d168'
/** Stock Tokens with a Chainlink feed, from vet402's public registry snapshot (symbol, token). */
const FEED_TOKENS: [string, string][] = JSON.parse(readFileSync(join(REPO, 'scripts/feed-tokens.json'), 'utf8'))

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))
let rpcCalls = 0
let lastAt = 0
async function rpc(method: string, params: unknown[]): Promise<any> {
	for (let attempt = 0; ; attempt++) {
		const wait = lastAt + 350 - Date.now()
		if (wait > 0) await sleep(wait)
		lastAt = Date.now()
		rpcCalls++
		let res: Response
		try {
			res = await fetch(RPC, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: rpcCalls, method, params }), signal: AbortSignal.timeout(30_000) })
		} catch (e) {
			if (attempt < 6) {
				await sleep(2000 * (attempt + 1))
				continue
			}
			throw e
		}
		if (res.status === 429 || res.status >= 500) {
			if (attempt >= 8) throw new Error(`${method}: HTTP ${res.status}`)
			await sleep(Math.min(30_000, 2000 * 2 ** attempt))
			continue
		}
		const body = (await res.json()) as { result?: unknown; error?: { message?: string } }
		if (body.error) throw new Error(body.error.message ?? 'rpc error')
		return body.result
	}
}
const hex = (n: number) => `0x${n.toString(16)}`
const addr = (topic: string) => `0x${topic.slice(-40)}`.toLowerCase()

type T = { token: string; symbol: string; from: string; to: string; raw: bigint; block: number; tx: string }

/** Transfer logs of one token over [from, to], halving the span whenever the RPC says "exceeds limit". */
async function scan(token: string, symbol: string, from: number, to: number, cap: number): Promise<T[] | null> {
	const out: T[] = []
	let span = 200_000
	for (let a = from; a <= to; ) {
		const b = Math.min(to, a + span - 1)
		try {
			const logs = (await rpc('eth_getLogs', [{ address: token, fromBlock: hex(a), toBlock: hex(b), topics: [TRANSFER] }])) as any[]
			for (const l of logs) {
				if (l.topics.length !== 3) continue
				out.push({ token: token.toLowerCase(), symbol, from: addr(l.topics[1]), to: addr(l.topics[2]), raw: BigInt(l.data === '0x' ? '0x0' : l.data), block: Number(BigInt(l.blockNumber)), tx: l.transactionHash })
			}
			if (out.length > cap) return null
			a = b + 1
			if (logs.length < 3000) span = Math.min(400_000, span * 2)
		} catch (e) {
			if (!/exceeds limit/.test(String((e as Error).message))) throw e
			span = Math.floor(span / 2)
			if (span < 5_000) return null
		}
	}
	return out
}

const v3Pool = new Map<string, boolean>()
async function isOfficialPool(a: string): Promise<boolean> {
	if (a === V4_POOL_MANAGER) return true
	if (v3Pool.has(a)) return v3Pool.get(a) as boolean
	let ok = false
	try {
		const f = (await rpc('eth_call', [{ to: a, data: '0xc45a0155' }, 'latest'])) as string
		ok = f.length === 66 && addr(f) === V3_FACTORY
	} catch {
		ok = false
	}
	v3Pool.set(a, ok)
	return ok
}

async function main() {
	mkdirSync(OUT, { recursive: true })
	const latest = Number(BigInt(await rpc('eth_blockNumber', [])))
	const from = latest - WINDOW + 1
	const log: string[] = []
	const say = (s: string) => {
		console.log(s)
		log.push(s)
	}
	say(`copy candidate search, Robinhood Chain 4663, blocks ${from}..${latest} (${WINDOW} blocks), ${new Date().toISOString()}`)

	// 1. How busy is each token? Count Transfer logs over the newest 20,000 blocks.
	const busy: { symbol: string; token: string; recent: number | null }[] = []
	for (const [symbol, token] of FEED_TOKENS) {
		let n: number | null
		try {
			n = ((await rpc('eth_getLogs', [{ address: token, fromBlock: hex(latest - 19_999), toBlock: hex(latest), topics: [TRANSFER] }])) as any[]).length
		} catch {
			n = null
		}
		busy.push({ symbol, token, recent: n })
	}
	const quiet = busy.filter((b) => b.recent !== null).sort((x, y) => (x.recent as number) - (y.recent as number)).slice(0, TOKENS)
	say(`tokens with a feed: ${FEED_TOKENS.length}; transfers in the newest 20,000 blocks: ${busy.map((b) => `${b.symbol} ${b.recent ?? '>10000'}`).join(', ')}`)
	say(`scanning the ${quiet.length} quietest: ${quiet.map((q) => q.symbol).join(', ')}`)

	// 2. Scan.
	const all: T[] = []
	const scanned: { symbol: string; transfers: number | null }[] = []
	for (const q of quiet) {
		const got = await scan(q.token, q.symbol, from, latest, 60_000)
		scanned.push({ symbol: q.symbol, transfers: got ? got.length : null })
		if (got) all.push(...got)
		say(`  ${q.symbol}: ${got ? got.length : 'too many'} transfers`)
	}

	// 3. Group by wallet.
	type W = { transfers: T[]; counter: Set<string> }
	const wallets = new Map<string, W>()
	const touch = (w: string, t: T, other: string) => {
		if (w === ZERO) return
		const e = wallets.get(w) ?? { transfers: [], counter: new Set<string>() }
		e.transfers.push(t)
		e.counter.add(other)
		wallets.set(w, e)
	}
	for (const t of all) {
		touch(t.from, t, t.to)
		touch(t.to, t, t.from)
	}
	const shaped: { wallet: string; n: number; held: string[] }[] = []
	for (const [w, e] of wallets) {
		if (w === V4_POOL_MANAGER || e.transfers.length < 2 || e.transfers.length > 14 || e.counter.size > 3) continue
		const buys = e.transfers.filter((t) => t.to === w).length
		const sells = e.transfers.filter((t) => t.from === w).length
		if (!buys || !sells) continue
		const net = new Map<string, bigint>()
		for (const t of e.transfers) net.set(t.symbol, (net.get(t.symbol) ?? 0n) + (t.to === w ? t.raw : -t.raw))
		const held = [...net].filter(([, v]) => v > 0n).map(([s]) => s)
		if (!held.length) continue
		shaped.push({ wallet: w, n: e.transfers.length, held })
	}
	shaped.sort((a, b) => a.n - b.n)
	say(`wallets seen: ${wallets.size}; with 2 to 14 transfers, a buy, a sell, at most 3 counterparties and a balance left in the window: ${shaped.length}`)

	// Counterparties must be official pools, and the candidate itself must be a plain account.
	let candidates: (typeof shaped[number] & { est_realized_usd?: number })[] = []
	let poolOnly = 0
	let usdgQuoted = 0
	for (const c of shaped) {
		if (!USDG_QUOTED && candidates.length >= MAX_FACTS) break
		if (SKIP.has(c.wallet)) continue
		const e = wallets.get(c.wallet) as W
		let ok = true
		for (const other of e.counter) if (!(await isOfficialPool(other))) ok = false
		if (!ok) continue
		const code = (await rpc('eth_getCode', [c.wallet, 'latest'])) as string
		if (code !== '0x') continue
		poolOnly++
		if (USDG_QUOTED) {
			// USDG the wallet sent and received in the window, by tx.
			const w = `0x${'0'.repeat(24)}${c.wallet.slice(2)}`
			const range = { address: USDG, fromBlock: hex(from), toBlock: hex(latest) }
			const sent = (await rpc('eth_getLogs', [{ ...range, topics: [TRANSFER, w] }])) as any[]
			const got = (await rpc('eth_getLogs', [{ ...range, topics: [TRANSFER, null, w] }])) as any[]
			const flow = new Map<string, number>()
			for (const l of sent) flow.set(l.transactionHash, (flow.get(l.transactionHash) ?? 0) - Number(BigInt(l.data)) / 1e6)
			for (const l of got) flow.set(l.transactionHash, (flow.get(l.transactionHash) ?? 0) + Number(BigInt(l.data)) / 1e6)
			// Average cost per token: every buy must have USDG going out, every sell USDG coming in.
			const book = new Map<string, { bought: number; cost: number; sold: number; proceeds: number }>()
			let paired = true
			for (const t of e.transfers) {
				const usdg = flow.get(t.tx) ?? 0
				const b = book.get(t.symbol) ?? { bought: 0, cost: 0, sold: 0, proceeds: 0 }
				const units = Number(t.raw) / 1e18
				if (t.to === c.wallet) {
					if (!(usdg < 0)) paired = false
					b.bought += units
					b.cost += -usdg
				} else {
					if (!(usdg > 0)) paired = false
					b.sold += units
					b.proceeds += usdg
				}
				book.set(t.symbol, b)
			}
			if (!paired) continue
			usdgQuoted++
			let est = 0
			let heldUsd = 0
			let oversold = false
			for (const b of book.values()) {
				if (b.sold > b.bought * 1.000001) oversold = true
				const avg = b.bought > 0 ? b.cost / b.bought : 0
				est += b.proceeds - avg * b.sold
				heldUsd += Math.max(0, b.bought - b.sold) * avg
			}
			if (oversold || !(est > 0.05) || !(heldUsd > 0.05)) continue
			candidates.push({ ...c, est_realized_usd: Number(est.toFixed(2)) })
		} else {
			candidates.push(c)
		}
	}
	if (USDG_QUOTED) {
		candidates.sort((a, b) => (b.est_realized_usd ?? 0) - (a.est_realized_usd ?? 0))
		say(`plain accounts whose every counterparty is the v4 PoolManager or an official v3 pool: ${poolOnly}; of those, every Stock Token move paid or was paid in USDG in the same tx: ${usdgQuoted}; of those, sells above average cost and a balance left: ${candidates.length}`)
		candidates = candidates.slice(0, MAX_FACTS)
	} else {
		say(`of those, plain accounts whose every counterparty is the v4 PoolManager or an official v3 pool: ${candidates.length} (checked until ${MAX_FACTS} were found)`)
	}

	// 4. vet402 /rwa, free route.
	const facts: any[] = []
	let factsCalls = 0
	for (const c of candidates) {
		if (factsCalls >= MAX_FACTS) break
		if (factsCalls) await sleep(7000)
		factsCalls++
		const url = `${VET402}/api/v1/rwa/facts/${c.wallet}?chain=4663`
		let row: any = { wallet: c.wallet, transfers_in_window: c.n, est_realized_usd: (c as any).est_realized_usd }
		try {
			const res = await fetch(url, { headers: { accept: 'application/json' }, signal: AbortSignal.timeout(90_000) })
			row.http = res.status
			if (res.status === 200) {
				const f = (await res.json()) as any
				const priced = (f.tokens ?? []).filter((t: any) => t.canonical && Number(t.usd) > 0 && Number(t.shares_ui) > 0).map((t: any) => t.symbol)
				row = { ...row, r1_status: f.r1_status, realized_usd: f.realized_usd, lookalikes: (f.lookalikes ?? []).length, priced_holdings: priced, as_of_block: f.as_of_block, method_version: f.method_version, other_unparsed: f.events_summary?.other_unparsed }
				row.c3 = f.r1_status === 'reconstructed'
				row.c4 = typeof f.realized_usd === 'string' && /^\d/.test(f.realized_usd) && /[1-9]/.test(f.realized_usd)
				row.c5_possible = priced.length > 0
				row.fit = row.c3 && row.c4 && row.c5_possible
			} else if (res.status === 429) {
				await sleep(20_000)
			}
		} catch (e) {
			row.error = String((e as Error).message).slice(0, 80)
		}
		facts.push(row)
		say(`  ${factsCalls}/${MAX_FACTS} ${c.wallet} http ${row.http ?? '-'} ${row.r1_status ?? ''} realized ${row.realized_usd ?? '-'} holds ${(row.priced_holdings ?? []).join('/') || '-'}${row.fit ? '  <-- FIT' : ''}`)
		if (facts.filter((f) => f.fit).length >= 3) break
	}
	const fits = facts.filter((f) => f.fit)
	say(`/rwa records read: ${factsCalls}; complete history: ${facts.filter((f) => f.c3).length}; complete with a realized profit: ${facts.filter((f) => f.c3 && f.c4).length}; also still holding a priced Stock Token: ${fits.length}`)
	writeFileSync(
		join(OUT, `search-${LABEL}.json`),
		`${JSON.stringify({ searched_at: new Date().toISOString(), pass: LABEL, usdg_quoted_only: USDG_QUOTED, chain_id: 4663, from_block: from, to_block: latest, feed_tokens: FEED_TOKENS.length, recent_transfer_counts: busy, scanned, wallets_seen: wallets.size, shaped: shaped.length, candidates: candidates.length, rpc_calls: rpcCalls, rwa_free_route_calls: factsCalls, records: facts, fits }, null, 2)}\n`,
	)
	writeFileSync(join(OUT, `search-${LABEL}-output.txt`), `${log.join('\n')}\n`)
}

main().catch((e) => {
	console.error(String(e instanceof Error ? e.message : e).slice(0, 400))
	process.exit(1)
})
