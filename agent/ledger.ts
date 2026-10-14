// The practice-trade ledger: one row per decision, with two columns side by side.
//
//   copy-guard   what the agent did under its rules, its mandate and the user's limits
//   blind copy   what a bot does that mirrors the same move with no record and no rules
//
// Both columns use the same size (the user's per-position limit), the same entry price
// (the price the wallet got in the move when the chain shows one, otherwise the record's
// price) and the same mark (the record's price at its as_of). A look-alike token is marked
// at zero: it has no Chainlink feed, gives no claim on the share whose ticker it copies,
// and the record leaves it out of every figure.
//
// Pure. Every number comes from the trail, and the trail's hash is onchain. verify.mjs
// has its own writing of this file and compares row by row.
//
// The ledger compares two policies on past public moves. It is not a forecast, not a
// track record of real trades and not advice.
import { mainLeg } from './card'
import { cents, usd } from './limits'
import { paperTrade } from './rules'
import { executionPrice } from './rules-v2'
import type { TrailV2 } from './trail'

export const BASELINE =
	'Blind copy mirrors the first leg of the move at the per-position limit. It trusts the ticker and the log: it buys what looks like a Stock Token arriving, at the price that ticker trades at. It buys no record and applies no rule. Sales and plain payments open nothing.'

export type Side = {
	position: null | { side: 'buy' | 'sell'; symbol: string; token: string; entry_price_usd: string | null; notional_usd: string; units: string | null; holds: string }
	mark: null | { price_usd: string | null; value_usd: string; as_of: string; basis: string }
	/** Value at the mark minus what was put in. "0.00" when nothing was opened. */
	result_usd: string
	note: string
}

export type LedgerRow = {
	n: number
	wallet: string
	move_tx: string
	move_block: number
	move_time: string
	decided_at: string
	conclusion: string
	failed: string[]
	card: TrailV2['card']
	evidence: { record_facts_hash: string; record_as_of: string; record_block: number; purchase: string; payment_tx: string | null; cre_verdict: string; cre_verdict_tx: string | null; anchor_tx: string }
	limits_keccak: string
	mandate_keccak: string
	copy_guard: Side
	blind_copy: Side
	trail_file: string
	trail_hash: string
	trail_tx: string | null
}

const lc = (s: string | null | undefined) => String(s ?? '').toLowerCase()

/** Value now of `notional` put in at `entry` and marked at `mark`, in cents. */
function marked(notionalCents: bigint, entry: string, mark: string, side: 'buy' | 'sell'): bigint {
	const ratio = Number(mark) / Number(entry)
	const value = Number(notionalCents) * (side === 'buy' ? ratio : 2 - ratio)
	return BigInt(Math.round(value))
}

export function copyGuardSide(trail: TrailV2): Side {
	const p = trail.decision.paper_trade
	if (!p) return { position: null, mark: null, result_usd: '0.00', note: trail.decision.conclusion === 'HOLD' ? 'Held. Nothing opened.' : 'Not copied. Nothing opened.' }
	const n = cents(p.notional_usd)
	const value = marked(n, p.price_usd, p.record_price_usd, p.side)
	return {
		position: { side: p.side, symbol: p.symbol, token: p.token, entry_price_usd: p.price_usd, notional_usd: p.notional_usd, units: p.shares, holds: `${p.shares} ${p.symbol}, the Robinhood Stock Token` },
		mark: { price_usd: p.record_price_usd, value_usd: usd(value), as_of: trail.inputs.record.as_of, basis: "the record's price for the token" },
		result_usd: usd(value - n),
		note: `Practice ${p.side}. Exit: ${p.exit.rule}.`,
	}
}

export function blindCopySide(trail: TrailV2): Side {
	const inp = trail.inputs
	const leg = mainLeg(inp)
	const size = inp.limits.position.max_usd_per_position
	const n = cents(size)
	const nothing = (note: string): Side => ({ position: null, mark: null, result_usd: '0.00', note })
	if (!leg) return nothing('Nothing to mirror.')
	const { t, m } = leg
	if (m.kind === 'fake') {
		if (m.ticker === 'USDG' || t.direction !== 'in') {
			return nothing(
				t.direction === 'out'
					? `Nothing to buy. The harm of this log is of another kind: it puts ${`${t.to.slice(0, 6)}…${t.to.slice(-4)}`}, an address made to look like one the wallet pays, into the wallet's history.`
					: 'Nothing to buy: the look-alike copies a dollar token, not a Stock Token.',
			)
		}
		const real = inp.record.tokens.find((k) => k.canonical && k.symbol === m.ticker)
		const price = real && real.usd !== null && Number(real.shares_ui) > 0 && Number(real.usd) > 0 ? (Number(real.usd) / Number(real.shares_ui)).toFixed(4) : null
		const units = price ? (Number(size) / Number(price)).toFixed(6) : null
		return {
			position: { side: 'buy', symbol: m.ticker, token: m.token, entry_price_usd: price, notional_usd: size, units, holds: `${units ?? 'some'} units of the look-alike at ${m.token}, not ${m.ticker}` },
			mark: { price_usd: null, value_usd: '0.00', as_of: inp.record.as_of, basis: `a look-alike: no Chainlink feed, no claim on ${m.ticker} shares, left out of the record's figures` },
			result_usd: usd(-n),
			note: `It believes it bought ${m.ticker}${price ? ` at ${price} USD` : ''}. It holds a token anyone could deploy.`,
		}
	}
	if (m.kind === 'stock') {
		if (t.direction !== 'in') return nothing('A sale. With no position to sell, there is nothing to mirror.')
		const base = paperTrade(inp)
		const entry = executionPrice(inp) ?? base?.price_usd ?? null
		const mark = base?.price_usd ?? null
		const units = entry ? (Number(size) / Number(entry)).toFixed(6) : null
		const holds = `${units ?? 'some'} ${m.ticker}, the Robinhood Stock Token`
		if (!entry || !mark) {
			return { position: { side: 'buy', symbol: m.ticker, token: m.token, entry_price_usd: entry, notional_usd: size, units, holds }, mark: null, result_usd: '0.00', note: 'Not marked: the record has no price for the token.' }
		}
		const value = marked(n, entry, mark, 'buy')
		return {
			position: { side: 'buy', symbol: m.ticker, token: m.token, entry_price_usd: entry, notional_usd: size, units, holds },
			mark: { price_usd: mark, value_usd: usd(value), as_of: inp.record.as_of, basis: "the record's price for the token" },
			result_usd: usd(value - n),
			note: 'A real buy, mirrored without asking who is being copied.',
		}
	}
	return nothing('Nothing to mirror: no Stock Token and no look-alike of one moved.')
}

export type Envelope = { trail: TrailV2; trail_hash: string; trail_tx: string | null; file: string }

export function ledgerRow(e: Envelope, n: number): LedgerRow {
	const t = e.trail
	const inp = t.inputs
	return {
		n,
		wallet: lc(inp.wallet),
		move_tx: lc(inp.movement.tx),
		move_block: inp.movement.block,
		move_time: inp.move.time,
		decided_at: t.decided_at,
		conclusion: t.decision.conclusion,
		failed: t.decision.decisive,
		card: t.card,
		evidence: {
			record_facts_hash: lc(inp.record.recomputed_facts_hash),
			record_as_of: inp.record.as_of,
			record_block: inp.record.as_of_block,
			purchase: t.purchase.mode,
			payment_tx: t.purchase.payment_tx,
			cre_verdict: inp.cre.verdict,
			cre_verdict_tx: inp.cre.verdict_tx,
			anchor_tx: lc(inp.cre.anchor_tx),
		},
		limits_keccak: lc(inp.limits_keccak),
		mandate_keccak: lc(inp.mandate.keccak),
		copy_guard: copyGuardSide(t),
		blind_copy: blindCopySide(t),
		trail_file: e.file,
		trail_hash: e.trail_hash,
		trail_tx: e.trail_tx,
	}
}

export type Ledger = {
	ledger_version: 1
	note: string
	baseline: string
	limits: TrailV2['inputs']['limits'] | null
	limits_keccak: string | null
	mandate: { keccak: string; principal: string; agent_payment_key: string; signed_by_principal: boolean; valid_from: string; valid_until: string } | null
	rows: LedgerRow[]
	totals: { decisions: number; copy: number; do_not_copy: number; hold: number; wallets: number; copy_guard_positions: number; blind_copy_positions: number; copy_guard_result_usd: string; blind_copy_result_usd: string }
}

/** Rows in the order the moves happened. */
export function buildLedger(envelopes: Envelope[]): Ledger {
	const sorted = [...envelopes].sort((a, b) => a.trail.inputs.movement.block - b.trail.inputs.movement.block || (a.trail.inputs.movement.tx < b.trail.inputs.movement.tx ? -1 : 1))
	const rows = sorted.map((e, i) => ledgerRow(e, i + 1))
	const sum = (pick: (r: LedgerRow) => Side) => usd(rows.reduce((s, r) => s + cents(pick(r).result_usd.replace('-', '')) * (pick(r).result_usd.startsWith('-') ? -1n : 1n), 0n))
	const first = sorted[0]?.trail.inputs
	const count = (c: string) => rows.filter((r) => r.conclusion === c).length
	return {
		ledger_version: 1,
		note: 'Practice trades only. No real trade was placed. The two columns compare two policies on past public moves. This is not a forecast, not a record of real trading and not advice.',
		baseline: BASELINE,
		limits: first?.limits ?? null,
		limits_keccak: first ? lc(first.limits_keccak) : null,
		mandate: first
			? {
					keccak: lc(first.mandate.keccak),
					principal: lc(first.mandate.document.principal),
					agent_payment_key: lc(first.mandate.document.agent.payment_key),
					signed_by_principal: Boolean(first.mandate.signer) && lc(first.mandate.signer) === lc(first.mandate.document.principal),
					valid_from: first.mandate.document.valid_from,
					valid_until: first.mandate.document.valid_until,
				}
			: null,
		rows,
		totals: {
			decisions: rows.length,
			copy: count('COPY'),
			do_not_copy: count('DO_NOT_COPY'),
			hold: count('HOLD'),
			wallets: new Set(rows.map((r) => r.wallet)).size,
			copy_guard_positions: rows.filter((r) => r.copy_guard.position).length,
			blind_copy_positions: rows.filter((r) => r.blind_copy.position).length,
			copy_guard_result_usd: sum((r) => r.copy_guard),
			blind_copy_result_usd: sum((r) => r.blind_copy),
		},
	}
}
