// The user's risk limits: limits.json at the root of the repo.
//
// The person the agent acts for writes this file. The agent reads it, names it by hash
// in every trail, and may only do less than it says, never more. The mandate the
// principal signs names the same hash, so changing a limit means signing again.
//
// Pure. Money is counted in whole cents (BigInt), so the agent, the CRE workflow and the
// key-free checker get the same numbers.
import { canonicalJson, keccakText } from '../rwa-verify/verify'

export type Grade = 'reduced' | 'none'

export type Limits = {
	limits_version: 2
	/** True means the agent may only record practice trades. This build has no code path that trades. */
	practice_only: boolean
	size: {
		/** A practice position when every piece of evidence is there, in USD. */
		full_usd: string
		/** A practice position when the token and the venue are real but the wallet's record is weaker, in USD. */
		reduced_usd: string
		/** The most all practice positions opened on one UTC day may be worth, in USD. */
		max_usd_per_day: string
		/** How many practice positions may be open at once. */
		max_open_positions: number
	}
	/** What weaker evidence does to the size: "reduced" opens the smaller position, "none" opens nothing. */
	evidence: {
		/** vet402 has not anchored a record for the wallet onchain, so CRE had nothing to check it against. */
		record_not_anchored: Grade
		/** The wallet's history could only be rebuilt in part. */
		history_partial: Grade
		/** The record gives no realized result for the wallet. */
		wallet_result_unknown: Grade
		/** The wallet's closed trades add up to a loss, or to nothing. */
		wallet_at_a_loss: Grade
		/** A Chainlink feed value older than this at the block of the move is not used as an entry price. */
		max_price_age_hours: number
	}
	exit: {
		/** Leave when the copied wallet sells or sends the same token. */
		when_wallet_sells: boolean
		/** Leave when the feed is this many percent under the entry. */
		stop_loss_pct: string
		/** Leave when the feed is this many percent over the entry. */
		take_profit_pct: string
		/** Leave after this many days whatever the price. */
		max_holding_days: number
	}
	payments: {
		/** The most the agent may pay for the evidence behind one decision, in USDG. */
		max_usdg_per_decision: string
		/** The most the agent may ever pay in total, in USDG. The code never goes above 1 USDG whatever this says. */
		max_usdg_total: string
	}
}

const MONEY = /^(0|[1-9]\d{0,8})(\.\d{1,2})?$/
const PCT = /^(0|[1-9]\d{0,2})(\.\d{1,2})?$/
const GRADES = ['reduced', 'none']

export function parseLimits(v: unknown): Limits {
	const l = v as Limits
	const bad = (what: string): never => {
		throw new Error(`limits.json: ${what}`)
	}
	if (!l || typeof l !== 'object') bad('not an object')
	if (l.limits_version !== 2) bad('limits_version must be 2')
	if (typeof l.practice_only !== 'boolean') bad('practice_only must be true or false')
	for (const k of ['full_usd', 'reduced_usd', 'max_usd_per_day'] as const) if (!MONEY.test(l.size?.[k] ?? '')) bad(`size.${k} must be a USD amount such as "100.00"`)
	if (!Number.isInteger(l.size?.max_open_positions) || l.size.max_open_positions < 0 || l.size.max_open_positions > 10000) bad('size.max_open_positions must be a whole number')
	if (cents(l.size.reduced_usd) > cents(l.size.full_usd)) bad('size.reduced_usd must not be above size.full_usd')
	for (const k of ['record_not_anchored', 'history_partial', 'wallet_result_unknown', 'wallet_at_a_loss'] as const) if (!GRADES.includes(l.evidence?.[k])) bad(`evidence.${k} must be "reduced" or "none"`)
	if (!Number.isInteger(l.evidence?.max_price_age_hours) || l.evidence.max_price_age_hours < 1 || l.evidence.max_price_age_hours > 8760) bad('evidence.max_price_age_hours must be a whole number of hours')
	if (typeof l.exit?.when_wallet_sells !== 'boolean') bad('exit.when_wallet_sells must be true or false')
	for (const k of ['take_profit_pct', 'stop_loss_pct'] as const) if (!PCT.test(l.exit?.[k] ?? '')) bad(`exit.${k} must be a percentage such as "10"`)
	if (!Number.isInteger(l.exit?.max_holding_days) || l.exit.max_holding_days < 1 || l.exit.max_holding_days > 3650) bad('exit.max_holding_days must be a whole number of days')
	for (const k of ['max_usdg_per_decision', 'max_usdg_total'] as const) if (!MONEY.test(l.payments?.[k] ?? '')) bad(`payments.${k} must be a USDG amount such as "0.01"`)
	// Exactly these keys, so the hash covers everything the file says.
	const shape = canonicalJson({
		limits_version: 2,
		practice_only: l.practice_only,
		size: { full_usd: l.size.full_usd, reduced_usd: l.size.reduced_usd, max_usd_per_day: l.size.max_usd_per_day, max_open_positions: l.size.max_open_positions },
		evidence: {
			record_not_anchored: l.evidence.record_not_anchored,
			history_partial: l.evidence.history_partial,
			wallet_result_unknown: l.evidence.wallet_result_unknown,
			wallet_at_a_loss: l.evidence.wallet_at_a_loss,
			max_price_age_hours: l.evidence.max_price_age_hours,
		},
		exit: { when_wallet_sells: l.exit.when_wallet_sells, stop_loss_pct: l.exit.stop_loss_pct, take_profit_pct: l.exit.take_profit_pct, max_holding_days: l.exit.max_holding_days },
		payments: { max_usdg_per_decision: l.payments.max_usdg_per_decision, max_usdg_total: l.payments.max_usdg_total },
	})
	if (shape !== canonicalJson(l)) bad('unknown or missing field')
	return l
}

export function limitsKeccak(l: Limits): string {
	return keccakText(canonicalJson(l))
}

/** "100.00" to 10000n. Only called on strings parseLimits or the rules have checked. */
export function cents(s: string): bigint {
	const [whole, frac = ''] = s.split('.')
	return BigInt(whole) * 100n + BigInt(frac.padEnd(2, '0').slice(0, 2))
}

export function usd(c: bigint): string {
	const neg = c < 0n
	const a = neg ? -c : c
	return `${neg ? '-' : ''}${a / 100n}.${(a % 100n).toString().padStart(2, '0')}`
}

/** USDG has 6 decimals: "0.01" is 10000 atomic. */
export function usdgAtomic(s: string): bigint {
	return cents(s) * 10_000n
}

/** The spend cap in force: the smaller of the code's hard cap and the user's total. */
export function paymentCapAtomic(l: Limits, hardCap: bigint): bigint {
	const user = usdgAtomic(l.payments.max_usdg_total)
	return user < hardCap ? user : hardCap
}
