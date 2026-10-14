// The practice-trade ledger: a walk through every decision in the order the moves
// happened, with two books side by side.
//
//   copy-guard   opens what its rules, its mandate and the user's limits allow
//   blind copy   opens the full size on every move that looks like a Stock Token
//                arriving. It buys no record and applies no rule or limit
//
// Both books enter at the Chainlink feed's value at the block of the move and leave by
// the same exit rules from limits.json: the copied wallet sells or sends the token, the
// feed crosses the stop loss or the take profit, or the time limit passes. Whatever is
// still open at the end is marked at the feed's last value. A look-alike has no feed and
// gives no claim on the share whose ticker it copies, so the blind book writes it off at
// once.
//
// Pure: trails, feed values and limits in, rows and totals out. verify.mjs has its own
// writing of this walk and compares every row.
//
// Practice only. The ledger compares two policies on past public moves. It is not a
// forecast, not a record of real trading and not advice.
import { canonicalJson, keccakHex, keccakText } from '../rwa-verify/verify'
import { mainLeg } from './card'
import type { FeedSeries, Point } from './facts'
import { cents, type Limits, usd } from './limits'
import { type Book, type DecisionInputsV2, feedPrice, priceGap, stockLegV2, type Tier } from './rules-v2'
import type { TrailV2 } from './trail'

export const BASELINE =
	'Blind copy opens the full size on every move in which something that looks like a Stock Token arrives in the wallet: a real one, or a look-alike that copies a stock ticker. It trusts the ticker and the log. It buys no record, checks no venue or signature, and has no daily or open-position limit. It uses the same entry price and the same exit rules as copy-guard.'
export const NOTE =
	'Practice (paper) trades only. No real trade was placed. The two columns compare two policies on past public moves. This is not a forecast, not a record of real trading and not advice.'

export type Feeds = Record<string, FeedSeries>
export type ExitReason = 'wallet sold' | 'stop loss' | 'take profit' | 'time limit' | 'look-alike, written off'

export type PositionRow = {
	/** The decision that opened it. */
	n: number
	wallet: string
	token: string
	symbol: string
	tier: Tier | 'BLIND'
	fake: boolean
	notional_usd: string
	entry_price_usd: string | null
	opened_block: number
	opened_time: string
	status: 'open' | 'closed'
	exit: null | { reason: ExitReason; block: number; price_usd: string | null; at_decision: number | null }
	mark: null | { block: number; price_usd: string }
	/** Value at the exit or the mark, minus what was put in. */
	result_usd: string
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
	) {}

	private close(p: Live, reason: ExitReason, block: number, price: string | null, atDecision: number | null) {
		p.status = 'closed'
		p.exit = { reason, block, price_usd: price, at_decision: atDecision }
		p.result_usd = p.fake || !price || !p.entry_price_usd ? usd(-cents(p.notional_usd)) : usd(resultCents(p.notional_usd, p.entry_price_usd, price))
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

	open(n: number, inp: DecisionInputsV2, o: { token: string; symbol: string; tier: Tier | 'BLIND'; notional: string; entry: string | null; fake: boolean }) {
		const entry = o.entry === null ? Number.NaN : Number(o.entry)
		const ex = this.limits.exit
		const p: Live = {
			n,
			wallet: lc(inp.wallet),
			token: o.token,
			symbol: o.symbol,
			tier: o.tier,
			fake: o.fake,
			notional_usd: o.notional,
			entry_price_usd: o.entry,
			opened_block: inp.movement.block,
			opened_time: inp.move.time,
			status: 'open',
			exit: null,
			mark: null,
			result_usd: '0.00',
			stop: entry * (1 - Number(ex.stop_loss_pct) / 100),
			take: entry * (1 + Number(ex.take_profit_pct) / 100),
			closeBy: Date.parse(inp.move.time) + ex.max_holding_days * 86_400_000,
			cursor: 0,
		}
		this.positions.push(p)
		if (o.fake) this.close(p, 'look-alike, written off', inp.movement.block, null, n)
	}

	/** Walk to the mark block and value what is still open at the feed's last value. */
	finish(markBlock: number): PositionRow[] {
		this.advance(markBlock)
		for (const p of this.positions) {
			if (p.status !== 'open') continue
			const series = this.feeds[p.token]
			let last: Point | null = null
			for (const pt of series?.points ?? []) {
				if (pt.block > markBlock) break
				last = pt
			}
			if (!series || !last || !p.entry_price_usd) continue
			p.mark = { block: last.block, price_usd: priceOf(series, last) }
			p.result_usd = usd(resultCents(p.notional_usd, p.entry_price_usd, p.mark.price_usd))
		}
		return this.positions.map(({ stop: _s, take: _t, closeBy: _c, cursor: _k, ...row }) => row)
	}
}

/** The wallet sold or sent a Stock Token in a transaction it signed: which token, or null. */
export function saleOf(inp: DecisionInputsV2): string | null {
	const leg = stockLegV2(inp)
	return leg && leg.direction === 'out' && lc(inp.move.signer) === lc(inp.wallet) ? lc(leg.token) : null
}

/** What the blind book opens on this move, or null. */
export function blindEntry(inp: DecisionInputsV2): { token: string; symbol: string; entry: string | null; fake: boolean } | null {
	const leg = mainLeg(inp)
	if (!leg || leg.t.direction !== 'in') return null
	if (leg.m.kind === 'fake') return leg.m.ticker === 'USDG' ? null : { token: leg.m.token, symbol: leg.m.ticker, entry: null, fake: true }
	if (leg.m.kind === 'stock' && priceGap(inp) === '') return { token: leg.m.token, symbol: leg.m.ticker, entry: feedPrice(inp.price), fake: false }
	return null
}

export type LedgerRow = {
	n: number
	wallet: string
	move_tx: string
	move_block: number
	move_time: string
	tier: Tier
	failed: string[]
	/** How many of the rules passed, out of how many, and every rule that did not: the red flags. */
	checks: { passed: number; total: number; flags: string[] }
	card: TrailV2['card']
	book: Book
	copy_guard: { opened: null | { tier: Tier; notional_usd: string; entry_price_usd: string; shares: string }; closed_here: number[] }
	blind_copy: { opened: null | { notional_usd: string; entry_price_usd: string | null; fake: boolean }; closed_here: number[] }
	leaf: string
}

export type Ledger = {
	ledger_version: 2
	note: string
	baseline: string
	decided_at: string
	mark_block: number
	limits: Limits
	limits_keccak: string
	mandate: { keccak: string; principal: string; agent_payment_key: string; signed_by_principal: boolean; valid_from: string; valid_until: string }
	rules: TrailV2['rules']
	root: string
	rows: LedgerRow[]
	copy_guard_positions: PositionRow[]
	blind_copy_positions: PositionRow[]
	totals: {
		decisions: number
		wallets: number
		full: number
		reduced: number
		none: number
		fakes_named: number
		copy_guard: { opened: number; closed: number; open: number; put_in_usd: string; result_usd: string }
		blind_copy: { opened: number; fakes: number; closed: number; open: number; put_in_usd: string; result_usd: string }
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

/** The whole ledger from the trails (in walk order), the feed values and the block everything is marked at. */
export function buildLedger(trails: TrailV2[], feeds: Feeds, markBlock: number): Ledger {
	if (trails.length === 0) throw new Error('no decision to build a ledger from')
	const first = trails[0].inputs
	const limits = first.limits
	const guard = new PracticeBook(feeds, limits)
	const blind = new PracticeBook(feeds, limits)
	const rows: LedgerRow[] = []
	trails.forEach((t, i) => {
		const n = i + 1
		const inp = t.inputs
		const block = inp.movement.block
		guard.advance(block)
		blind.advance(block)
		const sold = saleOf(inp)
		const closedGuard = sold ? guard.walletSold(lc(inp.wallet), sold, block, n) : []
		const closedBlind = sold ? blind.walletSold(lc(inp.wallet), sold, block, n) : []
		const book = guard.state(inp.move.time.slice(0, 10))
		const p = t.decision.paper_trade
		if (p) guard.open(n, inp, { token: p.token, symbol: p.symbol, tier: p.tier, notional: p.notional_usd, entry: p.price_usd, fake: false })
		const b = blindEntry(inp)
		if (b) blind.open(n, inp, { ...b, tier: 'BLIND', notional: limits.size.full_usd })
		rows.push({
			n,
			wallet: lc(inp.wallet),
			move_tx: lc(inp.movement.tx),
			move_block: block,
			move_time: inp.move.time,
			tier: t.decision.tier,
			failed: t.decision.decisive,
			checks: { passed: t.decision.rule_results.filter((r) => r.ok).length, total: t.decision.rule_results.length, flags: t.decision.rule_results.filter((r) => !r.ok).map((r) => r.id) },
			card: t.card,
			book,
			copy_guard: { opened: p ? { tier: p.tier, notional_usd: p.notional_usd, entry_price_usd: p.price_usd, shares: p.shares } : null, closed_here: closedGuard },
			blind_copy: { opened: b ? { notional_usd: limits.size.full_usd, entry_price_usd: b.entry, fake: b.fake } : null, closed_here: closedBlind },
			leaf: leafOf(t),
		})
	})
	const guardPositions = guard.finish(markBlock)
	const blindPositions = blind.finish(markBlock)
	const sum = (ps: PositionRow[], pick: (p: PositionRow) => string) => usd(ps.reduce((s, p) => s + signed(pick(p)), 0n))
	const count = (tier: Tier) => rows.filter((r) => r.tier === tier).length
	const side = (ps: PositionRow[]) => ({
		opened: ps.length,
		closed: ps.filter((p) => p.status === 'closed').length,
		open: ps.filter((p) => p.status === 'open').length,
		put_in_usd: sum(ps, (p) => p.notional_usd),
		result_usd: sum(ps, (p) => p.result_usd),
	})
	const m = first.mandate
	const blindSide = side(blindPositions)
	return {
		ledger_version: 2,
		note: NOTE,
		baseline: BASELINE,
		decided_at: trails[0].decided_at,
		mark_block: markBlock,
		limits,
		limits_keccak: lc(first.limits_keccak),
		mandate: {
			keccak: lc(m.keccak),
			principal: lc(m.document.principal),
			agent_payment_key: lc(m.document.agent.payment_key),
			signed_by_principal: Boolean(m.signer) && lc(m.signer) === lc(m.document.principal),
			valid_from: m.document.valid_from,
			valid_until: m.document.valid_until,
		},
		rules: trails[0].rules,
		root: merkleRoot(rows.map((r) => r.leaf)),
		rows,
		copy_guard_positions: guardPositions,
		blind_copy_positions: blindPositions,
		totals: {
			decisions: rows.length,
			wallets: new Set(rows.map((r) => r.wallet)).size,
			full: count('FULL'),
			reduced: count('REDUCED'),
			none: count('NONE'),
			fakes_named: trails.filter((t) => t.decision.rule_results.some((r) => r.id === 'C1' && !r.ok)).length,
			copy_guard: side(guardPositions),
			blind_copy: { opened: blindSide.opened, fakes: blindPositions.filter((p) => p.fake).length, closed: blindSide.closed, open: blindSide.open, put_in_usd: blindSide.put_in_usd, result_usd: blindSide.result_usd },
		},
	}
}
