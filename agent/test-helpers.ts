// Real data for the tests: the live /rwa record saved on 2026-10-08, the real 402
// terms saved on 2026-10-09, and the receipts of three real movements of the demo wallet.
import live from '../rwa-verify/fixtures/live-facts-2026-10-08.json'
import liveHeaders from '../rwa-verify/fixtures/live-facts-2026-10-08.headers.json'
import r68837431 from './fixtures/receipt-68837431.json'
import r73953009 from './fixtures/receipt-73953009.json'
import r81262132 from './fixtures/receipt-81262132.json'
import paymentRequired from './fixtures/payment-required-2026-10-09.json'
import { groupMovements } from './movement'
import { recordInputs } from './record'
import type { CreInputs, DecisionInputs, Movement } from './rules'
import type { Purchase } from './trail'
import { termsOf } from './x402'

export const WALLET = '0xe9b08727131e34010b34006c660d4c1b436ec25f'
export const LIVE = live
export const PAYMENT_REQUIRED = paymentRequired

const one = (r: any): Movement => {
	const [m] = groupMovements(WALLET, r.logs)
	if (!m) throw new Error('fixture has no movement')
	return m
}

/** Real QQQ buy paid in USDG. */
export const QQQ_BUY = one(r68837431)
/** A fake NVDA (0x5dd7…3539) sent to the wallet. */
export const FAKE_NVDA = one(r73953009)
/** A fake USDG log that names the wallet as sender (address poisoning). */
export const FAKE_USDG = one(r81262132)

export const CRE_MATCH: CreInputs = {
	workflow: 'vet402-rwa-verify',
	anchor_tx: '0x15f9ed8ae5dd466c2f35021c9f1291e7a624abbb52c8ac26b54d47442f585c7f',
	anchor_record_url: 'https://raw.githubusercontent.com/kzmttkc/vet402/main/fixtures/rwa/anchors/rwa-recon-0.3-76177721.json',
	verdict: 'MATCH',
	reason_bits: 0,
	recomputed_facts_hash: '0x9d0e83d968786570beebf0d322b36e0836dc81ebe896bd186304405ba8f721ee',
	anchored_facts_hash: '0x9d0e83d968786570beebf0d322b36e0836dc81ebe896bd186304405ba8f721ee',
	receiver: '0x8bf4d455d38301e9d330B12144AdE02F16BC2Cb3',
	mode: 'simulate',
	verdict_tx: null,
}

export function liveRecord(facts: any = live) {
	return recordInputs(facts, {
		source_url: 'https://vet402.com/api/v1/rwa/facts/0xE9B08727131E34010b34006c660D4c1B436EC25f?chain=4663',
		x_facts_hash: liveHeaders['x-facts-hash'],
	})
}

export function inputs(movement: Movement, over: Partial<DecisionInputs> = {}): DecisionInputs {
	return {
		wallet: WALLET,
		movement,
		terms: termsOf(paymentRequired.decoded.accepts[0]),
		record: liveRecord(),
		cre: CRE_MATCH,
		...over,
	}
}

/** The live record changed so the wallet looks like one worth copying, X-Facts-Hash recomputed to match. */
export function profitableRecord() {
	const facts = structuredClone(live) as any
	facts.r1_status = 'reconstructed'
	facts.realized_usd = '1250.00'
	const rec = liveRecord(facts)
	return { ...rec, x_facts_hash: rec.recomputed_facts_hash }
}

export const DRY_PURCHASE: Purchase = {
	mode: 'dry-run',
	resource: 'https://vet402.com/api/v1/rwa/paid/facts/0xE9B08727131E34010b34006c660D4c1B436EC25f',
	payer: '0xc380D9F41D90765A4820429B9Da151889E8bED94',
	payment_tx: null,
	settlement: 'not-sent',
	spent_before_atomic: '0',
	cap_atomic: '1000000',
	permit2_digest: `0x${'ab'.repeat(32)}`,
}
