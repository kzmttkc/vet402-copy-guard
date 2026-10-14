#!/usr/bin/env node
// Build docs/index.html from docs/page.template.html and docs/ledger.json, and docs/rows/.
//
//   node scripts/build-page.mjs
//
// The page is one static file a phone can open. It carries, with no network:
//   ledger-data   the ledger without its rows: the totals, both books with every position,
//                 the mandate, the limits, the walk's context and the root
//   rows-data     the full rows of the cards at the top, a short form of every decision in
//                 which either book opened a position, a different token under a listed
//                 ticker moved, or the size was not NONE, and one line per wallet
// Every other decision is in docs/rows/<wallet>.js, one file per wallet, which the page
// reads with a <script> tag when it is asked for (that works from file:// too). Each file
// is `vet402Rows([...rows])` with the wallet's rows exactly as docs/ledger.json has them.
// `node verify.mjs` checks the page and every file of docs/rows/ against docs/ledger.json.
// No dependency.
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { canonicalJson, keccak256 } from '../verify.mjs'
import { ARRIVALS, arrivalsOf, concentration, groupOf, groupsBrief, groupsOf, groupWords, observedToken, selectionSentence, verifyTimes } from './groups.mjs'

const REPO = join(dirname(fileURLToPath(import.meta.url)), '..')
const read = (p) => readFileSync(join(REPO, p), 'utf8')
const json = (p) => JSON.parse(read(p))
const maybe = (p, f) => (existsSync(join(REPO, p)) ? f(p) : null)
const embed = (v) => JSON.stringify(v).replace(/</g, '\\u003c')
const lc = (s) => String(s ?? '').toLowerCase()

const ledger = json('docs/ledger.json')
const { rows, ...head } = ledger
const template = read('docs/page.template.html')
const config = JSON.parse(template.match(/<script type="application\/json" id="page-config">([\s\S]*?)<\/script>/)[1])

// ---- the short form of a row, and which rows the page carries -------------------------
// verify.mjs holds its own copy of these two definitions and checks the page against them.
const shortRow = (r) => ({ n: r.n, wallet: r.wallet, cohort: r.cohort, move_tx: r.move_tx, move_time: r.move_time, tier: r.tier, main: r.main ?? null, copy_guard: { opened: r.copy_guard.opened }, blind_copy: { opened: r.blind_copy.opened }, card: { headline: r.card.headline } })
const OTHER_KIND = ['same_ticker', 'fake']
const isOtherRow = (r) => (r.main ? OTHER_KIND.includes(r.main.kind) : r.failed.includes('C1'))
const carried = (r) => Boolean(r.copy_guard.opened || r.blind_copy.opened) || r.tier !== 'NONE' || isOtherRow(r)

// ---- which cards stand at the top: the page-config block of the template ------------
// Version 3 names how a token came in rows[].main.arrival. Version 2 did not, so it is read from the card.
const arrivalOf = (r) => {
	if (r.main) return r.main.arrival
	const h = r.card.happened
	return /from this wallet|The wallet sent/.test(h) ? 'out' : /did not sign/.test(h) ? 'received_unsigned' : 'in_signed'
}
const guardPos = new Map(ledger.copy_guard_positions.map((p) => [p.n, p]))
const tickerOf = (r) => r.main?.ticker ?? guardPos.get(r.n)?.symbol ?? r.card.headline.split(' ').pop()
function fits(r, m) {
	if ('opened' in m && Boolean(r.copy_guard.opened) !== m.opened) return false
	if (m.asset === 'same_ticker' && !isOtherRow(r)) return false
	if (m.arrival && !m.arrival.includes(arrivalOf(r))) return false
	if (m.invisible_characters && !r.card.happened.includes('⟨U+')) return false
	return true
}
const chosen = []
for (const slot of config.cards) {
	const free = rows.filter((r) => !chosen.some((x) => x.row === r))
	const earlier = chosen.find((x) => x.slot === slot.same_ticker_as)
	const pool = free.filter((r) => fits(r, slot.match ?? {}))
	const row = (slot.tx && free.find((r) => r.move_tx.startsWith(slot.tx))) || (earlier && pool.find((r) => tickerOf(r) === tickerOf(earlier.row))) || pool[0]
	if (row) chosen.push({ slot: slot.slot, caption: slot.caption, row })
}

// ---- one file of rows per wallet, and one line per wallet ----------------------------
const rowsDir = join(REPO, 'docs/rows')
mkdirSync(rowsDir, { recursive: true })
for (const f of readdirSync(rowsDir)) if (f.endsWith('.js')) rmSync(join(rowsDir, f))
const order = [...ledger.context.wallets.map((w) => lc(w.wallet)), ...rows.map((r) => lc(r.wallet))].filter((w, i, a) => a.indexOf(w) === i)
const wallets = []
for (const w of order) {
	const mine = rows.filter((r) => lc(r.wallet) === w)
	if (!mine.length) continue
	const text = `vet402Rows(${JSON.stringify(mine)})\n`
	const bytes = Buffer.from(text, 'utf8')
	writeFileSync(join(rowsDir, `${w}.js`), bytes)
	const ctx = ledger.context.wallets.find((x) => lc(x.wallet) === w)
	wallets.push({
		wallet: w,
		cohort: mine[0].cohort,
		rank: ctx?.rank ?? null,
		decisions: mine.length,
		full: mine.filter((r) => r.tier === 'FULL').length,
		reduced: mine.filter((r) => r.tier === 'REDUCED').length,
		none: mine.filter((r) => r.tier === 'NONE').length,
		other_token_moves: mine.filter(isOtherRow).length,
		copy_guard_opened: mine.filter((r) => r.copy_guard.opened).length,
		ticker_copy_opened: mine.filter((r) => r.blind_copy.opened).length,
		ticker_copy_in_other_tokens: mine.filter((r) => r.blind_copy.opened && (r.blind_copy.opened.asset === 'same_ticker' || r.blind_copy.opened.fake === true)).length,
		file: `docs/rows/${w}.js`,
		bytes: bytes.length,
		keccak: keccak256(new Uint8Array(bytes)),
	})
}
const rowsData = { featured: chosen.map((x) => x.row), short: rows.filter(carried).map(shortRow), wallets }

// ---- what else the page shows ---------------------------------------------------------
const sample = maybe('mandate/sample/mandate.json', json)
const verifyOut = maybe('docs/verify/verify-output.txt', read)
const tcAnchor = maybe('docs/token-check/anchor.json', json)
const tcResults = maybe('docs/token-check/results.json', json)
const recheck = maybe('docs/token-check/recheck-output.txt', (p) => read(p).trimEnd().split('\n').pop().match(/RECHECK: (\d+) of (\d+) rows agree, (\d+) differ/))
// What the page says about the groups, the arrivals, the selection and the recheck: scripts/groups.mjs,
// the same words and counts the README has.
const selectionJson = maybe('docs/walk/selection.json', json)
const groups = groupsOf(ledger, selectionJson)
const vt = verifyTimes((p) => maybe(p, read), read('verify.mjs'))
const extra = {
	groups,
	groups_brief: groupsBrief(groups),
	concentration: concentration(groups),
	selection_sentence: selectionSentence(selectionJson, groups),
	observed_token: observedToken(selectionJson),
	group_names: Object.fromEntries([...new Set([...rows.map((r) => r.cohort), 'top_buyers', 'same_ticker_buyers', 'watched'])].map((c) => [c, groupWords(groupOf(c), selectionJson).name])),
	arrivals: arrivalsOf(ledger),
	arrival_words: ARRIVALS.map(([key, label, means]) => ({ key, label, means })),
	copy_guard_in_other_tokens: ledger.copy_guard_positions.filter((p) => p.asset === 'same_ticker' || p.fake === true).length,
	verify_times: { quick: vt.quick, full: vt.full, has_quick: vt.hasQuick, promise: vt.promise, quick_tail: vt.quickOutput ? vt.quickOutput.trimEnd().split('\n').slice(-2).join(' / ') : null },
	cards: chosen.map((x) => ({ slot: x.slot, caption: x.caption, n: x.row.n })),
	anchor: maybe('docs/walk/anchor.json', json),
	// The same fact as ledger.mandate.status === 'sample', kept under its old name for the template.
	sample_mandate: ledger.mandate.status === 'sample' || (sample !== null && keccak256(canonicalJson(sample)) === ledger.mandate.keccak),
	mandate_status: ledger.mandate.status,
	mandate_to_sign: maybe('mandate/mandate.json', (p) => ({ principal: json(p).principal })),
	selection: maybe('docs/walk/selection.json', (p) => {
		const s = json(p)
		return { rule: s.rule, window: s.window, top: s.top, counts: s.counts, stop: s.stop, same_ticker_buyers: s.same_ticker_buyers ? { token: s.same_ticker_buyers.token, ticker: s.same_ticker_buyers.ticker, name: s.same_ticker_buyers.name, take: s.same_ticker_buyers.take, receivers: s.same_ticker_buyers.receivers } : null }
	}),
	verify: verifyOut ? verifyOut.trim().split('\n').slice(-2).join(' / ') : null,
	token_check:
		tcAnchor && tcResults
			? {
					tokens: tcAnchor.tokens,
					issuer_tokens: tcAnchor.issuer_tokens,
					runs: tcAnchor.runs,
					anchor_tx: tcAnchor.anchor_tx,
					recheck: recheck ? { agree: Number(recheck[1]), of: Number(recheck[2]), differ: Number(recheck[3]) } : null,
				}
			: null,
	all_rows_bytes: wallets.reduce((s, w) => s + w.bytes, 0),
}
const html = template
	.replace('/*LEDGER*/', () => embed(head))
	.replace('/*ROWS*/', () => embed(rowsData))
	.replace('/*EXTRA*/', () => embed(extra))
writeFileSync(join(REPO, 'docs/index.html'), html)
console.log(`docs/index.html  ${(Buffer.byteLength(html) / 1024).toFixed(0)} kB (${rowsData.featured.length} cards, ${rowsData.short.length} of ${rows.length} decisions in short form), docs/rows/ ${wallets.length} files, ${(extra.all_rows_bytes / 1024).toFixed(0)} kB, root ${ledger.root}`)
