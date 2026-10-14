// Which wallets the walk follows: the notable buyers of Robinhood Stock Tokens.
//
//   bun scripts/select-wallets.ts [--days 30] [--top 30] [--to-block N] [--out docs/walk]
//
// One rule, no hand picking:
//
//   A PURCHASE is a transfer of a Stock Token that has a Chainlink feed, straight from
//   the Uniswap v4 PoolManager or from a pool of the official Uniswap v3 factory to a
//   wallet, in a transaction that wallet signed and in which it paid: another token left
//   the wallet, or the transaction carried ETH. A liquidity-pool `collect`, an airdrop,
//   a bridge delivery and a purchase made through a contract are not purchases here.
//
//   Its SIZE is the amount received times the Chainlink feed's last value at or before
//   the block.
//
//   The walk follows the --top wallets with the largest sum of purchase sizes over the
//   last --days days, ending at --to-block (default: the head of the chain when run).
//
// Everything is read from the public Robinhood Chain RPC. No key, no vet402 API.
//
// How the ranking is found without reading every transaction: the Transfer logs give an
// upper bound for each receiver (everything it received from an official venue). The
// receivers are then checked one by one from the largest bound down: an address with
// contract code cannot sign a transaction, so it has no purchase; for a plain account
// each of its transactions is opened and the purchases are summed. The search stops
// when the wallet in place --top has a sum at least as large as the next receiver's
// upper bound, so no receiver left unread could enter the list.
//
// Output: <out>/selection.json (the rule, the window, the counts, every selected wallet
// with each purchase counted) and <out>/wallets.json (what agent/walk.ts reads). The raw
// scan is cached under agent/state/select/ (not part of the repo): delete it to scan again.
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { type FeedSeries, feedSeries, pointAt, V3_FACTORY, V4_POOL_MANAGER } from '../agent/facts'
import snapshot from '../token-check/registry-snapshot.json'

const RPC = 'https://rpc.mainnet.chain.robinhood.com'
const TRANSFER = '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef'
/** keccak256("PoolCreated(address,address,uint24,int24,address)") */
const POOL_CREATED = '0x783cca1c0412dd0d695e784568c96da2e9c22ff989357a2e8b1d9b2b4e6b7118'
const REPO = join(import.meta.dir, '..')
const CACHE = join(REPO, 'agent/state/select')
const FEED_LOOKBACK = 6_000_000

export const RULE =
	'A purchase is a transfer of a Robinhood Stock Token that has a Chainlink feed, straight from the Uniswap v4 PoolManager or a pool of the official Uniswap v3 factory to a wallet, in a transaction that wallet signed and in which it paid (another token left the wallet, or the transaction carried ETH). Its size is the amount received times the Chainlink feed value at or before the block. The walk follows the wallets with the largest sum of purchase sizes in the window.'

const arg = (name: string, dflt: string) => (process.argv.includes(name) ? process.argv[process.argv.indexOf(name) + 1] : dflt)
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))
const hex = (n: number) => `0x${n.toString(16)}`
const addr = (word: string) => `0x${word.slice(-40)}`.toLowerCase()
const pad = (a: string) => `0x${'0'.repeat(24)}${a.slice(2).toLowerCase()}`

let rpcCalls = 0
let lastAt = 0
async function post(body: unknown): Promise<any> {
	for (let attempt = 0; ; attempt++) {
		const wait = lastAt + 400 - Date.now()
		if (wait > 0) await sleep(wait)
		lastAt = Date.now()
		rpcCalls++
		try {
			const res = await fetch(RPC, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.timeout(60_000) })
			if (res.status === 429 || res.status >= 500) throw new Error(`HTTP ${res.status}`)
			return await res.json()
		} catch (e) {
			if (attempt >= 14) throw e
			await sleep(Math.min(20_000, 1500 * 2 ** attempt))
		}
	}
}
async function rpc(method: string, params: unknown[]): Promise<any> {
	const body = await post({ jsonrpc: '2.0', id: 1, method, params })
	if (body.error) throw new Error(body.error.message ?? 'rpc error')
	return body.result
}
/** One JSON-RPC batch. An item the RPC rate-limits is asked again alone. */
async function batch(calls: { method: string; params: unknown[] }[]): Promise<any[]> {
	const answers = (await post(calls.map((c, i) => ({ jsonrpc: '2.0', id: i + 1, method: c.method, params: c.params })))) as any[]
	const out: any[] = calls.map(() => undefined)
	for (const a of Array.isArray(answers) ? answers : []) if (typeof a.id === 'number' && !a.error) out[a.id - 1] = a.result
	for (let i = 0; i < calls.length; i++) if (out[i] === undefined) out[i] = await rpc(calls[i].method, calls[i].params)
	return out
}

type Hit = { to: string; from: string; raw: string; block: number; tx: string }
export type Purchase = { tx: string; block: number; time?: string; token: string; symbol: string; venue: string; amount_raw: string; feed_usd: string; feed_round_id: string; size_usd: string; paid: string }

/** First block whose timestamp is at or after `unix`. */
async function blockAtOrAfter(unix: number, head: number): Promise<number> {
	let lo = 1
	let hi = head
	while (lo < hi) {
		const mid = Math.floor((lo + hi) / 2)
		const ts = Number(BigInt((await rpc('eth_getBlockByNumber', [hex(mid), false])).timestamp))
		if (ts >= unix) hi = mid
		else lo = mid + 1
	}
	return lo
}

/** Transfer logs of one token whose sender is one of the venues, over [from, to]. The span is halved whenever the RPC says the answer is too large. */
async function scan(token: string, venues: string[], from: number, to: number, file: string): Promise<Hit[]> {
	// One query per venue: with several values in one topic position the RPC allows only 100,000 blocks a query.
	const done = `${file}.done`
	if (existsSync(done) && readFileSync(done, 'utf8') === `${from}-${to}-${venues.length}`) {
		return readFileSync(file, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l))
	}
	writeFileSync(file, '')
	const out: Hit[] = []
	for (const venue of venues) {
		// The PoolManager is busy, so its span starts small. A v3 pool is usually quiet, so its span starts at the widest the RPC allows.
		let span = venue === V4_POOL_MANAGER ? 200_000 : 10_000_000
		for (let a = from; a <= to; ) {
			const b = Math.min(to, a + span - 1)
			try {
				const logs = (await rpc('eth_getLogs', [{ address: token, fromBlock: hex(a), toBlock: hex(b), topics: [TRANSFER, pad(venue)] }])) as any[]
				const hits: Hit[] = logs.filter((l) => l.topics.length === 3).map((l) => ({ to: addr(l.topics[2]), from: addr(l.topics[1]), raw: BigInt(l.data === '0x' ? '0x0' : l.data).toString(), block: Number(BigInt(l.blockNumber)), tx: String(l.transactionHash).toLowerCase() }))
				out.push(...hits)
				if (hits.length) appendFileSync(file, `${hits.map((h) => JSON.stringify(h)).join('\n')}\n`)
				a = b + 1
				if (logs.length < 4000) span = Math.min(10_000_000, span * 2)
			} catch (e) {
				if (!/exceeds limit|too large|timeout|limit of/i.test(String((e as Error).message))) throw e
				span = Math.floor(span / 4)
				if (span < 500) throw new Error(`cannot read ${token} at block ${a}`)
			}
		}
	}
	writeFileSync(done, `${from}-${to}-${venues.length}`)
	return out
}

async function main() {
	const days = Number(arg('--days', '30'))
	const top = Number(arg('--top', '30'))
	const out = join(REPO, arg('--out', 'docs/walk'))
	mkdirSync(CACHE, { recursive: true })
	const log: string[] = []
	const say = (s: string) => {
		console.log(s)
		log.push(s)
	}
	const windowFile = join(CACHE, 'window.json')
	let win: { from: number; to: number; from_time: string; to_time: string; days: number }
	if (existsSync(windowFile) && !process.argv.includes('--to-block') && JSON.parse(readFileSync(windowFile, 'utf8')).days === days) win = JSON.parse(readFileSync(windowFile, 'utf8'))
	else {
		const to = process.argv.includes('--to-block') ? Number(arg('--to-block', '0')) : Number(BigInt(await rpc('eth_blockNumber', [])))
		const toTs = Number(BigInt((await rpc('eth_getBlockByNumber', [hex(to), false])).timestamp))
		const from = await blockAtOrAfter(toTs - days * 86_400, to)
		const fromTs = Number(BigInt((await rpc('eth_getBlockByNumber', [hex(from), false])).timestamp))
		win = { from, to, from_time: new Date(fromTs * 1000).toISOString(), to_time: new Date(toTs * 1000).toISOString(), days }
		writeFileSync(windowFile, JSON.stringify(win))
	}
	say(`wallet selection, Robinhood Chain 4663, blocks ${win.from} to ${win.to} (${win.from_time} to ${win.to_time}, ${days} days)`)
	say(`rule: ${RULE}`)

	const tokens = (snapshot as any).tokens.filter((t: any) => t.feed) as { token: string; symbol: string; feed: string }[]
	const feedTokens = new Set(tokens.map((t) => t.token.toLowerCase()))

	// The official v3 pools that hold one of those tokens.
	const pools = new Map<string, string[]>()
	const head = win.to
	// One query per token and per position (token0, token1): the RPC allows a wide block span only for a query with one value per topic position.
	const poolsFile = join(CACHE, 'pools.json')
	if (existsSync(poolsFile) && JSON.parse(readFileSync(poolsFile, 'utf8')).to === head) for (const [t, ps] of Object.entries(JSON.parse(readFileSync(poolsFile, 'utf8')).pools)) pools.set(t, ps as string[])
	else {
		for (const t of tokens) {
			const token = t.token.toLowerCase()
			for (const topics of [[POOL_CREATED, pad(token)], [POOL_CREATED, null, pad(token)]]) {
				let span = 10_000_000
				for (let a = 0; a <= head; ) {
					const b = Math.min(head, a + span - 1)
					try {
						const logs = (await rpc('eth_getLogs', [{ address: V3_FACTORY, fromBlock: hex(a), toBlock: hex(b), topics }])) as any[]
						for (const l of logs) {
							const pool = addr(l.data.slice(0, 2 + 128))
							if (!(pools.get(token) ?? []).includes(pool)) pools.set(token, [...(pools.get(token) ?? []), pool])
						}
						a = b + 1
					} catch (e) {
						if (!/exceeds limit|limit of/i.test(String((e as Error).message))) throw e
						span = Math.floor(span / 2)
					}
				}
			}
			console.error(`pools ${t.symbol} ${(pools.get(token) ?? []).length}`)
		}
		writeFileSync(poolsFile, JSON.stringify({ to: head, pools: Object.fromEntries(pools) }))
	}
	const poolCount = new Set([...pools.values()].flat()).size
	say(`tokens with a Chainlink feed: ${tokens.length}; official v3 pools holding one of them: ${poolCount}; plus the v4 PoolManager`)

	// 1. Every transfer of those tokens out of an official venue.
	const hits: (Hit & { token: string; symbol: string })[] = []
	for (const t of tokens) {
		const token = t.token.toLowerCase()
		const venues = [V4_POOL_MANAGER, ...(pools.get(token) ?? [])]
		const got = await scan(token, venues, win.from, win.to, join(CACHE, `${t.symbol}.jsonl`))
		console.error(`scanned ${t.symbol} ${got.length}`)
		for (const h of got) hits.push({ ...h, token, symbol: t.symbol })
		say(`  ${t.symbol}: ${got.length} transfers out of ${venues.length} venue${venues.length === 1 ? '' : 's'}`)
	}

	// 2. Price each at the feed and add up per receiver: an upper bound of its purchases.
	const feeds: Record<string, FeedSeries> = {}
	for (const t of tokens) feeds[t.token.toLowerCase()] = await feedSeries(rpc, t.token, t.symbol, t.feed, win.from - FEED_LOOKBACK, win.to)
	const venueSet = new Set([V4_POOL_MANAGER, ...[...pools.values()].flat()])
	const sized = (h: { token: string; raw: string; block: number }) => {
		const series = feeds[h.token]
		const p = pointAt(series, h.block)
		if (!p) return null
		const price = Number(p.answer) / 10 ** series.decimals
		return { price, round: p.round_id, usd: (Number(BigInt(h.raw)) / 1e18) * price }
	}
	const bound = new Map<string, { usd: number; hits: typeof hits }>()
	let unpriced = 0
	for (const h of hits) {
		if (venueSet.has(h.to)) continue
		const s = sized(h)
		if (!s) {
			unpriced++
			continue
		}
		const e = bound.get(h.to) ?? { usd: 0, hits: [] }
		e.usd += s.usd
		e.hits.push(h)
		bound.set(h.to, e)
	}
	const ranked = [...bound.entries()].sort((a, b) => b[1].usd - a[1].usd)
	say(`transfers out of an official venue: ${hits.length}; receivers: ${ranked.length}; transfers with no feed value yet at their block: ${unpriced}`)
	if (process.argv.includes('--scan-only')) {
		for (const [w, e] of ranked.slice(0, 60)) say(`  ${w} bound ${e.usd.toFixed(2)} USD in ${new Set(e.hits.map((h) => h.tx)).size} txs`)
		return
	}

	// 3. From the largest bound down: who really bought, and how much.
	const txCacheFile = join(CACHE, 'txs.json')
	const txCache: Record<string, { from: string; value: string; block: number; outs: { token: string; raw: string }[] } | null> = existsSync(txCacheFile) ? JSON.parse(readFileSync(txCacheFile, 'utf8')) : {}
	const codeCache: Record<string, string> = existsSync(join(CACHE, 'code.json')) ? JSON.parse(readFileSync(join(CACHE, 'code.json'), 'utf8')) : {}
	const selected: { wallet: string; bound_usd: string; purchases: Purchase[]; size_usd: number; not_purchases: { not_signed: number; nothing_paid: number } }[] = []
	const read: { wallet: string; bound_usd: string; kind: string; size_usd: string; txs: number }[] = []
	let contracts = 0
	let accounts = 0
	for (const [wallet, e] of ranked) {
		const kth = selected.length >= top ? [...selected].sort((a, b) => b.size_usd - a.size_usd)[top - 1].size_usd : -1
		if (kth >= e.usd) break
		codeCache[wallet] ??= (await rpc('eth_getCode', [wallet, 'latest'])) as string
		// Code that starts with 0xef0100 is an EIP-7702 delegation: the address is still an account that signs.
		if (codeCache[wallet] !== '0x' && !codeCache[wallet].startsWith('0xef0100')) {
			contracts++
			read.push({ wallet, bound_usd: e.usd.toFixed(2), kind: 'contract: cannot sign a transaction', size_usd: '0.00', txs: new Set(e.hits.map((h) => h.tx)).size })
			continue
		}
		accounts++
		const txs = [...new Set(e.hits.map((h) => h.tx))]
		const need = txs.filter((t) => txCache[`${t}:${wallet}`] === undefined)
		for (let i = 0; i < need.length; i += 20) {
			const part = need.slice(i, i + 20)
			const res = await batch(part.flatMap((t) => [{ method: 'eth_getTransactionByHash', params: [t] }, { method: 'eth_getTransactionReceipt', params: [t] }]))
			part.forEach((t, k) => {
				const tx = res[2 * k]
				const rc = res[2 * k + 1]
				if (!tx || !rc || rc.status !== '0x1') {
					txCache[`${t}:${wallet}`] = null
					return
				}
				const outs = (rc.logs ?? []).filter((l: any) => l.topics?.[0] === TRANSFER && l.topics.length === 3 && addr(l.topics[1]) === wallet).map((l: any) => ({ token: String(l.address).toLowerCase(), raw: BigInt(l.data === '0x' ? '0x0' : l.data).toString() }))
				txCache[`${t}:${wallet}`] = { from: String(tx.from).toLowerCase(), value: BigInt(tx.value).toString(), block: Number(BigInt(rc.blockNumber)), outs }
			})
			if (i % 400 === 0) writeFileSync(txCacheFile, JSON.stringify(txCache))
		}
		const purchases: Purchase[] = []
		let notSigned = 0
		let nothingPaid = 0
		for (const h of e.hits) {
			const t = txCache[`${h.tx}:${wallet}`]
			const s = sized(h)
			if (!t || !s) continue
			if (t.from !== wallet) {
				notSigned++
				continue
			}
			const paidToken = t.outs.find((o) => o.token !== h.token)
			if (!paidToken && BigInt(t.value) === 0n) {
				nothingPaid++
				continue
			}
			purchases.push({ tx: h.tx, block: h.block, token: h.token, symbol: h.symbol, venue: h.from, amount_raw: h.raw, feed_usd: s.price.toFixed(4), feed_round_id: s.round, size_usd: s.usd.toFixed(2), paid: BigInt(t.value) > 0n ? `${t.value} wei of ETH` : `${paidToken?.raw} of ${paidToken?.token}` })
		}
		const size = purchases.reduce((x, p) => x + Number(p.size_usd), 0)
		read.push({ wallet, bound_usd: e.usd.toFixed(2), kind: 'account', size_usd: size.toFixed(2), txs: txs.length })
		if (purchases.length) selected.push({ wallet, bound_usd: e.usd.toFixed(2), purchases, size_usd: size, not_purchases: { not_signed: notSigned, nothing_paid: nothingPaid } })
		say(`  ${wallet} bound ${e.usd.toFixed(2)} USD, ${txs.length} txs: ${purchases.length} purchases, ${size.toFixed(2)} USD (${notSigned} not signed by it, ${nothingPaid} with nothing paid)`)
	}
	writeFileSync(txCacheFile, JSON.stringify(txCache))
	writeFileSync(join(CACHE, 'code.json'), JSON.stringify(codeCache))
	selected.sort((a, b) => b.size_usd - a.size_usd || (a.wallet < b.wallet ? -1 : 1))
	const picked = selected.slice(0, top)
	say(`receivers read from the largest bound down: ${read.length} (${contracts} contracts, ${accounts} plain accounts); wallets with at least one purchase among them: ${selected.length}; selected: ${picked.length}`)

	// Group 3: the first buyers of one token that uses the ticker SPY (docs/walk/SELECTION.md).
	const WATCHED = '0xe9b08727131e34010b34006c660d4c1b436ec25f'
	const SAME_TICKER = { token: '0x69e7778d46713e17572d610bdaca3943aa4e6219', ticker: 'SPY', name: 'Spy Chip', take: 20 }
	const stHits = await scan(SAME_TICKER.token, [V4_POOL_MANAGER], win.from, win.to, join(CACHE, 'same-ticker-SPY.jsonl'))
	stHits.sort((a, b) => a.block - b.block || (a.tx < b.tx ? -1 : a.tx > b.tx ? 1 : a.to < b.to ? -1 : 1))
	const taken = new Set([WATCHED, ...picked.map((p) => p.wallet)])
	const sameTicker: { wallet: string; first_purchase: { tx: string; block: number; amount_raw: string; paid: string } }[] = []
	let stRead = 0
	for (const h of stHits) {
		if (sameTicker.length >= SAME_TICKER.take) break
		if (taken.has(h.to) || h.to === V4_POOL_MANAGER) continue
		const key = `${h.tx}:${h.to}`
		if (txCache[key] === undefined) {
			const [tx, rc] = await batch([{ method: 'eth_getTransactionByHash', params: [h.tx] }, { method: 'eth_getTransactionReceipt', params: [h.tx] }])
			stRead++
			if (!tx || !rc || rc.status !== '0x1') txCache[key] = null
			else {
				const outs = (rc.logs ?? []).filter((l: any) => l.topics?.[0] === TRANSFER && l.topics.length === 3 && addr(l.topics[1]) === h.to).map((l: any) => ({ token: String(l.address).toLowerCase(), raw: BigInt(l.data === '0x' ? '0x0' : l.data).toString() }))
				txCache[key] = { from: String(tx.from).toLowerCase(), value: BigInt(tx.value).toString(), block: Number(BigInt(rc.blockNumber)), outs }
			}
		}
		const t = txCache[key]
		if (!t || t.from !== h.to) continue
		const paidToken = t.outs.find((o) => o.token !== SAME_TICKER.token)
		if (!paidToken && BigInt(t.value) === 0n) continue
		taken.add(h.to)
		sameTicker.push({ wallet: h.to, first_purchase: { tx: h.tx, block: h.block, amount_raw: h.raw, paid: BigInt(t.value) > 0n ? `${t.value} wei of ETH` : `${paidToken?.raw} of ${paidToken?.token}` } })
	}
	writeFileSync(txCacheFile, JSON.stringify(txCache))
	say(`same-ticker token ${SAME_TICKER.token} (${SAME_TICKER.ticker}, "${SAME_TICKER.name}"): ${stHits.length} transfers out of the v4 PoolManager to ${new Set(stHits.map((h) => h.to)).size} receivers in the window; the first ${sameTicker.length} wallets that bought it are group 3`)

	mkdirSync(out, { recursive: true })
	writeFileSync(
		join(out, 'selection.json'),
		`${JSON.stringify(
			{
				rule: RULE,
				selected_at: new Date().toISOString(),
				chain_id: 4663,
				window: win,
				top,
				tokens: tokens.map((t) => ({ symbol: t.symbol, token: t.token.toLowerCase(), feed: t.feed.toLowerCase() })),
				venues: { v4_pool_manager: V4_POOL_MANAGER, v3_factory: V3_FACTORY, v3_pools: poolCount },
				counts: { transfers_out_of_venues: hits.length, receivers: ranked.length, receivers_read: read.length, contracts_among_them: contracts, accounts_among_them: accounts, wallets_with_a_purchase: selected.length, selected: picked.length },
				stop: `the wallet in place ${top} bought for ${picked[picked.length - 1]?.size_usd.toFixed(2)} USD; the next receiver not read has an upper bound of ${ranked[read.length]?.[1].usd.toFixed(2) ?? '0.00'} USD`,
				wallets: picked.map((s, i) => ({ rank: i + 1, wallet: s.wallet, size_usd: s.size_usd.toFixed(2), purchases: s.purchases.length, received_but_not_purchases: s.not_purchases, largest: [...s.purchases].sort((a, b) => Number(b.size_usd) - Number(a.size_usd)).slice(0, 5) })),
				same_ticker_buyers: { ...SAME_TICKER, transfers_out_of_the_pool_manager: stHits.length, receivers: new Set(stHits.map((h) => h.to)).size, wallets: sameTicker },
				watched: WATCHED,
				read,
				rpc_calls: rpcCalls,
			},
			null,
			1,
		)}\n`,
	)
	writeFileSync(join(out, 'selection-purchases.json'), `${JSON.stringify(Object.fromEntries(picked.map((s) => [s.wallet, s.purchases])))}\n`)
	writeFileSync(
		join(out, 'wallets.json'),
		`${JSON.stringify(
			[
				{ wallet: WATCHED, cohort: 'watched', rank: null, purchases_usd: null, why: 'the wallet copy-guard was first pointed at, and the only wallet vet402 has anchored a record for' },
				...picked.map((s, i) => ({ wallet: s.wallet, cohort: 'top_buyers', rank: i + 1, purchases_usd: s.size_usd.toFixed(2), why: `rank ${i + 1} of the 30 largest buyers of Stock Tokens in the window: ${s.purchases.length} purchases, ${s.size_usd.toFixed(2)} USD at the Chainlink feed` })),
				...sameTicker.map((s, i) => ({ wallet: s.wallet, cohort: 'same_ticker_buyers', rank: i + 1, purchases_usd: null, why: `buyer ${i + 1} of the first 20 of the token ${SAME_TICKER.token}, which uses the ticker ${SAME_TICKER.ticker}` })),
			],
			null,
			1,
		)}\n`,
	)
	writeFileSync(join(out, 'selection-output.txt'), `${log.join('\n')}\n`)
	say(`saved ${arg('--out', 'docs/walk')}/selection.json`)
}

if (import.meta.main)
	main().catch((e) => {
		console.error(String(e instanceof Error ? e.message : e).slice(0, 600))
		process.exit(1)
	})
