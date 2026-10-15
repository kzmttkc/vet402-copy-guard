// vet402's SpendGuard (@vet402/sdk), asked before the agent signs a payment.
//
// copy-guard pays on Robinhood Chain (eip155:4663). vet402's payee verdict (ALLOW / WARN /
// BLOCK) does not cover that chain yet, and payOrRefuse pays on Base and Solana only, so
// the guard runs with trustPolicy "custom": the two local rules below, and no payee lookup.
// The amounts come from the user's limits.json (payments.max_usdg_per_decision and the cap
// in force), so the guard and the ledger cap can never disagree.
//
// A refusal throws before anything is signed and before the pending entry is written.
import { SpendGuard } from '@vet402/sdk'

const USDG_DECIMALS = 1_000_000

export type GuardCheck = (amountAtomic: bigint) => Promise<void>

export function atomicToUsd(a: bigint): number {
	return Number(a) / USDG_DECIMALS
}

// SpendGuard adds amounts as floating-point dollars: 100 payments of 0.01 against a 1.00
// budget reach 0.99000000000000007 after 99, and the 100th is refused. A budget one
// nanodollar above the cap keeps exactly the cap's number of payments allowed, and is far
// below one atomic USDG (0.000001), so it can never let an extra payment through.
const FLOAT_SLACK_USD = 1e-9

const guards = new Map<string, SpendGuard>()

/**
 * The guard for this process. It is made once per (limit for one decision, cap) and reused,
 * so its in-memory daily counter adds up every payment this process makes in a UTC day.
 * The ledger cap and the chain floor still bound the total across processes.
 */
export function vet402SpendGuard(perDecisionAtomic: bigint, capAtomic: bigint): SpendGuard {
	const key = `${perDecisionAtomic}:${capAtomic}`
	let g = guards.get(key)
	if (!g) {
		g = new SpendGuard(
			{ maxPerTxUsd: atomicToUsd(perDecisionAtomic), dailyBudgetUsd: atomicToUsd(capAtomic) + FLOAT_SLACK_USD, trustPolicy: 'custom' },
			async () => {
				throw new Error('payee lookup is off: vet402 has no payee verdict on Robinhood Chain yet')
			},
		)
		guards.set(key, g)
	}
	return g
}

/** Tests only: forget the guards made so far. */
export function resetGuardsForTests() {
	guards.clear()
}

export function guardCheck(guard: SpendGuard, payTo: string): GuardCheck {
	return async (amountAtomic) => {
		const d = await guard.evaluate({ payee: payTo, amountUsd: atomicToUsd(amountAtomic) })
		if (!d.allow) throw new Error(`vet402 SpendGuard refused (${d.reasons.join(', ')}); nothing signed`)
	}
}
