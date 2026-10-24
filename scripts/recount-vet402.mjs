#!/usr/bin/env node
// One GET of the public observatory export. Counts settled paid calls on Base the same way
// README line 3 does: network eip155:8453, status settled, attempted_at on or after 2026-08-14.
// Writes docs/vet402-count.json. Does not save the CSV.
//
//   node scripts/recount-vet402.mjs
//
// A later CSV cannot replay an earlier snapshot: a row can change from another status to
// settled. The 2026-10-24T00:02Z audit count of 9713 is this definition on that fetch. The
// 2026-10-23T21:32Z count of 9670 is the same definition on that earlier fetch.
import { createHash } from 'node:crypto'
import { existsSync, realpathSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

export const EXPORT_URL = 'https://vet402.com/api/v1/observatory/export.csv?days=365'
export const SINCE = '2026-08-14T00:00:00.000Z'
export const BEFORE_PAID_RUN = '2026-10-08T11:38:00.000Z'
export const BASE_NETWORK = 'eip155:8453'

export function parseCsv(text) {
	const rows = []
	let row = []
	let f = ''
	let q = false
	const src = String(text ?? '')
	for (let i = 0; i < src.length; i++) {
		const c = src[i]
		if (q) {
			if (c === '"' && src[i + 1] === '"') {
				f += '"'
				i++
			} else if (c === '"') q = false
			else f += c
		} else if (c === '"') q = true
		else if (c === ',') {
			row.push(f)
			f = ''
		} else if (c === '\n' || c === '\r') {
			if (c === '\r' && src[i + 1] === '\n') i++
			row.push(f)
			rows.push(row)
			row = []
			f = ''
		} else f += c
	}
	if (f.length || row.length) {
		row.push(f)
		rows.push(row)
	}
	const [head, ...body] = rows.filter((r) => r.length > 1 || r[0] !== '')
	if (!head) return []
	return body.map((r) => Object.fromEntries(head.map((h, i) => [h, r[i] ?? ''])))
}

export function attemptedMs(row) {
	const t = Date.parse(String(row?.attempted_at ?? '').trim())
	return Number.isFinite(t) ? t : NaN
}

export function countSettledBase(rows, { since = SINCE, before, until } = {}) {
	const sinceMs = typeof since === 'number' ? since : Date.parse(since)
	const beforeMs = before == null ? null : typeof before === 'number' ? before : Date.parse(before)
	const untilMs = until == null ? null : typeof until === 'number' ? until : Date.parse(until)
	let n = 0
	for (const r of rows) {
		if (String(r.network ?? '').trim() !== BASE_NETWORK) continue
		if (String(r.status ?? '').trim() !== 'settled') continue
		const t = attemptedMs(r)
		if (!Number.isFinite(t)) continue
		if (t < sinceMs) continue
		if (beforeMs != null && t >= beforeMs) continue
		if (untilMs != null && t > untilMs) continue
		n++
	}
	return n
}

export function countFromCsv(text) {
	const rows = parseCsv(text)
	return {
		settled_base_since_2026_08_14: countSettledBase(rows),
		settled_base_before_2026_10_08T11_38Z: countSettledBase(rows, { before: BEFORE_PAID_RUN }),
	}
}

async function main() {
	let repo = dirname(fileURLToPath(import.meta.url))
	while (!existsSync(join(repo, 'verify.mjs'))) {
		if (dirname(repo) === repo) throw new Error('verify.mjs not found above this script')
		repo = dirname(repo)
	}
	const retrieved_at_utc = new Date().toISOString()
	const res = await fetch(EXPORT_URL, { headers: { 'user-agent': 'vet402-copy-guard-recount/1' } })
	if (!res.ok) throw new Error(`${EXPORT_URL} -> HTTP ${res.status}`)
	const csv = await res.text()
	const sha256_of_csv = createHash('sha256').update(csv).digest('hex')
	const counts = countFromCsv(csv)
	const out = {
		retrieved_at_utc,
		url: EXPORT_URL,
		...counts,
		sha256_of_csv,
	}
	const path = join(repo, 'docs/vet402-count.json')
	writeFileSync(path, `${JSON.stringify(out, null, 2)}\n`)
	console.log(JSON.stringify(out, null, 2))
}

const invoked = process.argv[1] && existsSync(process.argv[1]) && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)
if (invoked) main().catch((e) => {
	console.error(e instanceof Error ? e.message : e)
	process.exit(1)
})
