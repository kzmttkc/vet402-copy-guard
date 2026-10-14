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
import r68837431 from './fixtures/receipt-68837431.json'
import collectMove from './fixtures/move-collect-76631426.json'
import liquidityMove from './fixtures/move-liquidity.json'
import rotationMove from './fixtures/move-rotation.json'
import routedBuy from './fixtures/move-routed-buy.json'
import spyBuy from './fixtures/move-same-ticker-buy-87804532.json'
import { blindEntry, buildLedger, medianUsd, merkleRoot, moveUsd, poolRatio, PracticeBook } from './ledger'
import { MAY_NOT_ACT } from './mandate-text'
import { groupMovements } from './movement'
import { abiText, ISSUER_LIST, NO_RECORD, poolEntryOf, receiptFacts } from './tokens'
import { type Limits, limitsKeccak, parseLimits, paymentCapAtomic } from './limits'
import { type Mandate, mandateMessage, mandateRef, mandateSigner, personalHash, recoverAddress } from './mandate'
import { arrival, type DecisionInputsV2, decideV2, type MovedToken, type Price, type Venue } from './rules-v2'
import { CRE_MATCH, DRY_PURCHASE, FAKE_NVDA, FAKE_USDG, inputs, LIVE, liveRecord, profitableRecord, QQQ_BUY, WALLET } from './test-helpers'
import { buildTrailV2, recheckTrail, type TrailV2 } from './trail'
import { readWalkText, walkFileExists } from './walk-files'
import { MAX_SPEND_ATOMIC, permit2TypedData } from './x402'
import { movedTokens, otherName, shown } from './rules-v2'
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

/** Who sent a token the wallet received in a real receipt, as the walk records it. In a test the PoolManager is v4 and any other swapping address is taken as an official v3 pool (verify.mjs asks the chain). */
function venuesFrom(logs: any[], wallet: string, token: string, direction: 'in' | 'out', transfers: { token: string; from: string; to: string; direction: string }[]): Venue[] {
	const f = receiptFacts(logs, wallet)
	const direct = transfers.filter((t) => t.token === token && t.direction === direction).map((t) => (direction === 'in' ? t.from : t.to))
	return [...new Set([...(direction === 'in' ? (f.token_senders[token] ?? []) : []), ...direct])].map((a) => ({ address: a, kind: a === PM ? 'uniswap-v4-pool-manager' : f.swap_emitters.includes(a) ? 'uniswap-v3-pool' : 'other', swapped: f.swap_emitters.includes(a) }))
}
const QQQ_FACTS = receiptFacts(r68837431.logs as any, WALLET)

async function v2(movement = QQQ_BUY, over: Partial<DecisionInputsV2> = {}, limits: Limits = LIMITS): Promise<DecisionInputsV2> {
	const m = mandate(limits)
	const signature = await PRINCIPAL.signMessage({ message: mandateMessage(m) })
	const base = inputs(movement, { record: profitableRecord(), cre: CRE_MATCH })
	return {
		...base,
		decided_at: DECIDED,
		payer: PAYER,
		rules: RULES,
		move: { time: '2026-09-21T13:36:17.000Z', signer: WALLET, value_wei: '0', to: PM, selector: '0x3593564c', liquidity: movement === QQQ_BUY ? QQQ_FACTS.liquidity : [] },
		record_fetch: { url: 'https://vet402.com/api/v1/rwa/facts/0xE9B08727131E34010b34006c660D4c1B436EC25f?chain=4663', http_status: 200 },
		tokens_moved: movedTokens(LIVE, movement.transfers, { [QQQ]: 18, [USDG]: 6 }, USDG, ISSUER_LIST, null),
		token_check: null,
		pool_entry: null,
		venue: movement === QQQ_BUY ? venuesFrom(r68837431.logs as any, WALLET, QQQ, 'in', QQQ_BUY.transfers) : [],
		other_venue: [],
		price: movement === QQQ_BUY ? PRICE : null,
		limits,
		limits_keccak: limitsKeccak(limits),
		mandate: mandateRef(m, signature),
		book: { day: '2026-09-21', used_usd_today: '0.00', open_positions: 0 },
		...over,
	}
}

/** Inputs from one of the saved real transactions: the movement, the move's facts and the venues, all from its receipt. */
async function fromFixture(fx: { wallet: string; tx: { hash: string; from: string; to: string; value: string; selector: string }; time: string; logs: any[] }, over: Partial<DecisionInputsV2> = {}, facts: any = null) {
	const [mv] = groupMovements(fx.wallet, fx.logs as any).filter((x) => x.tx === fx.tx.hash)
	const tokens = movedTokens(facts, mv.transfers, { [USDG]: 6 }, USDG, ISSUER_LIST, null)
	const stock = mv.transfers.find((t) => tokens.find((x) => x.token === t.token)?.kind === 'stock')
	const other = mv.transfers.find((t) => t.direction === 'in' && tokens.find((x) => x.token === t.token)?.kind === 'same_ticker')
	return v2(mv, {
		wallet: fx.wallet,
		record: { ...profitableRecord(), address: fx.wallet, tokens: tokens.filter((x) => x.kind === 'stock').map((x) => ({ token: x.token, symbol: x.ticker, canonical: true, usd: null, shares_ui: '0' })), lookalikes: [] },
		move: { time: fx.time, signer: fx.tx.from, value_wei: fx.tx.value, to: fx.tx.to, selector: fx.tx.selector, liquidity: receiptFacts(fx.logs, fx.wallet).liquidity },
		tokens_moved: tokens,
		venue: stock ? venuesFrom(fx.logs, fx.wallet, stock.token, stock.direction, mv.transfers) : [],
		other_venue: other ? venuesFrom(fx.logs, fx.wallet, other.token, 'in', mv.transfers) : [],
		price: stock ? { ...PRICE, updated_at: fx.time, update_block: mv.block - 1 } : null,
		...over,
	})
}

const MOVE = { value_wei: '0', to: PM, selector: '0x3593564c', liquidity: [] as string[] }
const moved = (transfers: { token: string }[]) => movedTokens(LIVE, transfers, {}, USDG, ISSUER_LIST, null)
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
	test('the sample mandate in the repo is signed by its own principal, and the real one names a principal apart from the vet402 wallet that is paid', () => {
		const sample = JSON.parse(readFileSync(join(REPO, 'mandate/sample/mandate.json'), 'utf8'))
		const sig = readFileSync(join(REPO, 'mandate/sample/mandate.sig'), 'utf8').trim()
		expect(mandateSigner(sample, sig)).toBe(sample.principal.toLowerCase())
		expect(sample.title).toMatch(/^SAMPLE/)
		const real = JSON.parse(readFileSync(join(REPO, 'mandate/mandate.json'), 'utf8'))
		expect(real.principal.toLowerCase()).toBe(V.CLAIMS.principal)
		expect(real.principal.toLowerCase()).not.toBe(V.CLAIMS.payee)
		expect(real.scope.may_not).toContain(`pay any address other than 0x973cD8a91A771C2C04C6036888F8175D6b4F6227`)
		expect(readFileSync(join(REPO, 'mandate/mandate.message.txt'), 'utf8')).toBe(mandateMessage(real))
	})
})

describe('the size a decision ends in', () => {
	test('FULL: the issuer\'s token, official venue, bought by the wallet, priced by the feed, anchored, complete and in profit', async () => {
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
	test('NONE with its reason: a different token under a listed ticker, an anchor that does not match, no mandate, an unofficial venue, another signer, no price, a stale price, a sale', async () => {
		const sent = { move: { time: '2026-09-27T12:52:47.000Z', signer: '0x3433e16efacb71e0e2cd605489514b648b30abd0', ...MOVE }, tokens_moved: moved(FAKE_NVDA.transfers) }
		const other = both(await v2(FAKE_NVDA, sent))
		expect(other.tier).toBe('NONE')
		expect(other.decisive).toContain('C1')
		const card = buildCard(await v2(FAKE_NVDA, sent), other)
		expect(card.headline).toBe('No position: not the Stock Token NVDA, a different token with the same ticker')
		expect(card.happened).toBe('0x3433…abd0 sent this wallet 25 tokens with the ticker NVDA (named "NVIDIA Robinhood Coin"). No official swap put the token out in the transaction. The wallet did not sign the transaction (0x3433…abd0 did).')
		expect(card.why[0]).toStartWith('This is not the Robinhood Stock Token NVDA. It is a different token at 0x5dd7…3539 with the same ticker, at an address the issuer did not list. The Stock Token NVDA is at ')
		expect(card.why[0]).toEndWith('It says nothing about who made it or why.')
		expect(JSON.stringify(card)).not.toMatch(/fake|scam|look-alike/i)
		expect(both(await v2(FAKE_USDG, { move: { time: '2026-10-06T01:57:00.000Z', signer: '0x1111111111111111111111111111111111111111', ...MOVE }, tokens_moved: moved(FAKE_USDG.transfers) })).decisive).toContain('C1')
		expect(both(await v2(QQQ_BUY, { cre: { ...CRE_MATCH, verdict: 'MISMATCH', reason_bits: 32 } })).conclusion).toBe('HOLD')
		const unsigned = await v2()
		unsigned.mandate = mandateRef(unsigned.mandate.document, null)
		expect([both(unsigned).tier, both(unsigned).conclusion, both(unsigned).decisive]).toEqual(['NONE', 'HOLD', ['M1']])
		const stranger = await v2()
		stranger.mandate = { ...stranger.mandate, signer: '0x1111111111111111111111111111111111111111' }
		expect(both(stranger).decisive).toEqual(['M1'])
		expect(both(await v2(QQQ_BUY, { payer: '0x1111111111111111111111111111111111111111' })).decisive).toEqual(['M1'])
		expect(both(await v2(QQQ_BUY, { decided_at: '2027-01-01T00:00:00.000Z' })).decisive).toEqual(['M1'])
		const unofficial = await v2(QQQ_BUY, { venue: [{ address: `0x${'9'.repeat(40)}`, kind: 'other', swapped: true }] })
		expect(both(unofficial).decisive).toEqual(['V1', 'D1'])
		// The wallet paid USDG, but no official venue swapped: a purchase outside the official venues, not a delivery
		expect(arrival(unofficial, { token: QQQ, direction: 'in' })).toBe('purchase_off_venue')
		expect(buildCard(unofficial, both(unofficial)).headline).toBe('No position: bought outside the official Uniswap pools')
		expect(buildCard(unofficial, both(unofficial)).happened).toBe('The wallet bought 6.86032 QQQ (Invesco QQQ) through a venue outside the official Uniswap pools, paying 5,000 USDG. No official swap put the token out in the transaction. The wallet signed the transaction.')
		expect(blindEntry(unofficial)).toMatchObject({ token: QQQ, asset: 'stock' })
		const gift = await v2({ ...QQQ_BUY, transfers: QQQ_BUY.transfers.filter((t) => t.direction === 'in') }, { venue: unofficial.venue, price: PRICE, tokens_moved: unofficial.tokens_moved.filter((m) => m.kind === 'stock') })
		expect(arrival(gift, { token: QQQ, direction: 'in' })).toBe('received')
		expect(buildCard(gift, both(gift)).headline).toBe('No position: sent to the wallet, not bought by it')
		expect(blindEntry(gift)).toBeNull()
		// signed by a relayer: still a purchase, because the payment left the wallet itself
		const relayed = await v2(QQQ_BUY, { move: { time: '2026-09-21T13:36:17.000Z', signer: '0x1111111111111111111111111111111111111111', ...MOVE } })
		expect(both(relayed).tier).toBe('FULL')
		expect(buildCard(relayed, both(relayed)).happened).toContain('0x1111…1111 signed the transaction, and the payment left the wallet itself.')
		expect(both(await v2(QQQ_BUY, { price: null })).decisive).toEqual(['P1'])
		expect(both(await v2(QQQ_BUY, { price: { ...PRICE, updated_at: '2026-09-10T00:00:00.000Z' } })).decisive).toEqual(['P1'])
		expect(both(await v2(QQQ_BUY, { price: { ...PRICE, update_block: 99_000_000 } })).decisive).toEqual(['P1'])
		const sale = { ...QQQ_BUY, transfers: QQQ_BUY.transfers.map((t) => ({ ...t, direction: t.direction === 'in' ? ('out' as const) : ('in' as const) })) }
		const at = { venue: [{ address: PM, kind: 'uniswap-v4-pool-manager' as const, swapped: true }], price: PRICE }
		const sold = both(await v2(sale, at))
		expect(sold.decisive).toEqual(['D1'])
		expect(buildCard(await v2(sale, at), sold).headline).toBe('No position: a sale or a transfer out, not a purchase')
	})
	test('D1 is a purchase: an official swap put the token out and the wallet itself paid. The real QQQ buy paid USDG, and the same token with nothing paid, or paid in ETH, is told apart', async () => {
		const buy = await v2()
		expect(arrival(buy, { token: QQQ, direction: 'in' })).toBe('purchase')
		const d = both(buy)
		expect(d.rule_results.find((r) => r.id === 'D1')?.detail).toStartWith('bought: an official swap put it out and the wallet paid 5000000000 of 0x5fc5360d0400a0fd4f2af552add042d716f1d168')
		expect(buildCard(buy, d).happened).toMatch(/^The wallet bought 6\.86032 QQQ \(Invesco QQQ\) in a swap on (the Uniswap v4 PoolManager|an official Uniswap v3 pool) \(0x[0-9a-f]{4}…[0-9a-f]{4}\) and paid 5,000 USDG\. The wallet signed the transaction\.$/)
		const unpaidMove = { ...QQQ_BUY, transfers: QQQ_BUY.transfers.filter((t) => t.direction === 'in') }
		const unpaid = await v2(unpaidMove, { venue: buy.venue, price: PRICE, tokens_moved: buy.tokens_moved.filter((m) => m.kind === 'stock') })
		expect(arrival(unpaid, { token: QQQ, direction: 'in' })).toBe('swapped_unpaid')
		expect(both(unpaid).decisive).toEqual(['D1'])
		expect(buildCard(unpaid, both(unpaid)).headline).toBe('No position: swapped, but not paid for by the wallet')
		const eth = await v2(unpaidMove, { venue: buy.venue, price: PRICE, tokens_moved: unpaid.tokens_moved, move: { ...unpaid.move, value_wei: '39813720698039296' } })
		expect(both(eth).tier).toBe('FULL')
		expect(buildCard(eth, both(eth)).happened).toContain('and paid 0.039813 ETH.')
		// ETH carried by a transaction someone else signed is not the wallet's payment
		const relayedEth = await v2(unpaidMove, { venue: buy.venue, price: PRICE, tokens_moved: unpaid.tokens_moved, move: { ...unpaid.move, value_wei: '39813720698039296', signer: '0x1111111111111111111111111111111111111111' } })
		expect(arrival(relayedEth, { token: QQQ, direction: 'in' })).toBe('swapped_unpaid')
	})
	test('a real liquidity-pool collect (0x39967dd6…, Collect logs): SLV and USDG arrive from an official v3 pool and nothing is paid. A liquidity operation, opened by neither book', async () => {
		const SLV = '0x411efb0e7f985935daec3d4c3ebaea0d0ad7d89f'
		const inp = await fromFixture(collectMove as any)
		expect(collectMove.tx.selector).toBe('0xfc6f7865')
		expect(inp.move.liquidity).toEqual(['Collect'])
		expect(arrival(inp, { token: SLV, direction: 'in' })).toBe('liquidity')
		const d = both(inp)
		expect([d.tier, d.paper_trade]).toEqual(['NONE', null])
		expect(d.decisive).toContain('D1')
		expect(d.rule_results.find((r) => r.id === 'D1')?.detail).toBe('received in a transaction with liquidity logs (Collect): a liquidity operation, not a purchase')
		const card = buildCard(inp, d)
		expect(card.headline).toBe('No position: a liquidity operation, not a purchase')
		expect(card.happened).toContain('in a transaction that changes a liquidity position (Collect). That is not a purchase.')
		expect(blindEntry(inp)).toBeNull()
	})
	test('a real rearranged liquidity position (0x03989c0f…) is a liquidity operation, and a real exchange of SPY for NVDA (0x95c9447a…) is a rotation. Neither is a purchase in either book', async () => {
		const NVDA = '0xd0601ce157db5bdc3162bbac2a2c8af5320d9eec'
		const lp = await fromFixture(liquidityMove as any)
		expect(lp.move.liquidity.length).toBeGreaterThan(0)
		expect(arrival(lp, { token: NVDA, direction: 'in' })).toBe('liquidity')
		expect(both(lp).tier).toBe('NONE')
		expect(blindEntry(lp)).toBeNull()
		const rot = await fromFixture(rotationMove as any)
		const leg = rot.movement.transfers.find((t) => t.token === NVDA && t.direction === 'in') as any
		expect(arrival(rot, leg)).toBe('rotation')
		const d = both(rot)
		expect(d.tier).toBe('NONE')
		expect(blindEntry(rot)).toBeNull()
	})
	test('a real purchase through a router (0x445859d5…): the Stock Token reaches the wallet from the router, an official swap put it out, the wallet paid USDG. A purchase', async () => {
		const NVDA = '0xd0601ce157db5bdc3162bbac2a2c8af5320d9eec'
		const inp = await fromFixture(routedBuy as any)
		const leg = inp.movement.transfers.find((t) => t.token === NVDA && t.direction === 'in') as any
		expect(leg.from).toBe('0x3d90f66b534dd8482b181e24655a9e8265316be9')
		expect(inp.venue.some((v) => v.swapped && v.kind !== 'other')).toBe(true)
		expect(arrival(inp, leg)).toBe('purchase')
		const d = both(inp)
		expect(d.rule_results.find((r) => r.id === 'D1')?.ok).toBe(true)
		expect(d.rule_results.find((r) => r.id === 'V1')?.ok).toBe(true)
		expect(blindEntry(inp)?.asset).toBe('stock')
	})
	test('a real purchase of a different token under the ticker SPY (0x647ba3dc…): the card says the wallet bought it and what it paid, never that it was sent', async () => {
		const SPY_CHIP = '0x69e7778d46713e17572d610bdaca3943aa4e6219'
		const facts = { lookalikes: [{ token: SPY_CHIP, imitates: 'SPY', name_raw: 'Spy Chip' }] }
		const inp0 = await fromFixture(spyBuy as any, {}, facts)
		const mv = inp0.movement
		const tokens = inp0.tokens_moved
		expect(tokens).toEqual([{ token: SPY_CHIP, kind: 'same_ticker', ticker: 'SPY', name: 'Spy Chip', decimals: 18, by: 'record', listed_at: Object.keys(ISSUER_LIST).find((k) => ISSUER_LIST[k].symbol === 'SPY') as string }])
		const swaps = spyBuy.logs.filter((l: any) => l.address === PM && l.topics[0] === '0x40e9cecb9f5f1f1c5b9c97dec2917b7ee92e57ba5563708daca94dd84ad7112f')
		const entry = poolEntryOf(swaps as any, mv.transfers[0].amount_raw)
		expect(entry).not.toBeNull()
		const inp = { ...inp0, pool_entry: entry }
		expect(arrival(inp, { token: SPY_CHIP, direction: 'in' })).toBe('purchase')
		const d = both(inp)
		expect(d.decisive).toContain('C1')
		const card = buildCard(inp, d)
		expect(card.happened).toBe('The wallet bought 3,231,746.269751 tokens with the ticker SPY (named "Spy Chip") in a swap on the Uniswap v4 PoolManager (0x8366…0951) and paid 0.039813 ETH. The wallet signed the transaction.')
		expect(card.happened).not.toContain('sent this wallet')
		expect(card.headline).toBe('No position: not the Stock Token SPY, a different token with the same ticker')
		// with the CRE token-check results (the shape of docs/token-check/results.json) the basis of the sentence changes, and the row names the results file
		const cre = { source: 'docs/token-check/results.json', keccak: `0x${'cc'.repeat(32)}`, tokens: { [SPY_CHIP]: { issuer_token: false, ticker: 'SPY', reasons: ['NOT_IN_ISSUER_LIST', 'TICKER_SAME_AS_ISSUER_TOKEN'] } } }
		const withCre = { ...inp, token_check: cre, tokens_moved: movedTokens(null, mv.transfers, { [SPY_CHIP]: 18 }, USDG, ISSUER_LIST, cre) }
		const d2 = both(withCre)
		expect(withCre.tokens_moved[0]).toMatchObject({ by: 'cre', kind: 'same_ticker', ticker: 'SPY' })
		expect(buildCard(withCre, d2).why[0]).toContain('The Chainlink CRE token-check workflow read it from the chain (NOT_IN_ISSUER_LIST, TICKER_SAME_AS_ISSUER_TOKEN).')
		// an ordinary token outside the list (no listed mark) is not a same-ticker token
		const plain = { ...cre, tokens: { [SPY_CHIP]: { issuer_token: false, ticker: 'RIPE', reasons: ['NOT_IN_ISSUER_LIST'] } } }
		expect(movedTokens(null, mv.transfers, {}, USDG, ISSUER_LIST, plain)[0].kind).toBe('unknown')
		const hiddenUsdg = { ...cre, tokens: { [SPY_CHIP]: { issuer_token: false, ticker: 'U[U+17B5]S[U+17B5]DG', reasons: ['NOT_IN_ISSUER_LIST', 'TICKER_OR_NAME_READS_AS_USDG'] } } }
		expect(movedTokens(null, mv.transfers, {}, USDG, ISSUER_LIST, hiddenUsdg)[0]).toMatchObject({ kind: 'same_ticker', ticker: 'USDG' })
		// the ticker copy opens it. Its value comes from the pool, or it is not measured. Nothing is written off
		const b = blindEntry(inp)
		expect(b).toMatchObject({ asset: 'same_ticker', entry: null, pool: entry })
		const mark = { block: mv.block + 10, tx: `0x${'ab'.repeat(32)}`, log_index: 1, sqrt_price_x96: (BigInt((entry as any).sqrt_price_x96) * 2n).toString() }
		expect(poolRatio(entry as any, mark)).toBeCloseTo((entry as any).token_is_currency0 ? 4 : 0.25, 9)
		for (const [marks, valued, result] of [[{}, 'none', null], [{ [(entry as any).pool_id]: mark }, 'pool', (entry as any).token_is_currency0 ? '300.00' : '-75.00']] as const) {
			const book = new PracticeBook({}, LIMITS, marks as any)
			book.open(1, inp, { ...(b as any), tier: 'BLIND', notional: '100.00' })
			expect(book.finish(mv.block + 100)[0]).toMatchObject({ valued_by: valued, result_usd: result, status: 'open' })
		}
	})
	test('a token whose name carries invisible characters says so, and a wallet vet402 has no record for opens nothing and says why', async () => {
		const hidden: MovedToken[] = [{ token: FAKE_USDG.transfers[0].token, kind: 'same_ticker', ticker: 'USDG', name: 'U⟨U+206F⟩S⟨U+206F⟩DG', decimals: 6, by: 'record', listed_at: USDG }]
		const inp = await v2(FAKE_USDG, { move: { time: '2026-10-06T01:57:00.000Z', signer: '0x1111111111111111111111111111111111111111', ...MOVE }, tokens_moved: hidden })
		const card = buildCard(inp, both(inp))
		expect(card.happened).toContain('The marks ⟨U+…⟩ stand for invisible characters in the name: without them it reads USDG.')
		expect(card.headline).toBe('No position: not USDG, a different token with the same ticker')
		const none = await v2(QQQ_BUY, { record: { ...NO_RECORD, source_url: 'https://vet402.com/x' }, record_fetch: { url: 'https://vet402.com/x', http_status: 422 }, cre: { ...CRE_MATCH, verdict: 'NO_ANCHOR', anchor_tx: '', recomputed_facts_hash: '', anchored_facts_hash: '' } })
		const d = both(none)
		expect([d.tier, d.conclusion]).toEqual(['NONE', 'HOLD'])
		expect(d.decisive).toContain('A2')
		const c = buildCard(none, d)
		expect(c.headline).toBe('No position: vet402 has no record for this wallet')
		expect(c.why[0]).toStartWith("vet402 answered HTTP 422 when asked for this wallet's record")
		// the ticker copy needs no record: it still opens, which keeps the two columns about the same moves
		expect(blindEntry(none)?.asset).toBe('stock')
	})
	test('the CRE token-check, when its results are given, is what C2 reads: a listed address it does not confirm opens nothing', async () => {
		const ok = { source: 'docs/token-check/results.json', keccak: `0x${'cc'.repeat(32)}`, tokens: { [QQQ]: { issuer_token: true, ticker: 'QQQ', reasons: [] } } }
		const yes = await v2(QQQ_BUY, { token_check: ok, tokens_moved: movedTokens(LIVE, QQQ_BUY.transfers, { [QQQ]: 18, [USDG]: 6 }, USDG, ISSUER_LIST, ok) })
		expect(both(yes).tier).toBe('FULL')
		expect(both(yes).rule_results.find((r) => r.id === 'C2')?.detail).toContain(`CRE token-check: the issuer's token, results 0x${'cc'.repeat(32)}`)
		expect(buildCard(yes, both(yes)).why[0]).toContain('confirmed from the chain by the Chainlink CRE token-check workflow')
		const bad = { ...ok, tokens: { [QQQ]: { issuer_token: false, ticker: null, reasons: ['CODE_HASH_DIFFERS'] } } }
		const no = await v2(QQQ_BUY, { token_check: bad, tokens_moved: movedTokens(LIVE, QQQ_BUY.transfers, { [QQQ]: 18, [USDG]: 6 }, USDG, ISSUER_LIST, bad) })
		expect(both(no).tier).toBe('NONE')
		expect(both(no).decisive).toContain('C2')
	})
	test(`the mandate's sentence and the rules say the same: "${MAY_NOT_ACT}"`, async () => {
		const mandateFile = JSON.parse(readFileSync(join(REPO, 'mandate/mandate.json'), 'utf8'))
		const sampleFile = JSON.parse(readFileSync(join(REPO, 'mandate/sample/mandate.json'), 'utf8'))
		expect(mandateFile.scope.may_not).toContain(MAY_NOT_ACT)
		expect(sampleFile.scope.may_not).toContain(MAY_NOT_ACT)
		const noAnchor = { ...CRE_MATCH, verdict: 'NO_ANCHOR' as const, anchor_tx: '', recomputed_facts_hash: '', anchored_facts_hash: '' }
		const good = profitableRecord()
		// every way a rule of group A, B or M can fail, one at a time
		const failing: Record<string, Partial<DecisionInputsV2>> = {
			A1: { terms: { ...(await v2()).terms, payTo: `0x${'1'.repeat(40)}` } },
			A2: { record: { ...good, x_facts_hash: `0x${'0'.repeat(64)}` } },
			A3: { record: { ...good, address: `0x${'1'.repeat(40)}` } },
			A4: { cre: { ...CRE_MATCH, verdict: 'MISMATCH', reason_bits: 1 } },
			A5: { record: { ...good, r1_status: 'unverified' } },
			A6: { record: { ...good, lookalikes: [{ token: `0x${'2'.repeat(40)}`, imitates: 'NVDA', counted: true, needs_review: false }] } },
			B1: { record: { ...good, as_of_block: 1 } },
			B2: { tokens_moved: (await v2()).tokens_moved.map((m) => (m.kind === 'usdg' ? { ...m, kind: 'unknown' as const, by: 'none' as const } : m)) },
			M1: { payer: `0x${'1'.repeat(40)}` },
		}
		for (const [id, over] of Object.entries(failing)) {
			const d = both(await v2(QQQ_BUY, over))
			expect([id, d.rule_results.find((r) => r.id === id)?.ok, d.tier, d.paper_trade]).toEqual([id, false, 'NONE', null])
			expect(d.conclusion).toBe('HOLD')
		}
		// the one exception: A4 with no anchor yet, graded by the user's limits
		const reduced = both(await v2(QQQ_BUY, { cre: noAnchor }))
		expect([reduced.tier, reduced.decisive, reduced.paper_trade?.notional_usd]).toEqual(['REDUCED', ['A4'], LIMITS.size.reduced_usd])
		const strict: Limits = { ...LIMITS, evidence: { ...LIMITS.evidence, record_not_anchored: 'none' } }
		expect(both(await v2(QQQ_BUY, { cre: noAnchor }, strict)).tier).toBe('NONE')
		// and nothing else is graded in groups A, B and M: the groups of every graded row
		const gradedGroups = new Set(both(await v2(QQQ_BUY, { cre: noAnchor, record: { ...good, r1_status: 'partial', realized_usd: null } })).rule_results.filter((r) => r.effect === 'reduced').map((r) => r.id))
		expect([...gradedGroups].sort()).toEqual(['A4', 'C3', 'C4'])
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
	const have = walkFileExists(join(walk, 'trails.jsonl')) && existsSync(join(walk, 'context.json')) && existsSync(join(REPO, 'docs/ledger.json'))
	test.skipIf(!have)('the saved walk: both writings rebuild docs/ledger.json from the trails and the feed values, row for row, with the same root', () => {
		const trails = readWalkText(join(walk, 'trails.jsonl')).split('\n').filter(Boolean).map((l) => JSON.parse(l)) as TrailV2[]
		const feeds = JSON.parse(readFileSync(join(walk, 'feeds.json'), 'utf8'))
		const context = JSON.parse(readFileSync(join(walk, 'context.json'), 'utf8'))
		const saved = JSON.parse(readFileSync(join(REPO, 'docs/ledger.json'), 'utf8'))
		const mine = buildLedger(trails, feeds, saved.mark_block, context)
		const theirs = V.ledgerOf(trails, feeds, saved.mark_block, context)
		expect(canonicalJson(theirs)).toBe(canonicalJson(mine))
		expect(canonicalJson(JSON.parse(JSON.stringify(mine)))).toBe(canonicalJson(saved))
		// no position copy-guard opened rests on anything but a purchase: signed by the wallet and paid for
		for (const r of mine.rows.filter((x) => x.copy_guard.opened)) {
			expect([r.n, r.main?.arrival, r.main?.kind]).toEqual([r.n, 'purchase', 'stock'])
			expect(trails[r.n - 1].inputs.move.liquidity).toEqual([])
		}
		// every position of the ticker copy is in the same-size pass, and what copy-guard opened is a subset of it
		const sz = mine.totals.same_size
		expect(sz.opened_by_both.count).toBe(mine.totals.copy_guard.opened)
		expect(sz.opened_by_both.count + sz.opened_by_ticker_copy_only_stock.count + sz.opened_by_ticker_copy_only_other.count).toBe(mine.totals.blind_copy.opened)
		expect(mine.totals.blind_copy.in_other_tokens.measured + mine.totals.blind_copy.in_other_tokens.not_measured).toBe(mine.totals.blind_copy.in_other_tokens.count)
		expect(JSON.stringify(mine.rows.map((r) => r.card))).not.toMatch(/\bfake\b|\bscam\b|look-alike/i)
		expect(mine.totals.decisions).toBeGreaterThanOrEqual(100)
		expect(mine.totals.full + mine.totals.reduced + mine.totals.none).toBe(mine.totals.decisions)
		// the three groups add up to the whole book, and each says how much of it one wallet holds
		const g = Object.values(mine.totals.by_group)
		expect(g.reduce((x, y) => x + y.opened, 0)).toBe(mine.totals.copy_guard.opened)
		expect(g.reduce((x, y) => x + y.decisions, 0)).toBe(mine.totals.decisions)
		expect(g.reduce((x, y) => x + y.followed_purchases_usd.count, 0)).toBe(mine.totals.copy_guard.followed_purchases_usd.count)
		for (const x of g) {
			expect(x.opened + x.declined).toBe(x.decisions)
			if (x.top_wallet) expect(Number(x.top_wallet.share_pct)).toBeCloseTo((100 * x.top_wallet.opened) / x.opened, 1)
		}
		// every name of a different token under a listed ticker is filled
		for (const o of mine.totals.other_tokens.list) expect(o.name.trim()).not.toBe('')
		for (const t of trails.slice(0, 40)) {
			expect(recheckTrail(t).ok).toBe(true)
			expect(canonicalJson(V.decideV2(t.inputs))).toBe(canonicalJson(t.decision))
		}
		// one changed decision changes the root
		const leaves = mine.rows.map((r) => r.leaf)
		expect(V.merkleRootOf(leaves)).toBe(merkleRoot(leaves))
		expect(merkleRoot([...leaves.slice(0, -1), `0x${'00'.repeat(32)}`])).not.toBe(mine.root)
	}, 120_000)
	test('the median of amounts in USD', () => {
		expect(medianUsd([])).toBe('0.00')
		expect(medianUsd(['3.00', '1.00', '2.00'])).toBe('2.00')
		expect(medianUsd(['0.36', '10.00', '0.10', '5.00'])).toBe('2.68')
	})
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

describe('names read from the chain, and the money of a move', () => {
	test('name() and symbol() answers are decoded, invisible characters are marked, and a name is never blank', () => {
		const abi = (text: string) => {
			const hex = Buffer.from(text, 'utf8').toString('hex')
			return `0x${(32).toString(16).padStart(64, '0')}${(hex.length / 2).toString(16).padStart(64, '0')}${hex.padEnd(Math.ceil(hex.length / 64) * 64, '0')}`
		}
		for (const text of ['Spy Chip', 'U\u17b5S\u17b5DG', 'Global Dolar ', '']) {
			expect(abiText(abi(text))).toBe(text)
			expect(V.textOfCall(abi(text))).toBe(text)
		}
		const bytes32 = `0x${Buffer.from('SPY', 'utf8').toString('hex').padEnd(64, '0')}`
		expect(abiText(bytes32)).toBe('SPY')
		expect(V.textOfCall(bytes32)).toBe('SPY')
		expect(abiText('0x')).toBe('')
		expect(shown('U\u17b5S\u17b5DG')).toBe('U⟨U+17B5⟩S⟨U+17B5⟩DG')
		expect(shown('U\u206fS\u206fDG')).toBe('U⟨U+206F⟩S⟨U+206F⟩DG')
		expect(shown('NV\u200bDA\u0000')).toBe('NV⟨U+200B⟩DA⟨U+0000⟩')
		for (const x of ['Spy Chip', 'U\u17b5S\u17b5DG', 'a\u{e0041}b', 'Global Dollar']) expect(V.markInvisible(x)).toBe(shown(x))
		const token = '0x69e7778d46713e17572d610bdaca3943aa4e6219'
		expect(otherName(token, { [token]: { name: 'Spy Chip', symbol: 'SPY' } }, '')).toBe('Spy Chip')
		expect(otherName(token, {}, 'from the record')).toBe('from the record')
		expect(otherName(token, { [token]: { name: '', symbol: 'SPY' } }, '')).toBe('(no name; symbol SPY)')
		expect(otherName(token, {}, '')).toBe('(no name)')
		const cre = { source: 'x', keccak: `0x${'1'.repeat(64)}`, tokens: { [token]: { issuer_token: false, ticker: 'SPY', reasons: ['TICKER_SAME_AS_ISSUER_TOKEN'] } } }
		const names = { [token]: { name: 'Spy Chip', symbol: 'SPY' } }
		const mine = movedTokens(null, [{ token }], {}, USDG, ISSUER_LIST, cre, names)
		expect(mine[0]).toMatchObject({ kind: 'same_ticker', ticker: 'SPY', name: 'Spy Chip' })
		const list = Object.fromEntries(Object.entries(ISSUER_LIST).map(([k, v]) => [k, { symbol: v.symbol, name: v.name }]))
		expect(canonicalJson(V.movedTokensFrom(null, [{ token }], {}, list, cre, names))).toBe(canonicalJson(mine))
	})
	test('move_usd is the amount times the feed answer, rounded once to the cent, the same in both writings', async () => {
		const buy = await v2()
		const exact = (raw: bigint, answer: bigint, dec: number, fdec: number) => {
			const x = raw * answer * 100n
			const d = 10n ** BigInt(dec + fdec)
			const q = x / d
			return x % d * 2n >= d ? q + 1n : q
		}
		for (const answer of ['72928510000', '72928515000', '72928514999', '1']) {
			const inp = { ...buy, price: { ...(buy.price as NonNullable<typeof buy.price>), answer } }
			const raw = inp.movement.transfers.filter((t) => t.token === QQQ && t.direction === 'in').reduce((x, t) => x + BigInt(t.amount_raw), 0n)
			const c = exact(raw, BigInt(answer), 18, inp.price.decimals)
			const want = `${c / 100n}.${(c % 100n).toString().padStart(2, '0')}`
			expect(moveUsd(inp)).toBe(want)
		}
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
