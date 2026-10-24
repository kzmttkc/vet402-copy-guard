// The published recheck numbers are one run, copied into every surface.
// A hand edit of one surface fails here. PUBLISHED_ROOT points the same checks at a copy.
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, test } from 'bun:test'

const ROOT = process.env.PUBLISHED_ROOT ?? join(import.meta.dir)
const read = (p: string) => readFileSync(join(ROOT, p), 'utf8')

function marked(text: string, name: string) {
	const a = `<!-- ${name}:BEGIN -->`
	const b = `<!-- ${name}:END -->`
	const i = text.indexOf(a)
	const j = text.indexOf(b)
	if (i < 0 || j < 0 || j < i) throw new Error(`README has no ${name} block`)
	return text.slice(i + a.length, j)
}

/**
 * Bodies of fences opened by a line that is exactly ```.
 * A ```bash fence stays closed until its own closing line, so that line is not a second opening.
 */
function plainFences(block: string) {
	const bodies: string[] = []
	let open: 'plain' | 'other' | null = null
	let buf: string[] = []
	for (const line of block.split('\n')) {
		if (open === null) {
			if (line === '```') {
				open = 'plain'
				buf = []
			} else if (line.startsWith('```')) open = 'other'
		} else if (line === '```') {
			if (open === 'plain') bodies.push(buf.join('\n'))
			open = null
		} else if (open === 'plain') buf.push(line)
	}
	return bodies
}

function fence(block: string) {
	const bodies = plainFences(block)
	if (bodies.length !== 1) throw new Error(`a marked block has ${bodies.length} plain fences`)
	return bodies[0]
}

/** Status lines the recheck prints (`  OK    name`). The summary `N OK,` is not one of them. */
function okStatusLines(body: string) {
	return body.split('\n').filter((l) => /^\s+OK\s{2,}/.test(l)).length
}

function skipSavedHeader(text: string) {
	const lines = text.split('\n')
	if (lines[0]?.startsWith('$ ') && lines.length >= 3) return lines.slice(3).join('\n')
	return text
}

function summaryOk(text: string) {
	const m = skipSavedHeader(text).match(/^(\d+) OK,/m)
	if (!m) throw new Error('no "N OK" summary')
	return Number(m[1])
}

/** Median of the five saved full runs, as the guidance sentence states it. */
function phraseFromFiveRuns(text: string) {
	const xs = [...skipSavedHeader(text).matchAll(/^run \d+ \([^)]*\): exit \d+, (\d+) s,/gm)].map((m) => Number(m[1]))
	if (xs.length !== 5) throw new Error(`verify-five-runs.txt has ${xs.length} runs, expected 5`)
	const median = [...xs].sort((a, b) => a - b)[2]
	const n = Math.round(median / 60)
	return `about ${n} minute${n === 1 ? '' : 's'}`
}

describe('published verify numbers', () => {
	test('the README output block has as many OK lines as its tail says', () => {
		const readme = read('README.md')
		const body = fence(marked(readme, 'VERIFY'))
		const tail = fence(marked(readme, 'VERIFY_TAIL'))
		const lines = okStatusLines(body)
		expect(summaryOk(body)).toBe(lines)
		expect(summaryOk(tail)).toBe(lines)
	})

	test('page-data verify and quick_tail match the README tails', () => {
		const readme = read('README.md')
		const html = read('docs/index.html')
		const m = html.match(/<script type="application\/json" id="page-data">([\s\S]*?)<\/script>/)
		if (!m) throw new Error('docs/index.html has no page-data')
		const page = JSON.parse(m[1]) as { verify: string; verify_times: { quick_tail: string } }
		const tail = fence(marked(readme, 'VERIFY_TAIL')).split('\n').join(' / ')
		expect(page.verify).toBe(tail)
		const quickFences = plainFences(marked(readme, 'VERIFY_RUN'))
		expect(quickFences).toHaveLength(1)
		expect(page.verify_times.quick_tail).toBe(quickFences[0].split('\n').join(' / '))
	})

	test('the guidance sentence in verify.mjs and the README is about N minutes from the five-run median', async () => {
		const five = read('docs/verify/verify-five-runs.txt')
		const phrase = phraseFromFiveRuns(five)
		const sentence = `node verify.mjs (${phrase})`
		const readme = read('README.md')
		const src = read('verify.mjs')
		expect(readme).toContain(sentence)
		const literals = [...src.matchAll(/node verify\.mjs \((about [^)]+)\)/g)].map((m) => m[1])
		for (const lit of literals) expect(lit).toBe(phrase)
		const said = src.includes('export function fullRunGuidance')
			? (await import('./verify.mjs')).fullRunGuidance(five).match(/node verify\.mjs \((about [^)]+)\)/)?.[1]
			: literals[0]
		expect(said).toBe(phrase)
	})

	test('the ledger check names off-venue buys so the other-token parts sum to moves', () => {
		const src = read('verify.mjs')
		const start = src.indexOf('Different tokens under a listed ticker were part of')
		expect(start).toBeGreaterThan(0)
		const chunk = src.slice(start, start + 900)
		expect(chunk).toContain('bought_off_venue')
		expect(chunk).toContain('bought outside the official venues')
		const L = JSON.parse(read('docs/ledger.json')) as {
			totals: {
				other_tokens: {
					moves: number
					sent_to_the_wallet: number
					bought_by_the_wallet: number
					bought_off_venue: number
					received_unpaid: number
					logged_as_sent_by_the_wallet: number
				}
			}
		}
		const o = L.totals.other_tokens
		const parts = [o.sent_to_the_wallet, o.bought_by_the_wallet, o.bought_off_venue, o.received_unpaid, o.logged_as_sent_by_the_wallet]
		expect(parts.reduce((a, b) => a + b, 0)).toBe(o.moves)
	})

	test('Run it installs rwa-verify before agent, then the repo-root tests', () => {
		const readme = read('README.md')
		const i = readme.indexOf('### Run it')
		expect(i).toBeGreaterThan(0)
		const block = readme.slice(i, readme.indexOf('## What it does not claim', i))
		const install = block.match(/^for d in (.+); do \(cd \$d && bun install\); done$/m)
		const test = block.match(/^for d in (.+); do \(cd \$d && bun test\); done$/m)
		expect(install?.[1].split(' ')).toEqual(['rwa-verify', 'trail-anchor', 'token-check', 'agent'])
		expect(test?.[1]).toBe(install?.[1])
		expect(block.indexOf(install![0])).toBeLessThan(block.indexOf(test![0]))
		expect(block).not.toMatch(/bun install && bun test/)
		expect(block).toMatch(/bun test verify\.numbers\.test\.ts verify\.order\.test\.ts/)
	})

	test('the README states no offline recheck time (it varies with the load of the machine)', () => {
		const readme = read('README.md')
		const gen = read('scripts/readme-numbers.mjs')
		expect(readme).not.toMatch(/165 s/)
		expect(gen).not.toMatch(/165 s/)
		expect(readme).not.toMatch(/--offline`?,? which reads no RPC,? (still )?took/)
		expect(readme).not.toMatch(/Most of (that time|it) is local computation/)
	})

	test('a new limits.json takes effect only through a mandate that names its hash', () => {
		const readme = read('README.md')
		expect(readme).toContain('A new `limits.json` takes effect only once the principal signs a mandate that names its hash. Rule M1 refuses limits the mandate does not name.')
	})

	test("the 2025 judge line names BLI's hackathon", () => {
		const readme = read('README.md')
		expect(readme).toContain("Bourn Collier was a judge of BLI's 2025 hackathon ([BLI, 2025-11-16](https://bli.tools/")
		expect(readme).toContain('DARA\'s announcement of his talk describes it as a framework for')
		expect(readme).not.toContain('A 2025 judge of this hackathon')
	})

	test('the ticker copy is described as the ledger implements it: purchases only', () => {
		const readme = read('README.md')
		const ledger = read('agent/ledger.ts')
		expect(ledger).toContain('Ticker copy opens the full size on every purchase of a token with a stock ticker')
		expect(readme).toContain('It opens a position on every purchase of a token with a stock ticker, at an official venue or not.')
		expect(readme + ledger).not.toMatch(/every move in which a token with a stock ticker\s+arrives/)
	})

	test('does not promise to keep the walk running after the event', () => {
		expect(read('README.md')).not.toContain('keep the walk running')
	})
})
