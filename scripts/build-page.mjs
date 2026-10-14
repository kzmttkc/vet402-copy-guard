#!/usr/bin/env node
// Build docs/index.html from docs/page.template.html and docs/ledger.json.
//
//   node scripts/build-page.mjs
//
// The page is one static file. It carries the ledger as JSON and builds its cards and
// tables from it in the browser, so `node verify.mjs` can compare the ledger inside the
// page with docs/ledger.json. No dependency.
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { canonicalJson, keccak256 } from '../verify.mjs'

const REPO = join(dirname(fileURLToPath(import.meta.url)), '..')
const read = (p) => readFileSync(join(REPO, p), 'utf8')
const json = (p) => JSON.parse(read(p))
const maybe = (p, f) => (existsSync(join(REPO, p)) ? f(p) : null)
const embed = (v) => JSON.stringify(v).replace(/</g, '\\u003c')

const ledger = json('docs/ledger.json')
const sample = maybe('mandate/sample/mandate.json', json)
const verifyOut = maybe('docs/verify/verify-output.txt', read)
const extra = {
	showcase: ['0x0eac7685', '0x1b838f40', '0xf7cb51a2'],
	anchor: maybe('docs/walk/anchor.json', json),
	// The same fact as ledger.mandate.status === 'sample', kept under its old name for the template.
	sample_mandate: ledger.mandate.status === 'sample' || (sample !== null && keccak256(canonicalJson(sample)) === ledger.mandate.keccak),
	mandate_status: ledger.mandate.status,
	selection: maybe('docs/walk/selection.json', (p) => {
		const s = json(p)
		return { rule: s.rule, window: s.window, top: s.top, counts: s.counts, stop: s.stop, same_ticker_buyers: s.same_ticker_buyers ? { token: s.same_ticker_buyers.token, ticker: s.same_ticker_buyers.ticker, name: s.same_ticker_buyers.name, take: s.same_ticker_buyers.take, receivers: s.same_ticker_buyers.receivers } : null }
	}),
	verify: verifyOut ? verifyOut.trim().split('\n').slice(-2).join(' / ') : null,
	token_check: maybe('docs/token-check/page-note.txt', (p) => read(p).trim()),
}
const html = read('docs/page.template.html').replace('/*LEDGER*/', () => embed(ledger)).replace('/*EXTRA*/', () => embed(extra))
writeFileSync(join(REPO, 'docs/index.html'), html)
console.log(`docs/index.html  ${(html.length / 1024).toFixed(0)} kB, ${ledger.rows.length} decisions, root ${ledger.root}`)
