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
import { arrival } from './rules-v2'
import type { FeedSeries, Point } from './facts'
import { cents, type Limits, usd } from './limits'
import { type Book, type DecisionInputsV2, feedPrice, priceGap, stockLegV2, type Tier } from './rules-v2'
import type { TrailV2 } from './trail'

export const BASELINE =
	'Ticker copy opens the full size on every purchase of a token with a stock ticker: a Robinhood Stock Token with a usable Chainlink price, or a different token that uses a listed stock ticker. A purchase is the one definition copy-guard and the selection use (an official swap, paid by the wallet in USDG, WETH or ETH, no liquidity operation, no other Stock Token out). It goes by the ticker. It buys no record, does not ask whose token it is, and has no daily or open-position limit. For a Stock Token it uses the same entry price and the same exit rules as copy-guard.'
export const NOTE =
	'Practice (paper) trades only. No real trade was placed. The two columns compare two policies on past public moves. This is not a forecast, not a record of real trading and not advice. A position in a token without a Chainlink feed is valued only from a Uniswap v4 pool the wallet itself bought in, otherwise it is not measured and is left out of every sum.'

export type Feeds = Record<string, FeedSeries>
export type ExitReason = 'wallet sold' | 'stop loss' | 'take profit' | 'time limit'

/** The pool price a same-ticker token was bought at: the Swap log of the Uniswap v4 PoolManager in the move's own transaction. */
export type PoolEntry = { pool_id: string; token_is_currency0: boolean; sqrt_price_x96: string; log_index: number }
/** The last Swap log of a pool at or before the mark block. */
export type PoolMark = { block: number; tx: string; log_index: number; sqrt_price_x96: string }
export type Cohort = 'watched' | 'top_buyers' | 'same_ticker_buyers'
/** What the ledger knows besides the trails: which wallet is in the walk for which reason, the window, and the pool marks. Saved as docs/walk/context.json. */
export type WalkContext = {
	window: { from_block: number; to_block: number; from_time: string; to_time: string }
	/** How the wallets were picked: the addresses asked, the ones selected, the ones vet402 could build no record for, and why the asking stopped. */
	selection: { asked: number; selected: number; stop: string; no_record: { wallet: string; bound_rank: number; bound_usd: string; has_code: boolean; http_status: number; reason: string }[] }
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
	// The same definition of a purchase as rule D1 and the selection: anything else opens nothing in either book.
	if (arrival(inp, { token: leg.t.token, direction: 'in' }) !== 'purchase') return null
	if (leg.m.kind === 'same_ticker') return leg.m.ticker === 'USDG' ? null : { token: leg.m.token, symbol: leg.m.ticker, entry: null, asset: 'same_ticker', pool: inp.pool_entry ?? null }
	if (leg.m.kind === 'stock' && priceGap(inp) === '') return { token: leg.m.token, symbol: leg.m.ticker, entry: feedPrice(inp.price), asset: 'stock', pool: null }
	return null
}

/** The wallet's own move in USD: the Stock Token it received times the feed's value at the block. Null when no Stock Token came in or no price can be used. */
export function moveUsd(inp: DecisionInputsV2): string | null {
	const leg = stockLegV2(inp)
	if (!leg || leg.direction !== 'in' || priceGap(inp) !== '') return null
	const m = inp.tokens_moved.find((x) => x.token === lc(leg.token))
	const raw = inp.movement.transfers.filter((t) => lc(t.token) === lc(leg.token) && t.direction === 'in').reduce((s, t) => s + BigInt(t.amount_raw), 0n)
	return ((Number(raw) / 10 ** (m?.decimals ?? 18)) * Number(feedPrice(inp.price))).toFixed(2)
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
			/** came in by a swap the wallet did not pay for, a liquidity operation or a rotation */
			received_unpaid: number
			by_arrival: Record<Arrival, number>
			logged_as_sent_by_the_wallet: number
			with_invisible_characters: number
			list: { token: string; ticker: string; name: string; moves: number }[]
		}
		copy_guard: { opened: number; closed: number; open: number; put_in_usd: string; result_usd: string; followed_purchases_usd: { count: number; median: string; sum: string; min: string; max: string } }
		blind_copy: { opened: number; closed: number; open: number; in_stock_tokens: Side; in_other_tokens: OtherSide & { tokens: number } }
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
	const how: Record<Arrival, number> = { purchase: 0, rotation: 0, liquidity: 0, swapped_unpaid: 0, received: 0, out: 0 }
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
	const times = rows.map((r) => r.move_time).sort()
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
			stock_moves: (() => {
				const c: Record<Arrival, number> = { purchase: 0, rotation: 0, liquidity: 0, swapped_unpaid: 0, received: 0, out: 0 }
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
			blind_copy: {
				opened: blindPositions.length,
				closed: blindPositions.filter((p) => p.status === 'closed').length,
				open: blindPositions.filter((p) => p.status === 'open').length,
				in_stock_tokens: sideOf(stockBlind),
				in_other_tokens: { ...otherOf(otherBlind), tokens: new Set(otherBlind.map((p) => p.token)).size },
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
