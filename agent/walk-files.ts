// The two largest files of a walk, trails.jsonl and chain.json, are kept gzipped in the
// repo (trails.jsonl.gz, chain.json.gz), so that no file comes near GitHub's 50 MB warning.
// docs/verify/compressed.json keeps the sha256 of each file before it was gzipped, and
// verify.mjs checks it with its own code. Only node:zlib and node:crypto, no dependency.
import { createHash } from 'node:crypto'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join, relative } from 'node:path'
import { gunzipSync, gzipSync } from 'node:zlib'

/** The text of a walk file: `path.gz` when it is there, else the plain file. */
export function readWalkText(path: string): string {
	return (existsSync(`${path}.gz`) ? gunzipSync(readFileSync(`${path}.gz`)) : readFileSync(path)).toString('utf8')
}

export const walkFileExists = (path: string) => existsSync(`${path}.gz`) || existsSync(path)

/**
 * Write `path.gz` (gzip level 9, the same bytes every time for the same text) and record the
 * sha256 and size of the text in docs/verify/compressed.json under `repo`.
 */
export function writeWalkGz(repo: string, path: string, text: string): void {
	const bytes = Buffer.from(text, 'utf8')
	writeFileSync(`${path}.gz`, gzipSync(bytes, { level: 9 }))
	const manifestPath = join(repo, 'docs/verify/compressed.json')
	const manifest = existsSync(manifestPath) ? JSON.parse(readFileSync(manifestPath, 'utf8')) : { note: '', files: [] }
	manifest.note =
		'The two largest files of the walk are kept gzipped as <file>.gz (gzip level 9, Node zlib). sha256 and bytes are those of the file before it was gzipped. Check: gunzip -c <file>.gz | shasum -a 256. node verify.mjs checks it too.'
	const file = relative(repo, path)
	const entry = { file, bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex'), gz_bytes: readFileSync(`${path}.gz`).length }
	manifest.files = [...manifest.files.filter((f: { file: string }) => f.file !== file), entry].sort((a: { file: string }, b: { file: string }) => (a.file < b.file ? 1 : -1))
	writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 1)}\n`)
}
