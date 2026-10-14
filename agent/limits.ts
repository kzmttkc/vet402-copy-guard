// The user's risk limits: limits.json at the root of the repo.
//
// The person the agent acts for writes this file. The agent reads it, names it by hash
// in every trail, and may only do less than it says, never more. The mandate the
// principal signs names the same hash, so changing a limit means signing again.
//
// Pure. Money is counted in whole cents (BigInt), so the agent, the CRE workflow and the
// key-free checker get the same numbers.
import { canonicalJson, keccakText } from '../rwa-verify/verify'

export type Limits = {
	limits_version: 1
	/** True means the agent may only record practice trades. This build has no code path that trades. */
	practice_only: boolean
	position: {
		/** The most one practice position may be worth, in USD. */
		max_usd_per_position: string
		/** The most all practice positions opened on one UTC day may be worth, in USD. */
		max_usd_per_day: string
		/** How many practice positions may be open at once. */
		max_open_positions: number
	}
	exit: {
		/** Close a practice position when the price has moved this many percent in its favour. */
		take_profit_pct: string
		/** Close it when the price has moved this many percent against it. */
		stop_loss_pct: string
		/** Close it after this many days whatever the price. */
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

export function parseLimits(v: unknown): Limits {
	const l = v as Limits
	const bad = (what: string): never => {
		throw new Error(`limits.json: ${what}`)
	}
	if (!l || typeof l !== 'object') bad('not an object')
	if (l.limits_version !== 1) bad('limits_version must be 1')
	if (typeof l.practice_only !== 'boolean') bad('practice_only must be true or false')
	for (const k of ['max_usd_per_position', 'max_usd_per_day'] as const) if (!MONEY.test(l.position?.[k] ?? '')) bad(`position.${k} must be a USD amount such as "100.00"`)
	if (!Number.isInteger(l.position?.max_open_positions) || l.position.max_open_positions < 0 || l.position.max_open_positions > 1000) bad('position.max_open_positions must be a whole number')
	for (const k of ['take_profit_pct', 'stop_loss_pct'] as const) if (!PCT.test(l.exit?.[k] ?? '')) bad(`exit.${k} must be a percentage such as "10"`)
	if (!Number.isInteger(l.exit?.max_holding_days) || l.exit.max_holding_days < 1 || l.exit.max_holding_days > 3650) bad('exit.max_holding_days must be a whole number of days')
	for (const k of ['max_usdg_per_decision', 'max_usdg_total'] as const) if (!MONEY.test(l.payments?.[k] ?? '')) bad(`payments.${k} must be a USDG amount such as "0.01"`)
	// Exactly these keys, so the hash covers everything the file says.
	const shape = canonicalJson({
		limits_version: 1,
		practice_only: l.practice_only,
		position: { max_usd_per_position: l.position.max_usd_per_position, max_usd_per_day: l.position.max_usd_per_day, max_open_positions: l.position.max_open_positions },
		exit: { take_profit_pct: l.exit.take_profit_pct, stop_loss_pct: l.exit.stop_loss_pct, max_holding_days: l.exit.max_holding_days },
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
