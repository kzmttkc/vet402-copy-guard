// copy-guard v2: one decision that ends in a size.
//
//   FULL     the token is real, it was bought on an official venue, a Chainlink feed
//            prices it, and the wallet's record is anchored, complete and in profit
//   REDUCED  the token, the venue and the price hold, but the record is weaker.
//            How much weaker evidence is tolerated is the user's choice (limits.json)
//   NONE     a different token with the same ticker, no price, no official venue, not a
//            purchase, no mandate, or evidence that cannot be trusted. Every NONE
//            carries its reasons
//
// The rows:
//   A1 to B2  the eight evidence rules of v1, unchanged in wording
//   M1        a mandate signed by the principal covers the decision
//   C1, C2    no moved token is a different token under a listed ticker, and a Stock
//             Token the issuer listed moves. v1 asked the same two questions of the
//             record alone. Here they are asked of the issuer's list, and of the
//             Chainlink CRE token-check workflow's reading of the chain when one is given
//   C3, C4    complete history, realized profit (v1 wording)
//   V1        the Stock Token came from an official venue
//   D1        the wallet itself bought: it received the token in a transaction it signed
//             and in which it paid. A liquidity-pool collect, a fee claim, a bridge
//             delivery and an airdrop are not purchases
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

/**
 * What a moved token is.
 *   stock        a Robinhood Stock Token: its address is in the issuer's list
 *   usdg         USDG, by address
 *   same_ticker  a different token that uses a listed ticker or name (or USDG's) at an address the
 *                issuer did not list. This says what the token is not. It says nothing about who made it or why
 *   unknown      anything else
 * `by` says what the kind rests on: the CRE token-check workflow's reading of the chain, the issuer's
 * list, the token's address, or the vet402 record.
 */
export type MovedToken = {
	token: string
	kind: 'stock' | 'usdg' | 'same_ticker' | 'unknown'
	ticker: string
	name: string
	decimals: number
	by: 'cre' | 'list' | 'address' | 'record' | 'none'
	/** For a same_ticker token: the address the issuer's list gives for that ticker (USDG's address for USDG). Otherwise null. */
	listed_at: string | null
}

/** One token as the Chainlink CRE token-check workflow judged it from the chain (docs/token-check/results.json). */
export type TokenCheckEntry = { issuer_token: boolean; ticker: string | null; reasons: string[] }
/** The token-check results a decision read, named by the keccak256 of the results file. Null when no results file was given. */
export type TokenCheckRef = { source: string; keccak: string; tokens: Record<string, TokenCheckEntry> }

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
	/** When the move happened, who signed its transaction, the ETH it carried, and what it called. All public chain data. */
	move: { time: string; signer: string; value_wei: string; to: string; selector: string }
	/** How the record was fetched. A wallet vet402 could not build a record for stays in the ledger with the HTTP status. */
	record_fetch: { url: string; http_status: number }
	tokens_moved: MovedToken[]
	token_check: TokenCheckRef | null
	/** For a different token under a listed ticker that the wallet bought in a Uniswap v4 pool: the pool and its price in that swap. No rule reads it. The ledger values the ticker-copy position with it. */
	pool_entry: { pool_id: string; token_is_currency0: boolean; sqrt_price_x96: string; log_index: number } | null
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

/** What the wallet paid in this transaction for the token of `leg`: every other token that left it, and the ETH the transaction carried. */
export function paidFor(inp: DecisionInputsV2, legToken: string): { tokens: { token: string; amount_raw: string }[]; eth_wei: string } {
	const sums = new Map<string, bigint>()
	for (const t of inp.movement.transfers) if (t.direction === 'out' && lc(t.token) !== lc(legToken)) sums.set(lc(t.token), (sums.get(lc(t.token)) ?? 0n) + BigInt(t.amount_raw))
	return { tokens: [...sums].filter(([, v]) => v > 0n).map(([token, v]) => ({ token, amount_raw: v.toString() })), eth_wei: /^\d+$/.test(inp.move.value_wei ?? '') ? inp.move.value_wei : '0' }
}

/**
 * How a token came into the wallet, from the facts of the transaction alone:
 *   bought            the wallet signed the transaction and paid in it
 *   received_unpaid   the wallet signed, received, and paid nothing (a pool collect, a claim, a withdrawal)
 *   received_unsigned someone else signed (an airdrop, a transfer, a bridge delivery)
 *   out               the token left the wallet
 */
export type Arrival = 'bought' | 'received_unpaid' | 'received_unsigned' | 'out'
export function arrival(inp: DecisionInputsV2, leg: { token: string; direction: 'in' | 'out' }): Arrival {
	if (leg.direction !== 'in') return 'out'
	if (lc(inp.move.signer) !== lc(inp.wallet)) return 'received_unsigned'
	const paid = paidFor(inp, leg.token)
	return paid.tokens.length > 0 || BigInt(paid.eth_wei) > 0n ? 'bought' : 'received_unpaid'
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
	// C1 and C2 ask v1's two questions of tokens_moved: the issuer's list, and the CRE token-check when one was given.
	const other = inp.tokens_moved.filter((m) => m.kind === 'same_ticker')
	const tc = inp.token_check
	const stockLeg = stockLegV2(inp)
	const stockToken = stockLeg ? inp.tokens_moved.find((m) => m.token === lc(stockLeg.token)) : undefined
	const creSays = stockToken && tc ? tc.tokens[stockToken.token] : undefined
	const c2ok = Boolean(stockLeg) && (!tc || creSays?.issuer_token === true)
	const v2rows: Record<string, { ok: boolean; rule: string; detail: string }> = {
		C1: {
			ok: other.length === 0,
			rule: 'no moved token is a different token that uses a listed ticker or name at an address the issuer did not list',
			detail: other.length ? other.map((m) => `${m.token} uses ${m.ticker} (${m.by})`).join(', ') : 'none',
		},
		C2: {
			ok: c2ok,
			rule: 'the move moves a Robinhood Stock Token: its address is in the issuer\'s list, and the CRE token-check confirms it from the chain when its results are given',
			detail: !stockLeg ? 'no Stock Token moved' : `${lc(stockLeg.token)} ${stockLeg.direction}, ${tc ? (creSays ? `CRE token-check: ${creSays.issuer_token ? 'the issuer\'s token' : `not confirmed (${creSays.reasons.join(' ') || 'no reason given'})`}, results ${lc(tc.keccak)}` : `not in the CRE token-check results ${lc(tc.keccak)}`) : 'in the issuer\'s list (no CRE token-check results given)'}`,
		},
	}
	const rows: RuleRowV2[] = v1.map((r) => {
		const row = v2rows[r.id] ? { ...r, ...v2rows[r.id] } : r
		return { ...row, effect: row.ok ? 'ok' : graded(row) }
	})
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
	const how = leg ? arrival(inp, leg) : null
	const paid = leg ? paidFor(inp, leg.token) : null
	add(
		'D1',
		'D',
		how === 'bought',
		'the wallet itself bought: it received the Stock Token in a transaction it signed and in which it paid (another token left the wallet, or the transaction carried ETH)',
		!leg || !paid
			? 'no Stock Token moved'
			: how === 'out'
				? `sent, signed by ${lc(inp.move.signer) === lc(inp.wallet) ? 'the wallet' : lc(inp.move.signer)}`
				: how === 'received_unsigned'
					? `received, signed by ${lc(inp.move.signer)}, not the wallet`
					: how === 'received_unpaid'
						? `received, signed by the wallet, nothing paid: not a purchase (call ${inp.move.selector || '(none)'} on ${lc(inp.move.to) || '(none)'})`
						: `received, signed by the wallet, paid ${[...paid.tokens.map((p) => `${p.amount_raw} of ${p.token}`), ...(BigInt(paid.eth_wei) > 0n ? [`${paid.eth_wei} wei of ETH`] : [])].join(' and ')}`,
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

/** The issuer's list, as the walk and the agent read it: token address to ticker, name and feed. */
export type IssuerList = Record<string, { symbol: string; name: string; feed: string | null }>

/**
 * What each moved token is. In this order: the CRE token-check's reading of the chain when its
 * results name the token, the issuer's list, USDG's address, the look-alikes the vet402 record
 * names, and otherwise unknown. decimals come from the token contracts.
 */
export function movedTokens(facts: any, transfers: { token: string }[], decimals: Record<string, number>, usdg: string, list: IssuerList, check: TokenCheckRef | null): MovedToken[] {
	const seen = new Set<string>()
	const out: MovedToken[] = []
	for (const t of transfers) {
		const token = lc(t.token)
		if (seen.has(token)) continue
		seen.add(token)
		const named = (facts?.lookalikes ?? []).find((l: any) => lc(l.token) === token)
		const listed = list[token]
		const cre = check?.tokens[token]
		const dec = decimals[token] ?? 18
		const nameOf = String(named?.name_raw ?? '')
		const at = (ticker: string) => (ticker === 'USDG' ? lc(usdg) : (Object.keys(list).find((k) => list[k].symbol === ticker) ?? null))
		if (token === lc(usdg)) out.push({ token, kind: 'usdg', ticker: 'USDG', name: 'Global Dollar', decimals: dec, by: 'address', listed_at: null })
		else if (cre?.issuer_token === true && listed) out.push({ token, kind: 'stock', ticker: listed.symbol, name: listed.name, decimals: dec, by: 'cre', listed_at: null })
		else if (cre && cre.issuer_token === false && cre.ticker) out.push({ token, kind: 'same_ticker', ticker: cre.ticker, name: nameOf, decimals: dec, by: 'cre', listed_at: at(cre.ticker) })
		else if (named) out.push({ token, kind: 'same_ticker', ticker: String(named.imitates), name: nameOf, decimals: dec, by: 'record', listed_at: at(String(named.imitates)) })
		else if (listed && !cre) out.push({ token, kind: 'stock', ticker: listed.symbol, name: listed.name, decimals: dec, by: 'list', listed_at: null })
		else out.push({ token, kind: 'unknown', ticker: '?', name: '', decimals: dec, by: cre ? 'cre' : 'none', listed_at: null })
	}
	return out
}
