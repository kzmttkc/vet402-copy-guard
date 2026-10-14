// copy-guard v2: the 13 rules of v1, unchanged, plus three that tie a decision to a
// person and to that person's limits.
//
//   A, B  can the record be trusted, does it cover the move     a failure gives HOLD
//   M1    a mandate signed by the principal covers the decision a failure gives HOLD
//   C     should the move be copied                             a failure gives DO_NOT_COPY
//   L1    the user's limits leave room for a position           a failure gives DO_NOT_COPY
//   L2    fewer practice positions are open than the user allows   a failure gives DO_NOT_COPY
//
// agent/rules.ts is not edited: every v1 trail names that file by hash, and the hash
// still has to match. This file calls it for rows A1 to C5 and adds M1, L1 and L2.
//
// Pure and deterministic like v1. No clock: the time of the decision and the state of
// the practice book are inputs, written into the trail.
import { canonicalJson } from '../rwa-verify/verify'
import { cents, type Limits, usd } from './limits'
import { ISO, type MandateRef } from './mandate'
import { type Conclusion, type DecisionInputs, decide, paperTrade, type RuleRow } from './rules'

export const RULES_V2 = { id: 'copy-guard', version: 2 } as const

export type RulesRef = { id: string; version: number; source_keccak: string; limits_rules_keccak: string }

/** What a moved token is, in words a person can read. Built from the record and the token's own decimals(). */
export type MovedToken = { token: string; kind: 'stock' | 'usdg' | 'fake' | 'unknown'; ticker: string; name: string; decimals: number }

/** The practice book at the time of the decision: what earlier decisions already used. */
export type Book = { day: string; used_usd_today: string; open_positions: number }

export type DecisionInputsV2 = DecisionInputs & {
	decided_at: string
	/** The key that pays for evidence. The mandate must name it. */
	payer: string
	rules: RulesRef
	/** When the move happened and who signed its transaction. Both are public chain data. */
	move: { time: string; signer: string }
	tokens_moved: MovedToken[]
	limits: Limits
	limits_keccak: string
	mandate: MandateRef
	book: Book
}

export type RuleRowV2 = Omit<RuleRow, 'group'> & { group: 'A' | 'B' | 'C' | 'M' | 'L' }

export type Position = {
	side: 'buy' | 'sell'
	token: string
	symbol: string
	/** Entry price. */
	price_usd: string
	price_basis: string
	/** The record's price at its as_of, used to mark the position later. */
	record_price_usd: string
	notional_usd: string
	shares: string
	exit: { take_profit_usd: string; stop_loss_usd: string; close_by: string; rule: string }
}

export type DecisionV2 = { rule_results: RuleRowV2[]; conclusion: Conclusion; decisive: string[]; paper_trade: Position | null }

const lc = (s: string | null | undefined) => String(s ?? '').toLowerCase()

/** Why the mandate does not cover this decision, or '' when it does. The first reason found, in a fixed order. */
export function mandateGap(inp: DecisionInputsV2): string {
	const m = inp.mandate
	const d = m.document
	if (!m.signature || !m.signer) return 'the mandate is not signed'
	if (lc(m.signer) !== lc(d.principal)) return `the signature is from ${lc(m.signer)}, not from the principal`
	if (d.scope.practice_only !== true || inp.limits.practice_only !== true) return 'the mandate or the limits do not say practice only'
	if (lc(d.limits_keccak) !== lc(inp.limits_keccak)) return 'the mandate names other limits'
	if (canonicalJson(d.rules) !== canonicalJson(inp.rules)) return 'the mandate names other rules'
	if (lc(d.agent.payment_key) !== lc(inp.payer)) return 'the mandate names another payment key'
	if (d.chain_id !== inp.movement.chain_id) return 'the mandate is for another chain'
	if (!ISO.test(inp.decided_at) || !ISO.test(d.valid_from) || !ISO.test(d.valid_until)) return 'a date cannot be read'
	const t = Date.parse(inp.decided_at)
	if (t < Date.parse(d.valid_from) || t > Date.parse(d.valid_until)) return `decided ${inp.decided_at}, outside ${d.valid_from} to ${d.valid_until}`
	return ''
}

/** What the limits leave for one more position today, in cents. Never below zero. */
export function roomCents(inp: DecisionInputsV2): bigint {
	const per = cents(inp.limits.position.max_usd_per_position)
	const left = cents(inp.limits.position.max_usd_per_day) - cents(inp.book.used_usd_today)
	const room = per < left ? per : left
	return room > 0n ? room : 0n
}

/**
 * The wallet's own price in this move: the USDG that went the other way, divided by the
 * Stock Token that moved. Null when the move has no USDG leg to price it with.
 */
export function executionPrice(inp: DecisionInputsV2): string | null {
	const stock = inp.movement.transfers.find((t) => inp.tokens_moved.find((m) => m.token === lc(t.token))?.kind === 'stock')
	if (!stock) return null
	const decimals = inp.tokens_moved.find((m) => m.token === lc(stock.token))?.decimals ?? 18
	const other = stock.direction === 'in' ? 'out' : 'in'
	const sum = (pick: (t: DecisionInputsV2['movement']['transfers'][number]) => boolean) => inp.movement.transfers.filter(pick).reduce((s, t) => s + BigInt(t.amount_raw), 0n)
	const stockRaw = sum((t) => lc(t.token) === lc(stock.token) && t.direction === stock.direction)
	const usdgRaw = sum((t) => inp.tokens_moved.find((m) => m.token === lc(t.token))?.kind === 'usdg' && t.direction === other)
	if (stockRaw <= 0n || usdgRaw <= 0n) return null
	const price = Number(usdgRaw) / 1e6 / (Number(stockRaw) / 10 ** decimals)
	return Number.isFinite(price) && price > 0 ? price.toFixed(4) : null
}

export function position(inp: DecisionInputsV2): Position | null {
	const base = paperTrade(inp)
	const room = roomCents(inp)
	if (!base || room <= 0n) return null
	const own = executionPrice(inp)
	const price = Number(own ?? base.price_usd)
	const tp = Number(inp.limits.exit.take_profit_pct) / 100
	const sl = Number(inp.limits.exit.stop_loss_pct) / 100
	const up = base.side === 'buy' ? 1 : -1
	const notional = usd(room)
	const takeProfit = (price * (1 + up * tp)).toFixed(4)
	const stopLoss = (price * (1 - up * sl)).toFixed(4)
	const closeBy = new Date(Date.parse(inp.move.time) + inp.limits.exit.max_holding_days * 86_400_000).toISOString()
	return {
		side: base.side,
		token: base.token,
		symbol: base.symbol,
		price_usd: price.toFixed(4),
		price_basis: own ? 'the price the wallet got in this move' : "the record's price",
		record_price_usd: base.price_usd,
		notional_usd: notional,
		shares: (Number(notional) / price).toFixed(6),
		exit: {
			take_profit_usd: takeProfit,
			stop_loss_usd: stopLoss,
			close_by: closeBy,
			rule: `close at ${takeProfit} USD (take profit ${inp.limits.exit.take_profit_pct}%), at ${stopLoss} USD (stop loss ${inp.limits.exit.stop_loss_pct}%) or on ${closeBy.slice(0, 10)} (${inp.limits.exit.max_holding_days} days), whichever comes first`,
		},
	}
}

export function decideV2(inp: DecisionInputsV2): DecisionV2 {
	const v1 = decide(inp).rule_results as RuleRowV2[]
	const d = inp.mandate.document
	const gap = mandateGap(inp)
	const m1: RuleRowV2 = {
		id: 'M1',
		group: 'M',
		ok: gap === '',
		rule: 'a mandate signed by the principal covers this decision (signer, practice only, these rules, these limits, this payment key, these dates)',
		detail: `principal ${lc(d.principal)} signer ${lc(inp.mandate.signer) || '(none)'} mandate ${lc(inp.mandate.keccak)}${gap ? `: ${gap}` : ''}`,
	}
	const lim = inp.limits.position
	const room = roomCents(inp)
	const l1: RuleRowV2 = {
		id: 'L1',
		group: 'L',
		ok: room > 0n,
		rule: "the user's limits leave room for a practice position (per position and per day)",
		detail: `limit ${lim.max_usd_per_position} USD per position, ${lim.max_usd_per_day} USD per day, ${inp.book.used_usd_today} USD used on ${inp.book.day}, room ${usd(room)} USD`,
	}
	const l2: RuleRowV2 = {
		id: 'L2',
		group: 'L',
		ok: inp.book.open_positions < lim.max_open_positions,
		rule: 'fewer practice positions are open than the user allows',
		detail: `${inp.book.open_positions} open, limit ${lim.max_open_positions}`,
	}
	const rows: RuleRowV2[] = [...v1.filter((r) => r.group !== 'C'), m1, ...v1.filter((r) => r.group === 'C'), l1, l2]
	const failed = (g: string[]) => rows.filter((x) => g.includes(x.group) && !x.ok).map((x) => x.id)
	const hold = failed(['A', 'B', 'M'])
	if (hold.length) return { rule_results: rows, conclusion: 'HOLD', decisive: hold, paper_trade: null }
	const no = failed(['C', 'L'])
	if (no.length) return { rule_results: rows, conclusion: 'DO_NOT_COPY', decisive: no, paper_trade: null }
	return { rule_results: rows, conclusion: 'COPY', decisive: [], paper_trade: position(inp) }
}

// ---------------------------------------------------------------- inputs built from the record

/** What each moved token is, from the record the rules read. decimals come from the token contracts. */
export function movedTokens(facts: any, transfers: { token: string }[], decimals: Record<string, number>, usdg: string): MovedToken[] {
	const seen = new Set<string>()
	const out: MovedToken[] = []
	for (const t of transfers) {
		const token = lc(t.token)
		if (seen.has(token)) continue
		seen.add(token)
		const fake = (facts.lookalikes ?? []).find((l: any) => lc(l.token) === token)
		const stock = (facts.tokens ?? []).find((k: any) => k.canonical === true && lc(k.token) === token)
		const dec = decimals[token] ?? 18
		if (fake) out.push({ token, kind: 'fake', ticker: String(fake.imitates), name: String(fake.name_raw ?? ''), decimals: dec })
		else if (token === lc(usdg)) out.push({ token, kind: 'usdg', ticker: 'USDG', name: 'Global Dollar', decimals: dec })
		else if (stock) out.push({ token, kind: 'stock', ticker: String(stock.symbol), name: String(stock.name ?? ''), decimals: dec })
		else out.push({ token, kind: 'unknown', ticker: '?', name: '', decimals: dec })
	}
	return out
}
