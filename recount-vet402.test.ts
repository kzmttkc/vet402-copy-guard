import { describe, expect, test } from 'bun:test'
import { countSettledBase, parseCsv } from './scripts/recount-vet402.mjs'

const HEAD = 'attempted_at,resource_key,network,status,amount_units,spent_units,tx_hash,http_status_paid,latency_ms,l2_schema,held_reason,request_body,request_body_sha256,settlement_source,request_query,request_query_sha256,confirmed_units,purchase_id,l2_reading'

function row(at, network, status) {
	return `${at},example,${network},${status},1,1,0x1,200,1,match,,{},,vet402_index,{},,1,p,`
}

describe('vet402 settled Base counts', () => {
	test('counts settled eip155:8453 rows from 2026-08-14, and those before 2026-10-08T11:38Z, from one CSV', () => {
		const csv = [
			HEAD,
			row('2026-08-13T23:59:59Z', 'eip155:8453', 'settled'),
			row('2026-08-14T00:00:00Z', 'eip155:8453', 'settled'),
			row('2026-08-14T00:00:01Z', 'eip155:8453', 'settle_failed'),
			row('2026-10-08T11:37:59Z', 'eip155:8453', 'settled'),
			row('2026-10-08T11:38:00Z', 'eip155:8453', 'settled'),
			row('2026-08-14T12:00:00Z', 'solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp', 'settled'),
			row('2026-10-23T21:32:01Z', 'eip155:8453', 'settled'),
		].join('\n')
		const rows = parseCsv(csv)
		expect(countSettledBase(rows)).toBe(4)
		expect(countSettledBase(rows, { before: '2026-10-08T11:38:00.000Z' })).toBe(2)
		expect(countSettledBase(rows, { until: '2026-10-23T21:32:00.000Z' })).toBe(3)
		expect(countSettledBase(rows, { until: '2026-10-24T00:02:00.000Z' })).toBe(4)
	})
})
