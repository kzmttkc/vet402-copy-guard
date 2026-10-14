// Builds docs/token-check/tokens.json from the saved walk, for the time before the
// walk writes docs/walk/tokens.json itself: every token that moved in a decision
// (docs/walk/trails.jsonl), every token and look-alike a record names, and every
// token of a position in docs/ledger.json. Addresses in lower case, in order of
// first appearance.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { gunzipSync } from 'node:zlib'

const root = new URL('..', import.meta.url).pathname
const seen = new Set()
const add = (a) => typeof a === 'string' && /^0x[0-9a-fA-F]{40}$/.test(a) && seen.add(a.toLowerCase())

const trails = `${root}docs/walk/trails.jsonl`
// The walk keeps this file gzipped (trails.jsonl.gz). Either form is read.
const trailsText = existsSync(`${trails}.gz`) ? gunzipSync(readFileSync(`${trails}.gz`)).toString('utf8') : existsSync(trails) ? readFileSync(trails, 'utf8') : null
if (trailsText) {
	for (const line of trailsText.split('\n')) {
		if (!line.trim()) continue
		const t = JSON.parse(line)
		for (const tr of t.inputs?.movement?.transfers ?? []) add(tr.token)
		for (const m of t.inputs?.tokens_moved ?? []) add(m.token)
		for (const r of t.inputs?.record?.tokens ?? []) add(r.token)
		for (const l of t.inputs?.record?.lookalikes ?? []) add(l.token)
	}
}
const ledger = `${root}docs/ledger.json`
if (existsSync(ledger)) {
	const l = JSON.parse(readFileSync(ledger, 'utf8'))
	for (const p of [...(l.copy_guard_positions ?? []), ...(l.blind_copy_positions ?? [])]) add(p.token)
}
if (seen.size === 0) throw new Error('no token found in docs/walk/trails.jsonl or docs/ledger.json')
mkdirSync(`${root}docs/token-check`, { recursive: true })
writeFileSync(`${root}docs/token-check/tokens.json`, `${JSON.stringify([...seen], null, 2)}\n`)
console.log(`docs/token-check/tokens.json: ${seen.size} tokens`)
