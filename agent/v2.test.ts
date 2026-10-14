// copy-guard v2: the user's limits, the mandate, the size a decision ends in, the card
// and the ledger walk. Every pure function is also held against verify.mjs, which is a
// separate writing with no import from the agent.
import { describe, expect, test } from 'bun:test'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { hashTypedData, keccak256 as viemKeccak } from 'viem'
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts'
import { canonicalJson } from '../rwa-verify/verify'
// @ts-expect-error verify.mjs is plain JavaScript on purpose and ships no types
import * as V from '../verify.mjs'
import { buildCard } from './card'
import { buildLedger, merkleRoot } from './ledger'
import { type Limits, limitsKeccak, parseLimits, paymentCapAtomic } from './limits'
import { type Mandate, mandateMessage, mandateRef, mandateSigner, personalHash, recoverAddress } from './mandate'
import { type DecisionInputsV2, decideV2, type Price } from './rules-v2'
import { CRE_MATCH, DRY_PURCHASE, FAKE_NVDA, FAKE_USDG, inputs, LIVE, liveRecord, profitableRecord, QQQ_BUY, WALLET } from './test-helpers'
import { buildTrailV2, recheckTrail, type TrailV2 } from './trail'
import { MAX_SPEND_ATOMIC, permit2TypedData } from './x402'
import { movedTokens } from './rules-v2'
import { USDG } from './rules'

const REPO = join(import.meta.dir, '..')
const LIMITS: Limits = parseLimits(JSON.parse(readFileSync(join(REPO, 'limits.json'), 'utf8')))
const RULES = { id: 'copy-guard', version: 2, source_keccak: `0x${'11'.repeat(32)}`, limits_rules_keccak: `0x${'22'.repeat(32)}` }
const KEY = generatePrivateKey()
const PRINCIPAL = privateKeyToAccount(KEY)
const PAYER = DRY_PURCHASE.payer.toLowerCase()
const DECIDED = '2026-10-14T01:00:00.000Z'
const QQQ = '0xd5f3879160bc7c32ebb4dc785f8a4f505888de68'
const PM = '0x8366a39cc670b4001a1121b8f6a443a643e40951'

function mandate(limits: Limits = LIMITS): Mandate {
	return {
		mandate_version: 1,
		title: 'test mandate',
		principal: PRINCIPAL.address,
		agent: { name: 'vet402 copy-guard', payment_key: DRY_PURCHASE.payer },
		scope: { practice_only: true, may: [], may_not: [] },
		rules: RULES,
		limits_keccak: limitsKeccak(limits),
		chain_id: 4663,
		valid_from: '2026-10-14T00:00:00Z',
		valid_until: '2026-12-31T23:59:59Z',
	}
}
const PRICE: Price = { feed: `0x${'fe'.repeat(20)}`, aggregator: `0x${'a9'.repeat(20)}`, answer: '72883000000', decimals: 8, round_id: '300', updated_at: '2026-09-21T13:00:00.000Z', update_block: 68_800_000, update_tx: `0x${'77'.repeat(32)}` }

async function v2(movement = QQQ_BUY, over: Partial<DecisionInputsV2> = {}, limits: Limits = LIMITS): Promise<DecisionInputsV2> {
	const m = mandate(limits)
	const signature = await PRINCIPAL.signMessage({ message: mandateMessage(m) })
	const base = inputs(movement, { record: profitableRecord(), cre: CRE_MATCH })
	return {
		...base,
		decided_at: DECIDED,
		payer: PAYER,
		rules: RULES,
		move: { time: '2026-09-21T13:36:17.000Z', signer: WALLET },
		tokens_moved: movedTokens(LIVE, movement.transfers, { [QQQ]: 18, [USDG]: 6 }, USDG),
		venue: movement === QQQ_BUY ? [{ address: PM, kind: 'uniswap-v4-pool-manager' }] : [],
		price: movement === QQQ_BUY ? PRICE : null,
		limits,
		limits_keccak: limitsKeccak(limits),
		mandate: mandateRef(m, signature),
		book: { day: '2026-09-21', used_usd_today: '0.00', open_positions: 0 },
		...over,
	}
}
const both = (inp: DecisionInputsV2) => {
	const d = decideV2(inp)
	expect(canonicalJson(V.decideV2(inp))).toBe(canonicalJson(d))
	expect(canonicalJson(V.cardOf(inp, d))).toBe(canonicalJson(buildCard(inp, d)))
	return d
}

describe('limits.json', () => {
	test('the file in the repo parses, and its hash is the keccak256 of its canonical JSON in both writings', () => {
		expect(limitsKeccak(LIMITS)).toBe(V.keccak256(V.canonicalJson(LIMITS)))
	})
	test('an unknown field, a reduced size above the full size or a wrong grade is refused', () => {
		expect(() => parseLimits({ ...LIMITS, extra: 1 })).toThrow(/unknown or missing/)
		expect(() => parseLimits({ ...LIMITS, size: { ...LIMITS.size, reduced_usd: '500.00' } })).toThrow(/reduced_usd/)
		expect(() => parseLimits({ ...LIMITS, evidence: { ...LIMITS.evidence, wallet_at_a_loss: 'full' } })).toThrow(/wallet_at_a_loss/)
		expect(() => parseLimits({ ...LIMITS, limits_version: 1 })).toThrow()
	})
	test('the user can lower the payment cap and can never raise it above the hard cap', () => {
		expect(paymentCapAtomic(LIMITS, MAX_SPEND_ATOMIC)).toBe(1_000_000n)
		expect(paymentCapAtomic({ ...LIMITS, payments: { ...LIMITS.payments, max_usdg_total: '0.05' } }, MAX_SPEND_ATOMIC)).toBe(50_000n)
		expect(paymentCapAtomic({ ...LIMITS, payments: { ...LIMITS.payments, max_usdg_total: '50.00' } }, MAX_SPEND_ATOMIC)).toBe(MAX_SPEND_ATOMIC)
	})
})

describe('the mandate signature', () => {
	test('both writings recover the signer viem signed with, for 12 fresh keys', async () => {
		for (let i = 0; i < 12; i++) {
			const account = privateKeyToAccount(generatePrivateKey())
			const message = `message ${i} ✓`
			const sig = await account.signMessage({ message })
			expect(personalHash(message)).toBe(V.personalHash(message))
			expect(recoverAddress(personalHash(message), sig)).toBe(account.address.toLowerCase())
			expect(V.recoverSigner(personalHash(message), sig)).toBe(account.address.toLowerCase())
		}
		expect(recoverAddress(`0x${'00'.repeat(32)}`, '0x12')).toBeNull()
	})
	test('the line that is signed names the principal, the payment key, the hash and the dates, and one changed field changes the signer', async () => {
		const m = mandate()
		const line = mandateMessage(m)
		expect(line).toBe(V.mandateLine(m))
		for (const part of [m.principal, m.agent.payment_key, viemKeccak(new TextEncoder().encode(canonicalJson(m))), m.valid_from, m.valid_until, 'Practice trades only: yes']) expect(line).toContain(part)
		const sig = await PRINCIPAL.signMessage({ message: line })
		expect(mandateSigner(m, sig)).toBe(PRINCIPAL.address.toLowerCase())
		expect(mandateSigner({ ...m, valid_until: '2027-12-31T23:59:59Z' }, sig)).not.toBe(PRINCIPAL.address.toLowerCase())
		expect(mandateSigner(m, null)).toBeNull()
	})
	test('the sample mandate in the repo is signed by its own principal, and the real one names the vet402 operator', () => {
		const sample = JSON.parse(readFileSync(join(REPO, 'mandate/sample/mandate.json'), 'utf8'))
		const sig = readFileSync(join(REPO, 'mandate/sample/mandate.sig'), 'utf8').trim()
		expect(mandateSigner(sample, sig)).toBe(sample.principal.toLowerCase())
		expect(sample.title).toMatch(/^SAMPLE/)
		const real = JSON.parse(readFileSync(join(REPO, 'mandate/mandate.json'), 'utf8'))
		expect(real.principal.toLowerCase()).toBe(V.CLAIMS.payee)
		expect(readFileSync(join(REPO, 'mandate/mandate.message.txt'), 'utf8')).toBe(mandateMessage(real))
	})
})

describe('the size a decision ends in', () => {
	test('FULL: real token, official venue, bought by the wallet, priced by the feed, anchored, complete and in profit', async () => {
		const d = both(await v2())
		expect([d.tier, d.conclusion, d.decisive]).toEqual(['FULL', 'COPY', []])
		expect(d.rule_results.map((r) => r.id)).toEqual(['A1', 'A2', 'A3', 'A4', 'A5', 'A6', 'B1', 'B2', 'C1', 'C2', 'C3', 'C4', 'M1', 'V1', 'D1', 'P1', 'L1', 'L2'])
		expect(d.paper_trade).toMatchObject({ tier: 'FULL', notional_usd: '100.00', price_usd: '728.8300', shares: '0.137206', symbol: 'QQQ' })
		expect(d.paper_trade?.exit).toMatchObject({ stop_loss_usd: '655.9470', take_profit_usd: '874.5960', close_by: '2026-10-21T13:36:17.000Z', when_wallet_sells: true })
	})
	test('REDUCED: the same move with no anchor, a partial history or an unknown result opens the smaller size', async () => {
		const noAnchor = both(await v2(QQQ_BUY, { cre: { ...CRE_MATCH, verdict: 'NO_ANCHOR', anchor_tx: '', recomputed_facts_hash: '', anchored_facts_hash: '' } }))
		expect([noAnchor.tier, noAnchor.decisive, noAnchor.paper_trade?.notional_usd]).toEqual(['REDUCED', ['A4'], '25.00'])
		const partial = both(await v2(QQQ_BUY, { record: { ...profitableRecord(), r1_status: 'partial', realized_usd: null } }))
		expect([partial.tier, partial.decisive]).toEqual(['REDUCED', ['C3', 'C4']])
		expect(buildCard(await v2(QQQ_BUY, { record: { ...profitableRecord(), r1_status: 'partial', realized_usd: null } }), partial).headline).toBe('Practice buy, reduced size: 25.00 USD of QQQ')
	})
	test('a wallet at a loss opens nothing by default, and a reduced position when the user says so', async () => {
		const loss = { ...profitableRecord(), realized_usd: '-81.19' }
		const d = both(await v2(QQQ_BUY, { record: loss }))
		expect([d.tier, d.conclusion, d.decisive]).toEqual(['NONE', 'DO_NOT_COPY', ['C4']])
		const lenient: Limits = { ...LIMITS, evidence: { ...LIMITS.evidence, wallet_at_a_loss: 'reduced' } }
		expect(both(await v2(QQQ_BUY, { record: loss }, lenient)).tier).toBe('REDUCED')
	})
	test('NONE with its reason: a look-alike, an anchor that does not match, no mandate, an unofficial venue, another signer, no price, a stale price, a sale', async () => {
		const fake = both(await v2(FAKE_NVDA, { move: { time: '2026-09-27T12:52:47.000Z', signer: '0x3433e16efacb71e0e2cd605489514b648b30abd0' }, tokens_moved: movedTokens(LIVE, FAKE_NVDA.transfers, {}, USDG) }))
		expect(fake.tier).toBe('NONE')
		expect(fake.decisive).toContain('C1')
		const fakeInp = await v2(FAKE_NVDA, { move: { time: '2026-09-27T12:52:47.000Z', signer: '0x3433e16efacb71e0e2cd605489514b648b30abd0' }, tokens_moved: movedTokens(LIVE, FAKE_NVDA.transfers, {}, USDG) })
		const card = buildCard(fakeInp, fake)
		expect(card.headline).toBe('No position: fake NVDA')
		expect(card.happened).toContain('sent this wallet 25 tokens that a block explorer lists as NVDA, under the name "NVIDIA Robinhood Coin"')
		expect(card.why[0]).toContain('The token is not NVDA. It is a look-alike at 0x5dd7…3539')
		expect(both(await v2(FAKE_USDG, { move: { time: '2026-10-06T01:57:00.000Z', signer: '0x1111111111111111111111111111111111111111' }, tokens_moved: movedTokens(LIVE, FAKE_USDG.transfers, {}, USDG) })).decisive).toContain('C1')
		expect(both(await v2(QQQ_BUY, { cre: { ...CRE_MATCH, verdict: 'MISMATCH', reason_bits: 32 } })).conclusion).toBe('HOLD')
		const unsigned = await v2()
		unsigned.mandate = mandateRef(unsigned.mandate.document, null)
		expect([both(unsigned).tier, both(unsigned).conclusion, both(unsigned).decisive]).toEqual(['NONE', 'HOLD', ['M1']])
		const other = await v2()
		other.mandate = { ...other.mandate, signer: '0x1111111111111111111111111111111111111111' }
		expect(both(other).decisive).toEqual(['M1'])
		expect(both(await v2(QQQ_BUY, { payer: '0x1111111111111111111111111111111111111111' })).decisive).toEqual(['M1'])
		expect(both(await v2(QQQ_BUY, { decided_at: '2027-01-01T00:00:00.000Z' })).decisive).toEqual(['M1'])
		expect(both(await v2(QQQ_BUY, { venue: [{ address: `0x${'9'.repeat(40)}`, kind: 'other' }] })).decisive).toEqual(['V1'])
		expect(both(await v2(QQQ_BUY, { move: { time: '2026-09-21T13:36:17.000Z', signer: '0x1111111111111111111111111111111111111111' } })).decisive).toEqual(['D1'])
		expect(both(await v2(QQQ_BUY, { price: null })).decisive).toEqual(['P1'])
		expect(both(await v2(QQQ_BUY, { price: { ...PRICE, updated_at: '2026-09-10T00:00:00.000Z' } })).decisive).toEqual(['P1'])
		expect(both(await v2(QQQ_BUY, { price: { ...PRICE, update_block: 99_000_000 } })).decisive).toEqual(['P1'])
		const sale = { ...QQQ_BUY, transfers: QQQ_BUY.transfers.map((t) => ({ ...t, direction: t.direction === 'in' ? ('out' as const) : ('in' as const) })) }
		const at = { venue: [{ address: PM, kind: 'uniswap-v4-pool-manager' as const }], price: PRICE }
		const sold = both(await v2(sale, at))
		expect(sold.decisive).toEqual(['D1'])
		expect(buildCard(await v2(sale, at), sold).headline).toBe('No position: not a buy by the wallet')
	})
	test("the user's limits: the daily limit shrinks the position and then stops it, and the open-position limit stops it", async () => {
		expect(both(await v2(QQQ_BUY, { book: { day: '2026-09-21', used_usd_today: '290.00', open_positions: 3 } })).paper_trade?.notional_usd).toBe('10.00')
		expect(both(await v2(QQQ_BUY, { book: { day: '2026-09-21', used_usd_today: '300.00', open_positions: 3 } })).decisive).toEqual(['L1'])
		expect(both(await v2(QQQ_BUY, { book: { day: '2026-09-21', used_usd_today: '0.00', open_positions: 10 } })).decisive).toEqual(['L2'])
	})
	test('the same inputs give the same trail, and an edited trail is refused by both checkers', async () => {
		const inp = await v2()
		const a = buildTrailV2(inp, DRY_PURCHASE)
		expect(canonicalJson(buildTrailV2(structuredClone(inp), DRY_PURCHASE))).toBe(canonicalJson(a))
		expect(recheckTrail(a).ok).toBe(true)
		expect(V.trailProblems(a).problems).toEqual([])
		const edits: ((t: TrailV2) => void)[] = [
			(t) => void (t.decision.tier = 'REDUCED'),
			(t) => void ((t.decision.paper_trade as any).notional_usd = '1000.00'),
			(t) => void (t.card.so = 'So copy-guard bought.'),
			(t) => void (t.inputs.limits.size.full_usd = '1000.00'),
			(t) => void (t.inputs.mandate.document.valid_until = '2030-01-01T00:00:00Z'),
			(t) => void (t.inputs.mandate.signer = '0x1111111111111111111111111111111111111111'),
			(t) => void ((t.inputs.price as Price).answer = '1'),
			(t) => void (t.inputs.payer = '0x1111111111111111111111111111111111111111'),
		]
		for (const edit of edits) {
			const t = structuredClone(a)
			edit(t)
			expect(recheckTrail(t).ok).toBe(false)
			expect(V.trailProblems(t).problems.length).toBeGreaterThan(0)
		}
	})
})

describe('the ledger walk', () => {
	const walk = join(REPO, 'docs/walk')
	const have = existsSync(join(walk, 'trails.jsonl')) && existsSync(join(REPO, 'docs/ledger.json'))
	test.skipIf(!have)('the saved walk: both writings rebuild docs/ledger.json from the trails and the feed values, row for row, with the same root', () => {
		const trails = readFileSync(join(walk, 'trails.jsonl'), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)) as TrailV2[]
		const feeds = JSON.parse(readFileSync(join(walk, 'feeds.json'), 'utf8'))
		const saved = JSON.parse(readFileSync(join(REPO, 'docs/ledger.json'), 'utf8'))
		const mine = buildLedger(trails, feeds, saved.mark_block)
		const theirs = V.ledgerOf(trails, feeds, saved.mark_block)
		expect(canonicalJson(theirs)).toBe(canonicalJson(mine))
		expect(canonicalJson(JSON.parse(JSON.stringify(mine)))).toBe(canonicalJson(saved))
		expect(mine.totals.decisions).toBeGreaterThanOrEqual(100)
		expect(mine.totals.full + mine.totals.reduced + mine.totals.none).toBe(mine.totals.decisions)
		for (const t of trails.slice(0, 40)) {
			expect(recheckTrail(t).ok).toBe(true)
			expect(canonicalJson(V.decideV2(t.inputs))).toBe(canonicalJson(t.decision))
		}
		// one changed decision changes the root
		const leaves = mine.rows.map((r) => r.leaf)
		expect(V.merkleRootOf(leaves)).toBe(merkleRoot(leaves))
		expect(merkleRoot([...leaves.slice(0, -1), `0x${'00'.repeat(32)}`])).not.toBe(mine.root)
	}, 120_000)
	test('the Merkle root: one leaf is itself, pairs are hashed in order, an odd last node moves up', () => {
		const h = (n: number) => `0x${n.toString(16).padStart(64, '0')}`
		expect(merkleRoot([h(1)])).toBe(h(1))
		for (const n of [2, 3, 4, 5, 7, 8, 33]) {
			const leaves = Array.from({ length: n }, (_, i) => h(i + 1))
			expect(V.merkleRootOf(leaves)).toBe(merkleRoot(leaves))
			expect(merkleRoot([...leaves].reverse())).not.toBe(merkleRoot(leaves))
		}
		expect(merkleRoot([h(1), h(2)])).toBe(viemKeccak(`0x${h(1).slice(2)}${h(2).slice(2)}`))
	})
})

describe('verify.mjs: the Permit2 digest', () => {
	test('its EIP-712 hash of the payment message is the digest viem gives', () => {
		const accept = { scheme: 'exact', network: 'eip155:4663', amount: '10000', asset: USDG, payTo: V.CLAIMS.payee, maxTimeoutSeconds: 120, extra: { assetTransferMethod: 'permit2' } }
		const built = permit2TypedData(accept, DRY_PURCHASE.payer, 1_791_000_000, 123456789n)
		expect(built.digest).toBe(hashTypedData(built.typedData))
		expect(V.permit2Digest(JSON.parse(JSON.stringify(built.typedData, (_k, v) => (typeof v === 'bigint' ? v.toString() : v))))).toBe(built.digest)
	})
})

test('liveRecord is partial and at a loss, so the demo wallet opens nothing under the default limits', async () => {
	const d = both(await v2(QQQ_BUY, { record: liveRecord() }))
	expect(d.tier).toBe('NONE')
	expect(d.decisive).toContain('C4')
})
