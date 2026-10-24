#!/usr/bin/env node
// Compare numbers in the given files with the canon from the ledger, saved recheck
// output and docs/vet402-count.json. Exit 1 when any mismatch is found.
//
//   node scripts/check-surfaces.mjs README.md
//
// Spelled-out numbers ("over nine thousand") are out of scope. They are listed in the
// notes so a reader knows they are not checked.
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

let REPO = dirname(fileURLToPath(import.meta.url))
while (!existsSync(join(REPO, 'verify.mjs'))) {
	if (dirname(REPO) === REPO) throw new Error('verify.mjs not found above this script')
	REPO = dirname(REPO)
}

const has = (p) => existsSync(join(REPO, p))
const read = (p) => readFileSync(join(REPO, p), 'utf8')
const json = (p) => JSON.parse(read(p))

export function skipSavedHeader(text) {
	const lines = String(text ?? '').split('\n')
	if (lines[0]?.startsWith('$ ') && lines.length >= 3) return lines.slice(3).join('\n')
	return String(text ?? '')
}

function commas(n) {
	return Number(n).toLocaleString('en-US')
}

function runSpan(text) {
	const xs = [...skipSavedHeader(text).matchAll(/^run \d+ \([^)]*\): exit \d+, (\d+) s,/gm)].map((m) => Number(m[1]))
	if (!xs.length) return null
	const min = Math.min(...xs)
	const max = Math.max(...xs)
	return { min, max, words: min === max ? `${min} s` : `${min} to ${max} s`, range: min === max ? `${min}` : `${min} to ${max}` }
}

function summaryOk(text) {
	const m = skipSavedHeader(text).match(/^(\d+) OK,/m)
	return m ? Number(m[1]) : null
}

export function canonOf(repo = REPO) {
	const file = (p) => readFileSync(join(repo, p), 'utf8')
	const L = JSON.parse(file('docs/ledger.json'))
	const t = L.totals
	const count = JSON.parse(file('docs/vet402-count.json'))
	const asOf = String(count.retrieved_at_utc).slice(0, 10)
	const settled = count.settled_base_since_2026_08_14
	const quick = has('docs/verify/verify-quick-output.txt') ? summaryOk(file('docs/verify/verify-quick-output.txt')) : null
	const full = has('docs/verify/verify-output.txt') ? summaryOk(file('docs/verify/verify-output.txt')) : null
	const offline = has('docs/verify/verify-offline.txt') ? summaryOk(file('docs/verify/verify-offline.txt')) : null
	const quickSpan = has('docs/verify/verify-quick-runs.txt') ? runSpan(file('docs/verify/verify-quick-runs.txt')) : null
	const fullSpan = has('docs/verify/verify-five-runs.txt') ? runSpan(file('docs/verify/verify-five-runs.txt')) : null
	const offlineSpan = has('docs/verify/verify-offline-runs.txt') ? runSpan(file('docs/verify/verify-offline-runs.txt')) : null
	const li = t.large_incoming?.signed_by_the_wallet
	return {
		settled_base: settled,
		settled_base_words: commas(settled),
		as_of: asOf,
		decisions: t.decisions,
		opened: t.copy_guard.opened,
		none: t.none,
		wallets: t.wallets,
		other_tokens: t.other_tokens.tokens,
		other_moves: t.other_tokens.moves,
		large_liq: li?.by_arrival?.liquidity ?? null,
		large_count: li?.count ?? null,
		token_check: L.totals.token_check?.tokens ?? null,
		ticker_copy_other: t.blind_copy?.in_other_tokens?.count ?? null,
		ok: [full, quick, offline].filter((n) => n != null),
		second_ranges: [quickSpan, fullSpan, offlineSpan].filter(Boolean).map((s) => s.range),
		notes: [
			'spelled-out numbers such as "over nine thousand" are not checked',
			'probe402\'s "read on 2 October 2026" is that report\'s own date, not this fetch',
		],
	}
}

function parseNum(s) {
	return Number(String(s).replace(/,/g, ''))
}

export function checkSurfaces(files, { repo = REPO, canon } = {}) {
	const C = canon ?? canonOf(repo)
	const mismatches = []
	const knownNums = new Set(
		[C.decisions, C.opened, C.none, C.wallets, C.other_tokens, C.other_moves, C.large_liq, C.large_count, C.token_check, C.ticker_copy_other, C.settled_base, ...C.ok]
			.filter((n) => n != null)
			.map(Number),
	)
	const phrases = [
		{
			re: /([\d,]+) settled paid calls on Base/g,
			check: (m, file) => {
				if (parseNum(m[1]) !== C.settled_base) mismatches.push({ file, got: m[1], want: C.settled_base_words, phrase: m[0] })
			},
		},
		{
			re: /(\d+) OK\b/g,
			check: (m, file) => {
				const n = Number(m[1])
				if (!C.ok.includes(n)) mismatches.push({ file, got: n, want: C.ok.join('|'), phrase: m[0] })
			},
		},
		{
			re: /(\d+) to (\d+) s(?:econds)?\b/g,
			check: (m, file) => {
				const range = `${m[1]} to ${m[2]}`
				if (!C.second_ranges.includes(range)) mismatches.push({ file, got: range, want: C.second_ranges.join('|'), phrase: m[0] })
			},
		},
		{
			re: /as of (\d{4}-\d{2}-\d{2})(?!T)/gi,
			check: (m, file) => {
				if (m[1] !== C.as_of) mismatches.push({ file, got: m[1], want: C.as_of, phrase: m[0] })
			},
		},
		{
			re: /(\d+) of the (\d+) arrivals/g,
			check: (m, file) => {
				if (Number(m[1]) !== C.large_liq || Number(m[2]) !== C.large_count) mismatches.push({ file, got: `${m[1]}/${m[2]}`, want: `${C.large_liq}/${C.large_count}`, phrase: m[0] })
			},
		},
		{
			re: /looked at (\d+) moves of (\d+) wallets/g,
			check: (m, file) => {
				if (Number(m[1]) !== C.decisions || Number(m[2]) !== C.wallets) mismatches.push({ file, got: `${m[1]}/${m[2]}`, want: `${C.decisions}/${C.wallets}`, phrase: m[0] })
			},
		},
		{
			re: /read on ([^.\n)]+)/g,
			check: (m, file) => {
				const s = m[1].trim()
				if (s.includes(C.as_of) || /2 October 2026/.test(s)) return
				mismatches.push({ file, got: s, want: `${C.as_of}|2 October 2026`, phrase: m[0] })
			},
		},
	]
	const listed = [8396, 236, 8160, 214, 223, 143, 67, 24, 51]
	for (const file of files) {
		const raw = file.startsWith('/') || existsSync(file) ? readFileSync(file, 'utf8') : readFileSync(join(repo, file), 'utf8')
		const text = raw.replace(/<!--[\s\S]*?-->/g, '')
		for (const p of phrases) {
			p.re.lastIndex = 0
			for (const m of text.matchAll(p.re)) p.check(m, file)
		}
		for (const n of listed) {
			const re = new RegExp(`\\b${n}\\b`, 'g')
			if (!re.test(text)) continue
			if (!knownNums.has(n)) mismatches.push({ file, got: n, want: 'a canon value', phrase: String(n) })
		}
	}
	return { canon: C, mismatches, count: mismatches.length, notes: C.notes }
}

function report(result) {
	const { canon: C, mismatches, notes } = result
	console.log('canon:')
	console.log(`  settled Base since 2026-08-14: ${C.settled_base_words}`)
	console.log(`  as of: ${C.as_of}`)
	console.log(`  decisions ${C.decisions}, opened ${C.opened}, declined ${C.none}, wallets ${C.wallets}`)
	console.log(`  other tokens ${C.other_tokens} in ${C.other_moves} moves, ticker copy in them ${C.ticker_copy_other}`)
	console.log(`  large incoming ${C.large_liq} of ${C.large_count}, token-check ${C.token_check}`)
	console.log(`  OK counts: ${C.ok.join(', ')}`)
	console.log(`  second ranges: ${C.second_ranges.join(', ')}`)
	for (const n of notes) console.log(`  note: ${n}`)
	if (!mismatches.length) {
		console.log('mismatches: 0')
		return
	}
	console.log(`mismatches: ${mismatches.length}`)
	for (const m of mismatches) console.log(`  ${m.file}: ${m.phrase} (got ${m.got}, want ${m.want})`)
}

const invoked = process.argv[1] && existsSync(process.argv[1]) && resolve(process.argv[1]) === fileURLToPath(import.meta.url)
if (invoked) {
	const files = process.argv.slice(2)
	if (!files.length) {
		console.error('usage: node scripts/check-surfaces.mjs <file>...')
		process.exit(2)
	}
	let result
	try {
		result = checkSurfaces(files)
	} catch (e) {
		console.error(e instanceof Error ? e.message : e)
		process.exit(2)
	}
	report(result)
	process.exit(result.count === 0 ? 0 : 1)
}
