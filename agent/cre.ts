// Runs the two CRE workflows with `cre workflow simulate` and reads their result.
//
// With `broadcast`, the EVM write goes to Robinhood Testnet through CRE's
// simulation forwarder and is paid in testnet ETH by the testnet-only key in
// $BLI_TESTNET_KEY_FILE (default ~/.vet402/bli-testnet.key). The key is handed
// to the CRE CLI in its environment and never printed or logged.
import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

export const REPO = join(import.meta.dir, '..')
const CRE = process.env.CRE ?? join(homedir(), '.cre/bin/cre')
const TESTNET_KEY_FILE = process.env.BLI_TESTNET_KEY_FILE ?? join(homedir(), '.vet402/bli-testnet.key')

export type CreRun<T> = { result: T; tx: string | null; log: string; command: string }

/** Pull the workflow's return value and the written tx out of `cre workflow simulate` output. */
export function parseSimulation<T>(out: string): { result: T; tx: string | null } {
	const lines = out.split('\n')
	const i = lines.findIndex((l) => l.includes('Workflow Simulation Result:'))
	if (i < 0 || !lines[i + 1]) throw new Error('no "Workflow Simulation Result" in the CRE output')
	const result = JSON.parse(JSON.parse(lines[i + 1].trim())) as T
	const m = out.match(/written to 0x[0-9a-fA-F]{40} on [\w-]+, tx (0x[0-9a-f]{64})/)
	const tx = m && !/^0x0+$/.test(m[1]) ? m[1] : null
	return { result, tx }
}

export function simulate<T>(workflow: 'rwa-verify' | 'trail-anchor', payload: unknown, opts: { broadcast: boolean; workDir: string; label: string }): CreRun<T> {
	mkdirSync(opts.workDir, { recursive: true })
	const payloadFile = join(opts.workDir, `${opts.label}.payload.json`)
	writeFileSync(payloadFile, `${JSON.stringify(payload, null, 2)}\n`)
	const args = ['workflow', 'simulate', workflow, '--target', 'local-simulation', '--non-interactive', '--trigger-index', '0', '--http-payload', payloadFile]
	if (opts.broadcast) args.push('--broadcast')
	const env: Record<string, string> = { ...(process.env as Record<string, string>) }
	const bunDir = join(homedir(), '.local/bun-npm/node_modules/.bin')
	if (existsSync(bunDir)) env.PATH = `${bunDir}:${env.PATH}`
	delete env.CRE_ETH_PRIVATE_KEY
	if (opts.broadcast) {
		if (!existsSync(TESTNET_KEY_FILE)) throw new Error(`--broadcast needs a testnet-only key at ${TESTNET_KEY_FILE}`)
		env.CRE_ETH_PRIVATE_KEY = readFileSync(TESTNET_KEY_FILE, 'utf8').trim()
	}
	const r = spawnSync(CRE, args, { cwd: REPO, env, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, timeout: 10 * 60 * 1000 })
	const log = `${r.stdout ?? ''}${r.stderr ?? ''}`
	const command = `cre ${args.join(' ').replace(REPO + '/', '')}`
	// The CLI prints absolute paths. The saved copy shows the home folder as ~.
	writeFileSync(join(opts.workDir, `${opts.label}.cre.txt`), `$ ${command}\n${log}`.split(homedir()).join('~'))
	if (r.status !== 0) throw new Error(`cre exited ${r.status}; see ${opts.label}.cre.txt`)
	return { ...parseSimulation<T>(log), log, command }
}
