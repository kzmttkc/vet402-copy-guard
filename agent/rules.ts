// The copy-guard rules: "may I copy this wallet's move?"
//
// Pure and deterministic. No clock, no network, no randomness, no LLM. The
// same inputs give the same rule rows and the same conclusion, in the agent,
// in the CRE trail workflow (WASM) and in the key-free checker.
//
// Three groups, read in order:
//   A  can the record be trusted at all       a failure gives HOLD
//   B  does the record cover this movement    a failure gives HOLD
//   C  should the move be copied              a failure gives DO_NOT_COPY
// All of A, B and C pass: COPY (a paper trade, never a real one).

export const RULES = { id: 'copy-guard', version: 1 } as const

export const USDG = '0x5fc5360d0400a0fd4f2af552add042d716f1d168'
export const PAY_TO = '0x973cd8a91a771c2c04c6036888f8175d6b4f6227'
export const X402_NETWORK = 'eip155:4663'
/** The most one record may cost: 0.01 USDG (6 decimals). Higher terms are refused. */
export const MAX_PRICE_ATOMIC = '10000'
/** Paper trade size for a COPY. */
export const PAPER_NOTIONAL_USD = '100.00'

export type Conclusion = 'COPY' | 'DO_NOT_COPY' | 'HOLD'
export const CONCLUSION_CODE: Record<Conclusion, number> = { HOLD: 0, DO_NOT_COPY: 1, COPY: 2 }

export type Transfer = { token: string; from: string; to: string; amount_raw: string; direction: 'in' | 'out' }

export type Movement = { chain_id: number; tx: string; block: number; transfers: Transfer[] }

export type Terms = {
	scheme: string
	network: string
	asset: string
	amount: string
	payTo: string
	assetTransferMethod: string
}

export type RecordToken = { token: string; symbol: string; canonical: boolean; usd: string | null; shares_ui: string }
export type RecordLookalike = { token: string; imitates: string; counted: boolean; needs_review: boolean }

export type RecordInputs = {
	source_url: string
	x_facts_hash: string
	recomputed_facts_hash: string
	address: string
	chain_id: number
	as_of: string
	as_of_block: number
	method_version: string
	r1_status: string
	realized_usd: string | null
	tokens: RecordToken[]
	lookalikes: RecordLookalike[]
}

export type CreInputs = {
	workflow: string
	anchor_tx: string
	anchor_record_url: string
	verdict: 'MATCH' | 'MISMATCH' | 'NO_ANCHOR'
	reason_bits: number
	recomputed_facts_hash: string
	anchored_facts_hash: string
	receiver: string
	mode: 'simulate' | 'broadcast'
	verdict_tx: string | null
}

export type DecisionInputs = {
	wallet: string
	movement: Movement
	terms: Terms
	record: RecordInputs
	cre: CreInputs
}

export type RuleRow = { id: string; group: 'A' | 'B' | 'C'; ok: boolean; rule: string; detail: string }

export type PaperTrade = {
	side: 'buy' | 'sell'
	token: string
	symbol: string
	price_usd: string
	notional_usd: string
	shares: string
}

export type Decision = {
	rule_results: RuleRow[]
	conclusion: Conclusion
	decisive: string[]
	paper_trade: PaperTrade | null
}

const lc = (s: string) => String(s ?? '').toLowerCase()
const HASH = /^0x[0-9a-f]{64}$/

type Kind = 'stock' | 'fake' | 'usdg' | 'unknown'

/** How the record classifies a token address. A look-alike entry wins over everything else. */
export function classify(token: string, record: RecordInputs): Kind {
	const t = lc(token)
	if (record.lookalikes.some((l) => lc(l.token) === t)) return 'fake'
	if (t === USDG) return 'usdg'
	if (record.tokens.some((k) => k.canonical && lc(k.token) === t)) return 'stock'
	return 'unknown'
}

function decimalPositive(s: string | null): boolean {
	if (s === null || !/^-?\d+(\.\d+)?$/.test(s)) return false
	return !s.startsWith('-') && /[1-9]/.test(s)
}

/** The stock leg the paper trade would mirror: the first Stock Token transfer in log order. */
function stockLeg(inp: DecisionInputs): Transfer | undefined {
	return inp.movement.transfers.find((t) => classify(t.token, inp.record) === 'stock')
}

export function paperTrade(inp: DecisionInputs): PaperTrade | null {
	const leg = stockLeg(inp)
	if (!leg) return null
	const tok = inp.record.tokens.find((k) => lc(k.token) === lc(leg.token))
	if (!tok || tok.usd === null) return null
	const shares = Number(tok.shares_ui)
	const usd = Number(tok.usd)
	if (!(shares > 0) || !(usd > 0)) return null
	const price = usd / shares
	return {
		side: leg.direction === 'in' ? 'buy' : 'sell',
		token: lc(leg.token),
		symbol: tok.symbol,
		price_usd: price.toFixed(4),
		notional_usd: PAPER_NOTIONAL_USD,
		shares: (Number(PAPER_NOTIONAL_USD) / Number(price.toFixed(4))).toFixed(6),
	}
}

export function decide(inp: DecisionInputs): Decision {
	const rows: RuleRow[] = []
	const add = (id: string, group: RuleRow['group'], ok: boolean, rule: string, detail: string) =>
		rows.push({ id, group, ok, rule, detail })
	const r = inp.record
	const wallet = lc(inp.wallet)

	// A. can the record be trusted
	const t = inp.terms
	const termsOk =
		t.scheme === 'exact' &&
		t.network === X402_NETWORK &&
		lc(t.asset) === USDG &&
		lc(t.payTo) === PAY_TO &&
		t.assetTransferMethod === 'permit2' &&
		/^\d+$/.test(t.amount) &&
		BigInt(t.amount) > 0n &&
		BigInt(t.amount) <= BigInt(MAX_PRICE_ATOMIC)
	add(
		'A1',
		'A',
		termsOk,
		'the record was offered under the published x402 terms (exact, eip155:4663, USDG, at most 0.01, paid to the vet402 anchor wallet)',
		`${t.scheme} ${t.network} ${lc(t.asset)} amount ${t.amount} payTo ${lc(t.payTo)} ${t.assetTransferMethod}`,
	)
	const committed = HASH.test(lc(r.x_facts_hash)) && lc(r.x_facts_hash) === lc(r.recomputed_facts_hash)
	add(
		'A2',
		'A',
		committed,
		'X-Facts-Hash sent with the record equals the hash recomputed from its body',
		`header ${lc(r.x_facts_hash) || '(none)'} recomputed ${lc(r.recomputed_facts_hash)}`,
	)
	const subjectOk = lc(r.address) === wallet && r.chain_id === 4663 && /^rwa-recon-0\.[0-9]+$/.test(r.method_version)
	add(
		'A3',
		'A',
		subjectOk,
		'the record is about the watched wallet on Robinhood Chain 4663',
		`record ${lc(r.address)} chain ${r.chain_id} ${r.method_version}`,
	)
	const c = inp.cre
	add(
		'A4',
		'A',
		c.verdict === 'MATCH' && c.reason_bits === 0 && lc(c.recomputed_facts_hash) === lc(c.anchored_facts_hash),
		"the CRE workflow re-verified the wallet's newest vet402 anchor: MATCH",
		`${c.verdict} reasons ${c.reason_bits} anchor tx ${lc(c.anchor_tx) || '(none)'}`,
	)
	add('A5', 'A', r.r1_status !== 'unverified', 'the record replays to the balances it reports (r1_status is not unverified)', `r1_status ${r.r1_status}`)
	const shaky = r.lookalikes.filter((l) => l.counted || l.needs_review)
	add(
		'A6',
		'A',
		shaky.length === 0,
		'every look-alike token is left out of the figures and none waits for review',
		`${r.lookalikes.length} look-alikes, ${shaky.length} counted or needing review`,
	)

	// B. does the record cover this movement
	add(
		'B1',
		'B',
		r.as_of_block >= inp.movement.block,
		'the record was built at or after the block of the movement',
		`record block ${r.as_of_block}, movement block ${inp.movement.block}`,
	)
	const kinds = inp.movement.transfers.map((x) => ({ token: lc(x.token), kind: classify(x.token, r) }))
	const unknown = kinds.filter((k) => k.kind === 'unknown')
	add(
		'B2',
		'B',
		inp.movement.transfers.length > 0 && unknown.length === 0,
		'the record says what every moved token is (Stock Token, USDG or named look-alike)',
		inp.movement.transfers.length === 0
			? 'no transfers in the movement'
			: unknown.length
				? `not judged by the record: ${unknown.map((k) => k.token).join(', ')}`
				: kinds.map((k) => `${k.token} ${k.kind}`).join(', '),
	)

	// C. should the move be copied
	const fakes = kinds.filter((k) => k.kind === 'fake')
	add(
		'C1',
		'C',
		fakes.length === 0,
		'no token in the movement is a look-alike the record names as fake',
		fakes.length
			? `fake: ${fakes
					.map((k) => {
						const l = r.lookalikes.find((x) => lc(x.token) === k.token)
						return `${k.token} imitating ${l?.imitates ?? '?'}`
					})
					.join(', ')}`
			: 'none',
	)
	const leg = stockLeg(inp)
	add(
		'C2',
		'C',
		Boolean(leg),
		'the movement moves a Robinhood Stock Token',
		leg ? `${lc(leg.token)} ${leg.direction}` : 'no Stock Token moved',
	)
	add(
		'C3',
		'C',
		r.r1_status === 'reconstructed',
		"the wallet's track record is complete (r1_status reconstructed)",
		`r1_status ${r.r1_status}`,
	)
	add(
		'C4',
		'C',
		decimalPositive(r.realized_usd),
		'the wallet has a realized profit (realized_usd above zero)',
		`realized_usd ${r.realized_usd ?? 'null'}`,
	)
	const pt = paperTrade(inp)
	add(
		'C5',
		'C',
		pt !== null,
		'the moved Stock Token has a USD price in the record, so a paper trade can be sized',
		pt ? `${pt.symbol} ${pt.price_usd} USD` : 'no priced Stock Token leg',
	)

	const failed = (g: RuleRow['group'][]) => rows.filter((x) => g.includes(x.group) && !x.ok).map((x) => x.id)
	const hold = failed(['A', 'B'])
	if (hold.length) return { rule_results: rows, conclusion: 'HOLD', decisive: hold, paper_trade: null }
	const no = failed(['C'])
	if (no.length) return { rule_results: rows, conclusion: 'DO_NOT_COPY', decisive: no, paper_trade: null }
	return { rule_results: rows, conclusion: 'COPY', decisive: [], paper_trade: pt }
}
