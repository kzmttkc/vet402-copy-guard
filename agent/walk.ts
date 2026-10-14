// The walk: every move of the wallets picked by scripts/select-wallets.ts, in the order
// the moves happened, decided by copy-guard v2 and entered in the practice ledger.
//
//   bun agent/walk.ts [--wallets docs/walk/wallets.json] [--mandate mandate] [--limits limits.json]
//                     [--out docs/walk] [--broadcast]
//
// A replay: nothing is paid and nothing is signed. For each wallet the record is asked
// for once from vet402's free route. A wallet vet402 cannot build a record for stays in
// the walk: its purchases become decisions that open nothing, with the HTTP status as
// the reason. The moves of a wallet are the transactions its record lists as evidence,
// the transactions in which the record names a token under a listed ticker, and the
// purchases the selection counted. The 402 terms are read once from the paid route,
// without paying. Every other input is public chain data: the transactions, the block
// times, the venue each Stock Token came from, the Chainlink feed values, and for a
// different token under a listed ticker the Uniswap v4 pool it was bought in.
//
// Which token is the issuer's: Robinhood's own asset list (token-check/registry-snapshot.json),
// and the Chainlink CRE token-check workflow's reading of the chain when its results are
// in docs/token-check/results.json. Every decision then names that file by its keccak256.
//
// Output, all under --out:
//   records/<wallet>.json   the record as read, with the X-Facts-Hash that came with it,
//                           or the HTTP status when there is none
//   feeds.json              every feed value used, with the tx that published it
//   chain.json.gz           the chain answers the decisions rest on (for the tests), gzipped
//   context.json            which wallet is in the walk for which reason, the window, the pool marks
//   tokens.json             every token that moved, once (the input of the CRE token-check)
//   trails.jsonl.gz         one version 2 trail per decision, in walk order, gzipped
//                           (agent/walk-files.ts; docs/verify/compressed.json keeps each sha256)
//   ../ledger.json          the ledger: rows, both books, totals and the Merkle root
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join, relative } from 'node:path'
import { getAddress } from 'viem'
import { type AnchorRef, httpRpc, newestAnchor, RPC, type Rpc } from './chain'
import { REPO, simulate } from './cre'
import { type FeedSeries, feedSeries, priceAt, V4_POOL_MANAGER, venueOf } from './facts'
import { buildLedger, type Cohort, type Feeds, order, type PoolEntry, type PoolMark, PracticeBook, saleOf, type WalkContext } from './ledger'
import { paymentCapAtomic } from './limits'
import { loadPolicy } from './main'
import { groupMovements } from './movement'
import { ledgerPath } from './pay'
import { recordInputs } from './record'
import { type CreInputs, type Movement, type RecordInputs, USDG } from './rules'
import { arrival, type ChainNames, type DecisionInputsV2, movedTokens, stockLegV2, type Venue } from './rules-v2'
import { buildTrailV2, type Purchase, recheckTrailV2, type TrailV2 } from './trail'
import { abiText, ISSUER_LIST, loadTokenCheck, NO_RECORD, poolEntryOf, receiptFacts, V4_SWAP_TOPIC } from './tokens'
import { readWalkText, walkFileExists, writeWalkGz } from './walk-files'
import { decodeRequired, loadLedger, MAX_SPEND_ATOMIC, pickAccept, spentAtomic, termsOf } from './x402'

const VET402 = 'https://vet402.com'
const VET402_REPO_RAW = 'https://raw.githubusercontent.com/kzmttkc/vet402/main'
const ZERO32 = `0x${'0'.repeat(64)}`
/** How far before a token's first move the feed is read, so a weekend-old value is still found. */
const FEED_LOOKBACK = 6_000_000

const arg = (name: string, dflt: string) => (process.argv.includes(name) ? process.argv[process.argv.indexOf(name) + 1] : dflt)
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))
const lc = (s: string) => s.toLowerCase()

/** The public RPC, one request at a time with a pause, asked again when it is busy. */
function pacedRpc(): Rpc & { calls: () => number; batch: (calls: { method: string; params: unknown[] }[]) => Promise<any[]> } {
	const inner = httpRpc(RPC)
	let last = 0
	let n = 0
	const pace = async () => {
		const wait = last + 400 - Date.now()
		if (wait > 0) await sleep(wait)
		last = Date.now()
		n++
	}
	const f = (async (method: string, params: unknown[]) => {
		for (let attempt = 0; ; attempt++) {
			await pace()
			try {
				return await inner(method, params)
			} catch (e) {
				if (attempt >= 10 || !/429|5\d\d|fetch failed|timeout|Unexpected|Too Many/i.test(String(e))) throw e
				await sleep(Math.min(20_000, 3000 * (attempt + 1)))
			}
		}
	}) as Rpc & { calls: () => number; batch: (calls: { method: string; params: unknown[] }[]) => Promise<any[]> }
	f.calls = () => n
	// One JSON-RPC batch. An item the RPC does not answer is asked again alone.
	f.batch = async (calls) => {
		const out: any[] = calls.map(() => undefined)
		try {
			await pace()
			const res = await fetch(RPC, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(calls.map((c, i) => ({ jsonrpc: '2.0', id: i + 1, method: c.method, params: c.params }))), signal: AbortSignal.timeout(60_000) })
			const answers = res.status === 200 ? ((await res.json()) as any[]) : []
			for (const a of Array.isArray(answers) ? answers : []) if (typeof a.id === 'number' && !a.error) out[a.id - 1] = a.result
		} catch {
			// every item is asked again below
		}
		for (let i = 0; i < calls.length; i++) if (out[i] === undefined) out[i] = await f(calls[i].method, calls[i].params)
		return out
	}
	return f
}

type Move = { wallet: string; mv: Movement; time: string; signer: string; value: string; to: string; selector: string; swaps: any[]; liquidity: string[]; swap_emitters: string[]; token_senders: Record<string, string[]> }
type Saved = { source_url: string; http_status: number; x_facts_hash: string; facts: any }

async function main() {
	const out = join(REPO, arg('--out', 'docs/walk'))
	const broadcast = process.argv.includes('--broadcast')
	const walletsFile = join(REPO, arg('--wallets', 'docs/walk/wallets.json'))
	const wallets: { wallet: string; cohort: Cohort; rank: number | null; purchases_usd: string | null; why: string }[] = JSON.parse(readFileSync(walletsFile, 'utf8'))
	const selection = JSON.parse(readFileSync(join(out, 'selection.json'), 'utf8'))
	// The one purchase counted for each wallet of the same-ticker observation. A selected wallet's moves come from its record alone.
	const counted: Record<string, { tx: string }[]> = {}
	for (const w of selection.same_ticker_buyers?.wallets ?? []) counted[lc(w.wallet)] = [{ tx: w.first_purchase.tx }]
	mkdirSync(join(out, 'records'), { recursive: true })
	const log: string[] = []
	const say = (s: string) => {
		console.log(s)
		log.push(s)
	}
	const policy = loadPolicy({ limits: arg('--limits', 'limits.json'), mandate: arg('--mandate', 'mandate') })
	const payer = getAddress(readFileSync(process.env.BLI_AGENT_ADDRESS_FILE ?? join(homedir(), '.vet402/bli-agent.address'), 'utf8').trim())
	const rpc = pacedRpc()
	const markBlock = Number(BigInt(await rpc('eth_blockNumber', [])))
	const decidedAt = new Date().toISOString()
	const m = policy.mandate
	const signed = Boolean(m.signer) && lc(m.signer ?? '') === lc(m.document.principal)
	const tokenCheck = loadTokenCheck(join(REPO, 'docs/token-check/results.json'), 'docs/token-check/results.json')
	say(`copy-guard v2 walk, ${wallets.length} wallets, decided ${decidedAt}, marked at block ${markBlock}`)
	say(`  mandate  ${m.keccak} principal ${m.document.principal} ${signed ? 'signed by the principal' : 'NOT signed by the principal: every decision will be NONE'} (${policy.mandateDir}/)`)
	say(`  limits   ${policy.limitsKeccak} full ${policy.limits.size.full_usd} USD, reduced ${policy.limits.size.reduced_usd} USD, ${policy.limits.size.max_usd_per_day} USD per day, ${policy.limits.size.max_open_positions} open`)
	say(`  tokens   ${tokenCheck ? `CRE token-check results ${tokenCheck.keccak} (${Object.keys(tokenCheck.tokens).length} tokens)` : 'no CRE token-check results file: a Stock Token is one whose address is in the issuer\'s list'}`)

	// The x402 terms, read once from the paid route. Nothing is paid.
	const first = await fetch(`${VET402}/api/v1/rwa/paid/facts/${getAddress(wallets[0].wallet)}`)
	const header = first.headers.get('PAYMENT-REQUIRED')
	if (first.status !== 402 || !header) throw new Error(`expected 402 with PAYMENT-REQUIRED, got ${first.status}`)
	const terms = termsOf(pickAccept(decodeRequired(header)))
	const spentBefore = spentAtomic(loadLedger(ledgerPath(), payer)).toString()

	// Per wallet: the record (free route, once), the newest anchor and CRE's verdict on it, and the moves.
	const records = new Map<string, { facts: any; record: RecordInputs; cre: CreInputs; fetch: { url: string; http_status: number } }>()
	const moves: Move[] = []
	const context: WalkContext = {
		window: { from_block: selection.window.from, to_block: selection.window.to, from_time: selection.window.from_time, to_time: selection.window.to_time },
		selection: { asked: selection.counts.asked, selected: selection.counts.selected, stop: selection.stop, no_record: selection.no_record },
		price_source: selection.price_source,
		wallets: [],
		pool_marks: {},
	}
	// Chain answers saved by an earlier walk are read from the file. A transaction, a block time, a token's decimals and a pool's factory do not change.
	const chainFile = join(out, 'chain.json')
	const chain: { receipts: Record<string, any>; blocks: Record<string, string>; decimals: Record<string, number>; venues: Record<string, Venue['kind']>; names: ChainNames } = walkFileExists(chainFile)
		? { names: {}, ...JSON.parse(readWalkText(chainFile)) }
		: { receipts: {}, blocks: {}, decimals: {}, venues: {}, names: {} }
	let lastFacts = 0
	let factsCalls = 0
	const receiver = JSON.parse(readFileSync(join(REPO, 'rwa-verify/config.json'), 'utf8')).receiverAddress
	for (const w of wallets) {
		const wallet = lc(w.wallet)
		const file = join(out, 'records', `${wallet}.json`)
		let saved: Saved
		if (existsSync(file)) saved = JSON.parse(readFileSync(file, 'utf8'))
		else {
			const url = `${VET402}/api/v1/rwa/facts/${getAddress(wallet)}?chain=4663`
			let status = 0
			let hash = ''
			let facts: any = null
			// A busy answer (429, 5xx, a timeout) is asked again. Any other answer is what vet402 says about this wallet.
			for (let attempt = 0; attempt < 4; attempt++) {
				const wait = lastFacts + 7000 - Date.now()
				if (wait > 0) await sleep(wait)
				lastFacts = Date.now()
				factsCalls++
				try {
					const res = await fetch(url, { signal: AbortSignal.timeout(120_000) })
					status = res.status
					if (status === 200) {
						hash = lc(res.headers.get('x-facts-hash') ?? '')
						facts = await res.json()
					}
				} catch {
					status = 0
				}
				if (status !== 429 && status !== 0 && status < 500) break
				await sleep(30_000)
			}
			saved = { source_url: url, http_status: status, x_facts_hash: hash, facts }
			writeFileSync(file, `${JSON.stringify(saved, null, 2)}\n`)
		}
		const http = saved.http_status ?? 200
		context.wallets.push({ wallet, cohort: w.cohort, rank: w.rank, purchases_usd: w.purchases_usd, record_http: http })
		const record = saved.facts ? recordInputs(saved.facts, { source_url: saved.source_url, x_facts_hash: saved.x_facts_hash }) : { ...NO_RECORD, source_url: saved.source_url }
		const anchor: AnchorRef | null = saved.facts ? await newestAnchor(rpc, wallet, markBlock, VET402_REPO_RAW) : null
		let cre: CreInputs = { workflow: 'vet402-rwa-verify', anchor_tx: '', anchor_record_url: '', verdict: 'NO_ANCHOR', reason_bits: 0, recomputed_facts_hash: '', anchored_facts_hash: '', receiver, mode: broadcast ? 'broadcast' : 'simulate', verdict_tx: null }
		if (anchor) {
			const run = simulate<any>('rwa-verify', { tx: anchor.tx, recordUrl: anchor.recordUrl }, { broadcast, workDir: join(out, 'cre'), label: `cre-verify-${wallet.slice(2, 10)}` })
			cre = { ...cre, anchor_tx: anchor.tx, anchor_record_url: anchor.recordUrl, verdict: run.result.verdict, reason_bits: run.result.reasonBits, recomputed_facts_hash: lc(run.result.recomputedFactsHash), anchored_facts_hash: lc(run.result.anchoredFactsHash), verdict_tx: run.tx }
		}
		records.set(wallet, { facts: saved.facts, record, cre, fetch: { url: saved.source_url, http_status: http } })
		const txs = [...new Set<string>([...(saved.facts?.evidence?.txs ?? []), ...(saved.facts?.lookalikes ?? []).map((l: any) => l.tx), ...(counted[wallet] ?? []).map((p) => p.tx)].filter(Boolean).map((t: string) => lc(t)))]
		let n = 0
		const padded = `0x${'0'.repeat(24)}${wallet.slice(2)}`
		for (let i = 0; i < txs.length; i += 10) {
			const part = txs.slice(i, i + 10).filter((tx) => !chain.receipts[`${tx}:${wallet}`])
			if (part.length) {
				const res = await rpc.batch(part.flatMap((tx) => [{ method: 'eth_getTransactionByHash', params: [tx] }, { method: 'eth_getTransactionReceipt', params: [tx] }]))
				part.forEach((tx, k) => {
					const t = res[2 * k]
					const r = res[2 * k + 1]
					if (!t || !r) return
					// Keep only what a checker reads: the Transfer logs that name the wallet, and the PoolManager's swap logs.
					const logs = (r.logs ?? []).filter((l: any) => (l.topics ?? []).slice(1, 3).some((x: string) => lc(x) === padded))
					const swaps = (r.logs ?? []).filter((l: any) => lc(l.address) === V4_POOL_MANAGER && lc(l.topics?.[0]) === V4_SWAP_TOPIC).map((l: any) => ({ topics: l.topics, data: l.data, logIndex: l.logIndex }))
					chain.receipts[`${tx}:${wallet}`] = { transactionHash: tx, blockNumber: r.blockNumber, status: r.status, from: lc(r.from), to: lc(t.to ?? ''), value: BigInt(t.value ?? '0x0').toString(), selector: String(t.input ?? '0x').slice(0, 10), logs, swaps, ...receiptFacts(r.logs ?? [], wallet) }
				})
			}
			const needBlocks = [...new Set(txs.slice(i, i + 10).map((tx) => chain.receipts[`${tx}:${wallet}`]).filter((r) => r && r.status === '0x1').map((r) => String(Number(BigInt(r.blockNumber)))))].filter((b) => !chain.blocks[b])
			if (needBlocks.length) {
				const res = await rpc.batch(needBlocks.map((b) => ({ method: 'eth_getBlockByNumber', params: [`0x${Number(b).toString(16)}`, false] })))
				needBlocks.forEach((b, k) => {
					chain.blocks[b] = res[k].timestamp
				})
			}
		}
		for (const tx of txs) {
			const r = chain.receipts[`${tx}:${wallet}`]
			if (!r || r.status !== '0x1') continue
			const [mv] = groupMovements(wallet, r.logs ?? []).filter((x) => x.tx === tx)
			if (!mv) continue
			moves.push({ wallet, mv, time: new Date(Number(BigInt(chain.blocks[mv.block])) * 1000).toISOString(), signer: lc(r.from), value: r.value, to: r.to, selector: r.selector, swaps: r.swaps ?? [], liquidity: r.liquidity, swap_emitters: r.swap_emitters, token_senders: r.token_senders })
			n++
		}
		writeWalkGz(REPO, chainFile, `${JSON.stringify(chain)}\n`)
		say(`  ${wallet} ${w.cohort}${w.rank ? ` ${w.rank}` : ''}: ${saved.facts ? `record ${record.r1_status}, realized ${record.realized_usd ?? 'unknown'}, ${anchor ? `anchor ${cre.verdict}` : 'no anchor'}` : `NO RECORD (HTTP ${http})`}, ${n} moves of ${txs.length} listed txs`)
	}

	// Decimals, venues and feeds.
	const venueCache = new Map<string, Venue['kind']>(Object.entries(chain.venues))
	const feeds: Feeds = {}
	const firstBlock = new Map<string, { block: number; symbol: string; feed: string }>()
	for (const mo of moves) {
		for (const t of mo.mv.transfers) {
			const token = lc(t.token)
			if (chain.decimals[token] === undefined) {
				try {
					chain.decimals[token] = Number(BigInt(await rpc('eth_call', [{ to: token, data: '0x313ce567' }, 'latest'])))
				} catch {
					chain.decimals[token] = 18
				}
			}
			// name() and symbol() of every token that is not a Stock Token, USDG or WETH, as the chain answers them. A revert is ''.
			if (!ISSUER_LIST[token] && token !== lc(USDG) && token !== '0x0bd7d308f8e1639fab988df18a8011f41eacad73' && chain.names[token] === undefined) {
				const text = async (data: string) => {
					try {
						return abiText(await rpc('eth_call', [{ to: token, data }, 'latest']))
					} catch {
						return ''
					}
				}
				chain.names[token] = { name: await text('0x06fdde03'), symbol: await text('0x95d89b41') }
			}
			const stock = ISSUER_LIST[token]
			if (stock?.feed && (!firstBlock.has(token) || (firstBlock.get(token)?.block ?? 0) > mo.mv.block)) firstBlock.set(token, { block: mo.mv.block, symbol: stock.symbol, feed: stock.feed })
		}
	}
	for (const [token, f] of firstBlock) {
		const series: FeedSeries = await feedSeries(rpc, token, f.symbol, f.feed, f.block - FEED_LOOKBACK, markBlock)
		feeds[token] = series
		say(`  feed ${f.symbol} ${series.points.length} values from block ${series.from_block}`)
	}

	// The walk.
	moves.sort((a, b) => a.mv.block - b.mv.block || (a.mv.tx < b.mv.tx ? -1 : a.mv.tx > b.mv.tx ? 1 : a.wallet < b.wallet ? -1 : 1))
	const book = new PracticeBook(feeds, policy.limits)
	const trails: TrailV2[] = []
	const poolFirst = new Map<string, number>()
	for (const mo of moves) {
		const ctx = records.get(mo.wallet) as { facts: any; record: RecordInputs; cre: CreInputs; fetch: { url: string; http_status: number } }
		const n = trails.length + 1
		book.advance(mo.mv.block)
		const tokensMoved = movedTokens(ctx.facts, mo.mv.transfers, chain.decimals, USDG, ISSUER_LIST, tokenCheck, chain.names)
		const base = { wallet: mo.wallet, movement: mo.mv, move: { time: mo.time, signer: mo.signer, value_wei: mo.value, to: mo.to, selector: mo.selector, liquidity: mo.liquidity }, tokens_moved: tokensMoved, venue: [], other_venue: [] } as unknown as DecisionInputsV2
		/** Who a leg's token came from: the swapping addresses that sent it in the transaction, then the wallet's own counterparties. */
		const venuesOf = async (token: string, direction: 'in' | 'out'): Promise<Venue[]> => {
			const direct = mo.mv.transfers.filter((t) => lc(t.token) === lc(token) && t.direction === direction).map((t) => lc(direction === 'in' ? t.from : t.to))
			const list = [...new Set([...(direction === 'in' ? (mo.token_senders[lc(token)] ?? []) : []), ...direct])]
			const out: Venue[] = []
			for (const a of list) out.push(await venueOf(rpc, a, venueCache, mo.swap_emitters.includes(a)))
			return out
		}
		const leg = stockLegV2(base)
		const venue: Venue[] = leg ? await venuesOf(leg.token, leg.direction) : []
		const otherIn = mo.mv.transfers.find((t) => t.direction === 'in' && tokensMoved.find((x) => x.token === lc(t.token))?.kind === 'same_ticker')
		const otherVenue: Venue[] = otherIn ? await venuesOf(otherIn.token, 'in') : []
		base.venue = venue
		base.other_venue = otherVenue
		// A different token under a listed ticker that the wallet bought from the v4 PoolManager: the pool and its price in that swap.
		let poolEntry: PoolEntry | null = null
		if (otherIn && arrival(base, { token: otherIn.token, direction: 'in' }) === 'purchase') {
			const raw = mo.mv.transfers.filter((t) => lc(t.token) === lc(otherIn.token) && t.direction === 'in').reduce((x, t) => x + BigInt(t.amount_raw), 0n).toString()
			poolEntry = poolEntryOf(mo.swaps, raw)
			if (poolEntry && !poolFirst.has(poolEntry.pool_id)) poolFirst.set(poolEntry.pool_id, mo.mv.block)
		}
		const purchase: Purchase = {
			mode: 'dry-run',
			resource: `${VET402}/api/v1/rwa/paid/facts/${getAddress(mo.wallet)}`,
			payer,
			payment_tx: null,
			settlement: 'not-sent',
			spent_before_atomic: spentBefore,
			cap_atomic: paymentCapAtomic(policy.limits, MAX_SPEND_ATOMIC).toString(),
			permit2_digest: ZERO32,
		}
		const inputs: DecisionInputsV2 = {
			...base,
			terms,
			record: ctx.record,
			record_fetch: ctx.fetch,
			cre: ctx.cre,
			decided_at: decidedAt,
			payer: lc(payer),
			rules: policy.rules,
			token_check: tokenCheck ? { source: tokenCheck.source, keccak: tokenCheck.keccak, tokens: Object.fromEntries(tokensMoved.filter((x) => tokenCheck.tokens[x.token]).map((x) => [x.token, tokenCheck.tokens[x.token]])) } : null,
			pool_entry: poolEntry,
			venue,
			other_venue: otherVenue,
			price: leg ? priceAt(feeds[lc(leg.token)], mo.mv.block) : null,
			limits: policy.limits,
			limits_keccak: policy.limitsKeccak,
			mandate: policy.mandate,
			book: { day: '', used_usd_today: '0.00', open_positions: 0 },
		}
		const sold = saleOf(inputs)
		if (sold) book.walletSold(mo.wallet, sold, mo.mv.block, n)
		inputs.book = book.state(mo.time.slice(0, 10))
		const trail = buildTrailV2(inputs, purchase)
		const p = trail.decision.paper_trade
		if (p) book.open(n, inputs, { token: p.token, symbol: p.symbol, tier: p.tier, notional: p.notional_usd, entry: p.price_usd, asset: 'stock', pool: null })
		const re = recheckTrailV2(trail)
		if (!re.ok) throw new Error(`decision ${n} does not recheck: ${re.problems.join('; ')}`)
		trails.push(trail)
	}
	for (const [a, k] of venueCache) chain.venues[a] = k
	// The last swap of each such pool at or before the mark block: what the token was worth there, in the pool's other asset.
	for (const [id, from] of poolFirst) {
		let lastLog: any = null
		// The public RPC allows at most 10,000,000 blocks a query.
		let span = Math.min(10_000_000, markBlock - from + 1)
		for (let a = from; a <= markBlock; ) {
			const b = Math.min(markBlock, a + span - 1)
			try {
				const logs = (await rpc('eth_getLogs', [{ address: V4_POOL_MANAGER, fromBlock: `0x${a.toString(16)}`, toBlock: `0x${b.toString(16)}`, topics: [V4_SWAP_TOPIC, id] }])) as any[]
				if (logs.length) lastLog = logs[logs.length - 1]
				a = b + 1
			} catch (e) {
				if (!/exceeds limit|limit of|are allowed|narrow the block range|timed out|timeout/i.test(String(e))) throw e
				if (/timed out|timeout/i.test(String(e))) await sleep(3000)
				span = Math.max(1, Math.floor(span / 2))
			}
		}
		if (lastLog) context.pool_marks[id] = { block: Number(BigInt(lastLog.blockNumber)), tx: lc(lastLog.transactionHash), log_index: Number(BigInt(lastLog.logIndex)), sqrt_price_x96: BigInt(`0x${lastLog.data.slice(2 + 128, 2 + 192)}`).toString() } satisfies PoolMark
	}
	trails.sort(order)
	const ledger = buildLedger(trails, feeds, markBlock, context)
	ledger.rows.forEach((r, i) => {
		if (JSON.stringify(r.book) !== JSON.stringify(trails[i].inputs.book)) throw new Error(`row ${r.n}: the book the decision read is not the book the ledger walk gives`)
	})

	writeWalkGz(REPO, join(out, 'trails.jsonl'), `${trails.map((t) => JSON.stringify(t)).join('\n')}\n`)
	writeFileSync(join(out, 'feeds.json'), `${JSON.stringify(feeds, null, 1)}\n`)
	writeFileSync(join(out, 'context.json'), `${JSON.stringify(context, null, 1)}\n`)
	const allTokens = [...new Set(moves.flatMap((mo) => mo.mv.transfers.map((t) => lc(t.token))))].sort()
	const names = Object.fromEntries(allTokens.filter((t) => chain.names[t]).map((t) => [t, chain.names[t]]))
	writeFileSync(join(out, 'tokens.json'), `${JSON.stringify({ note: 'Every token that moved in the walk, once. The input of the CRE token-check workflow (docs/token-check/results.json). `names`: what name() and symbol() answered on Robinhood Chain for every token that is not a Stock Token, USDG or WETH, as decoded text (empty when the call reverted).', count: allTokens.length, tokens: allTokens, names }, null, 1)}\n`)
	// Save only the chain answers this walk rests on.
	const walked = new Set(moves.map((mo) => `${mo.mv.tx}:${mo.wallet}`))
	const blocks = new Set(moves.map((mo) => String(mo.mv.block)))
	const pick = <T,>(o: Record<string, T>, keep: (k: string) => boolean) => Object.fromEntries(Object.entries(o).filter(([k]) => keep(k)))
	const tokens = new Set(allTokens)
	const venues = new Set(trails.flatMap((t) => t.inputs.venue.map((v) => v.address)))
	writeWalkGz(REPO, chainFile, `${JSON.stringify({ receipts: pick(chain.receipts, (k) => walked.has(k)), blocks: pick(chain.blocks, (k) => blocks.has(k)), decimals: pick(chain.decimals, (k) => tokens.has(k)), venues: pick(chain.venues, (k) => venues.has(k)), names: pick(chain.names, (k) => tokens.has(k)) })}\n`)
	writeFileSync(join(REPO, 'docs/ledger.json'), `${JSON.stringify(ledger, null, 1)}\n`)
	// One write for the whole walk: the CRE workflow recomputes the Merkle root from the leaves and delivers it.
	const anchored = simulate<{ root: string; ledgerTx: string }>(
		'trail-anchor',
		{ ledger: { root: ledger.root, leaves: ledger.rows.map((r) => ({ leaf: r.leaf, tier: r.tier })), mandate_keccak: ledger.mandate.keccak, limits_keccak: ledger.limits_keccak, rules: ledger.rules, mark_block: markBlock } },
		{ broadcast, workDir: join(out, 'cre'), label: 'ledger-root' },
	)
	if (anchored.result.root !== ledger.root) throw new Error(`CRE gave root ${anchored.result.root}, the ledger says ${ledger.root}`)
	const ledgerReceiver = JSON.parse(readFileSync(join(REPO, 'trail-anchor/config.json'), 'utf8')).ledgerReceiverAddress
	writeFileSync(
		join(out, 'anchor.json'),
		`${JSON.stringify({ root: ledger.root, decisions: ledger.totals.decisions, ledger_tx: anchored.tx, receiver: ledgerReceiver, network: anchored.tx ? 'robinhood-testnet (46630)' : 'simulated', written_through: "CRE's simulation forwarder (MockKeystoneForwarder). Not a DON attestation." }, null, 2)}\n`,
	)
	const t = ledger.totals
	say('')
	say(`  CRE       root recomputed from ${ledger.rows.length} leaves${anchored.tx ? `, LedgerAnchored tx ${anchored.tx}` : ' (simulated, not broadcast)'}`)
	say(`  decisions ${t.decisions} about ${t.wallets} wallets (${t.wallets_without_record} without a record, ${t.decisions_without_record} decisions): FULL ${t.full}, REDUCED ${t.reduced}, NONE ${t.none}`)
	say(`  other tokens under a listed ticker: ${t.other_tokens.moves} moves in ${t.other_tokens.tokens} tokens (${t.other_tokens.tickers.join(', ')}): ${t.other_tokens.sent_to_the_wallet} sent to the wallet, ${t.other_tokens.bought_by_the_wallet} bought by it on an official venue, ${t.other_tokens.bought_off_venue} bought by it elsewhere, ${t.other_tokens.received_unpaid} received unpaid, ${t.other_tokens.logged_as_sent_by_the_wallet} logged as sent by it`)
	say(`  copy-guard  opened ${t.copy_guard.opened} (${t.copy_guard.put_in_usd} USD of practice money), closed ${t.copy_guard.closed}, open ${t.copy_guard.open}, result ${t.copy_guard.result_usd} USD; the purchases it followed: median ${t.copy_guard.followed_purchases_usd.median} USD, sum ${t.copy_guard.followed_purchases_usd.sum} USD`)
	say(`  ticker copy opened ${t.blind_copy.opened}: ${t.blind_copy.in_stock_tokens.count} in Stock Tokens (result ${t.blind_copy.in_stock_tokens.result_usd} USD), ${t.blind_copy.in_other_tokens.count} in ${t.blind_copy.in_other_tokens.tokens} other tokens (${t.blind_copy.in_other_tokens.measured} valued at a pool: ${t.blind_copy.in_other_tokens.result_measured_usd ?? 'n/a'} USD, ${t.blind_copy.in_other_tokens.not_measured} not measured)`)
	for (const [g, x] of Object.entries(t.by_group)) say(`  ${g.padEnd(28)} ${x.wallets} wallets, ${x.decisions} decisions: copy-guard opened ${x.opened} (${x.put_in_usd} USD, result ${x.result_usd} USD; at ${x.same_size.size_usd} USD each ${x.same_size.result_usd} USD), followed purchases median ${x.followed_purchases_usd.median} USD${x.top_wallet ? `, ${x.top_wallet.share_pct}% from ${x.top_wallet.wallet}` : ''}`)
	say(`  incoming Stock Tokens: ${Object.entries(t.stock_moves).map(([k, v]) => `${k} ${v}`).join(', ')}`)
	say(`  same size   ${t.same_size.size_usd} USD each: opened by both ${t.same_size.opened_by_both.count} (${t.same_size.opened_by_both.result_usd} USD), by ticker copy only ${t.same_size.opened_by_ticker_copy_only_stock.count} Stock Token positions (${t.same_size.opened_by_ticker_copy_only_stock.result_usd} USD)`)
	say(`  root      ${ledger.root}`)
	say(`  read      ${factsCalls} records from the free route, ${rpc.calls()} RPC calls`)
	say(`  saved     ${relative(REPO, out)}/ and docs/ledger.json`)
	writeFileSync(join(out, 'walk-output.txt'), `${log.join('\n')}\n`)
}

main().catch((e) => {
	console.error(String(e instanceof Error ? e.message : e).slice(0, 600))
	process.exit(1)
})
