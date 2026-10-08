import { describe, expect, test } from 'bun:test'
import { canonicalJson } from '../rwa-verify/verify'
import { CRE_MATCH, FAKE_NVDA, FAKE_USDG, inputs, liveRecord, profitableRecord, QQQ_BUY } from './test-helpers'
import { classify, decide } from './rules'

const ids = (d: ReturnType<typeof decide>) => d.rule_results.filter((r) => !r.ok).map((r) => r.id)

describe('real movements of the demo wallet against the real record', () => {
	test('the fixtures are what they say', () => {
		const rec = liveRecord()
		expect(rec.x_facts_hash).toBe(rec.recomputed_facts_hash)
		expect(QQQ_BUY.transfers.map((t) => classify(t.token, rec))).toEqual(['stock', 'usdg', 'usdg', 'stock'])
		expect(FAKE_NVDA.transfers.map((t) => classify(t.token, rec))).toEqual(['fake'])
		expect(FAKE_USDG.transfers.map((t) => classify(t.token, rec))).toEqual(['fake'])
	})

	test('a real QQQ buy: the record is sound, but the track record is partial and at a loss', () => {
		const d = decide(inputs(QQQ_BUY))
		expect(d.conclusion).toBe('DO_NOT_COPY')
		expect(d.decisive).toEqual(['C3', 'C4'])
		expect(d.paper_trade).toBeNull()
	})

	test('a fake NVDA sent to the wallet is not a move to copy', () => {
		const d = decide(inputs(FAKE_NVDA))
		expect(d.conclusion).toBe('DO_NOT_COPY')
		expect(d.decisive).toContain('C1')
		expect(d.rule_results.find((r) => r.id === 'C1')?.detail).toContain('imitating NVDA')
	})

	test('a fake USDG log naming the wallet as sender is not a move to copy', () => {
		const d = decide(inputs(FAKE_USDG))
		expect(d.conclusion).toBe('DO_NOT_COPY')
		expect(d.decisive).toEqual(['C1', 'C2', 'C3', 'C4', 'C5'])
	})
})

describe('determinism', () => {
	test('same inputs, same rows and conclusion, every time', () => {
		const a = canonicalJson(decide(inputs(QQQ_BUY)))
		for (let i = 0; i < 20; i++) expect(canonicalJson(decide(inputs(QQQ_BUY)))).toBe(a)
	})

	test('key order and a JSON round trip do not change the result', () => {
		const inp = inputs(FAKE_NVDA)
		const reversed = JSON.parse(JSON.stringify(inp, (_k, v) => (v && typeof v === 'object' && !Array.isArray(v) ? Object.fromEntries(Object.entries(v).reverse()) : v)))
		expect(canonicalJson(decide(reversed))).toBe(canonicalJson(decide(inp)))
	})

	test('address case does not change the result', () => {
		const inp = inputs(QQQ_BUY, { wallet: '0xE9B08727131E34010b34006c660D4c1B436EC25f' })
		expect(canonicalJson(decide(inp))).toBe(canonicalJson(decide(inputs(QQQ_BUY))))
	})
})

describe('COPY needs every rule', () => {
	test('a complete, profitable record and a real Stock Token buy give a paper buy', () => {
		const d = decide(inputs(QQQ_BUY, { record: profitableRecord() }))
		expect(d.conclusion).toBe('COPY')
		expect(d.decisive).toEqual([])
		expect(d.paper_trade).toEqual({
			side: 'buy',
			token: '0xd5f3879160bc7c32ebb4dc785f8a4f505888de68',
			symbol: 'QQQ',
			price_usd: '751.7499',
			notional_usd: '100.00',
			shares: '0.133023',
		})
	})

	test('a fake stays DO_NOT_COPY even on a profitable record', () => {
		expect(decide(inputs(FAKE_NVDA, { record: profitableRecord() })).decisive).toEqual(['C1', 'C2', 'C5'])
	})
})

describe('HOLD when the evidence is not good enough', () => {
	const good = () => inputs(QQQ_BUY, { record: profitableRecord() })

	test('A1 terms above 0.01 USDG or to another wallet', () => {
		expect(ids(decide({ ...good(), terms: { ...good().terms, amount: '10001' } }))).toEqual(['A1'])
		expect(ids(decide({ ...good(), terms: { ...good().terms, payTo: '0x1111111111111111111111111111111111111111' } }))).toEqual(['A1'])
		expect(decide({ ...good(), terms: { ...good().terms, network: 'eip155:8453' } }).conclusion).toBe('HOLD')
	})

	test('A2 X-Facts-Hash that does not match the body', () => {
		const g = good()
		const d = decide({ ...g, record: { ...g.record, x_facts_hash: `0x${'1'.repeat(64)}` } })
		expect(d.conclusion).toBe('HOLD')
		expect(d.decisive).toEqual(['A2'])
	})

	test('A3 a record about another wallet', () => {
		const g = good()
		expect(decide({ ...g, record: { ...g.record, address: '0x1111111111111111111111111111111111111111' } }).decisive).toEqual(['A3'])
	})

	test('A4 CRE says MISMATCH, or the wallet has no anchor', () => {
		const g = good()
		expect(decide({ ...g, cre: { ...CRE_MATCH, verdict: 'MISMATCH', reason_bits: 288 } }).decisive).toEqual(['A4'])
		expect(decide({ ...g, cre: { ...CRE_MATCH, verdict: 'NO_ANCHOR', anchor_tx: '' } }).decisive).toEqual(['A4'])
	})

	test('A5 an unverified replay, A6 a look-alike that is counted or needs review', () => {
		const g = good()
		expect(decide({ ...g, record: { ...g.record, r1_status: 'unverified' } }).decisive).toEqual(['A5'])
		const counted = g.record.lookalikes.map((l, i) => (i === 0 ? { ...l, counted: true } : l))
		expect(decide({ ...g, record: { ...g.record, lookalikes: counted } }).decisive).toEqual(['A6'])
	})

	test('B1 a record older than the movement, B2 a token the record does not judge', () => {
		const g = good()
		expect(decide({ ...g, record: { ...g.record, as_of_block: QQQ_BUY.block - 1 } }).decisive).toEqual(['B1'])
		const odd = { ...QQQ_BUY, transfers: [...QQQ_BUY.transfers, { ...QQQ_BUY.transfers[0], token: '0x2222222222222222222222222222222222222222' }] }
		expect(decide({ ...g, movement: odd }).decisive).toEqual(['B2'])
	})

	test('HOLD wins over DO_NOT_COPY: a fake judged from an untrusted record is not a judgement', () => {
		const inp = inputs(FAKE_NVDA)
		const d = decide({ ...inp, record: { ...inp.record, x_facts_hash: `0x${'1'.repeat(64)}` } })
		expect(d.conclusion).toBe('HOLD')
		expect(d.decisive).toEqual(['A2'])
		expect(ids(d)).toContain('C1')
	})
})
