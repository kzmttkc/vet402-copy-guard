// Checks every token of a list with the CRE workflow `token-check` and writes
// docs/token-check/results.json.
//
//   bun scripts/token-check-batch.ts <tokens.json> [--out docs/token-check] [--dry] [--max-per-run N]
//
// <tokens.json> is an array of token addresses (or an object with a `tokens` array).
//
// What it does, in order:
//   1. measures how many JSON-RPC items Robinhood's public RPC lets through in one
//      request right now (it rate-limits per caller address), and splits the list into
//      runs that fit CRE's limits at that size (token-check/batch.ts, planRuns)
//   2. for each run: `cre workflow simulate token-check --broadcast` with { tokens }.
//      The run reads the chain, decides, and writes the hash of its rows to
//      TokenCheckReceiver on Robinhood Testnet. Its output is saved under <out>/batch/.
//   3. writes <out>/results.json in the fixed shape:
//        { generated_at, cre_runs: [{ tx, simulate_log }], tokens: { <address>: { issuer_token, ticker, reasons, multiplier_updates, checked_block } } }
//      and <out>/details.json (what stands behind each row, and which run checked which token)
//   4. one more CRE run anchors the file: the workflow reads the receipt of every run
//      the file names, then writes keccak256(results.json) once. Saved as <out>/anchor.json.
//
// Nothing is paid. The only key used is the testnet-only key, for testnet gas; it is
// read by agent/cre.ts and handed to the CRE CLI, never printed.
//
// With --dry nothing is broadcast and no file is written: the rows are printed.
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'
import { REPO, simulate } from '../agent/cre'
import { keccakText } from '../rwa-verify/verify'
import { type BatchResult, type BatchTokenDetail, type BatchTokenResult, batchHash, ITEMS_PER_CALL, LIST_HASH, planRuns, type ResultsFile, resultsProblem } from '../token-check/batch'
import { SNAPSHOT, STOCK_TOKEN_FACTORY, TOKEN_DEPLOYED_TOPIC } from '../token-check/check'
import { MAX_ANCHOR_RUNS } from '../token-check/workflow'

const argv = process.argv.slice(2)
const flag = (name: string) => argv.includes(name)
const opt = (name: string, dflt: string) => (argv.includes(name) ? argv[argv.indexOf(name) + 1] : dflt)
const input = argv.find((a, i) => !a.startsWith('--') && argv[i - 1] !== '--out' && argv[i - 1] !== '--max-per-run')
if (!input) {
	console.error('usage: bun scripts/token-check-batch.ts <tokens.json> [--out docs/token-check] [--dry]')
	process.exit(2)
}
const dry = flag('--dry')
const out = resolve(REPO, opt('--out', 'docs/token-check'))
const workDir = join(out, 'batch')
const config = JSON.parse(readFileSync(join(REPO, 'token-check/config.json'), 'utf8')) as { robinhoodRpc: string; stateRpc?: string; receiverAddress: string; chainSelectorName: string }
const separate = Boolean(config.stateRpc) && config.stateRpc !== config.robinhoodRpc

/** Tries per run when the RPC rate-limits, and the wait before try n (seconds). */
const TRIES = 4
const WAIT_S = 25
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

function readTokens(path: string): string[] {
	const raw = JSON.parse(readFileSync(path, 'utf8')) as unknown
	const list = Array.isArray(raw) ? raw : ((raw as { tokens?: unknown[] }).tokens ?? [])
	const seen = new Set<string>()
	for (const item of list) {
		const a = typeof item === 'string' ? item : ((item as { token?: string; address?: string })?.token ?? (item as { address?: string })?.address)
		if (typeof a !== 'string' || !/^0x[0-9a-fA-F]{40}$/.test(a)) throw new Error(`not a token address: ${JSON.stringify(item)}`)
		seen.add(a.toLowerCase())
	}
	if (seen.size === 0) throw new Error(`${path} holds no token address`)
	return [...seen]
}

async function head(): Promise<number> {
	for (let attempt = 0; ; attempt++) {
		try {
			const res = await fetch(config.stateRpc ?? config.robinhoodRpc, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'eth_blockNumber', params: [] }) })
			const body = (await res.json()) as { result?: string }
			if (body.result) return Number(BigInt(body.result))
		} catch {}
		if (attempt >= 5) throw new Error('the RPC does not answer eth_blockNumber')
		await sleep(3000 * (attempt + 1))
	}
}

/** Does Robinhood's RPC answer one request of `n` log queries right now? The query is the real kind: one factory log, one block. */
async function passes(n: number): Promise<boolean> {
	const at = `0x${(SNAPSHOT.tokens[0].deployed_block ?? 1).toString(16)}`
	const body = Array.from({ length: n }, (_, i) => ({ jsonrpc: '2.0', id: i + 1, method: 'eth_getLogs', params: [{ address: STOCK_TOKEN_FACTORY, topics: [TOKEN_DEPLOYED_TOPIC], fromBlock: at, toBlock: at }] }))
	try {
		const res = await fetch(config.robinhoodRpc, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
		if (res.status !== 200) return false
		const items = (await res.json()) as { error?: unknown }[]
		return Array.isArray(items) && items.length === n && items.every((i) => !i.error)
	} catch {
		return false
	}
}

/** The largest request size, of 10, 5 and 2, that goes through twice in a row. */
async function measureItemsPerCall(): Promise<number> {
	for (const n of [ITEMS_PER_CALL, 5, 2]) {
		await sleep(2500)
		if (!(await passes(n))) continue
		await sleep(2500)
		if (await passes(n)) return n
	}
	return 2
}

type Run = { tokens: string[]; result: BatchResult; tx: string | null; log: string; itemsPerCall: number }

const tokens = readTokens(resolve(input))
const at = await head()
let itemsPerCall = await measureItemsPerCall()
// Planned a little ahead of the head, so a run that starts later needs no more log windows than planned.
// --max-per-run N caps the tokens of one run below what the planner allows, when a busy RPC makes the planned runs fail and split.
const maxPerRun = Number(opt('--max-per-run', '0'))
const plan = (list: string[]) => planRuns(list, at + 100_000, separate, itemsPerCall).flatMap((run) => (maxPerRun > 0 && run.length > maxPerRun ? Array.from({ length: Math.ceil(run.length / maxPerRun) }, (_, i) => run.slice(i * maxPerRun, (i + 1) * maxPerRun)) : [run]))
let queue = plan(tokens)
console.log(`${tokens.length} tokens, ${queue.length} run${queue.length === 1 ? '' : 's'} planned (head ${at}, state from ${config.stateRpc ?? config.robinhoodRpc}, logs from ${config.robinhoodRpc}, ${itemsPerCall} items per request to it)`)

if (!dry) {
	mkdirSync(workDir, { recursive: true })
	for (const f of readdirSync(workDir)) if (/^(batch-\d+|anchor)\.(cre\.txt|payload\.json)$/.test(f)) rmSync(join(workDir, f))
}
const tmp = dry ? join(REPO, 'agent/state/token-check-dry') : workDir

const runs: Run[] = []
while (queue.length > 0) {
	const batch = queue.shift() as string[]
	const label = `batch-${runs.length + 1}`
	let done: Run | null = null
	let lastError = ''
	for (let attempt = 1; attempt <= TRIES && !done; attempt++) {
		try {
			const r = simulate<BatchResult & { mode: string }>('token-check', itemsPerCall === ITEMS_PER_CALL ? { tokens: batch } : { tokens: batch, itemsPerCall }, { broadcast: !dry, workDir: tmp, label })
			if (r.result.mode !== 'batch') throw new Error('the workflow did not answer in batch mode')
			if (batchHash(r.result.tokens) !== r.result.batchHash) throw new Error('the batch hash of the answer is not the hash of its rows')
			if (!dry && !r.tx) throw new Error('the run wrote nothing onchain')
			done = { tokens: batch, result: r.result, tx: r.tx, log: relative(REPO, join(tmp, `${label}.cre.txt`)), itemsPerCall }
		} catch (e) {
			lastError = String(e instanceof Error ? e.message : e)
			const logFile = join(tmp, `${label}.cre.txt`)
			const why = existsSync(logFile) ? (readFileSync(logFile, 'utf8').match(/workflow execution failed: .*/)?.[0] ?? lastError) : lastError
			console.log(`  ${label}: try ${attempt} of ${TRIES} failed (${why.slice(0, 200)})`)
			if (attempt < TRIES) await sleep(WAIT_S * 1000 * attempt)
		}
	}
	if (!done) {
		// The line may have become busier since it was measured: measure again and plan what is left with the new size.
		const measured = await measureItemsPerCall()
		if (measured < itemsPerCall) {
			itemsPerCall = measured
			queue = plan([...batch, ...queue.flat()])
			console.log(`  ${label}: the RPC now lets ${itemsPerCall} items through per request; ${queue.length} runs planned for what is left`)
			continue
		}
		if (batch.length === 1) throw new Error(`${batch[0]} could not be checked: ${lastError}`)
		const half = Math.ceil(batch.length / 2)
		console.log(`  ${label}: ${batch.length} tokens split in two`)
		queue.unshift(batch.slice(0, half), batch.slice(half))
		continue
	}
	runs.push(done)
	const n = Object.keys(done.result.tokens).length
	console.log(`  ${label}: ${n} tokens at block ${done.result.block}, ${done.result.issuerTokens} the issuer's, ${n - done.result.issuerTokens} not${done.tx ? `, tx ${done.tx}` : ''}`)
	if (queue.length > 0) await sleep(3000)
}

if (!dry && runs.length > MAX_ANCHOR_RUNS) throw new Error(`${runs.length} runs were needed, one anchor reads at most ${MAX_ANCHOR_RUNS} receipts: run again when the RPC is less busy, or with a shorter list`)

const rows: Record<string, BatchTokenResult> = {}
const details: Record<string, BatchTokenDetail & { run: number }> = {}
for (const t of tokens) {
	const i = runs.findIndex((r) => r.result.tokens[t])
	if (i < 0) throw new Error(`${t} is in no run`)
	rows[t] = runs[i].result.tokens[t]
	details[t] = { ...runs[i].result.details[t], run: i + 1 }
}

if (dry) {
	for (const [t, r] of Object.entries(rows)) console.log(`${r.issuer_token ? 'ISSUER_TOKEN    ' : 'NOT_ISSUER_TOKEN'}  ${t}  ${JSON.stringify(r.ticker)}  updates ${r.multiplier_updates}  ${r.reasons.join(' ')}`)
	console.log('--dry: nothing broadcast, no file written')
	process.exit(0)
}

const results: ResultsFile = { generated_at: new Date().toISOString(), cre_runs: runs.map((r) => ({ tx: r.tx as string, simulate_log: r.log })), tokens: rows }
const problem = resultsProblem(results)
if (problem) throw new Error(`the results are not in the fixed shape: ${problem}`)
const text = `${JSON.stringify(results, null, 2)}\n`
writeFileSync(join(out, 'results.json'), text)

const network = `${config.chainSelectorName} (46630)`
const through = "CRE's simulation forwarder (MockKeystoneForwarder). Not a DON attestation."
writeFileSync(
	join(out, 'details.json'),
	`${JSON.stringify(
		{
			about: 'What stands behind each row of results.json, and which run checked which token. results.json is the file that is hashed and anchored; this one is for a person who wants to look.',
			generated_at: results.generated_at,
			list: { taken_at: SNAPSHOT.list_taken_at, source: SNAPSHOT.source, count: SNAPSHOT.count, source_file_keccak256: LIST_HASH },
			rpc: { state: config.stateRpc ?? config.robinhoodRpc, logs: config.robinhoodRpc },
			receiver: config.receiverAddress,
			network,
			written_through: through,
			runs: runs.map((r, i) => ({ run: i + 1, tx: r.tx, simulate_log: r.log, checked_block: r.result.block, checked_block_hash: r.result.blockHash, batch_hash: r.result.batchHash, issuer_tokens: r.result.issuerTokens, items_per_request: r.itemsPerCall, tokens: r.tokens })),
			tokens: details,
		},
		null,
		2,
	)}\n`,
)

// The anchor: one more run that reads every receipt, then writes the hash of the file.
await sleep(3000)
type Anchor = { mode: string; resultsHash: string; tokens: number; issuerTokens: number; runs: number; lastCheckedBlock: number }
const anchor = simulate<Anchor>('token-check', { results_json: text, batches: runs.map((r) => r.tokens) }, { broadcast: true, workDir, label: 'anchor' })
if (anchor.result.mode !== 'anchor' || anchor.result.resultsHash !== keccakText(text)) throw new Error('the anchor run did not hash the file that was written')
if (!anchor.tx) throw new Error('the anchor run wrote nothing onchain')
writeFileSync(
	join(out, 'anchor.json'),
	`${JSON.stringify(
		{
			results_file: relative(REPO, join(out, 'results.json')),
			results_keccak: anchor.result.resultsHash,
			anchor_tx: anchor.tx,
			event: 'TokenCheckResultsAnchored',
			receiver: config.receiverAddress,
			network,
			tokens: anchor.result.tokens,
			issuer_tokens: anchor.result.issuerTokens,
			runs: anchor.result.runs,
			last_checked_block: anchor.result.lastCheckedBlock,
			simulate_log: relative(REPO, join(workDir, 'anchor.cre.txt')),
			written_through: through,
		},
		null,
		2,
	)}\n`,
)
const issuer = Object.values(rows).filter((r) => r.issuer_token).length
console.log(`results.json: ${tokens.length} tokens, ${issuer} the issuer's, ${tokens.length - issuer} not, from ${runs.length} CRE run${runs.length === 1 ? '' : 's'}`)
console.log(`keccak256(results.json) ${anchor.result.resultsHash} written to ${config.receiverAddress} on ${network}, tx ${anchor.tx}`)
