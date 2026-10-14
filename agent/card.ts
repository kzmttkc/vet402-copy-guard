// The decision card: what happened, why, and so what, in sentences a person can read.
//
// Every sentence is a fixed template filled from the trail's own inputs and rule rows.
// No language model writes anything, so the same trail always gives the same card, and
// the card is part of the trail whose hash goes onchain. verify.mjs has its own writing
// of these templates and compares.
import { mandateGap, type DecisionInputsV2, type DecisionV2, type MovedToken } from './rules-v2'
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

/** The transfer the card talks about: a look-alike first, then a Stock Token, then whatever came first. */
export function mainLeg(inp: DecisionInputsV2): Leg | null {
	const legs = inp.movement.transfers.map((t) => ({ t, m: inp.tokens_moved.find((x) => x.token === lc(t.token)) })).filter((l): l is Leg => Boolean(l.m))
	return legs.find((l) => l.m.kind === 'fake') ?? legs.find((l) => l.m.kind === 'stock') ?? legs[0] ?? null
}

/** Everything of the leg's token that moved the same way in this transaction, as a raw amount. */
export function legRaw(inp: DecisionInputsV2, leg: Leg): string {
	return inp.movement.transfers
		.filter((t) => lc(t.token) === lc(leg.t.token) && t.direction === leg.t.direction)
		.reduce((s, t) => s + BigInt(t.amount_raw), 0n)
		.toString()
}

/** USDG that moved the other way in the same transaction, as a display amount, or '' when none did. */
export function usdgAgainst(inp: DecisionInputsV2, leg: Leg): string {
	const other = leg.t.direction === 'in' ? 'out' : 'in'
	const sum = inp.movement.transfers.filter((t) => lc(t.token) === USDG && t.direction === other).reduce((s, t) => s + BigInt(t.amount_raw), 0n)
	return sum > 0n ? amount(sum.toString(), 6) : ''
}

function signedBy(inp: DecisionInputsV2): { own: boolean; text: string } {
	const own = lc(inp.move.signer) === lc(inp.wallet)
	return { own, text: own ? 'The wallet signed the transaction.' : `The wallet did not sign the transaction (${shortAddr(lc(inp.move.signer))} did).` }
}

function happened(inp: DecisionInputsV2, leg: Leg | null): string {
	if (!leg) return 'The transaction holds no token transfer that names this wallet.'
	const { t, m } = leg
	const amt = amount(legRaw(inp, leg), m.decimals)
	const sig = signedBy(inp)
	if (m.kind === 'fake') {
		const named = m.name && m.name !== m.ticker ? `, under the name "${m.name}"` : ''
		const marks = `${m.name}${m.ticker}`.includes('⟨U+') ? ' The marks ⟨U+…⟩ stand for invisible characters in the name.' : ''
		if (t.direction === 'in') return `${shortAddr(t.from)} sent this wallet ${amt} tokens that a block explorer lists as ${m.ticker}${named}. ${sig.text}${sig.own ? '' : ' It did not buy them.'}${marks}`
		return `A token that a block explorer lists as ${m.ticker}${named} logged a transfer of ${amt} from this wallet to ${shortAddr(t.to)}. ${sig.text}${sig.own ? '' : ' It never made this payment.'}${marks}`
	}
	if (m.kind === 'stock') {
		const against = usdgAgainst(inp, leg)
		const label = m.name ? `${m.ticker} (${m.name})` : m.ticker
		if (t.direction === 'in') return `The wallet received ${amt} ${label}${against ? ` and paid ${against} USDG` : ''}. ${sig.text}`
		return `The wallet sent ${amt} ${label}${against ? ` and received ${against} USDG` : ''}. ${sig.text}`
	}
	if (m.kind === 'usdg') return `The wallet ${t.direction === 'in' ? 'received' : 'sent'} ${amt} USDG and no Stock Token moved. ${sig.text}`
	return `The wallet ${t.direction === 'in' ? 'received' : 'sent'} ${amt} of a token at ${shortAddr(m.token)} that the record does not classify. ${sig.text}`
}

function blindView(inp: DecisionInputsV2, leg: Leg | null): string {
	const n = inp.movement.transfers.length
	if (!leg) return 'A bot that copies this wallet sees nothing to copy.'
	const { t, m } = leg
	const amt = amount(legRaw(inp, leg), m.decimals)
	if (m.kind === 'fake') return t.direction === 'in' ? `A bot that trusts tickers sees this wallet receive ${amt} ${m.ticker}.` : `A bot that trusts logs sees this wallet pay ${amt} ${m.ticker} to ${shortAddr(t.to)}.`
	if (m.kind === 'stock') {
		const against = usdgAgainst(inp, leg)
		if (t.direction === 'in') return against ? `A bot that copies this wallet sees a ${m.ticker} buy for ${against} USDG.` : `A bot that copies this wallet sees ${amt} ${m.ticker} arrive.`
		return against ? `A bot that copies this wallet sees a ${m.ticker} sale for ${against} USDG.` : `A bot that copies this wallet sees ${amt} ${m.ticker} leave.`
	}
	return `A bot that copies this wallet sees ${n} token transfer${n === 1 ? '' : 's'}.`
}

const HOLD_HEADLINE: Record<string, string> = {
	A1: 'payment terms not as published',
	A2: 'record does not match its hash',
	A3: 'record is about another wallet',
	A5: 'record does not replay',
	A6: 'look-alike still under review',
	B1: 'record older than the move',
	B2: 'a moved token is not classified',
	M1: 'no signed mandate covers it',
}
const NO_HEADLINE: Record<string, string> = {
	C2: 'no Stock Token moved',
	C3: 'track record incomplete',
	C4: 'no realized profit',
	C5: 'no price to size a position',
	L1: 'daily limit reached',
	L2: 'position limit reached',
}

function reason(id: string, inp: DecisionInputsV2): string[] {
	const r = inp.record
	switch (id) {
		case 'A1':
			return ['The payment terms offered for the evidence were not the published ones (0.01 USDG on Robinhood Chain, paid to vet402), so the evidence was not trusted.']
		case 'A2':
			return ['The record did not match the hash that came with it, so it may have been changed on the way.']
		case 'A3':
			return ['The record is about another wallet or another chain.']
		case 'A4':
			if (inp.cre.verdict === 'NO_ANCHOR') return ['vet402 has not anchored a record for this wallet onchain, so the Chainlink CRE workflow had nothing to check its records against.']
			if (inp.cre.verdict === 'MISMATCH') return [`The Chainlink CRE workflow found that the wallet's anchored record does not match its onchain hash (reason bits ${inp.cre.reason_bits}).`]
			return ["The Chainlink CRE workflow did not confirm the wallet's anchored record."]
		case 'A5':
			return ['The record does not replay to the balances it reports.']
		case 'A6':
			return ['A look-alike token in this wallet is still counted in its figures or waits for review.']
		case 'B1':
			return [`The record was built at block ${r.as_of_block}, before this move in block ${inp.movement.block}, so it says nothing about it.`]
		case 'B2':
			return ['The record does not say what one of the moved tokens is.']
		case 'M1':
			return [`No signed mandate covers this decision: ${mandateGap(inp)}.`]
		case 'C1':
			return inp.tokens_moved
				.filter((m) => m.kind === 'fake')
				.map((m) => {
					const real = m.ticker === 'USDG' ? USDG : lc(r.tokens.find((k) => k.canonical && k.symbol === m.ticker)?.token)
					return `The token is not ${m.ticker}. It is a look-alike at ${shortAddr(m.token)} that copies the ticker.${real ? ` The real ${m.ticker} is the token at ${shortAddr(real)}.` : ''}`
				})
		case 'C2':
			return ['No real Robinhood Stock Token moved, so there is nothing to copy.']
		case 'C3':
			return [`The wallet's history could not be rebuilt in full (status: ${r.r1_status}), so its track record is unknown.`]
		case 'C4':
			if (r.realized_usd === null) return ['The record gives no realized result for this wallet.']
			if (r.realized_usd.startsWith('-')) return [`The wallet's closed trades add up to a loss of ${r.realized_usd.slice(1)} USD.`]
			return [`The wallet's closed trades add up to ${r.realized_usd} USD, which is not a profit.`]
		case 'C5':
			return ['The record has no USD price for the moved Stock Token, so a practice position cannot be sized.']
		case 'L1':
			return [`The limit of ${inp.limits.position.max_usd_per_day} USD per day leaves no room (${inp.book.used_usd_today} USD used on ${inp.book.day}).`]
		case 'L2':
			return [`${inp.book.open_positions} practice positions are open, which is the limit the user set.`]
		default:
			return [`Rule ${id} failed.`]
	}
}

export function buildCard(inp: DecisionInputsV2, d: DecisionV2): Card {
	const leg = mainLeg(inp)
	const base = { happened: happened(inp, leg), blind_view: blindView(inp, leg) }
	if (d.conclusion === 'COPY' && d.paper_trade) {
		const p = d.paper_trade
		const stock = inp.tokens_moved.find((m) => m.token === p.token)
		return {
			headline: `Practice ${p.side}: ${p.notional_usd} USD of ${p.symbol}`,
			...base,
			why: [
				`The record matches the hash that came with it, and the Chainlink CRE workflow confirmed the wallet's anchored record: MATCH.`,
				`${p.symbol} is the real Robinhood Stock Token at ${shortAddr(stock?.token ?? p.token)}, and no look-alike is part of the move.`,
				`The wallet's full history could be rebuilt, and its closed trades add up to a profit of ${inp.record.realized_usd} USD.`,
				`A mandate signed by ${shortAddr(lc(inp.mandate.document.principal))} covers the decision, and the limits leave room for ${p.notional_usd} USD.`,
			],
			so: `So copy-guard opened a practice ${p.side} of ${p.notional_usd} USD: ${p.shares} ${p.symbol} at ${p.price_usd} USD, ${p.price_basis}. It will ${p.exit.rule}. No real trade was placed.`,
		}
	}
	if (d.conclusion === 'HOLD') {
		const first = d.decisive[0]
		const head = first === 'A4' ? (inp.cre.verdict === 'NO_ANCHOR' ? 'no anchored record to check against' : 'anchored record not confirmed') : (HOLD_HEADLINE[first] ?? 'evidence not good enough')
		return {
			headline: `Held: ${head}`,
			...base,
			why: d.decisive.flatMap((id) => reason(id, inp)),
			so: 'So copy-guard held. The evidence was not good enough to judge the move either way. No practice position was opened and no real trade was placed.',
		}
	}
	const fake = d.decisive.includes('C1')
	const fakeTicker = inp.tokens_moved.find((m) => m.kind === 'fake')?.ticker ?? ''
	const rest = d.decisive.filter((id) => id !== 'C1')
	const why = fake ? [...reason('C1', inp), ...(rest.length ? [`${rest.length === 1 ? 'Rule' : 'Rules'} ${rest.join(', ')} failed as well. The rule rows show each one.`] : [])] : d.decisive.flatMap((id) => reason(id, inp))
	return {
		headline: fake ? `Not copied: fake ${fakeTicker}` : `Not copied: ${NO_HEADLINE[d.decisive[0]] ?? 'a rule failed'}`,
		...base,
		why,
		so: 'So copy-guard did not copy it. No practice position was opened and no real trade was placed.',
	}
}
