// The practice-trade ledger: a walk through every decision in the order the moves
// happened, with two books side by side.
//
//   copy-guard   opens what its rules, its mandate and the user's limits allow
//   ticker copy  opens the full size on every move in which a token with a stock ticker
//                arrives in the wallet. It buys no record and applies no rule or limit
//
// Both books enter a Stock Token at the Chainlink feed's value at the block of the move
// and leave by the same exit rules from limits.json: the copied wallet sells or sends the
// token, the feed crosses the stop loss or the take profit, or the time limit passes.
// Whatever is still open at the end is marked at the feed's last value.
//
// A different token under the same ticker has no Chainlink feed. Its position is valued
// only when the wallet bought it in a Uniswap v4 pool: then the entry is that swap's pool
// price and the mark is the pool's last swap at or before the mark block, both read from
// public logs. Anything else is "not measured" and is left out of every sum. Nothing is
// assumed to be worth zero.
//
// The headline of the ledger is counts and names, not money. The money rows are there to
// show that the two books do not differ because of size: a second pass opens every
// position of both books at one size.
//
// Pure: trails, feed values, pool marks and the list of wallets in, rows and totals out.
// verify.mjs has its own writing of this walk and compares every row.
//
// Practice only. The ledger compares two policies on past public moves. It is not a
// forecast, not a record of real trading and not advice.
import { canonicalJson, keccakHex, keccakText } from '../rwa-verify/verify'
import { mainLeg } from './card'
import type { Arrival } from './rules-v2'
import { ARRIVALS, arrival } from './rules-v2'
import type { FeedSeries, Point } from './facts'
import { cents, type Limits, usd } from './limits'
import { type Book, type DecisionInputsV2, feedPrice, LISTED_MARKS, netIn, priceGap, stockLegV2, type Tier } from './rules-v2'
import type { TrailV2 } from './trail'

export const BASELINE =
	'Ticker copy opens the full size on every purchase of a token with a stock ticker: a Robinhood Stock Token with a usable Chainlink price, or a different token that uses a listed stock ticker. A purchase is what the wallet itself paid for in USDG, WETH or ETH, with no liquidity operation and no other Stock Token out, on an official Uniswap venue or outside one: it goes by the ticker and the amount and does not look at the venue. It buys no record, does not ask whose token it is, and has no daily or open-position limit. For a Stock Token it uses the same entry price and the same exit rules as copy-guard.'
export const NOTE =
	'Practice (paper) trades only. No real trade was placed. The two columns compare two policies on past public moves. This is not a forecast, not a record of real trading and not advice. A position in a token without a Chainlink feed is valued only from a Uniswap v4 pool the wallet itself bought in, otherwise it is not measured and is left out of every sum.'

export type Feeds = Record<string, FeedSeries>
export type ExitReason = 'wallet sold' | 'stop loss' | 'take profit' | 'time limit'

/** The pool price a same-ticker token was bought at: the Swap log of the Uniswap v4 PoolManager in the move's own transaction. */
export type PoolEntry = { pool_id: string; token_is_currency0: boolean; sqrt_price_x96: string; log_index: number }
/** The last Swap log of a pool at or before the mark block. */
export type PoolMark = { block: number; time?: string; tx: string; log_index: number; sqrt_price_x96: string }
/** The smallest wallet move counted as a large one in totals.large_incoming, in USD. */
export const LARGE_USD = '100000.00'
type ArrivalCounts = Record<Arrival, number>
type LargeSide = { count: number; by_arrival: ArrivalCounts }
type OtherByToken = {
	token: string
	ticker: string
	name: string
	count: number
	measured: number
	put_in_usd: string
	result_measured_usd: string | null
	/** the same positions at the one size of the second pass */
	same_size: { size_usd: string; count: number; put_in_usd: string; result_measured_usd: string | null }
	/** how the pool price moved between each purchase and the pool's last swap at or before the mark block, in percent with one decimal: the lowest and the highest */
	pool_change_pct: null | { min: string; max: string }
	first_opened_time: string
	/** the pool's last swap the positions are marked at (the first position's pool), and the hours from the first purchase to it */
	pool_mark: null | { block: number; time: string | null; hours_after_first_purchase: string | null }
}
export type Cohort = 'watched' | 'top_buyers' | 'same_ticker_buyers'
/**
 * The three groups the copy-guard book is counted in, one per cohort:
 *   selected                     the wallets the selection picked (cohort top_buyers)
 *   observed_other_token_buyers  the first buyers of one token under a listed ticker (cohort same_ticker_buyers)
 *   demo                         the one watched wallet (cohort watched)
 */
export type Group = 'selected' | 'observed_other_token_buyers' | 'demo'
export const GROUP_OF: Record<Cohort, Group> = { top_buyers: 'selected', same_ticker_buyers: 'observed_other_token_buyers', watched: 'demo' }
export type GroupTotals = {
	cohort: Cohort
	/** wallets in the group, and those with at least one decision */
	wallets: number
	wallets_with_decisions: number
	decisions: number
	/** copy-guard positions opened, and decisions in which copy-guard opened none */
	opened: number
	declined: number
	/** practice money put in and the result, at the sizes copy-guard chose */
	put_in_usd: string
	result_usd: string
	/** the wallets' own purchases those positions followed, at the feed */
	followed_purchases_usd: { count: number; median: string; sum: string; min: string; max: string }
	/** the same positions, each at the one size of the second pass */
	same_size: { size_usd: string; count: number; put_in_usd: string; result_usd: string }
	/** decisions in which the ticker copy opened a position, and those in a different token under a listed ticker */
	ticker_copy_opened: number
	ticker_copy_in_other_tokens: number
	/** wallets with at least one position */
	wallets_opened: number
	/** the wallet with the most positions (ties: the lower address), and its share of the group's positions in percent, one decimal */
	top_wallet: null | { wallet: string; opened: number; share_pct: string }
}
/** What the ledger knows besides the trails: which wallet is in the walk for which reason, the window, and the pool marks. Saved as docs/walk/context.json. */
export type WalkContext = {
	window: { from_block: number; to_block: number; from_time: string; to_time: string }
	/** How the wallets were picked: the addresses asked, the ones selected, the ones vet402 could build no record for, and why the asking stopped. */
	/** `no_record`: every address passed over, in ranking order: a router or another contract (`asked` false, `http_status` null), or an address vet402 could build no record for. */
	selection: { asked: number; selected: number; stop: string; no_record: { wallet: string; bound_rank: number; bound_usd: string; direct_usd?: string; routed_usd?: string; has_code: boolean; asked?: boolean; not_a_wallet?: null | 'router' | 'contract'; http_status: number | null; reason: string }[] }
	/** How a price at a past block was read. */
	price_source: string
	wallets: { wallet: string; cohort: Cohort; rank: number | null; purchases_usd: string | null; record_http: number }[]
	pool_marks: Record<string, PoolMark>
}

export type PositionRow = {
	/** The decision that opened it. */
	n: number
	wallet: string
	token: string
	symbol: string
	tier: Tier | 'BLIND'
	/** A Robinhood Stock Token, or a different token under the same ticker. */
	asset: 'stock' | 'same_ticker'
	/** What the value rests on: the Chainlink feed, a Uniswap v4 pool, or nothing (not measured). */
	valued_by: 'feed' | 'pool' | 'none'
	notional_usd: string
	entry_price_usd: string | null
	pool_entry: PoolEntry | null
	opened_block: number
	opened_time: string
	status: 'open' | 'closed'
	exit: null | { reason: ExitReason; block: number; price_usd: string | null; at_decision: number | null }
	mark: null | { block: number; price_usd: string | null; pool: PoolMark | null }
	/** Value at the exit or the mark, minus what was put in. Null when the position is not measured. */
	result_usd: string | null
}

type Live = PositionRow & { stop: number; take: number; closeBy: number; cursor: number }

const lc = (s: string | null | undefined) => String(s ?? '').toLowerCase()
const priceOf = (series: FeedSeries, p: Point) => (Number(p.answer) / 10 ** series.decimals).toFixed(4)
const resultCents = (notional: string, entry: string, exit: string) => BigInt(Math.round(Number(cents(notional)) * (Number(exit) / Number(entry) - 1)))

/** One book of practice positions, walked forward block by block. */
export class PracticeBook {
	readonly positions: Live[] = []
	constructor(
		private readonly feeds: Feeds,
		private readonly limits: Limits,
		private readonly marks: Record<string, PoolMark> = {},
	) {}

	private close(p: Live, reason: ExitReason, block: number, price: string | null, atDecision: number | null) {
		p.status = 'closed'
		p.exit = { reason, block, price_usd: price, at_decision: atDecision }
		p.result_usd = !price || !p.entry_price_usd ? null : usd(resultCents(p.notional_usd, p.entry_price_usd, price))
	}

	/** Apply stop loss, take profit and the time limit with every feed value up to this block. */
	advance(toBlock: number) {
		for (const p of this.positions) {
			if (p.status !== 'open') continue
			const series = this.feeds[p.token]
			if (!series) continue
			for (; p.cursor < series.points.length && series.points[p.cursor].block <= toBlock; p.cursor++) {
				const pt = series.points[p.cursor]
				if (pt.block <= p.opened_block) continue
				const price = Number(priceOf(series, pt))
				const reason: ExitReason | null = price <= p.stop ? 'stop loss' : price >= p.take ? 'take profit' : Date.parse(pt.updated_at) >= p.closeBy ? 'time limit' : null
				if (reason) {
					this.close(p, reason, pt.block, priceOf(series, pt), null)
					break
				}
			}
		}
	}

	/** The copied wallet sold or sent the token: leave every open position copied from it in that token. */
	walletSold(wallet: string, token: string, block: number, n: number): number[] {
		if (!this.limits.exit.when_wallet_sells) return []
		const closed: number[] = []
		for (const p of this.positions) {
			if (p.status !== 'open' || p.wallet !== wallet || p.token !== token || p.opened_block >= block) continue
			const series = this.feeds[token]
			let last: Point | null = null
			for (const pt of series?.points ?? []) {
				if (pt.block > block) break
				last = pt
			}
			if (!series || !last) continue
			this.close(p, 'wallet sold', block, priceOf(series, last), n)
			closed.push(p.n)
		}
		return closed
	}

	state(day: string): Book {
		const used = this.positions.filter((p) => p.opened_time.slice(0, 10) === day).reduce((s, p) => s + cents(p.notional_usd), 0n)
		return { day, used_usd_today: usd(used), open_positions: this.positions.filter((p) => p.status === 'open').length }
	}

	open(n: number, inp: DecisionInputsV2, o: { token: string; symbol: string; tier: Tier | 'BLIND'; notional: string; entry: string | null; asset: 'stock' | 'same_ticker'; pool: PoolEntry | null }) {
		const entry = o.entry === null ? Number.NaN : Number(o.entry)
		const ex = this.limits.exit
		const p: Live = {
			n,
			wallet: lc(inp.wallet),
			token: o.token,
			symbol: o.symbol,
			tier: o.tier,
			asset: o.asset,
			valued_by: o.asset === 'stock' ? 'feed' : 'none',
			notional_usd: o.notional,
			entry_price_usd: o.entry,
			pool_entry: o.pool,
			opened_block: inp.movement.block,
			opened_time: inp.move.time,
			status: 'open',
			exit: null,
			mark: null,
			result_usd: o.asset === 'stock' ? '0.00' : null,
			stop: entry * (1 - Number(ex.stop_loss_pct) / 100),
			take: entry * (1 + Number(ex.take_profit_pct) / 100),
			closeBy: Date.parse(inp.move.time) + ex.max_holding_days * 86_400_000,
			cursor: 0,
		}
		this.positions.push(p)
	}

	/** Walk to the mark block and value what is still open: a Stock Token at the feed's last value, a same-ticker token at its pool's last swap when there is one. */
	finish(markBlock: number): PositionRow[] {
		this.advance(markBlock)
		for (const p of this.positions) {
			if (p.status !== 'open') continue
			if (p.asset === 'same_ticker') {
				const m = p.pool_entry ? this.marks[p.pool_entry.pool_id] : undefined
				if (!p.pool_entry || !m || m.block > markBlock || m.block < p.opened_block) continue
				p.mark = { block: m.block, price_usd: null, pool: m }
				p.valued_by = 'pool'
				p.result_usd = usd(BigInt(Math.round(Number(cents(p.notional_usd)) * (poolRatio(p.pool_entry, m) - 1))))
				continue
			}
			const series = this.feeds[p.token]
			let last: Point | null = null
			for (const pt of series?.points ?? []) {
				if (pt.block > markBlock) break
				last = pt
			}
			if (!series || !last || !p.entry_price_usd) continue
			p.mark = { block: last.block, price_usd: priceOf(series, last), pool: null }
			p.result_usd = usd(resultCents(p.notional_usd, p.entry_price_usd, p.mark.price_usd as string))
		}
		return this.positions.map(({ stop: _s, take: _t, closeBy: _c, cursor: _k, ...row }) => row)
	}
}

/**
 * How many times its entry price a token is worth at the mark, in the pool's other asset.
 * A v4 pool's sqrtPriceX96 squared is the price of currency0 in currency1.
 */
export function poolRatio(entry: PoolEntry, mark: PoolMark): number {
	const r = Number(BigInt(mark.sqrt_price_x96)) / Number(BigInt(entry.sqrt_price_x96))
	return entry.token_is_currency0 ? r * r : 1 / (r * r)
}

/** The wallet sold or sent a Stock Token in a transaction it signed: which token, or null. */
export function saleOf(inp: DecisionInputsV2): string | null {
	const leg = stockLegV2(inp)
	return leg && leg.direction === 'out' && lc(inp.move.signer) === lc(inp.wallet) ? lc(leg.token) : null
}

/** What the ticker-copy book opens on this move, or null. */
export function blindEntry(inp: DecisionInputsV2): { token: string; symbol: string; entry: string | null; asset: 'stock' | 'same_ticker'; pool: PoolEntry | null } | null {
	const leg = mainLeg(inp)
	if (!leg || leg.t.direction !== 'in') return null
	// A purchase as rule D1 and the selection define it, or the same purchase made outside the official venues: a bot that goes by the ticker does not look at the venue. Anything else opens nothing.
	const how = arrival(inp, { token: leg.t.token, direction: 'in' })
	if (how !== 'purchase' && how !== 'purchase_off_venue') return null
	if (leg.m.kind === 'same_ticker') return leg.m.ticker === 'USDG' ? null : { token: leg.m.token, symbol: leg.m.ticker, entry: null, asset: 'same_ticker', pool: inp.pool_entry ?? null }
	if (leg.m.kind === 'stock' && priceGap(inp) === '') return { token: leg.m.token, symbol: leg.m.ticker, entry: feedPrice(inp.price), asset: 'stock', pool: null }
	return null
}

/**
 * The wallet's own move in USD: the Stock Token it received times the feed's value at the block.
 * Null when no Stock Token came in or no price can be used. Exact: the raw amount times the feed's
 * raw answer, in integers, rounded half up to the cent once at the end. No price is rounded first.
 */
export function moveUsd(inp: DecisionInputsV2): string | null {
	const leg = stockLegV2(inp)
	if (!leg || leg.direction !== 'in' || priceGap(inp) !== '' || !inp.price) return null
	const m = inp.tokens_moved.find((x) => x.token === lc(leg.token))
	const raw = inp.movement.transfers.filter((t) => lc(t.token) === lc(leg.token) && t.direction === 'in').reduce((s, t) => s + BigInt(t.amount_raw), 0n)
	const scale = 10n ** BigInt((m?.decimals ?? 18) + inp.price.decimals)
	return usd((raw * BigInt(inp.price.answer) * 100n * 2n + scale) / (2n * scale))
}

export type LedgerRow = {
	n: number
	wallet: string
	cohort: Cohort
	move_tx: string
	move_block: number
	move_time: string
	tier: Tier
	failed: string[]
	/** How many of the rules passed, out of how many, and every rule that did not: the red flags. */
	checks: { passed: number; total: number; flags: string[] }
	/** The token the card talks about, and how it came into the wallet, from the facts of the transaction. */
	main: null | { token: string; kind: string; ticker: string; arrival: Arrival }
	/** The wallet's own purchase or receipt of a Stock Token, in USD at the feed. */
	move_usd: string | null
	card: TrailV2['card']
	book: Book
	copy_guard: { opened: null | { tier: Tier; notional_usd: string; entry_price_usd: string; shares: string }; closed_here: number[] }
	blind_copy: { opened: null | { notional_usd: string; entry_price_usd: string | null; asset: 'stock' | 'same_ticker' }; closed_here: number[] }
	leaf: string
}

type Side = { count: number; put_in_usd: string; result_usd: string }
type OtherSide = { count: number; put_in_usd: string; measured: number; result_measured_usd: string | null; not_measured: number }

export type Ledger = {
	ledger_version: 3
	note: string
	baseline: string
	decided_at: string
	mark_block: number
	limits: Limits
	limits_keccak: string
	mandate: { keccak: string; title: string; principal: string; agent_payment_key: string; signed_by_principal: boolean; sample: boolean; status: 'signed_by_principal' | 'sample' | 'not_signed'; valid_from: string; valid_until: string }
	rules: TrailV2['rules']
	token_check: null | { source: string; keccak: string }
	context: WalkContext
	root: string
	rows: LedgerRow[]
	copy_guard_positions: PositionRow[]
	blind_copy_positions: PositionRow[]
	totals: {
		decisions: number
		wallets: number
		wallets_by_cohort: Record<Cohort, number>
		/** The main counts for each group of wallets, so that a group chosen for what it shows is never read as a sample. */
		by_cohort: Record<Cohort, { wallets: number; decisions: number; full: number; reduced: number; none: number; other_token_moves: number; copy_guard_opened: number; ticker_copy_opened: number; ticker_copy_in_other_tokens: number }>
		wallets_without_record: number
		decisions_without_record: number
		first_move_time: string
		/** How every incoming Stock Token came, from the transactions: only a purchase can open a position. */
		stock_moves: Record<Arrival, number>
		/** The copy-guard book by group of wallets, so that the selected wallets and the observations are never read as one sample. */
		by_group: Record<Group, GroupTotals>
		last_move_time: string
		full: number
		reduced: number
		none: number
		none_by_reason: { reason: string; count: number }[]
		/** Moves in which a different token under a listed ticker (or USDG's) was part. */
		other_tokens: {
			moves: number
			tokens: number
			tickers: string[]
			sent_to_the_wallet: number
			bought_by_the_wallet: number
			/** bought and paid for by the wallet, but not on an official Uniswap venue */
			bought_off_venue: number
			/** came in by a swap the wallet did not pay for, a liquidity operation or a rotation */
			received_unpaid: number
			by_arrival: Record<Arrival, number>
			logged_as_sent_by_the_wallet: number
			with_invisible_characters: number
			list: { token: string; ticker: string; name: string; moves: number }[]
		}
		copy_guard: { opened: number; closed: number; open: number; put_in_usd: string; result_usd: string; followed_purchases_usd: { count: number; median: string; sum: string; min: string; max: string } }
		/** Incoming Stock Tokens worth threshold_usd or more at the feed, in the selection's window: by who signed, and those that went out again in the same transaction (passed_through) */
		large_incoming: { threshold_usd: string; from_block: number; to_block: number; signed_by_the_wallet: LargeSide; signed_by_another: LargeSide; passed_through: LargeSide }
		/** The decisions inside the selection's window, and how many fall before or after it */
		in_window: { from_block: number; to_block: number; decisions: number; before: number; after: number; stock_moves: ArrivalCounts; copy_guard_opened: number; ticker_copy_opened: number }
		/** What the CRE token-check said about every token the walk met */
		token_check: null | { tokens: number; issuer_tokens: number; not_issuer: number; uses_a_stock_ticker: number; uses_usdg: number; other_assets: number; other_assets_list: { token: string; ticker: string }[] }
		blind_copy: { opened: number; closed: number; open: number; in_stock_tokens: Side; in_other_tokens: OtherSide & { tokens: number; by_token: OtherByToken[] } }
		/** Every position of both books at one size, so size cannot make the difference. */
		same_size: { size_usd: string; opened_by_both: Side; opened_by_ticker_copy_only_stock: Side; opened_by_ticker_copy_only_other: OtherSide }
	}
}

export const leafOf = (trail: TrailV2) => keccakText(canonicalJson(trail))

/** A binary Merkle root over the leaves in order. Pairs are hashed left then right, and an odd last node moves up unchanged. */
export function merkleRoot(leaves: string[]): string {
	if (leaves.length === 0) return keccakText('')
	let level = leaves.map((l) => l.toLowerCase())
	while (level.length > 1) {
		const next: string[] = []
		for (let i = 0; i < level.length; i += 2) next.push(i + 1 < level.length ? keccakHex(`0x${level[i].slice(2)}${level[i + 1].slice(2)}`) : level[i])
		level = next
	}
	return level[0]
}

export const order = (a: TrailV2, b: TrailV2) => a.inputs.movement.block - b.inputs.movement.block || (a.inputs.movement.tx < b.inputs.movement.tx ? -1 : a.inputs.movement.tx > b.inputs.movement.tx ? 1 : lc(a.inputs.wallet) < lc(b.inputs.wallet) ? -1 : 1)

const signed = (s: string) => cents(s.replace('-', '')) * (s.startsWith('-') ? -1n : 1n)
const sumUsd = (xs: (string | null)[]) => usd(xs.reduce((s, x) => s + (x === null ? 0n : signed(x)), 0n))
const sideOf = (ps: PositionRow[]): Side => ({ count: ps.length, put_in_usd: sumUsd(ps.map((p) => p.notional_usd)), result_usd: sumUsd(ps.map((p) => p.result_usd)) })
const otherOf = (ps: PositionRow[]): OtherSide => {
	const measured = ps.filter((p) => p.result_usd !== null)
	return { count: ps.length, put_in_usd: sumUsd(ps.map((p) => p.notional_usd)), measured: measured.length, result_measured_usd: measured.length ? sumUsd(measured.map((p) => p.result_usd)) : null, not_measured: ps.length - measured.length }
}
/** a / b with one decimal, rounded half up. a is already times 1000 for a percentage. */
const tenths = (a: bigint, b: bigint) => {
	const t = (a + b / 2n) / b
	return `${t / 10n}.${t % 10n}`
}
/** The middle value of amounts in USD, in cents. With an even count, the mean of the two middle values, rounded down. */
export function medianUsd(xs: string[]): string {
	if (!xs.length) return '0.00'
	const c = xs.map((x) => cents(x)).sort((a, b) => (a < b ? -1 : a > b ? 1 : 0))
	const mid = c.length >> 1
	return usd(c.length % 2 ? c[mid] : (c[mid - 1] + c[mid]) / 2n)
}

/** The whole ledger from the trails (in walk order), the feed values, the walk's context and the block everything is marked at. */
export function buildLedger(trails: TrailV2[], feeds: Feeds, markBlock: number, context: WalkContext): Ledger {
	if (trails.length === 0) throw new Error('no decision to build a ledger from')
	const first = trails[0].inputs
	const limits = first.limits
	const same = limits.size.reduced_usd
	const guard = new PracticeBook(feeds, limits)
	const blind = new PracticeBook(feeds, limits, context.pool_marks)
	const blindSame = new PracticeBook(feeds, limits, context.pool_marks)
	const cohortOf = new Map(context.wallets.map((w) => [lc(w.wallet), w.cohort]))
	const rows: LedgerRow[] = []
	trails.forEach((t, i) => {
		const n = i + 1
		const inp = t.inputs
		const block = inp.movement.block
		for (const b of [guard, blind, blindSame]) b.advance(block)
		const sold = saleOf(inp)
		const closedGuard = sold ? guard.walletSold(lc(inp.wallet), sold, block, n) : []
		const closedBlind = sold ? blind.walletSold(lc(inp.wallet), sold, block, n) : []
		if (sold) blindSame.walletSold(lc(inp.wallet), sold, block, n)
		const book = guard.state(inp.move.time.slice(0, 10))
		const p = t.decision.paper_trade
		if (p) guard.open(n, inp, { token: p.token, symbol: p.symbol, tier: p.tier, notional: p.notional_usd, entry: p.price_usd, asset: 'stock', pool: null })
		const b = blindEntry(inp)
		if (b) {
			blind.open(n, inp, { ...b, tier: 'BLIND', notional: limits.size.full_usd })
			blindSame.open(n, inp, { ...b, tier: 'BLIND', notional: same })
		}
		const cohort = cohortOf.get(lc(inp.wallet))
		if (!cohort) throw new Error(`decision ${n}: wallet ${lc(inp.wallet)} is not in the walk's context`)
		const leg = mainLeg(inp)
		rows.push({
			n,
			wallet: lc(inp.wallet),
			cohort,
			move_tx: lc(inp.movement.tx),
			move_block: block,
			move_time: inp.move.time,
			tier: t.decision.tier,
			failed: t.decision.decisive,
			checks: { passed: t.decision.rule_results.filter((r) => r.ok).length, total: t.decision.rule_results.length, flags: t.decision.rule_results.filter((r) => !r.ok).map((r) => r.id) },
			main: leg ? { token: leg.m.token, kind: leg.m.kind, ticker: leg.m.ticker, arrival: arrival(inp, { token: leg.t.token, direction: leg.t.direction }) } : null,
			move_usd: moveUsd(inp),
			card: t.card,
			book,
			copy_guard: { opened: p ? { tier: p.tier, notional_usd: p.notional_usd, entry_price_usd: p.price_usd, shares: p.shares } : null, closed_here: closedGuard },
			blind_copy: { opened: b ? { notional_usd: limits.size.full_usd, entry_price_usd: b.entry, asset: b.asset } : null, closed_here: closedBlind },
			leaf: leafOf(t),
		})
	})
	const guardPositions = guard.finish(markBlock)
	const blindPositions = blind.finish(markBlock)
	const samePositions = blindSame.finish(markBlock)
	const count = (tier: Tier) => rows.filter((r) => r.tier === tier).length
	const m = first.mandate
	const signedByPrincipal = Boolean(m.signer) && lc(m.signer) === lc(m.document.principal)
	const sample = /^SAMPLE\b/.test(m.document.title)
	const reasons = new Map<string, number>()
	for (const r of rows) if (r.tier === 'NONE') reasons.set(r.card.headline.replace('No position: ', ''), (reasons.get(r.card.headline.replace('No position: ', '')) ?? 0) + 1)
	// Different tokens under a listed ticker: one entry per token, and how each move came about.
	const others = new Map<string, { token: string; ticker: string; name: string; moves: number }>()
	const how = Object.fromEntries(ARRIVALS.map((a) => [a, 0])) as Record<Arrival, number>
	let hidden = 0
	let otherMoves = 0
	trails.forEach((t) => {
		const part = t.inputs.tokens_moved.filter((x) => x.kind === 'same_ticker')
		if (!part.length) return
		otherMoves++
		for (const x of part) {
			const e = others.get(x.token) ?? { token: x.token, ticker: x.ticker, name: x.name, moves: 0 }
			e.moves++
			others.set(x.token, e)
		}
		const leg = mainLeg(t.inputs)
		if (leg) how[arrival(t.inputs, { token: leg.t.token, direction: leg.t.direction })]++
		if (part.some((x) => `${x.name}${x.ticker}`.includes('⟨U+'))) hidden++
	})
	const opened = new Set(guardPositions.map((p) => p.n))
	const followed = rows.filter((r) => r.copy_guard.opened && r.move_usd !== null).map((r) => r.move_usd as string)
	const fc = followed.map((x) => cents(x)).sort((a, b) => (a < b ? -1 : a > b ? 1 : 0))
	const noRecord = context.wallets.filter((w) => w.record_http !== 200).map((w) => lc(w.wallet))
	const stockBlind = blindPositions.filter((p) => p.asset === 'stock')
	const otherBlind = blindPositions.filter((p) => p.asset === 'same_ticker')
	const zero = (): ArrivalCounts => Object.fromEntries(ARRIVALS.map((a) => [a, 0])) as ArrivalCounts
	const inWin = (r: LedgerRow) => r.move_block >= context.window.from_block && r.move_block <= context.window.to_block
	// Incoming Stock Tokens worth LARGE_USD or more at the feed, in the selection's window only: signed by the wallet itself, signed by another address, and those that left the wallet again in the same transaction.
	const largeIncoming = () => {
		const side = (): LargeSide => ({ count: 0, by_arrival: zero() })
		const out = { threshold_usd: LARGE_USD, from_block: context.window.from_block, to_block: context.window.to_block, signed_by_the_wallet: side(), signed_by_another: side(), passed_through: side() }
		for (const r of rows) {
			const inp = trails[r.n - 1].inputs
			const leg = stockLegV2(inp)
			if (!inWin(r) || !leg || leg.direction !== 'in' || r.move_usd === null || cents(r.move_usd) < cents(LARGE_USD)) continue
			const how = arrival(inp, leg)
			const s = netIn(inp, leg.token) <= 0n ? out.passed_through : lc(inp.move.signer) === lc(inp.wallet) ? out.signed_by_the_wallet : out.signed_by_another
			s.count++
			s.by_arrival[how]++
		}
		return out
	}
	const inWindow = () => {
		const stock = zero()
		for (const r of rows.filter(inWin)) {
			const leg = stockLegV2(trails[r.n - 1].inputs)
			if (leg) stock[arrival(trails[r.n - 1].inputs, leg)]++
		}
		const win = rows.filter(inWin)
		return { from_block: context.window.from_block, to_block: context.window.to_block, decisions: win.length, before: rows.filter((r) => r.move_block < context.window.from_block).length, after: rows.filter((r) => r.move_block > context.window.to_block).length, stock_moves: stock, copy_guard_opened: win.filter((r) => r.copy_guard.opened).length, ticker_copy_opened: win.filter((r) => r.blind_copy.opened).length }
	}
	// What the CRE token-check said about every token the walk met: the issuer's, or not, and if not, what it claims to be.
	const tokenCheckSummary = () => {
		if (!first.token_check) return null
		const seen = new Map<string, { issuer_token: boolean; ticker: string | null; reasons: string[] }>()
		for (const t of trails) for (const [k, v] of Object.entries(t.inputs.token_check?.tokens ?? {})) seen.set(lc(k), v)
		const all = [...seen].sort((a, b) => (a[0] < b[0] ? -1 : 1))
		const usdg = all.filter(([, v]) => !v.issuer_token && v.reasons.includes('TICKER_OR_NAME_READS_AS_USDG'))
		const stockTicker = all.filter(([, v]) => !v.issuer_token && !v.reasons.includes('TICKER_OR_NAME_READS_AS_USDG') && v.reasons.some((x) => LISTED_MARKS.includes(x)))
		const other = all.filter(([, v]) => !v.issuer_token && !v.reasons.some((x) => LISTED_MARKS.includes(x)))
		return { tokens: all.length, issuer_tokens: all.filter(([, v]) => v.issuer_token).length, not_issuer: all.length - all.filter(([, v]) => v.issuer_token).length, uses_a_stock_ticker: stockTicker.length, uses_usdg: usdg.length, other_assets: other.length, other_assets_list: other.map(([token, v]) => ({ token, ticker: v.ticker ?? '' })) }
	}
	// The ticker copy's positions in other tokens, one entry per token: what was put in, the measured result, and how the pool price moved.
	const otherByToken = (): OtherByToken[] => {
		const tokens = [...new Set(otherBlind.map((p) => p.token))].sort()
		return tokens.map((token) => {
			const ps = otherBlind.filter((p) => p.token === token)
			const one = samePositions.filter((p) => p.token === token && p.asset === 'same_ticker')
			const m = ps.filter((p) => p.result_usd !== null)
			const m1 = one.filter((p) => p.result_usd !== null)
			const moves = ps.filter((p) => p.pool_entry && p.mark?.pool).map((p) => (poolRatio(p.pool_entry as PoolEntry, p.mark?.pool as PoolMark) - 1) * 100)
			const firstP = [...ps].sort((a, b) => a.opened_block - b.opened_block || a.n - b.n)[0]
			const mk = firstP.mark?.pool ?? null
			const entryInfo = others.get(token)
			return {
				token,
				ticker: firstP.symbol,
				name: entryInfo?.name ?? '',
				count: ps.length,
				measured: m.length,
				put_in_usd: sumUsd(ps.map((p) => p.notional_usd)),
				result_measured_usd: m.length ? sumUsd(m.map((p) => p.result_usd)) : null,
				same_size: { size_usd: limits.size.reduced_usd, count: one.length, put_in_usd: sumUsd(one.map((p) => p.notional_usd)), result_measured_usd: m1.length ? sumUsd(m1.map((p) => p.result_usd)) : null },
				pool_change_pct: moves.length ? { min: Math.min(...moves).toFixed(1), max: Math.max(...moves).toFixed(1) } : null,
				first_opened_time: firstP.opened_time,
				pool_mark: mk ? { block: mk.block, time: mk.time ?? null, hours_after_first_purchase: mk.time ? ((Date.parse(mk.time) - Date.parse(firstP.opened_time)) / 3_600_000).toFixed(1) : null } : null,
			}
		})
	}
	const times = rows.map((r) => r.move_time).sort()
	const groupTotals = (g: Group): GroupTotals => {
		const cohort = (Object.keys(GROUP_OF) as Cohort[]).find((c) => GROUP_OF[c] === g) as Cohort
		const rs = rows.filter((r) => r.cohort === cohort)
		const mine = new Set(rs.map((r) => r.n))
		const ps = guardPositions.filter((p) => mine.has(p.n))
		const fol = rs.filter((r) => r.copy_guard.opened && r.move_usd !== null).map((r) => r.move_usd as string)
		const sorted = fol.map((x) => cents(x)).sort((a, b) => (a < b ? -1 : a > b ? 1 : 0))
		const same = samePositions.filter((p) => mine.has(p.n) && opened.has(p.n))
		const per = new Map<string, number>()
		for (const p of ps) per.set(p.wallet, (per.get(p.wallet) ?? 0) + 1)
		const top = [...per].sort((x, y) => y[1] - x[1] || (x[0] < y[0] ? -1 : 1))[0]
		return {
			cohort,
			wallets: context.wallets.filter((w) => w.cohort === cohort).length,
			wallets_with_decisions: new Set(rs.map((r) => r.wallet)).size,
			decisions: rs.length,
			opened: ps.length,
			declined: rs.length - ps.length,
			put_in_usd: sumUsd(ps.map((p) => p.notional_usd)),
			result_usd: sumUsd(ps.map((p) => p.result_usd)),
			followed_purchases_usd: { count: fol.length, median: medianUsd(fol), sum: sumUsd(fol), min: sorted.length ? usd(sorted[0]) : '0.00', max: sorted.length ? usd(sorted[sorted.length - 1]) : '0.00' },
			same_size: { size_usd: same.length ? same[0].notional_usd : limits.size.reduced_usd, count: same.length, put_in_usd: sumUsd(same.map((p) => p.notional_usd)), result_usd: sumUsd(same.map((p) => p.result_usd)) },
			ticker_copy_opened: rs.filter((r) => r.blind_copy.opened).length,
			ticker_copy_in_other_tokens: rs.filter((r) => r.blind_copy.opened?.asset === 'same_ticker').length,
			wallets_opened: per.size,
			top_wallet: top ? { wallet: top[0], opened: top[1], share_pct: tenths(BigInt(top[1]) * 1000n, BigInt(ps.length)) } : null,
		}
	}
	const cohortTotals = (c: Cohort) => {
		const rs = rows.filter((r) => r.cohort === c)
		return {
			wallets: context.wallets.filter((w) => w.cohort === c).length,
			decisions: rs.length,
			full: rs.filter((r) => r.tier === 'FULL').length,
			reduced: rs.filter((r) => r.tier === 'REDUCED').length,
			none: rs.filter((r) => r.tier === 'NONE').length,
			other_token_moves: rs.filter((r) => trails[r.n - 1].inputs.tokens_moved.some((x) => x.kind === 'same_ticker')).length,
			copy_guard_opened: rs.filter((r) => r.copy_guard.opened).length,
			ticker_copy_opened: rs.filter((r) => r.blind_copy.opened).length,
			ticker_copy_in_other_tokens: rs.filter((r) => r.blind_copy.opened?.asset === 'same_ticker').length,
		}
	}
	return {
		ledger_version: 3,
		note: NOTE,
		baseline: BASELINE,
		decided_at: trails[0].decided_at,
		mark_block: markBlock,
		limits,
		limits_keccak: lc(first.limits_keccak),
		mandate: {
			keccak: lc(m.keccak),
			title: m.document.title,
			principal: lc(m.document.principal),
			agent_payment_key: lc(m.document.agent.payment_key),
			signed_by_principal: signedByPrincipal,
			sample,
			status: !signedByPrincipal ? 'not_signed' : sample ? 'sample' : 'signed_by_principal',
			valid_from: m.document.valid_from,
			valid_until: m.document.valid_until,
		},
		rules: trails[0].rules,
		token_check: first.token_check ? { source: first.token_check.source, keccak: lc(first.token_check.keccak) } : null,
		context,
		root: merkleRoot(rows.map((r) => r.leaf)),
		rows,
		copy_guard_positions: guardPositions,
		blind_copy_positions: blindPositions,
		totals: {
			decisions: rows.length,
			wallets: new Set(rows.map((r) => r.wallet)).size,
			wallets_by_cohort: { watched: context.wallets.filter((w) => w.cohort === 'watched').length, top_buyers: context.wallets.filter((w) => w.cohort === 'top_buyers').length, same_ticker_buyers: context.wallets.filter((w) => w.cohort === 'same_ticker_buyers').length },
			by_cohort: { watched: cohortTotals('watched'), top_buyers: cohortTotals('top_buyers'), same_ticker_buyers: cohortTotals('same_ticker_buyers') },
			wallets_without_record: noRecord.length,
			decisions_without_record: rows.filter((r) => noRecord.includes(r.wallet)).length,
			first_move_time: times[0],
			by_group: { selected: groupTotals('selected'), observed_other_token_buyers: groupTotals('observed_other_token_buyers'), demo: groupTotals('demo') },
			stock_moves: (() => {
				const c = Object.fromEntries(ARRIVALS.map((a) => [a, 0])) as Record<Arrival, number>
				for (const t of trails) {
					const leg = stockLegV2(t.inputs)
					if (leg) c[arrival(t.inputs, leg)]++
				}
				return c
			})(),
			last_move_time: times[times.length - 1],
			full: count('FULL'),
			reduced: count('REDUCED'),
			none: count('NONE'),
			none_by_reason: [...reasons].map(([reason, n]) => ({ reason, count: n })).sort((x, y) => y.count - x.count || (x.reason < y.reason ? -1 : 1)),
			other_tokens: {
				moves: otherMoves,
				tokens: others.size,
				tickers: [...new Set([...others.values()].map((o) => o.ticker))].sort(),
				sent_to_the_wallet: how.received,
				bought_by_the_wallet: how.purchase,
				bought_off_venue: how.purchase_off_venue,
				received_unpaid: how.swapped_unpaid + how.liquidity + how.rotation,
				by_arrival: how,
				logged_as_sent_by_the_wallet: how.out,
				with_invisible_characters: hidden,
				list: [...others.values()].sort((x, y) => y.moves - x.moves || (x.token < y.token ? -1 : 1)),
			},
			copy_guard: {
				opened: guardPositions.length,
				closed: guardPositions.filter((p) => p.status === 'closed').length,
				open: guardPositions.filter((p) => p.status === 'open').length,
				put_in_usd: sumUsd(guardPositions.map((p) => p.notional_usd)),
				result_usd: sumUsd(guardPositions.map((p) => p.result_usd)),
				followed_purchases_usd: { count: followed.length, median: medianUsd(followed), sum: sumUsd(followed), min: fc.length ? usd(fc[0]) : '0.00', max: fc.length ? usd(fc[fc.length - 1]) : '0.00' },
			},
			large_incoming: largeIncoming(),
			in_window: inWindow(),
			token_check: tokenCheckSummary(),
			blind_copy: {
				opened: blindPositions.length,
				closed: blindPositions.filter((p) => p.status === 'closed').length,
				open: blindPositions.filter((p) => p.status === 'open').length,
				in_stock_tokens: sideOf(stockBlind),
				in_other_tokens: { ...otherOf(otherBlind), tokens: new Set(otherBlind.map((p) => p.token)).size, by_token: otherByToken() },
			},
			same_size: {
				size_usd: same,
				opened_by_both: sideOf(samePositions.filter((p) => opened.has(p.n))),
				opened_by_ticker_copy_only_stock: sideOf(samePositions.filter((p) => !opened.has(p.n) && p.asset === 'stock')),
				opened_by_ticker_copy_only_other: otherOf(samePositions.filter((p) => p.asset === 'same_ticker')),
			},
		},
	}
}
