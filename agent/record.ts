// From a vet402 /rwa facts JSON to the few fields the rules read. Pure, so the
// checker can rebuild the same summary from a saved record and compare.
import { commitment, type Facts } from '../rwa-verify/verify'
import type { RecordInputs } from './rules'

export function recordInputs(facts: any, meta: { source_url: string; x_facts_hash: string }): RecordInputs {
	return {
		source_url: meta.source_url,
		x_facts_hash: meta.x_facts_hash.toLowerCase(),
		recomputed_facts_hash: commitment(facts as Facts).hash.toLowerCase(),
		address: String(facts.address).toLowerCase(),
		chain_id: Number(facts.chain_id),
		as_of: String(facts.as_of),
		as_of_block: Number(facts.as_of_block),
		method_version: String(facts.method_version),
		r1_status: String(facts.r1_status),
		realized_usd: facts.realized_usd ?? null,
		tokens: (facts.tokens ?? []).map((t: any) => ({
			token: String(t.token).toLowerCase(),
			symbol: String(t.symbol),
			canonical: t.canonical === true,
			usd: t.usd ?? null,
			shares_ui: String(t.shares_ui),
		})),
		lookalikes: (facts.lookalikes ?? []).map((l: any) => ({
			token: String(l.token).toLowerCase(),
			imitates: String(l.imitates),
			counted: l.counted !== false,
			needs_review: l.needs_review === true,
		})),
	}
}
