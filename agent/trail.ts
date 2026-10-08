// The reasoning trail: one JSON per decision, with everything the rules read,
// the rule rows, the conclusion and what was paid. Its hash goes onchain.
//
// Pure, so the CRE trail workflow (WASM) and the key-free checker use the same
// code as the agent. trailHash = keccak256(canonical JSON of the whole trail),
// with the same canonical JSON as vet402's verify-record.mjs.
import { canonicalJson, keccakText, subjectHash } from '../rwa-verify/verify'
import { CONCLUSION_CODE, type Decision, type DecisionInputs, decide, RULES } from './rules'

export const TRAIL_VERSION = 1

export type Purchase = {
	mode: 'dry-run' | 'paid'
	resource: string
	payer: string
	/** Settlement tx on Robinhood Chain 4663, null when nothing was paid. */
	payment_tx: string | null
	settlement: 'not-sent' | 'settled' | 'unknown' | 'failed'
	spent_before_atomic: string
	cap_atomic: string
	/** Hash of the Permit2 typed data that was (or, in a dry run, would have been) signed. */
	permit2_digest: string
}

export type Trail = {
	trail_version: number
	rules: { id: string; version: number; source_keccak: string }
	decided_at: string
	purchase: Purchase
	inputs: DecisionInputs
	decision: Decision
}

export function buildTrail(
	inputs: DecisionInputs,
	purchase: Purchase,
	meta: { decided_at: string; rules_source_keccak: string },
): Trail {
	return {
		trail_version: TRAIL_VERSION,
		rules: { id: RULES.id, version: RULES.version, source_keccak: meta.rules_source_keccak },
		decided_at: meta.decided_at,
		purchase,
		inputs,
		decision: decide(inputs),
	}
}

export function trailHash(trail: Trail): string {
	return keccakText(canonicalJson(trail))
}

export type Recheck = { ok: boolean; problems: string[]; recomputed: Decision }

/** Run the rules again on the trail's own inputs and compare with what it says. */
export function recheckTrail(trail: Trail): Recheck {
	const problems: string[] = []
	if (trail.trail_version !== TRAIL_VERSION) problems.push(`trail_version ${trail.trail_version}, this code reads ${TRAIL_VERSION}`)
	if (trail.rules?.id !== RULES.id || trail.rules?.version !== RULES.version) {
		problems.push(`rules ${trail.rules?.id} v${trail.rules?.version}, this code is ${RULES.id} v${RULES.version}`)
	}
	const recomputed = decide(trail.inputs)
	if (recomputed.conclusion !== trail.decision?.conclusion) {
		problems.push(`conclusion ${trail.decision?.conclusion} does not follow from the inputs, the rules give ${recomputed.conclusion}`)
	}
	if (canonicalJson(recomputed) !== canonicalJson(trail.decision)) {
		problems.push('rule rows, decisive rules or paper trade differ from what the rules give')
	}
	if (trail.purchase?.mode === 'paid' && !/^0x[0-9a-fA-F]{64}$/.test(trail.purchase.payment_tx ?? '')) {
		problems.push('purchase says paid but names no payment tx')
	}
	if (trail.purchase?.mode === 'dry-run' && trail.purchase.payment_tx !== null) {
		problems.push('purchase says dry-run but names a payment tx')
	}
	return { ok: problems.length === 0, problems, recomputed }
}

const ZERO32 = `0x${'0'.repeat(64)}`

/** The fixed-size summary written onchain next to the trail hash. */
export function trailReportFields(trail: Trail) {
	return {
		trailHash: trailHash(trail),
		subject: subjectHash(trail.inputs.wallet),
		conclusion: CONCLUSION_CODE[trail.decision.conclusion],
		recordFactsHash: trail.inputs.record.recomputed_facts_hash.toLowerCase(),
		movementTx: trail.inputs.movement.tx.toLowerCase(),
		verdictTx: (trail.inputs.cre.verdict_tx ?? ZERO32).toLowerCase(),
		paymentTx: (trail.purchase.payment_tx ?? ZERO32).toLowerCase(),
		rulesVersion: trail.rules.version,
	}
}
