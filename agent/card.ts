// The decision card: what happened, why, and so what, in sentences a person can read.
//
// Every sentence is a fixed template filled from the trail's own inputs and rule rows.
// No language model writes anything, so the same trail always gives the same card, and
// the card is part of the trail whose hash goes onchain. verify.mjs has its own writing
// of these templates and compares.
import { type Arrival, arrival, type DecisionInputsV2, type DecisionV2, mandateGap, type MovedToken, paidFor, priceGap, stockLegV2 } from './rules-v2'
import { type Transfer, USDG } from './rules'

export type Card = {
	headline: string
	/** What the chain shows. */
	happened: string
	/** What a bot that trusts tickers and logs would take it for. */
	blind_view: string
	/** One sentence per reason. */
	why: string[]
	/** What copy-guard did about it. */
	so: string
}

const lc = (s: string | null | undefined) => String(s ?? '').toLowerCase()
export const shortAddr = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`

/** 25000000000000000000 with 18 decimals is "25". At most six decimal places, no trailing zeros. */
export function amount(raw: string, decimals: number): string {
	const base = 10n ** BigInt(decimals)
	const v = BigInt(raw)
	const whole = (v / base).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',')
	const frac = (v % base).toString().padStart(decimals, '0').slice(0, 6).replace(/0+$/, '')
	return frac ? `${whole}.${frac}` : whole
}

type Leg = { t: Transfer; m: MovedToken }

/** The transfer the card talks about: a different token under a listed ticker first, then a Stock Token, then whatever came first. */
export function mainLeg(inp: DecisionInputsV2): Leg | null {
	const legs = inp.movement.transfers.map((t) => ({ t, m: inp.tokens_moved.find((x) => x.token === lc(t.token)) })).filter((l): l is Leg => Boolean(l.m))
	return legs.find((l) => l.m.kind === 'same_ticker') ?? legs.find((l) => l.m.kind === 'stock') ?? legs[0] ?? null
}

/** Everything of the leg's token that moved the same way in this transaction, as a raw amount. */
export function legRaw(inp: DecisionInputsV2, leg: Leg): string {
	return inp.movement.transfers
		.filter((t) => lc(t.token) === lc(leg.t.token) && t.direction === leg.t.direction)
		.reduce((s, t) => s + BigInt(t.amount_raw), 0n)
		.toString()
}

/** What the wallet itself paid in this transaction, in words, or '' when it paid nothing that counts. */
export function paidText(inp: DecisionInputsV2): string {
	const paid = paidFor(inp)
	const parts = paid.tokens.map((p) => `${amount(p.amount_raw, inp.tokens_moved.find((x) => x.token === p.token)?.decimals ?? 18)} ${p.token === USDG ? 'USDG' : 'WETH'}`)
	if (BigInt(paid.eth_wei) > 0n) parts.push(`${amount(paid.eth_wei, 18)} ETH`)
	return parts.join(' and ')
}

/** USDG that came in with a Stock Token the wallet sent, as a display amount, or ''. */
function usdgReceived(inp: DecisionInputsV2): string {
	const sum = inp.movement.transfers.filter((t) => lc(t.token) === USDG && t.direction === 'in').reduce((s, t) => s + BigInt(t.amount_raw), 0n)
	return sum > 0n ? amount(sum.toString(), 6) : ''
}

const VENUE_NAME: Record<string, string> = { 'uniswap-v4-pool-manager': 'the Uniswap v4 PoolManager', 'uniswap-v3-pool': 'an official Uniswap v3 pool' }

/** The official venue that swapped the leg's token out, in words, or '' when none did. */
function swapVenue(inp: DecisionInputsV2, leg: Leg): string {
	const v = (leg.m.kind === 'stock' ? inp.venue : inp.other_venue).find((x) => x.kind !== 'other' && x.swapped)
	return v ? `${VENUE_NAME[v.kind]} (${shortAddr(lc(v.address))})` : ''
}

/** Who the leg's token came from or went to, as the transfer says. */
function counterparty(inp: DecisionInputsV2, leg: Leg): string {
	const other = lc(leg.t.direction === 'in' ? leg.t.from : leg.t.to)
	const v = [...inp.venue, ...inp.other_venue].find((x) => lc(x.address) === other)
	return v && VENUE_NAME[v.kind] ? `${VENUE_NAME[v.kind]} (${shortAddr(other)})` : shortAddr(other)
}

const signedText = (inp: DecisionInputsV2) => (lc(inp.move.signer) === lc(inp.wallet) ? 'The wallet signed the transaction.' : `The wallet did not sign the transaction (${shortAddr(lc(inp.move.signer))} did).`)

/** The other Stock Tokens that left the wallet in a rotation, in words. */
function rotatedOut(inp: DecisionInputsV2, leg: Leg): string {
	const sums = new Map<string, bigint>()
	for (const t of inp.movement.transfers) {
		const m = inp.tokens_moved.find((x) => x.token === lc(t.token))
		if (t.direction === 'out' && m?.kind === 'stock' && m.token !== leg.m.token) sums.set(m.token, (sums.get(m.token) ?? 0n) + BigInt(t.amount_raw))
	}
	return [...sums].map(([token, v]) => `${amount(v.toString(), inp.tokens_moved.find((x) => x.token === token)?.decimals ?? 18)} ${inp.tokens_moved.find((x) => x.token === token)?.ticker}`).join(' and ')
}

/** What the chain shows, from the facts of the transaction alone: what came in, by which way, and what the wallet itself paid. */
function happened(inp: DecisionInputsV2, leg: Leg | null): string {
	if (!leg) return 'The transaction holds no token transfer that names this wallet.'
	const { t, m } = leg
	const amt = amount(legRaw(inp, leg), m.decimals)
	const how = arrival(inp, { token: t.token, direction: t.direction })
	const own = lc(inp.move.signer) === lc(inp.wallet)
	const relayed = own ? 'The wallet signed the transaction.' : `${shortAddr(lc(inp.move.signer))} signed the transaction, and the payment left the wallet itself.`
	let what: string
	let marks = ''
	if (m.kind === 'same_ticker') {
		what = `${amt} tokens with the ticker ${m.ticker}${m.name && m.name !== m.ticker ? ` (named "${m.name}")` : ''}`
		if (`${m.name}${m.ticker}`.includes('⟨U+')) marks = ` The marks ⟨U+…⟩ stand for invisible characters in the name: without them it reads ${m.ticker}.`
	} else if (m.kind === 'stock') what = `${amt} ${m.name ? `${m.ticker} (${m.name})` : m.ticker}`
	else if (m.kind === 'usdg' || m.kind === 'weth') return `The wallet ${t.direction === 'in' ? 'received' : 'sent'} ${amt} ${m.ticker} and no Stock Token moved. ${signedText(inp)}`
	else return `The wallet ${t.direction === 'in' ? 'received' : 'sent'} ${amt} of a token at ${shortAddr(m.token)} that is not a Stock Token, USDG or WETH. ${signedText(inp)}`
	const SENTENCE: Record<Arrival, string> = {
		purchase: `The wallet bought ${what} in a swap on ${swapVenue(inp, leg)} and paid ${paidText(inp)}. ${relayed}`,
		rotation: `The wallet received ${what} and gave ${rotatedOut(inp, leg)} in the same transaction: one Stock Token exchanged for another. ${signedText(inp)}`,
		liquidity: `The wallet received ${what} from ${counterparty(inp, leg)} in a transaction that changes a liquidity position (${inp.move.liquidity.join(', ')}). That is not a purchase. ${signedText(inp)}`,
		swapped_unpaid: `${what.charAt(0).toUpperCase()}${what.slice(1)} came to the wallet out of a swap on ${swapVenue(inp, leg)}, and the wallet itself paid no USDG, WETH or ETH in the transaction. ${signedText(inp)}`,
		received: `${counterparty(inp, leg)} sent this wallet ${what}. No official swap put the token out in the transaction. ${signedText(inp)}`,
		out:
			m.kind === 'stock'
				? `The wallet sent ${what} to ${counterparty(inp, leg)}${usdgReceived(inp) ? ` and received ${usdgReceived(inp)} USDG` : ''}. ${signedText(inp)}`
				: `A token with the ticker ${m.ticker}${m.name && m.name !== m.ticker ? ` (named "${m.name}")` : ''} logged a transfer of ${amt} from this wallet to ${shortAddr(t.to)}. ${signedText(inp)}${own ? '' : ' The wallet never made this payment.'}`,
	}
	return `${SENTENCE[how]}${marks}`
}

function blindView(inp: DecisionInputsV2, leg: Leg | null): string {
	const n = inp.movement.transfers.length
	if (!leg) return 'A bot that copies this wallet sees nothing to copy.'
	const { t, m } = leg
	const amt = amount(legRaw(inp, leg), m.decimals)
	if (m.kind === 'same_ticker') return t.direction === 'in' ? `A bot that goes by the ticker sees ${amt} ${m.ticker} arrive in this wallet.` : `A bot that goes by the log sees this wallet pay ${amt} ${m.ticker} to ${shortAddr(t.to)}.`
	if (m.kind === 'stock') return t.direction === 'in' ? `A bot that copies this wallet sees ${amt} ${m.ticker} arrive.` : `A bot that copies this wallet sees ${amt} ${m.ticker} leave.`
	return `A bot that copies this wallet sees ${n} token transfer${n === 1 ? '' : 's'}.`
}

/** The short reason in the headline of a decision that opens nothing, by the first row that made the size none. */
const NONE_HEADLINE: Record<string, string> = {
	A1: 'payment terms not as published',
	A2: 'record does not match its hash',
	A3: 'record is about another wallet',
	A4: 'record not confirmed against its anchor',
	A5: 'record does not replay',
	A6: 'a same-ticker token still under review',
	B1: 'record older than the move',
	B2: 'a moved token the agent cannot name',
	M1: 'no signed mandate covers it',
	C2: 'no Stock Token moved',
	C3: 'track record incomplete',
	C4: 'wallet not in profit',
	V1: 'no official swap put the token out',
	D1: 'not a purchase by the wallet',
	P1: 'no Chainlink price at the block',
	L1: 'daily limit reached',
	L2: 'position limit reached',
}

const D1_HEADLINE: Record<Arrival, string> = {
	purchase: 'not a purchase by the wallet',
	out: 'a sale or a transfer out, not a purchase',
	liquidity: 'a liquidity operation, not a purchase',
	rotation: 'one Stock Token exchanged for another, not a purchase',
	swapped_unpaid: 'swapped, but not paid for by the wallet',
	received: 'sent to the wallet, not bought by it',
}

/** The headline of a decision that opens nothing: the lead reason, said from the facts of the move. */
function noneHeadline(id: string, inp: DecisionInputsV2): string {
	if (inp.record_fetch.http_status !== 200) return 'vet402 has no record for this wallet'
	const leg = stockLegV2(inp)
	if (id === 'D1' && leg) return D1_HEADLINE[arrival(inp, leg)]
	return NONE_HEADLINE[id] ?? 'a rule failed'
}

/** Which reason leads a card: what the move is comes before what the wallet's record lacks. */
const PRIORITY = ['A2', 'A3', 'A1', 'A5', 'A6', 'B1', 'B2', 'M1', 'D1', 'C2', 'V1', 'P1', 'A4', 'C3', 'C4', 'L1', 'L2']

function reason(id: string, inp: DecisionInputsV2): string[] {
	const r = inp.record
	const leg = stockLegV2(inp)
	switch (id) {
		case 'A1':
			return ['The payment terms offered for the evidence were not the published ones (0.01 USDG on Robinhood Chain, paid to vet402), so the evidence was not trusted.']
		case 'A2':
			if (inp.record_fetch.http_status !== 200) return [`vet402 answered HTTP ${inp.record_fetch.http_status} when asked for this wallet's record, so there is no record to judge the wallet by. copy-guard opens nothing on a wallet it has no record for.`]
			return ['The record did not match the hash that came with it, so it may have been changed on the way.']
		case 'A3':
			return ['The record is about another wallet or another chain.']
		case 'A4':
			if (inp.cre.verdict === 'NO_ANCHOR') return ['vet402 has not anchored a record for this wallet onchain, so the Chainlink CRE workflow had nothing to check its record against.']
			if (inp.cre.verdict === 'MISMATCH') return [`The Chainlink CRE workflow found that the wallet's anchored record does not match its onchain hash (reason bits ${inp.cre.reason_bits}).`]
			return ["The Chainlink CRE workflow did not confirm the wallet's anchored record."]
		case 'A5':
			return ['The record does not replay to the balances it reports.']
		case 'A6':
			return ['A token in this wallet that uses a listed ticker at another address is still counted in its figures or waits for review.']
		case 'B1':
			return [`The record was built at block ${r.as_of_block}, before this move in block ${inp.movement.block}, so it says nothing about it.`]
		case 'B2':
			return [`A moved token is neither a Stock Token of the issuer's list, USDG, WETH nor a token named as using a listed ticker (${inp.tokens_moved.filter((m) => m.kind === 'unknown').map((m) => shortAddr(m.token)).join(', ')}), so the move cannot be judged.`]
		case 'M1':
			return [`No signed mandate covers this decision: ${mandateGap(inp)}.`]
		case 'C1':
			return inp.tokens_moved
				.filter((m) => m.kind === 'same_ticker')
				.map((m) => {
					const real = m.listed_at
					const what = m.ticker === 'USDG' ? 'USDG' : `the Robinhood Stock Token ${m.ticker}`
					const basis = m.by === 'cre' ? `The Chainlink CRE token-check workflow read it from the chain (${(inp.token_check?.tokens[m.token]?.reasons ?? []).join(', ') || 'no reason given'}).` : 'The vet402 record names it.'
					return `This is not ${what}. It is a different token at ${shortAddr(m.token)} with the same ticker, at an address the issuer did not list.${real ? ` ${m.ticker === 'USDG' ? 'USDG' : `The Stock Token ${m.ticker}`} is at ${shortAddr(real)}.` : ''} ${basis} This says what the token is not. It says nothing about who made it or why.`
				})
		case 'C2':
			return ['No Robinhood Stock Token moved, so there is nothing to copy.']
		case 'C3':
			return [`The wallet's history could only be rebuilt in part (status: ${r.r1_status}), so its track record is not fully known.`]
		case 'C4':
			if (r.realized_usd === null) return ['The record gives no realized result for this wallet, so it is not known whether its closed trades made or lost money.']
			if (r.realized_usd.startsWith('-')) return [`The wallet's closed trades add up to a loss of ${r.realized_usd.slice(1)} USD.`]
			return [`The wallet's closed trades add up to ${r.realized_usd} USD, which is not a profit.`]
		case 'V1':
			return ['No official Uniswap venue (the v4 PoolManager or a pool of the official v3 factory) swapped and sent the Stock Token in this transaction.']
		case 'D1': {
			const how = leg ? arrival(inp, leg) : null
			if (how === 'out') return ['The wallet sold or sent the Stock Token. That opens nothing. It closes a practice position copied from this wallet in the same token, if one is open.']
			if (how === 'liquidity') return [`The transaction changes a liquidity position (${inp.move.liquidity.join(', ')}). Adding to a pool, taking from it and collecting from it move tokens in and out of a wallet, and none of them is a purchase.`]
			if (how === 'rotation') return ['Another Stock Token left the wallet in the same transaction. Exchanging one Stock Token for another is a rotation, and copy-guard copies purchases paid in USDG, WETH or ETH only.']
			if (how === 'swapped_unpaid') return ['An official swap put the Stock Token out, but the wallet itself paid no USDG, WETH or ETH in the transaction. Someone else paid, or it was paid in something whose worth is not known, so it is not counted as a purchase.']
			return ['No official swap put the Stock Token out in this transaction. It was sent to the wallet: a transfer, an airdrop or a bridge delivery, not a purchase.']
		}
		case 'P1':
			return [`No Chainlink feed value can be used as the price at the block of the move (${priceGap(inp)}), so a practice position cannot be entered.`]
		case 'L1':
			return [`The limit of ${inp.limits.size.max_usd_per_day} USD per day leaves no room (${inp.book.used_usd_today} USD used on ${inp.book.day}).`]
		case 'L2':
			return [`${inp.book.open_positions} practice positions are open, which is the limit the user set.`]
		default:
			return [`Rule ${id} failed.`]
	}
}

/** Which of the user's limits turned a weaker record into a smaller position, or into none. */
function limitNote(ids: string[], inp: DecisionInputsV2, effect: 'reduced' | 'none'): string[] {
	const graded = ids.filter((id) => (id === 'A4' && inp.cre.verdict === 'NO_ANCHOR') || id === 'C3' || id === 'C4')
	if (!graded.length) return []
	return [effect === 'reduced' ? `The user's limits allow a reduced position on this evidence (${graded.join(', ')}).` : `The user's limits say to open nothing on this evidence (${graded.join(', ')}).`]
}

export function buildCard(inp: DecisionInputsV2, d: DecisionV2): Card {
	const leg = mainLeg(inp)
	const base = { happened: happened(inp, leg), blind_view: blindView(inp, leg) }
	if (d.paper_trade) {
		const p = d.paper_trade
		const full = d.tier === 'FULL'
		return {
			headline: `Practice buy, ${full ? 'full' : 'reduced'} size: ${p.notional_usd} USD of ${p.symbol}`,
			...base,
			why: [
				`${p.symbol} is the Robinhood Stock Token at ${shortAddr(p.token)}, an address in the issuer's list${inp.token_check ? ', confirmed from the chain by the Chainlink CRE token-check workflow' : ''}. No other token with a listed ticker is part of the move. An official Uniswap venue swapped it out, the wallet itself paid, and the transaction holds no liquidity operation.`,
				full
					? `The record matches its hash, the Chainlink CRE workflow confirmed the wallet's anchored record (MATCH), the wallet's full history could be rebuilt and its closed trades add up to a profit of ${inp.record.realized_usd} USD.`
					: 'The record matches its hash, but the evidence about the wallet is weaker:',
				...(full ? [] : [...d.decisive.flatMap((id) => reason(id, inp)), ...limitNote(d.decisive, inp, 'reduced')]),
				`A mandate signed by ${shortAddr(lc(inp.mandate.document.principal))} covers the decision.`,
			],
			so: `So copy-guard opened a practice buy of ${p.notional_usd} USD: ${p.shares} ${p.symbol} at ${p.price_usd} USD, the Chainlink feed's value at the block of the move. It will ${p.exit.rule}. No real trade was placed.`,
		}
	}
	const other = d.decisive.includes('C1')
	const otherTicker = inp.tokens_moved.find((m) => m.kind === 'same_ticker')?.ticker ?? ''
	const noRecord = inp.record_fetch.http_status !== 200
	// The reasons a person needs first. After a same-ticker token, or with no record at all, the rows that fail only as a consequence are counted, not spelled out.
	const rank = (id: string) => (PRIORITY.indexOf(id) + 1 || 99)
	// V1 after D1 says nothing new: without an official swap there is no purchase.
	const lead = other ? ['C1'] : noRecord ? ['A2'] : d.decisive.filter((id) => !(d.decisive.includes('C2') && ['V1', 'D1', 'P1'].includes(id)) && !(id === 'V1' && d.decisive.includes('D1'))).sort((x, y) => rank(x) - rank(y))
	const rest = d.decisive.filter((id) => !lead.includes(id))
	return {
		headline: other ? `No position: not ${otherTicker === 'USDG' ? 'USDG' : `the Stock Token ${otherTicker}`}, a different token with the same ticker` : `No position: ${noneHeadline(lead[0], inp)}`,
		...base,
		why: [...lead.flatMap((id) => reason(id, inp)), ...limitNote(lead, inp, 'none'), ...(rest.length ? [`${rest.length === 1 ? 'Rule' : 'Rules'} ${rest.join(', ')} failed as well. The rule rows show each one.`] : [])],
		so: 'So copy-guard opened no position. No real trade was placed.',
	}
}
