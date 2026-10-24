import { existsSync, readFileSync } from 'node:fs'
import { describe, expect, test } from 'bun:test'
import { creLogStampToUtcMs, creMatchStamp, creStampFitsRun, nodeVersionBlock, paidGateOrder } from './verify.mjs'

const LOG = 'docs/agent/paid-gate-run/gate-1792114689777-1.cre.txt'
const SETTLEMENT = '2026-10-16T01:38:19.000Z'

describe('paid gate order', () => {
	test('the CRE log is the published copy under docs/agent/paid-gate-run, not agent/state', () => {
		expect(LOG.startsWith('docs/agent/paid-gate-run/')).toBe(true)
		expect(LOG.includes('agent/state/')).toBe(false)
		expect(existsSync(LOG)).toBe(true)
	})

	test('a copy with the CRE answer and the settlement time swapped fails', () => {
		const log = readFileSync(LOG, 'utf8')
		const stamp = creMatchStamp(log)
		const creMs = creLogStampToUtcMs(stamp)
		const blockMs = Date.parse(SETTLEMENT)
		// The log prints +07:00 with a Z. Swapping the two instants rewrites MATCH to the settlement time in that labeling, and passes the original MATCH time in as the block.
		const swappedStamp = new Date(blockMs + 7 * 60 * 60 * 1000).toISOString().replace('.000Z', 'Z')
		const swapped = log.replace(`${stamp} [USER LOG] RESULT: MATCH`, `${swappedStamp} [USER LOG] RESULT: MATCH`)
		const [ok, detail] = paidGateOrder(creLogStampToUtcMs(creMatchStamp(swapped)), creMs)
		expect(ok).toBe(false)
		expect(detail).toContain('not before')
	})

	test('the saved log answers before the settlement block', () => {
		const log = readFileSync(LOG, 'utf8')
		const creMs = creLogStampToUtcMs(creMatchStamp(log))
		const [ok, detail] = paidGateOrder(creMs, Date.parse(SETTLEMENT))
		expect(ok).toBe(true)
		expect(detail).toContain('2026-10-16T01:38:16.000Z')
		expect(creStampFitsRun(creMs, 1792114689777)).toBe(true)
	})

	test('Node older than 20 stops with a reason', () => {
		expect(nodeVersionBlock('v18.20.8')).toContain('Node 20 or newer')
		expect(nodeVersionBlock('v18.20.8')).toContain('v18.20.8')
		expect(nodeVersionBlock('v20.0.0')).toBe(null)
		expect(nodeVersionBlock('v26.3.0')).toBe(null)
	})
})
