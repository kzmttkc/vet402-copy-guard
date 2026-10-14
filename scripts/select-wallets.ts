// Which wallets the walk follows: notable wallets whose record can be checked.
//
//   bun scripts/select-wallets.ts [--days 30] [--top 30] [--max-asked 100] [--to-block N] [--out docs/walk]
//
// The rule is written out in docs/walk/SELECTION.md, precisely enough to be repeated
// without this file. In short:
//
//   1. Read every transfer of a feed-priced Stock Token out of an official Uniswap venue
//      in the window (the v4 PoolManager and the pools of the official v3 factory).
//   2. Rank the receivers by the sum of amount times the Chainlink feed value at the
//      block. This is one pass over the logs. No receipt is opened.
//   3. From the top, ask vet402's free /rwa route once per address. An address it can
//      build a record for is selected. Any other is written down with the HTTP status
//      and the reason, and not walked. Stop at --top selected or --max-asked asked.
//   4. Two observations, kept apart: the watched wallet, and the first 20 buyers of one
//      token that uses the ticker SPY (its first minter and that transaction's signer
//      left out).
//
// Everything on the chain is read from the public RPC. No key. The route is asked at
// most ten times a minute, and each answer is saved in <out>/records/.
//
// Output: <out>/selection.json (the rule, the window, the counts, the selected wallets,
// the addresses with no record, the observations) and <out>/wallets.json (what
// agent/walk.ts reads). The raw scan (2 GB) is cached under agent/state/select/, which is
// not part of the repo: delete it to scan again.
import { appendFileSync, createReadStream, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { createInterface } from 'node:readline'
import { join } from 'node:path'
import { type FeedSeries, feedSeries, pointAt, V3_FACTORY, V4_POOL_MANAGER } from '../agent/facts'
import { shown } from '../agent/rules-v2'
import { abiText } from '../agent/tokens'
import snapshot from '../token-check/registry-snapshot.json'

const RPC = 'https://rpc.mainnet.chain.robinhood.com'
const TRANSFER = '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef'
/** keccak256("PoolCreated(address,address,uint24,int24,address)") */
const POOL_CREATED = '0x783cca1c0412dd0d695e784568c96da2e9c22ff989357a2e8b1d9b2b4e6b7118'
const REPO = join(import.meta.dir, '..')
const CACHE = join(REPO, 'agent/state/select')
const FEED_LOOKBACK = 6_000_000

const VET402 = 'https://vet402.com'
const USDG = '0x5fc5360d0400a0fd4f2af552add042d716f1d168'
/** What WETH9() of the official Uniswap v3 position manager answers on Robinhood Chain. */
const WETH = '0x0bd7d308f8e1639fab988df18a8011f41eacad73'
/** keccak256("Swap(bytes32,address,int128,int128,uint160,uint128,int24,uint24)"), the v4 PoolManager's swap log. */
const V4_SWAP = '0x40e9cecb9f5f1f1c5b9c97dec2917b7ee92e57ba5563708daca94dd84ad7112f'
/** Every log that says a liquidity position was touched: v3 pool Mint, Burn, Collect; position manager IncreaseLiquidity, DecreaseLiquidity, Collect; v4 ModifyLiquidity. */
const LIQUIDITY_TOPICS = new Set([
	'0x7a53080ba414158be7ec69b987b5fb7d07dee101fe85488f0853ae16239d0bde',
	'0x0c396cd989a39f4459b5fa1aed6a9a8dcdbc45908acfd67e028cd568da98982c',
	'0x70935338e69775456a85ddef226c395fb668b63fa0115f5f20610b388e6ca9c0',
	'0x3067048beee31b25b2f1681f88dac838c8bba36af25bfb2b7cf7473a5847e35f',
	'0x26f6a048ee9138f2c0ce266f322cb99228e8d619ae2bff30c67f8dcf9d2377b4',
	'0x40d0efd1a53d60ecbf40971b9daf7dc90178c3aadc7aab1765632738fa8b8f01',
	'0xf208f4912782fd25c7f114ca3723a2d5dd6f3bcc3ac8db5af63baa85f711d5ec',
])

/**
 * Routers: contracts that take a Stock Token from an official venue and pass it on to the buyer in
 * the same transaction. What a router passes on of what a venue sent it in that transaction is
 * counted for the receiver (docs/walk/SELECTION.md, section 1, "Through a router").
 */
export const ROUTERS: { address: string; name: string; basis: string }[] = [
	{ address: '0xcaf681a66d020601342297493863e78c959e5cb2', name: 'Uniswap SwapRouter02', basis: "Uniswap's deployment list for Robinhood Chain (4663), and a verified SwapRouter02 on robinhoodchain.blockscout.com" },
	{ address: '0x8876789976decbfcbbbe364623c63652db8c0904', name: 'Uniswap UniversalRouter', basis: "Uniswap's deployment list for Robinhood Chain (4663), and a verified UniversalRouter on robinhoodchain.blockscout.com" },
	{ address: '0x3d90f66b534dd8482b181e24655a9e8265316be9', name: 'a router measured on the chain', basis: 'measured: in sampled transactions it receives a Stock Token from the v4 PoolManager and sends the same amount to the signer, who paid USDG (agent/fixtures/move-routed-buy.json is one)' },
]
const ROUTER_SET = new Set(ROUTERS.map((r) => r.address))

export const PURPOSE = 'The walk follows notable wallets whose record can be checked.'
export const RULE =
	"Rank every address by what official Uniswap venues (the v4 PoolManager and the pools of the official v3 factory) sent it of the Stock Tokens that have a Chainlink feed, in the window, directly or through a listed router in the same transaction, each transfer at the feed's value at its block. From the top: a router or another contract is not a wallet and is listed as such without asking; every other address is asked about once on vet402's free route. An address it can build a record for is selected. Any other is listed with the reason and not walked. Stop at the number to select, or at the number of addresses asked."
export const PURCHASE =
	'Within one transaction a wallet bought a token when an official venue emitted a swap log and sent the token, the wallet ended the transaction with more of it, the wallet itself paid USDG or WETH or (as the signer) ETH, no liquidity log is in the transaction, and no other Stock Token left the wallet.'
export const PRICE_SOURCE = "AnswerUpdated logs of the feed's aggregator: the last answer at or before the block, the last in log order within a block. The public RPC keeps no historical state, so latestRoundData() cannot be asked at a past block."

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
/** Returns how many transfers are in `file`. The transfers themselves stay on disk: there are millions. */
async function scan(token: string, venues: string[], from: number, to: number, file: string): Promise<number> {
	// One query per venue: with several values in one topic position the RPC allows only 100,000 blocks a query.
	const done = `${file}.done`
	const mark = `${from}-${to}-${venues.length}`
	if (existsSync(done) && readFileSync(done, 'utf8').startsWith(`${mark}:`)) return Number(readFileSync(done, 'utf8').split(':')[1])
	writeFileSync(file, '')
	let count = 0
	let stuck = 0
	for (const venue of venues) {
		// The PoolManager is busy, so its span starts small. A v3 pool is usually quiet, so its span starts at the widest the RPC allows.
		let span = venue === V4_POOL_MANAGER ? 200_000 : 10_000_000
		for (let a = from; a <= to; ) {
			const b = Math.min(to, a + span - 1)
			try {
				const logs = (await rpc('eth_getLogs', [{ address: token, fromBlock: hex(a), toBlock: hex(b), topics: [TRANSFER, pad(venue)] }])) as any[]
				const hits: Hit[] = logs.filter((l) => l.topics.length === 3).map((l) => ({ to: addr(l.topics[2]), from: addr(l.topics[1]), raw: BigInt(l.data === '0x' ? '0x0' : l.data).toString(), block: Number(BigInt(l.blockNumber)), tx: String(l.transactionHash).toLowerCase() }))
				count += hits.length
				if (hits.length) appendFileSync(file, `${hits.map((h) => JSON.stringify(h)).join('\n')}\n`)
				a = b + 1
				if (logs.length < 4000) span = Math.min(10_000_000, span * 2)
			} catch (e) {
				const msg = String((e as Error).message)
				if (!/exceeds limit|too large|timeout|timed out|limit of|aborted/i.test(msg)) throw e
				// Too many logs: a narrower span. Anything else is the RPC being slow: wait, then a narrower span as well.
				if (!/exceeds limit|limit of/i.test(msg)) await sleep(5000)
				span = Math.max(1, Math.floor(span / (venue === V4_POOL_MANAGER ? 2 : 4)))
				if (span === 1 && ++stuck > 20) throw new Error(`cannot read ${token} at block ${a}: ${msg.slice(0, 120)}`)
			}
		}
	}
	writeFileSync(done, `${mark}:${count}`)
	return count
}

/** Every transfer saved in a file, one at a time. */
async function* saved(file: string): AsyncGenerator<Hit> {
	if (!existsSync(file)) return
	for await (const line of createInterface({ input: createReadStream(file), crlfDelay: Number.POSITIVE_INFINITY })) if (line) yield JSON.parse(line) as Hit
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

	// 1. Every transfer of those tokens out of an official venue, saved to disk.
	const files: { token: string; symbol: string; file: string }[] = []
	let transfersOut = 0
	for (const t of tokens) {
		const token = t.token.toLowerCase()
		const venues = [V4_POOL_MANAGER, ...(pools.get(token) ?? [])]
		const file = join(CACHE, `${t.symbol}.jsonl`)
		const n = await scan(token, venues, win.from, win.to, file)
		files.push({ token, symbol: t.symbol, file })
		transfersOut += n
		console.error(`scanned ${t.symbol} ${n}`)
		say(`  ${t.symbol}: ${n} transfers out of ${venues.length} venue${venues.length === 1 ? '' : 's'}`)
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
	const bound = new Map<string, number>()
	const direct = new Map<string, number>()
	const routed = new Map<string, number>()
	/** What official venues sent a router of a token in one transaction, not yet passed on: `${token}|${tx}|${router}` to the raw amount. */
	const atRouter = new Map<string, bigint>()
	let unpriced = 0
	for (const f of files) {
		for await (const h of saved(f.file)) {
			if (venueSet.has(h.to)) continue
			if (ROUTER_SET.has(h.to)) {
				const k = `${f.token}|${h.tx}|${h.to}`
				atRouter.set(k, (atRouter.get(k) ?? 0n) + BigInt(h.raw))
			}
			const s = sized({ token: f.token, raw: h.raw, block: h.block })
			if (!s) {
				unpriced++
				continue
			}
			bound.set(h.to, (bound.get(h.to) ?? 0) + s.usd)
			direct.set(h.to, (direct.get(h.to) ?? 0) + s.usd)
		}
	}
	// 1b. What a router passed on in the same transaction, up to what venues sent it there of that token. Read from the logs, one query per token and router.
	let routedTransfers = 0
	let routedCounted = 0
	for (const t of tokens) {
		const token = t.token.toLowerCase()
		const file = join(CACHE, `${t.symbol}.routed.jsonl`)
		const n = await scan(token, ROUTERS.map((r) => r.address), win.from, win.to, file)
		routedTransfers += n
		console.error(`routed ${t.symbol} ${n}`)
		for await (const h of saved(file)) {
			if (venueSet.has(h.to) || ROUTER_SET.has(h.to)) continue
			const k = `${token}|${h.tx}|${h.from}`
			const left = atRouter.get(k) ?? 0n
			if (left <= 0n) continue
			const take = BigInt(h.raw) < left ? BigInt(h.raw) : left
			atRouter.set(k, left - take)
			const s = sized({ token, raw: take.toString(), block: h.block })
			if (!s) continue
			routedCounted++
			bound.set(h.to, (bound.get(h.to) ?? 0) + s.usd)
			routed.set(h.to, (routed.get(h.to) ?? 0) + s.usd)
		}
	}
	const ranked = [...bound.entries()].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1))
	say(`transfers out of an official venue: ${transfersOut}; transfers out of the ${ROUTERS.length} routers: ${routedTransfers}, of which ${routedCounted} passed on what a venue sent the router in the same transaction; receivers: ${ranked.length} (${routed.size} received through a router); transfers with no feed value yet at their block: ${unpriced}`)
	if (process.argv.includes('--scan-only')) {
		for (const [w, usd] of ranked.slice(0, 60)) say(`  ${w} bound ${usd.toFixed(2)} USD`)
		return
	}

	// 3. From the largest bound down: ask vet402's free route. An address it can build a record for is selected.
	const feedCover = tokens.map((t) => ({ symbol: t.symbol, feed: t.feed.toLowerCase(), aggregator: feeds[t.token.toLowerCase()].aggregator, answers: feeds[t.token.toLowerCase()].points.length, has_answer_before_window: (feeds[t.token.toLowerCase()].points[0]?.block ?? Number.POSITIVE_INFINITY) < win.from }))
	say(`feeds: ${feedCover.filter((f) => f.has_answer_before_window).length} of ${feedCover.length} aggregators have an answer before the window starts`)
	mkdirSync(join(out, 'records'), { recursive: true })
	let lastAsk = 0
	let routeCalls = 0
	/** One address, asked once (a busy answer is asked again). The answer is saved, and read from the file when it is there. */
	const ask = async (wallet: string): Promise<{ http_status: number; facts: any; reason: string }> => {
		const file = join(out, 'records', `${wallet}.json`)
		if (existsSync(file)) {
			const s = JSON.parse(readFileSync(file, 'utf8'))
			return { http_status: s.http_status ?? 200, facts: s.facts, reason: s.reason ?? '' }
		}
		const url = `${VET402}/api/v1/rwa/facts/${wallet}?chain=4663`
		let status = 0
		let hash = ''
		let facts: any = null
		let reason = ''
		for (let attempt = 0; attempt < 4; attempt++) {
			const wait = lastAsk + 7000 - Date.now()
			if (wait > 0) await sleep(wait)
			lastAsk = Date.now()
			routeCalls++
			try {
				const res = await fetch(url, { headers: { accept: 'application/json' }, signal: AbortSignal.timeout(120_000) })
				status = res.status
				const text = await res.text()
				if (status === 200) {
					hash = (res.headers.get('x-facts-hash') ?? '').toLowerCase()
					facts = JSON.parse(text)
					reason = ''
				} else reason = text.replace(/\s+/g, ' ').slice(0, 240)
			} catch (e) {
				status = 0
				reason = `no answer: ${String((e as Error).message).slice(0, 80)}`
			}
			if (status !== 429 && status !== 0 && status < 500) break
			await sleep(30_000)
		}
		writeFileSync(file, `${JSON.stringify({ source_url: url, http_status: status, reason, x_facts_hash: hash, facts }, null, 2)}\n`)
		return { http_status: status, facts, reason }
	}
	const maxAsked = Number(arg('--max-asked', '100'))
	type Parts = { bound_usd: string; direct_usd: string; routed_usd: string }
	const parts = (w: string, total: number): Parts => ({ bound_usd: total.toFixed(2), direct_usd: (direct.get(w) ?? 0).toFixed(2), routed_usd: (routed.get(w) ?? 0).toFixed(2) })
	const selected: ({ wallet: string; bound_rank: number; has_code: boolean; r1_status: string; realized_usd: string | null; evidence_txs: number } & Parts)[] = []
	/** Every address passed over: a router or another contract (not asked), or an address vet402 could build no record for. */
	const noRecord: ({ wallet: string; bound_rank: number; has_code: boolean; asked: boolean; not_a_wallet: null | 'router' | 'contract'; http_status: number | null; reason: string } & Parts)[] = []
	let asked = 0
	let considered = 0
	for (let at = 0; at < ranked.length && selected.length < top && asked < maxAsked; at++) {
		const [wallet, usdBound] = ranked[at]
		considered++
		const code = (await rpc('eth_getCode', [wallet, 'latest'])) as string
		// An EIP-7702 delegation (0xef0100 and an address) is an account that signs its own transactions: a wallet.
		const hasCode = code !== '0x' && !code.startsWith('0xef0100')
		if (ROUTER_SET.has(wallet) || hasCode) {
			const router = ROUTER_SET.has(wallet)
			const reason = router ? `a router (${ROUTERS.find((r) => r.address === wallet)?.name}): what it receives it passes on, and what it passed on to a wallet is counted for that wallet` : `a contract (it has code at the head of the chain, ${(code.length - 2) / 2} bytes): not a wallet`
			noRecord.push({ wallet, bound_rank: at + 1, ...parts(wallet, usdBound), has_code: hasCode, asked: false, not_a_wallet: router ? 'router' : 'contract', http_status: null, reason })
			say(`  #${at + 1} ${wallet} bound ${usdBound.toFixed(2)} USD: not asked, ${reason}`)
			continue
		}
		asked++
		const a = await ask(wallet)
		if (a.http_status === 200 && a.facts) {
			selected.push({ wallet, bound_rank: at + 1, ...parts(wallet, usdBound), has_code: hasCode, r1_status: String(a.facts.r1_status), realized_usd: a.facts.realized_usd ?? null, evidence_txs: (a.facts.evidence?.txs ?? []).length })
			say(`  #${at + 1} ${wallet} bound ${usdBound.toFixed(2)} USD (${(routed.get(wallet) ?? 0).toFixed(2)} through a router): record ${a.facts.r1_status}, ${(a.facts.evidence?.txs ?? []).length} transactions listed: SELECTED (${selected.length})`)
		} else {
			noRecord.push({ wallet, bound_rank: at + 1, ...parts(wallet, usdBound), has_code: hasCode, asked: true, not_a_wallet: null, http_status: a.http_status, reason: a.reason })
			say(`  #${at + 1} ${wallet} bound ${usdBound.toFixed(2)} USD: no record, HTTP ${a.http_status} ${a.reason.slice(0, 90)}`)
		}
	}
	const notAsked = noRecord.filter((x) => !x.asked).length
	const stop = selected.length >= top ? `${top} addresses were selected` : asked >= maxAsked ? `${maxAsked} addresses had been asked` : 'the ranking ran out'
	say(`went down the ranking ${considered} places: ${noRecord.filter((x) => x.not_a_wallet === 'router').length} routers and ${noRecord.filter((x) => x.not_a_wallet === 'contract').length} other contracts not asked; ${asked} addresses asked, ${selected.length} selected, ${noRecord.length - notAsked} with no record. Stopped because ${stop}`)

	// Observations (docs/walk/SELECTION.md, section 3): the watched wallet, and the first buyers of one token that uses the ticker SPY.
	const WATCHED = '0xe9b08727131e34010b34006c660d4c1b436ec25f'
	const SAME_TICKER_TOKEN = '0x69e7778d46713e17572d610bdaca3943aa4e6219'
	// The token's own name() and symbol(), read from the chain and shown with any invisible character marked.
	const readText = async (data: string) => shown(abiText(await rpc('eth_call', [{ to: SAME_TICKER_TOKEN, data }, 'latest']).catch(() => '0x')))
	const SAME_TICKER = { token: SAME_TICKER_TOKEN, ticker: 'SPY', symbol: await readText('0x95d89b41'), name: await readText('0x06fdde03'), take: 20 }
	const ZERO_TOPIC = `0x${'0'.repeat(64)}`
	let firstMint: any = null
	for (let a = 0; a <= win.to && !firstMint; a += 10_000_000) {
		const logs = (await rpc('eth_getLogs', [{ address: SAME_TICKER.token, fromBlock: hex(a), toBlock: hex(Math.min(win.to, a + 9_999_999)), topics: [TRANSFER, ZERO_TOPIC] }])) as any[]
		if (logs.length) firstMint = logs[0]
	}
	const mintTx = firstMint ? await rpc('eth_getTransactionByHash', [firstMint.transactionHash]) : null
	const leftOut = [...new Set([firstMint ? addr(firstMint.topics[2]) : '', mintTx ? String(mintTx.from).toLowerCase() : ''].filter(Boolean))]
	await scan(SAME_TICKER.token, [V4_POOL_MANAGER], win.from, win.to, join(CACHE, 'same-ticker-SPY.jsonl'))
	const stHits: Hit[] = []
	for await (const h of saved(join(CACHE, 'same-ticker-SPY.jsonl'))) stHits.push(h)
	stHits.sort((a, b) => a.block - b.block || (a.tx < b.tx ? -1 : a.tx > b.tx ? 1 : a.to < b.to ? -1 : 1))
	const taken = new Set([WATCHED, V4_POOL_MANAGER, ...leftOut, ...selected.map((p) => p.wallet)])
	const stockTokens = new Set((snapshot as any).tokens.map((t: any) => String(t.token).toLowerCase()))
	const sameTicker: { wallet: string; first_purchase: { tx: string; block: number; amount_raw: string; paid: string; signer: string } }[] = []
	const seenTx = new Set<string>()
	for (const h of stHits) {
		if (sameTicker.length >= SAME_TICKER.take) break
		if (seenTx.has(h.tx)) continue
		seenTx.add(h.tx)
		const [tx, rc] = await batch([{ method: 'eth_getTransactionByHash', params: [h.tx] }, { method: 'eth_getTransactionReceipt', params: [h.tx] }])
		if (!tx || !rc || rc.status !== '0x1') continue
		const logs = (rc.logs ?? []) as any[]
		const topic0 = (l: any) => String(l.topics?.[0] ?? '').toLowerCase()
		// (a) the PoolManager swapped and sent the token, (c) no liquidity log in the transaction
		if (!logs.some((l) => String(l.address).toLowerCase() === V4_POOL_MANAGER && topic0(l) === V4_SWAP)) continue
		if (logs.some((l) => LIQUIDITY_TOPICS.has(topic0(l)))) continue
		const transfers = logs.filter((l) => topic0(l) === TRANSFER && l.topics.length === 3).map((l) => ({ token: String(l.address).toLowerCase(), from: addr(l.topics[1]), to: addr(l.topics[2]), raw: BigInt(l.data === '0x' ? '0x0' : l.data) }))
		const net = new Map<string, bigint>()
		for (const t of transfers.filter((x) => x.token === SAME_TICKER.token)) {
			net.set(t.to, (net.get(t.to) ?? 0n) + t.raw)
			net.set(t.from, (net.get(t.from) ?? 0n) - t.raw)
		}
		for (const [w, got] of [...net].filter(([, v]) => v > 0n).sort((x, y) => (x[0] < y[0] ? -1 : 1))) {
			if (sameTicker.length >= SAME_TICKER.take || taken.has(w)) continue
			// (d) no Stock Token left the wallet, (b) the wallet itself paid USDG, WETH or ETH
			if (transfers.some((t) => t.from === w && stockTokens.has(t.token))) continue
			const paidToken = transfers.find((t) => t.from === w && (t.token === USDG || t.token === WETH) && t.raw > 0n)
			const paidEth = String(tx.from).toLowerCase() === w && BigInt(tx.value) > 0n
			if (!paidToken && !paidEth) continue
			taken.add(w)
			sameTicker.push({ wallet: w, first_purchase: { tx: h.tx, block: h.block, amount_raw: got.toString(), paid: paidEth ? `${BigInt(tx.value)} wei of ETH` : `${paidToken?.raw} of ${paidToken?.token === USDG ? 'USDG' : 'WETH'}`, signer: String(tx.from).toLowerCase() } })
		}
	}
	say(`same-ticker token ${SAME_TICKER.token} (symbol() "${SAME_TICKER.symbol}", name() "${SAME_TICKER.name}"): ${stHits.length} transfers out of the v4 PoolManager to ${new Set(stHits.map((h) => h.to)).size} receivers in the window; left out as first minter or its signer: ${leftOut.join(', ') || 'none'}; the first ${sameTicker.length} wallets that bought it are the observation group`)
	const observed: { wallet: string; cohort: string; http_status: number; reason: string }[] = []
	for (const w of [WATCHED, ...sameTicker.map((s) => s.wallet)]) {
		const a = await ask(w)
		observed.push({ wallet: w, cohort: w === WATCHED ? 'watched' : 'same_ticker_buyers', http_status: a.http_status, reason: a.reason })
	}
	say(`observations: ${observed.length} wallets asked, ${observed.filter((o) => o.http_status !== 200).length} with no record`)

	writeFileSync(
		join(out, 'selection.json'),
		`${JSON.stringify(
			{
				purpose: PURPOSE,
				rule: RULE,
				purchase: PURCHASE,
				price_source: PRICE_SOURCE,
				selected_at: new Date().toISOString(),
				chain_id: 4663,
				window: win,
				top,
				max_asked: maxAsked,
				list: { source: (snapshot as any).source, taken_at: (snapshot as any).list_taken_at, stock_tokens: (snapshot as any).count },
				tokens: tokens.map((t) => ({ symbol: t.symbol, token: t.token.toLowerCase(), feed: t.feed.toLowerCase() })),
				feeds: feedCover,
				venues: { v4_pool_manager: V4_POOL_MANAGER, v3_factory: V3_FACTORY, v3_pools: poolCount },
				routers: ROUTERS,
				counts: { transfers_out_of_venues: transfersOut, transfers_out_of_routers: routedTransfers, routed_transfers_counted: routedCounted, transfers_with_no_feed_value: unpriced, receivers: ranked.length, receivers_through_a_router: routed.size, considered, not_asked_routers: noRecord.filter((x) => x.not_a_wallet === 'router').length, not_asked_contracts: noRecord.filter((x) => x.not_a_wallet === 'contract').length, asked, selected: selected.length, via_router: selected.filter((x) => Number(x.routed_usd) > 0).length, no_record: noRecord.length - notAsked, passed_over: noRecord.length, route_calls: routeCalls },
				stop: `Stopped because ${stop}: ${considered} places of the ranking gone through, ${notAsked} of them routers or other contracts (not asked), ${asked} addresses asked, ${selected.length} selected, ${noRecord.length - notAsked} with no record.`,
				wallets: selected.map((s, i) => ({ rank: i + 1, ...s })),
				no_record: noRecord,
				same_ticker_buyers: { ...SAME_TICKER, first_mint: firstMint ? { tx: String(firstMint.transactionHash).toLowerCase(), block: Number(BigInt(firstMint.blockNumber)), to: addr(firstMint.topics[2]), signer: mintTx ? String(mintTx.from).toLowerCase() : null } : null, left_out: leftOut, transfers_out_of_the_pool_manager: stHits.length, receivers: new Set(stHits.map((h) => h.to)).size, wallets: sameTicker },
				watched: WATCHED,
				observations: observed,
				ranking_top: ranked.slice(0, Math.max(considered, 100)).map(([w, usd], i) => ({ bound_rank: i + 1, wallet: w, ...parts(w, usd) })),
				rpc_calls: rpcCalls,
			},
			null,
			1,
		)}\n`,
	)
	writeFileSync(
		join(out, 'wallets.json'),
		`${JSON.stringify(
			[
				{ wallet: WATCHED, cohort: 'watched', rank: null, purchases_usd: null, why: 'an observation: the wallet copy-guard was first pointed at, and the only wallet vet402 has anchored a record for' },
				...selected.map((s, i) => ({ wallet: s.wallet, cohort: 'top_buyers', rank: i + 1, purchases_usd: s.bound_usd, why: `selected: number ${s.bound_rank} by what official venues sent it in the window, directly or through a router (${s.bound_usd} USD at the feed, ${s.routed_usd} of it through a router; an upper bound of its purchases), and vet402 could build its record` })),
				...sameTicker.map((s, i) => ({ wallet: s.wallet, cohort: 'same_ticker_buyers', rank: i + 1, purchases_usd: null, why: `an observation: buyer ${i + 1} of the first ${SAME_TICKER.take} of the token ${SAME_TICKER.token}, which uses the ticker ${SAME_TICKER.ticker}` })),
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
