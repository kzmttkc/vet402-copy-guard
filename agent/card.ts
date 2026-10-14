// The decision card: what happened, why, and so what, in sentences a person can read.
//
// Every sentence is a fixed template filled from the trail's own inputs and rule rows.
// No language model writes anything, so the same trail always gives the same card, and
// the card is part of the trail whose hash goes onchain. verify.mjs has its own writing
// of these templates and compares.
import { arrival, type DecisionInputsV2, type DecisionV2, mandateGap, type MovedToken, paidFor, priceGap, stockLegV2 } from './rules-v2'
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

/** What the wallet paid for the leg's token in this transaction, in words, or '' when it paid nothing. */
export function paidText(inp: DecisionInputsV2, leg: Leg): string {
	const paid = paidFor(inp, leg.t.token)
	const parts = paid.tokens.map((p) => {
		const m = inp.tokens_moved.find((x) => x.token === p.token)
		const amt = amount(p.amount_raw, m?.decimals ?? 18)
		if (m?.kind === 'usdg') return `${amt} USDG`
		if (m?.kind === 'stock') return `${amt} ${m.ticker}`
		return `${amt} of the token at ${shortAddr(p.token)}`
	})
	if (BigInt(paid.eth_wei) > 0n) parts.push(`${amount(paid.eth_wei, 18)} ETH`)
	return parts.join(' and ')
}

/** USDG that came in with a Stock Token the wallet sent, as a display amount, or ''. */
function usdgReceived(inp: DecisionInputsV2): string {
	const sum = inp.movement.transfers.filter((t) => lc(t.token) === USDG && t.direction === 'in').reduce((s, t) => s + BigInt(t.amount_raw), 0n)
	return sum > 0n ? amount(sum.toString(), 6) : ''
}

const VENUE_NAME: Record<string, string> = { 'uniswap-v4-pool-manager': 'the Uniswap v4 PoolManager', 'uniswap-v3-pool': 'an official Uniswap v3 pool' }
const V4_POOL_MANAGER = '0x8366a39cc670b4001a1121b8f6a443a643e40951'

/** Who the leg's token came from or went to, in words. */
function counterparty(inp: DecisionInputsV2, leg: Leg): string {
	const other = lc(leg.t.direction === 'in' ? leg.t.from : leg.t.to)
	const v = inp.venue.find((x) => lc(x.address) === other)
	if (v && VENUE_NAME[v.kind]) return `${VENUE_NAME[v.kind]} (${shortAddr(other)})`
	if (other === V4_POOL_MANAGER) return `the Uniswap v4 PoolManager (${shortAddr(other)})`
	return shortAddr(other)
}

const signedText = (inp: DecisionInputsV2) => (lc(inp.move.signer) === lc(inp.wallet) ? 'The wallet signed the transaction.' : `The wallet did not sign the transaction (${shortAddr(lc(inp.move.signer))} did).`)

/** What the chain shows, from the facts of the transaction alone: who signed, what came in, what was paid. */
function happened(inp: DecisionInputsV2, leg: Leg | null): string {
	if (!leg) return 'The transaction holds no token transfer that names this wallet.'
	const { t, m } = leg
	const amt = amount(legRaw(inp, leg), m.decimals)
	const how = arrival(inp, { token: t.token, direction: t.direction })
	const paid = paidText(inp, leg)
	const from = counterparty(inp, leg)
	if (m.kind === 'same_ticker') {
		const named = m.name && m.name !== m.ticker ? ` (named "${m.name}")` : ''
		const what = `${amt} tokens with the ticker ${m.ticker}${named}`
		const marks = `${m.name}${m.ticker}`.includes('⟨U+') ? ` The marks ⟨U+…⟩ stand for invisible characters in the name: without them it reads ${m.ticker}.` : ''
		if (how === 'bought') return `The wallet bought ${what} from ${from} and paid ${paid}. The wallet signed the transaction.${marks}`
		if (how === 'received_unpaid') return `The wallet received ${what} from ${from} in a transaction it signed, and paid nothing in it.${marks}`
		if (how === 'received_unsigned') return `${from} sent this wallet ${what}. ${signedText(inp)} It paid nothing for them.${marks}`
		return `A token with the ticker ${m.ticker}${named} logged a transfer of ${amt} from this wallet to ${shortAddr(t.to)}. ${signedText(inp)}${lc(inp.move.signer) === lc(inp.wallet) ? '' : ' The wallet never made this payment.'}${marks}`
	}
	if (m.kind === 'stock') {
		const label = m.name ? `${m.ticker} (${m.name})` : m.ticker
		if (how === 'bought') return `The wallet bought ${amt} ${label} from ${from} and paid ${paid}. The wallet signed the transaction.`
		if (how === 'received_unpaid') return `The wallet received ${amt} ${label} from ${from} in a transaction it signed, and paid nothing in it. That is not a purchase: a liquidity-pool collect, a fee claim or a withdrawal looks like this.`
		if (how === 'received_unsigned') return `${from} sent this wallet ${amt} ${label}. ${signedText(inp)}`
		const got = usdgReceived(inp)
		return `The wallet sent ${amt} ${label} to ${from}${got ? ` and received ${got} USDG` : ''}. ${signedText(inp)}`
	}
	if (m.kind === 'usdg') return `The wallet ${t.direction === 'in' ? 'received' : 'sent'} ${amt} USDG and no Stock Token moved. ${signedText(inp)}`
	return `The wallet ${t.direction === 'in' ? 'received' : 'sent'} ${amt} of a token at ${shortAddr(m.token)} that is neither a Stock Token nor USDG. ${signedText(inp)}`
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
	B2: 'a moved token is not classified',
	M1: 'no signed mandate covers it',
	C2: 'no Stock Token moved',
	C3: 'track record incomplete',
	C4: 'wallet not in profit',
	V1: 'not bought on an official venue',
	D1: 'not a purchase by the wallet',
	P1: 'no Chainlink price at the block',
	L1: 'daily limit reached',
	L2: 'position limit reached',
}

/** The headline of a decision that opens nothing: the lead reason, said from the facts of the move. */
function noneHeadline(id: string, inp: DecisionInputsV2): string {
	if (inp.record_fetch.http_status !== 200) return 'vet402 has no record for this wallet'
	if (id === 'D1') {
		const leg = stockLegV2(inp)
		const how = leg ? arrival(inp, leg) : null
		if (how === 'out') return 'a sale or a transfer out, not a purchase'
		if (how === 'received_unpaid') return 'received without paying, not a purchase'
		if (how === 'received_unsigned') return 'sent to the wallet, not bought by it'
	}
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
			return ['The record does not say what one of the moved tokens is.']
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
			return [`The Stock Token did not come from an official venue (${inp.venue.filter((v) => v.kind === 'other').map((v) => shortAddr(lc(v.address))).join(', ') || 'no counterparty'} is neither the Uniswap v4 PoolManager nor an official Uniswap v3 pool).`]
		case 'D1': {
			const how = leg ? arrival(inp, leg) : null
			if (how === 'out') return ['The wallet sold or sent the Stock Token. That opens nothing. It closes a practice position copied from this wallet in the same token, if one is open.']
			if (how === 'received_unpaid') return [`The wallet signed the transaction and received the Stock Token, but paid nothing in it (it called ${inp.move.selector || 'no function'} on ${inp.move.to ? shortAddr(lc(inp.move.to)) : 'no contract'}). Collecting from a liquidity pool, claiming a fee and withdrawing look like this. None of them is a purchase.`]
			return ['Someone else signed the transaction that sent the wallet the Stock Token, so this is not a purchase the wallet chose.']
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
				`${p.symbol} is the Robinhood Stock Token at ${shortAddr(p.token)}, an address in the issuer's list${inp.token_check ? ', confirmed from the chain by the Chainlink CRE token-check workflow' : ''}. No other token with a listed ticker is part of the move. The wallet signed the transaction and paid in it, and the token came from an official Uniswap venue.`,
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
	const lead = other ? ['C1'] : noRecord ? ['A2'] : d.decisive.filter((id) => !(d.decisive.includes('C2') && ['V1', 'D1', 'P1'].includes(id))).sort((x, y) => rank(x) - rank(y))
	const rest = d.decisive.filter((id) => !lead.includes(id))
	return {
		headline: other ? `No position: not ${otherTicker === 'USDG' ? 'USDG' : `the Stock Token ${otherTicker}`}, a different token with the same ticker` : `No position: ${noneHeadline(lead[0], inp)}`,
		...base,
		why: [...lead.flatMap((id) => reason(id, inp)), ...limitNote(lead, inp, 'none'), ...(rest.length ? [`${rest.length === 1 ? 'Rule' : 'Rules'} ${rest.join(', ')} failed as well. The rule rows show each one.`] : [])],
		so: 'So copy-guard opened no position. No real trade was placed.',
	}
}
