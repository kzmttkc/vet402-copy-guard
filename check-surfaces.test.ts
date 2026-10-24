import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, test } from 'bun:test'
import { spawnSync } from 'node:child_process'
import { checkSurfaces } from './scripts/check-surfaces.mjs'

const SCRIPT = join(import.meta.dir, 'scripts/check-surfaces.mjs')

describe('check-surfaces', () => {
	test('README.md has 0 mismatches against the ledger, saved runs and vet402 count', () => {
		const r = checkSurfaces(['README.md'])
		expect(r.mismatches).toEqual([])
		expect(r.count).toBe(0)
	})

	test('a copy with one number moved exits 1', () => {
		const dir = mkdtempSync(join(tmpdir(), 'surfaces-'))
		const copy = join(dir, 'README.md')
		const orig = readFileSync(join(import.meta.dir, 'README.md'), 'utf8')
		expect(orig).toContain('8396')
		writeFileSync(copy, orig.replace('8396', '8397'))
		const proc = spawnSync(process.execPath, [SCRIPT, copy], { encoding: 'utf8' })
		expect(proc.status).toBe(1)
		expect(proc.stdout + proc.stderr).toMatch(/mismatch/i)
	})
})
