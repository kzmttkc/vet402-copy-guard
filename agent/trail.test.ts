import { describe, expect, test } from 'bun:test'
import { offlineChecks } from './check-trail'
import { buildTrail, recheckTrail, trailHash, trailReportFields } from './trail'
import { DRY_PURCHASE, FAKE_NVDA, inputs, LIVE, profitableRecord, QQQ_BUY } from './test-helpers'

const meta = { decided_at: '2026-10-09T06:00:00.000Z', rules_source_keccak: `0x${'cd'.repeat(32)}` }
const envelope = (t = buildTrail(inputs(FAKE_NVDA), DRY_PURCHASE, meta)) => ({ trail: t, trail_hash: trailHash(t), trail_tx: null })

describe('the key-free checker', () => {
	test('a trail the agent wrote holds, with and without the saved record', () => {
		const e = envelope()
		expect(offlineChecks(e).every((c) => c.ok)).toBe(true)
		expect(offlineChecks(e, LIVE).every((c) => c.ok)).toBe(true)
		expect(e.trail.decision.conclusion).toBe('DO_NOT_COPY')
	})

	test('a changed conclusion is caught', () => {
		const e = envelope()
		e.trail.decision.conclusion = 'COPY'
		e.trail_hash = trailHash(e.trail)
		const c = offlineChecks(e)
		expect(c.find((x) => x.name === 'rules')?.ok).toBe(false)
		expect(c.find((x) => x.name === 'rules')?.detail).toContain('does not follow')
	})

	test('a changed rule row is caught even when the conclusion stays', () => {
		const e = envelope()
		e.trail.decision.rule_results[0].detail = 'edited'
		e.trail_hash = trailHash(e.trail)
		expect(offlineChecks(e).find((x) => x.name === 'rules')?.ok).toBe(false)
	})

	test('a changed input is caught: rows no longer follow', () => {
		const e = envelope(buildTrail(inputs(QQQ_BUY), DRY_PURCHASE, meta))
		e.trail.inputs.record.realized_usd = '999.00'
		e.trail_hash = trailHash(e.trail)
		expect(offlineChecks(e).find((x) => x.name === 'rules')?.ok).toBe(false)
	})

	test('any edit without a new hash is caught by the hash', () => {
		const e = envelope()
		e.trail.decided_at = '2026-10-09T06:00:01.000Z'
		expect(offlineChecks(e).find((x) => x.name === 'trail hash')?.ok).toBe(false)
	})

	test('a saved record with one character changed is caught', () => {
		const e = envelope()
		const edited = structuredClone(LIVE) as any
		edited.tokens[0].realized_usd = '-170.58'
		const c = offlineChecks(e, edited).find((x) => x.name === 'record')
		expect(c?.ok).toBe(false)
	})

	test('a dry run that claims a payment tx, or a paid trail without one, is refused', () => {
		const t = buildTrail(inputs(FAKE_NVDA), { ...DRY_PURCHASE, payment_tx: `0x${'1'.repeat(64)}` }, meta)
		expect(recheckTrail(t).ok).toBe(false)
		const p = buildTrail(inputs(FAKE_NVDA), { ...DRY_PURCHASE, mode: 'paid' }, meta)
		expect(recheckTrail(p).ok).toBe(false)
	})

	test('the hash ignores key order', () => {
		const t = buildTrail(inputs(QQQ_BUY, { record: profitableRecord() }), DRY_PURCHASE, meta)
		const reordered = JSON.parse(JSON.stringify(t, (_k, v) => (v && typeof v === 'object' && !Array.isArray(v) ? Object.fromEntries(Object.entries(v).reverse()) : v)))
		expect(trailHash(reordered)).toBe(trailHash(t))
		expect(t.decision.conclusion).toBe('COPY')
	})

	test('the onchain summary carries the hash, the subject and the conclusion code', () => {
		const t = buildTrail(inputs(FAKE_NVDA), DRY_PURCHASE, meta)
		const f = trailReportFields(t)
		expect(f.trailHash).toBe(trailHash(t))
		expect(f.subject).toBe('0xa158baaf573f2b072b47acaa019ef60de680571a8a2a6ad234faf0e8a3d3bfc5')
		expect(f.conclusion).toBe(1)
		expect(f.paymentTx).toBe(`0x${'0'.repeat(64)}`)
		expect(f.rulesVersion).toBe(1)
	})
})
