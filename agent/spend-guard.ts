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

/** One guard per process. Its daily counter lives in memory, so it is a brake, not the ledger. */
export function vet402SpendGuard(perDecisionAtomic: bigint, capAtomic: bigint): SpendGuard {
	return new SpendGuard(
		{ maxPerTxUsd: atomicToUsd(perDecisionAtomic), dailyBudgetUsd: atomicToUsd(capAtomic), trustPolicy: 'custom' },
		async () => {
			throw new Error('payee lookup is off: vet402 has no payee verdict on Robinhood Chain yet')
		},
	)
}

export function guardCheck(guard: SpendGuard, payTo: string): GuardCheck {
	return async (amountAtomic) => {
		const d = await guard.evaluate({ payee: payTo, amountUsd: atomicToUsd(amountAtomic) })
		if (!d.allow) throw new Error(`vet402 SpendGuard refused (${d.reasons.join(', ')}); nothing signed`)
	}
}
