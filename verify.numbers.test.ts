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

function summaryOk(text: string) {
	const m = text.match(/^(\d+) OK,/m)
	if (!m) throw new Error('no "N OK" summary')
	return Number(m[1])
}

/** Median of the five saved full runs, as the guidance sentence states it. */
function phraseFromFiveRuns(text: string) {
	const xs = [...text.matchAll(/^run \d+ \([^)]*\): exit \d+, (\d+) s,/gm)].map((m) => Number(m[1]))
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
})
