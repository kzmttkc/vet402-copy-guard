// The reasoning trail: one JSON per decision, with everything the rules read,
// the rule rows, the conclusion and what was paid. Its hash goes onchain.
//
// Pure, so the CRE trail workflow (WASM) and the key-free checker use the same
// code as the agent. trailHash = keccak256(canonical JSON of the whole trail),
// with the same canonical JSON as vet402's verify-record.mjs.
import { canonicalJson, keccakText, subjectHash } from '../rwa-verify/verify'
import { buildCard, type Card } from './card'
import { limitsKeccak, parseLimits } from './limits'
import { mandateKeccak, mandateSigner } from './mandate'
import { CONCLUSION_CODE, type Decision, type DecisionInputs, decide, RULES } from './rules'
import { type DecisionInputsV2, type DecisionV2, decideV2, RULES_V2, type RulesRef } from './rules-v2'

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

/**
 * Trail version 2: everything in version 1, plus the mandate (who the agent acts for),
 * the user's limits, the state of the practice book and the decision card. The rules
 * are copy-guard v2 (agent/rules-v2.ts): the 13 rules of v1 and M1, L1, L2.
 */
export type TrailV2 = {
	trail_version: 2
	rules: RulesRef
	decided_at: string
	purchase: Purchase
	inputs: DecisionInputsV2
	decision: DecisionV2
	card: Card
}
export type AnyTrail = Trail | TrailV2

export function buildTrailV2(inputs: DecisionInputsV2, purchase: Purchase): TrailV2 {
	const decision = decideV2(inputs)
	return { trail_version: 2, rules: inputs.rules, decided_at: inputs.decided_at, purchase, inputs, decision, card: buildCard(inputs, decision) }
}

export function trailHash(trail: AnyTrail): string {
	return keccakText(canonicalJson(trail))
}

const lc = (s: string | null | undefined) => String(s ?? '').toLowerCase()

function purchaseProblems(trail: AnyTrail): string[] {
	const problems: string[] = []
	if (trail.purchase?.mode === 'paid' && !/^0x[0-9a-fA-F]{64}$/.test(trail.purchase.payment_tx ?? '')) problems.push('purchase says paid but names no payment tx')
	if (trail.purchase?.mode === 'dry-run' && trail.purchase.payment_tx !== null) problems.push('purchase says dry-run but names a payment tx')
	return problems
}

/** Version 2: the rules, the mandate's hash and signer, the limits' hash and the card, all rebuilt from the trail's inputs. */
export function recheckTrailV2(trail: TrailV2): { ok: boolean; problems: string[]; recomputed: DecisionV2 } {
	const problems: string[] = []
	const inp = trail.inputs
	if (trail.rules?.id !== RULES_V2.id || trail.rules?.version !== RULES_V2.version) problems.push(`rules ${trail.rules?.id} v${trail.rules?.version}, this code is ${RULES_V2.id} v${RULES_V2.version}`)
	if (canonicalJson(trail.rules) !== canonicalJson(inp.rules)) problems.push('the rules named by the trail and by its inputs differ')
	if (trail.decided_at !== inp.decided_at) problems.push('decided_at differs between the trail and its inputs')
	if (lc(trail.purchase?.payer) !== lc(inp.payer)) problems.push('the payer of the purchase is not the payer the rules read')
	try {
		if (limitsKeccak(parseLimits(inp.limits)) !== lc(inp.limits_keccak)) problems.push('limits_keccak is not the hash of the limits in the trail')
	} catch (e) {
		problems.push(String((e as Error).message))
	}
	const m = inp.mandate
	if (mandateKeccak(m.document) !== lc(m.keccak)) problems.push('mandate keccak is not the hash of the mandate in the trail')
	if (lc(mandateSigner(m.document, m.signature)) !== lc(m.signer)) problems.push('the mandate signature does not recover to the signer the trail names')
	const recomputed = decideV2(inp)
	if (recomputed.conclusion !== trail.decision?.conclusion) problems.push(`conclusion ${trail.decision?.conclusion} does not follow from the inputs, the rules give ${recomputed.conclusion}`)
	if (canonicalJson(recomputed) !== canonicalJson(trail.decision)) problems.push('rule rows, decisive rules or practice position differ from what the rules give')
	if (canonicalJson(buildCard(inp, recomputed)) !== canonicalJson(trail.card)) problems.push('the decision card differs from the one its inputs give')
	problems.push(...purchaseProblems(trail))
	return { ok: problems.length === 0, problems, recomputed }
}

export type Recheck = { ok: boolean; problems: string[]; recomputed: Decision | DecisionV2 }

/** Run the rules again on the trail's own inputs and compare with what it says. */
export function recheckTrail(trail: AnyTrail): Recheck {
	if ((trail as AnyTrail).trail_version === 2) {
		try {
			return recheckTrailV2(trail as TrailV2)
		} catch (e) {
			// A file that says version 2 but lacks what version 2 carries is refused, not crashed on.
			return { ok: false, problems: [`not a readable version 2 trail: ${String((e as Error).message).slice(0, 120)}`], recomputed: { rule_results: [], conclusion: 'HOLD', decisive: [], paper_trade: null } }
		}
	}
	return recheckTrailV1(trail as Trail)
}

function recheckTrailV1(trail: Trail): Recheck {
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
export function trailReportFields(trail: AnyTrail) {
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
