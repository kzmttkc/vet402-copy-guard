// copy-guard v2: one decision that ends in a size.
//
//   FULL     the token is real, it was bought on an official venue, a Chainlink feed
//            prices it, and the wallet's record is anchored, complete and in profit
//   REDUCED  the token, the venue and the price hold, but the record is weaker.
//            How much weaker evidence is tolerated is the user's choice (limits.json)
//   NONE     a fake, no price, no official venue, not a buy, no mandate, or evidence
//            that cannot be trusted. Every NONE carries its reasons
//
// The rows:
//   A1 to B2  the eight evidence rules of v1, unchanged in wording
//   M1        a mandate signed by the principal covers the decision
//   C1 to C4  fake, Stock Token, complete history, realized profit (v1 wording)
//   V1        the Stock Token came from an official venue
//   D1        the wallet itself bought: it received the token in a transaction it signed
//   P1        a Chainlink feed gives the price at the block of the move
//   L1, L2    the user's limits leave room
// In v1 a failed A4, C3 or C4 always meant no trade. In v2 the user's limits say whether
// each of them means a smaller position or none. v1's C5 (a price from the record) is
// replaced by P1 (a price from the feed).
//
// agent/rules.ts is not edited: every v1 trail names that file by hash. This file calls
// it for the v1 rows. Pure and deterministic. No clock, no network, no language model:
// the time of the decision, the price and the state of the practice book are inputs.
import { canonicalJson } from '../rwa-verify/verify'
import { cents, type Limits, usd } from './limits'
import { ISO, type MandateRef } from './mandate'
import { type Conclusion, type DecisionInputs, decide, type RuleRow } from './rules'

export const RULES_V2 = { id: 'copy-guard', version: 2 } as const

export type RulesRef = { id: string; version: number; source_keccak: string; limits_rules_keccak: string }
export type Tier = 'FULL' | 'REDUCED' | 'NONE'

/** What a moved token is, in words a person can read. Built from the record and the token's own decimals(). */
export type MovedToken = { token: string; kind: 'stock' | 'usdg' | 'fake' | 'unknown'; ticker: string; name: string; decimals: number }

/** Who the Stock Token came from, and whether that is an official venue. Read from the chain. */
export type Venue = { address: string; kind: 'uniswap-v4-pool-manager' | 'uniswap-v3-pool' | 'other' }

/** The Chainlink feed's last answer at or before the block of the move. Read from the aggregator's AnswerUpdated logs. */
export type Price = { feed: string; aggregator: string; answer: string; decimals: number; round_id: string; updated_at: string; update_block: number; update_tx: string }

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
	venue: Venue[]
	price: Price | null
	limits: Limits
	limits_keccak: string
	mandate: MandateRef
	book: Book
}

export type RuleRowV2 = Omit<RuleRow, 'group'> & {
	group: 'A' | 'B' | 'C' | 'M' | 'V' | 'D' | 'P' | 'L'
	/** What this row did to the size: nothing, made it smaller, or made it none. */
	effect: 'ok' | 'reduced' | 'none'
}

export type Position = {
	side: 'buy'
	tier: 'FULL' | 'REDUCED'
	token: string
	symbol: string
	/** Entry: the feed's answer at the block of the move. */
	price_usd: string
	price_round_id: string
	notional_usd: string
	shares: string
	exit: { when_wallet_sells: boolean; stop_loss_usd: string; take_profit_usd: string; close_by: string; rule: string }
}

export type DecisionV2 = { rule_results: RuleRowV2[]; tier: Tier; conclusion: Conclusion; decisive: string[]; paper_trade: Position | null }

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

/** The Stock Token leg: the first transfer of a token the record classifies as a Stock Token. */
export function stockLegV2(inp: DecisionInputsV2) {
	return inp.movement.transfers.find((t) => inp.tokens_moved.find((m) => m.token === lc(t.token))?.kind === 'stock')
}

/** The feed's answer as a USD price with four decimals, or null. */
export function feedPrice(p: Price | null): string | null {
	if (!p || !/^\d+$/.test(p.answer) || BigInt(p.answer) <= 0n) return null
	return (Number(p.answer) / 10 ** p.decimals).toFixed(4)
}

/** Why the price cannot be used, or '' when it can. */
export function priceGap(inp: DecisionInputsV2): string {
	const p = inp.price
	if (!p || feedPrice(p) === null) return 'no feed value'
	if (p.update_block > inp.movement.block) return 'the feed value is from after the move'
	const ageHours = (Date.parse(inp.move.time) - Date.parse(p.updated_at)) / 3_600_000
	if (!(ageHours <= inp.limits.evidence.max_price_age_hours)) return `the feed value is ${Math.floor(ageHours)} hours old, the limit is ${inp.limits.evidence.max_price_age_hours}`
	return ''
}

/** What is left of the daily limit, in cents. Never below zero. */
export function dayRoomCents(inp: DecisionInputsV2): bigint {
	const left = cents(inp.limits.size.max_usd_per_day) - cents(inp.book.used_usd_today)
	return left > 0n ? left : 0n
}

export function decideV2(inp: DecisionInputsV2): DecisionV2 {
	const ev = inp.limits.evidence
	const v1 = decide(inp).rule_results.filter((r) => r.id !== 'C5')
	// What a failed v1 row does in v2. Rows not listed here make the size none.
	const graded = (r: RuleRow): 'reduced' | 'none' => {
		if (r.id === 'A4' && inp.cre.verdict === 'NO_ANCHOR') return ev.record_not_anchored
		if (r.id === 'C3') return ev.history_partial
		if (r.id === 'C4') return inp.record.realized_usd === null ? ev.wallet_result_unknown : ev.wallet_at_a_loss
		return 'none'
	}
	const rows: RuleRowV2[] = v1.map((r) => ({ ...r, effect: r.ok ? 'ok' : graded(r) }))
	const add = (id: string, group: RuleRowV2['group'], ok: boolean, rule: string, detail: string) => rows.push({ id, group, ok, rule, detail, effect: ok ? 'ok' : 'none' })

	const d = inp.mandate.document
	const gap = mandateGap(inp)
	add(
		'M1',
		'M',
		gap === '',
		'a mandate signed by the principal covers this decision (signer, practice only, these rules, these limits, this payment key, these dates)',
		`principal ${lc(d.principal)} signer ${lc(inp.mandate.signer) || '(none)'} mandate ${lc(inp.mandate.keccak)}${gap ? `: ${gap}` : ''}`,
	)
	const leg = stockLegV2(inp)
	const unofficial = inp.venue.filter((v) => v.kind === 'other')
	add(
		'V1',
		'V',
		Boolean(leg) && inp.venue.length > 0 && unofficial.length === 0,
		'the Stock Token came from an official venue (the Uniswap v4 PoolManager or a pool of the official Uniswap v3 factory)',
		!leg ? 'no Stock Token moved' : inp.venue.length === 0 ? 'no counterparty to judge' : inp.venue.map((v) => `${lc(v.address)} ${v.kind}`).join(', '),
	)
	const own = lc(inp.move.signer) === lc(inp.wallet)
	add(
		'D1',
		'D',
		Boolean(leg) && leg?.direction === 'in' && own,
		'the wallet itself bought: it received the Stock Token in a transaction it signed',
		!leg ? 'no Stock Token moved' : `${leg.direction === 'in' ? 'received' : 'sent'}, signed by ${own ? 'the wallet' : lc(inp.move.signer)}`,
	)
	const pg = leg ? priceGap(inp) : 'no Stock Token moved'
	add(
		'P1',
		'P',
		pg === '',
		"a Chainlink feed gives the token's price at the block of the move",
		pg === '' && inp.price ? `${feedPrice(inp.price)} USD, round ${inp.price.round_id}, updated ${inp.price.updated_at} in block ${inp.price.update_block}` : pg,
	)
	const room = dayRoomCents(inp)
	add(
		'L1',
		'L',
		room > 0n,
		"the user's daily limit leaves room for a practice position",
		`${inp.limits.size.max_usd_per_day} USD per day, ${inp.book.used_usd_today} USD used on ${inp.book.day}, room ${usd(room)} USD`,
	)
	add('L2', 'L', inp.book.open_positions < inp.limits.size.max_open_positions, 'fewer practice positions are open than the user allows', `${inp.book.open_positions} open, limit ${inp.limits.size.max_open_positions}`)

	const none = rows.filter((r) => r.effect === 'none').map((r) => r.id)
	const reduced = rows.filter((r) => r.effect === 'reduced').map((r) => r.id)
	if (none.length) {
		// The three codes the receiver contract knows: evidence that cannot be judged is HOLD, anything else is DO_NOT_COPY.
		const evidence = rows.some((r) => r.effect === 'none' && ['A', 'B', 'M'].includes(r.group))
		return { rule_results: rows, tier: 'NONE', conclusion: evidence ? 'HOLD' : 'DO_NOT_COPY', decisive: none, paper_trade: null }
	}
	const tier = reduced.length ? 'REDUCED' : 'FULL'
	return { rule_results: rows, tier, conclusion: 'COPY', decisive: reduced, paper_trade: position(inp, tier, room) }
}

function position(inp: DecisionInputsV2, tier: 'FULL' | 'REDUCED', room: bigint): Position {
	const leg = stockLegV2(inp) as NonNullable<ReturnType<typeof stockLegV2>>
	const token = inp.tokens_moved.find((m) => m.token === lc(leg.token)) as MovedToken
	const price = Number(feedPrice(inp.price))
	const want = cents(tier === 'FULL' ? inp.limits.size.full_usd : inp.limits.size.reduced_usd)
	const notional = usd(want < room ? want : room)
	const ex = inp.limits.exit
	const stopLoss = (price * (1 - Number(ex.stop_loss_pct) / 100)).toFixed(4)
	const takeProfit = (price * (1 + Number(ex.take_profit_pct) / 100)).toFixed(4)
	const closeBy = new Date(Date.parse(inp.move.time) + ex.max_holding_days * 86_400_000).toISOString()
	return {
		side: 'buy',
		tier,
		token: token.token,
		symbol: token.ticker,
		price_usd: price.toFixed(4),
		price_round_id: (inp.price as Price).round_id,
		notional_usd: notional,
		shares: (Number(notional) / price).toFixed(6),
		exit: {
			when_wallet_sells: ex.when_wallet_sells,
			stop_loss_usd: stopLoss,
			take_profit_usd: takeProfit,
			close_by: closeBy,
			rule: `leave ${ex.when_wallet_sells ? 'when the wallet sells or sends the token, ' : ''}when the feed is at or under ${stopLoss} USD (${ex.stop_loss_pct}% under the entry), at or over ${takeProfit} USD (${ex.take_profit_pct}% over) or on ${closeBy.slice(0, 10)} (${ex.max_holding_days} days), whichever comes first`,
		},
	}
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
