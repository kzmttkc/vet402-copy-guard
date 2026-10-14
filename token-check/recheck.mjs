#!/usr/bin/env node
// Rechecks docs/token-check/results.json without CRE and without any code of the
// workflow. Plain JSON-RPC, one request at a time, to Robinhood's own public RPC.
//
//   node token-check/recheck.mjs [docs/token-check/results.json] [--latest]
//
// It is a second road to the same rows, built differently on purpose:
//
//   the workflow                               this file
//   -----------------------------------------  ------------------------------------------
//   EXTCODEHASH, asked from the chain          eth_getCode, hashed here with keccak256
//   state from a second RPC operator           state from Robinhood's own RPC
//   JSON-RPC batches inside CRE                single requests from Node
//   check.ts and batch.ts                      the few lines of `derive` below
//
// For every token it reads the code, the beacon slot, symbol(), uiMultiplier(), the
// factory's TokenDeployed log and every UIMultiplierUpdated log up to the block the
// row was checked at, derives issuer_token, ticker, multiplier_updates and the
// reasons that follow from those reads, and compares them with the row.
//
// It then checks the trail onchain: for every run, the hash of its rows is in a
// TokenBatchChecked event of the receiver on Robinhood Testnet, with the block hash
// Robinhood's RPC gives for that block; and keccak256 of the file is in the
// TokenCheckResultsAnchored event.
//
// State is read at each row's checked_block. The public RPC keeps recent state only
// (5,000 blocks back answered, 50,000 did not, measured 2026-10-14), so a recheck run
// later, or with --latest, reads the state as it is now and says so.
//
// The text rules (a ticker that equals a listed one after invisible characters are
// removed, a name that ends like the issuer's) are not derived here. They are pure
// functions with their own tests (token-check/check.test.ts, batch.test.ts).
//
// Writes docs/token-check/recheck.json next to the results. Exit code 1 when anything differs.
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { keccak256 } from 'viem'

const HERE = dirname(fileURLToPath(import.meta.url))
const REPO = resolve(HERE, '..')

export const MAINNET_RPC = 'https://rpc.mainnet.chain.robinhood.com'
export const TESTNET_RPC = 'https://rpc.testnet.chain.robinhood.com'
export const PIN = {
	codeHash: '0x6c1fdd40002dcb440c7fff6a84171404d279ccb057803b65826f7546acd65630',
	beacon: '0xe10b6f6b275de231345c20d14ab812db62151b00',
	beaconSlot: '0xa3f0ad74e5423aebfd80d3ef4346578335a9a72aeaee59ff6cb3582b35133d50',
	factory: '0x4783c67b63de2b358ac5951a7d41f47a38f3c046',
	usdg: '0x5fc5360d0400a0fd4f2af552add042d716f1d168',
	one: 10n ** 18n,
}
const SELECTOR = { symbol: '0x95d89b41', uiMultiplier: '0xa60bf13d' }
const LOG_SPAN = 10_000_000
const text = (s) => new TextEncoder().encode(s)
export const keccakOfText = (s) => keccak256(text(s))
export const TOPIC = {
	/** topic0 of the factory's deployment log. Its first data word is the token address. Pinned: the factory's source is not public. */
	tokenDeployed: '0xd9b0c6a1c0de228715ad0fa09f3259686ee84f8cc675e03ef7e47a9cdafa76d6',
	multiplierUpdated: keccakOfText('UIMultiplierUpdated(uint256,uint256,uint256)'),
	batchChecked: keccakOfText('TokenBatchChecked(bytes32,bytes32,uint64,bytes32,uint32,uint32,bytes32,bytes10,address)'),
	resultsAnchored: keccakOfText('TokenCheckResultsAnchored(bytes32,bytes32,uint32,uint32,uint32,uint64,bytes32,bytes10,address)'),
}

/** The reasons this file derives itself. A row's other reasons are text rules and are counted, not compared. */
export const RECHECKED = [
	'IN_ISSUER_LIST',
	'NOT_IN_ISSUER_LIST',
	'USDG_ADDRESS',
	'CODE_HASH_MATCHES',
	'CODE_HASH_DIFFERS',
	'NO_CONTRACT_CODE',
	'BEACON_MATCHES',
	'BEACON_DIFFERS',
	'FACTORY_LOG_NAMES_TOKEN',
	'FACTORY_LOG_MISSING',
	'TICKER_MATCHES_LIST',
	'TICKER_DIFFERS_FROM_LIST',
	'TICKER_SAME_AS_ISSUER_TOKEN',
	'ISSUER_CODE_AT_UNLISTED_ADDRESS',
	'MULTIPLIER_NOT_ONE',
	'MULTIPLIER_UNREADABLE',
]

// ---------------------------------------------------------------- small pure parts

/** Sorted keys, no spaces. */
export function canonical(v) {
	if (v === null) return 'null'
	if (Array.isArray(v)) return `[${v.map(canonical).join(',')}]`
	if (typeof v === 'object') {
		return `{${Object.keys(v)
			.sort()
			.map((k) => `${JSON.stringify(k)}:${canonical(v[k])}`)
			.join(',')}}`
	}
	return JSON.stringify(v)
}

/** The string an eth_call to symbol() returned: an ABI string, or a bytes32. Null when unreadable. At most 96 characters. */
export function decodeText(hex) {
	if (typeof hex !== 'string' || !/^0x[0-9a-fA-F]*$/.test(hex) || hex.length < 66) return null
	const bytes = Buffer.from(hex.slice(2), 'hex')
	let out = null
	if (bytes.length >= 64) {
		const offset = BigInt(`0x${hex.slice(2, 66)}`)
		if (offset + 32n <= BigInt(bytes.length)) {
			const o = Number(offset)
			const length = BigInt(`0x${bytes.subarray(o, o + 32).toString('hex')}`)
			if (BigInt(o) + 32n + length <= BigInt(bytes.length)) out = bytes.subarray(o + 32, o + 32 + Number(length)).toString('utf8')
		}
	}
	if (out === null && bytes.length === 32) {
		let end = 32
		while (end > 0 && bytes[end - 1] === 0) end--
		out = bytes.subarray(0, end).toString('utf8')
	}
	return out === null ? null : [...out].slice(0, 96).join('')
}

/** Everything outside printable ASCII as [U+XXXX], the bullet of "• Robinhood Token" excepted. */
export function show(s) {
	let out = ''
	for (const ch of s) {
		const cp = ch.codePointAt(0)
		out += (cp >= 0x20 && cp <= 0x7e) || cp === 0x2022 ? ch : `[U+${cp.toString(16).toUpperCase().padStart(4, '0')}]`
	}
	return out
}

/**
 * What the reads say about one token.
 * `read`: { code, beaconWord, symbolHex, multiplierHex, factoryNamesToken, updates }
 * `listed`: the list entry of the address, or null. `listedSymbols`: every ticker of the list.
 */
export function derive(token, listed, listedSymbols, read) {
	const hasCode = typeof read.code === 'string' && read.code !== '0x' && read.code.length > 2
	const codeOk = hasCode && keccak256(read.code).toLowerCase() === PIN.codeHash
	const beaconOk = `0x${String(read.beaconWord).slice(2).padStart(64, '0').slice(24)}`.toLowerCase() === PIN.beacon
	const symbol = decodeText(read.symbolHex)
	const reasons = []
	if (listed) {
		const tickerOk = symbol === listed.symbol
		reasons.push('IN_ISSUER_LIST', !hasCode ? 'NO_CONTRACT_CODE' : codeOk ? 'CODE_HASH_MATCHES' : 'CODE_HASH_DIFFERS', beaconOk ? 'BEACON_MATCHES' : 'BEACON_DIFFERS')
		reasons.push(read.factoryNamesToken ? 'FACTORY_LOG_NAMES_TOKEN' : 'FACTORY_LOG_MISSING', tickerOk ? 'TICKER_MATCHES_LIST' : 'TICKER_DIFFERS_FROM_LIST')
		const readable = typeof read.multiplierHex === 'string' && /^0x[0-9a-fA-F]{64,}$/.test(read.multiplierHex)
		if (!readable) reasons.push('MULTIPLIER_UNREADABLE')
		else if (BigInt(`0x${read.multiplierHex.slice(2, 66)}`) !== PIN.one) reasons.push('MULTIPLIER_NOT_ONE')
		return { issuer_token: codeOk && beaconOk && read.factoryNamesToken === true && tickerOk, ticker: listed.symbol, multiplier_updates: read.updates, reasons }
	}
	if (token === PIN.usdg) {
		reasons.push('USDG_ADDRESS')
		if (!hasCode) reasons.push('NO_CONTRACT_CODE')
		return { issuer_token: false, ticker: 'USDG', multiplier_updates: 0, reasons }
	}
	reasons.push('NOT_IN_ISSUER_LIST')
	if (codeOk && beaconOk) reasons.push('ISSUER_CODE_AT_UNLISTED_ADDRESS')
	else {
		if (!hasCode) reasons.push('NO_CONTRACT_CODE')
		else if (!codeOk) reasons.push('CODE_HASH_DIFFERS')
		if (!beaconOk) reasons.push('BEACON_DIFFERS')
	}
	if (symbol !== null && listedSymbols.has(symbol)) reasons.push('TICKER_SAME_AS_ISSUER_TOKEN')
	return { issuer_token: false, ticker: symbol === null ? '' : show(symbol), multiplier_updates: 0, reasons }
}

/** The differences between a row of the results and what was derived here. Empty when they agree. */
export function compareRow(row, mine) {
	const diffs = []
	for (const k of ['issuer_token', 'ticker', 'multiplier_updates']) if (row[k] !== mine[k]) diffs.push({ field: k, results: row[k], recheck: mine[k] })
	const theirs = row.reasons.filter((r) => RECHECKED.includes(r)).sort()
	const ours = [...mine.reasons].sort()
	if (canonical(theirs) !== canonical(ours)) diffs.push({ field: 'reasons', results: theirs, recheck: ours })
	return diffs
}

// ---------------------------------------------------------------- reading

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const hex = (n) => `0x${n.toString(16)}`
const RATE_LIMITED = /too many requests|rate limit|deadline exceeded|try again|temporarily unavailable/i
const NO_STATE = /historical state|missing trie node|state .* not available|header not found|pruned/i
let calls = 0
let lastAt = 0

/** One JSON-RPC request. A 429, a 5xx or a rate-limited answer is waited out and asked again. Returns { result } or { error }. */
async function rpc(url, method, params) {
	for (let attempt = 0; ; attempt++) {
		const wait = lastAt + 350 - Date.now()
		if (wait > 0) await sleep(wait)
		lastAt = Date.now()
		calls++
		let limited = false
		try {
			const res = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }), signal: AbortSignal.timeout(30_000) })
			if (res.status === 429 || res.status >= 500) limited = true
			else {
				const body = await res.json()
				if (body.error && RATE_LIMITED.test(body.error.message ?? '')) limited = true
				else if (body.error) return { error: body.error.message ?? 'rpc error' }
				else return { result: body.result }
			}
		} catch {
			limited = true
		}
		if (limited && attempt >= 11) throw new Error(`${method}: the RPC kept refusing (rate limited) after ${attempt + 1} tries`)
		await sleep(Math.min(20_000, 1500 * (attempt + 1)))
	}
}
const must = async (url, method, params) => {
	const a = await rpc(url, method, params)
	if (a.error) throw new Error(`${method}: ${a.error}`)
	return a.result
}

async function main() {
	const argv = process.argv.slice(2)
	const file = resolve(argv.find((a) => !a.startsWith('--')) ?? join(REPO, 'docs/token-check/results.json'))
	const dir = dirname(file)
	const bytes = readFileSync(file)
	const results = JSON.parse(bytes.toString('utf8'))
	const snapshot = JSON.parse(readFileSync(join(HERE, 'registry-snapshot.json'), 'utf8'))
	const config = JSON.parse(readFileSync(join(HERE, 'config.json'), 'utf8'))
	const byAddress = new Map(snapshot.tokens.map((t) => [t.token.toLowerCase(), t]))
	const listedSymbols = new Set(snapshot.tokens.map((t) => t.symbol))
	const tokens = Object.keys(results.tokens)
	let useLatest = argv.includes('--latest')
	const say = (s) => console.log(s)

	say(`recheck of ${file.replace(`${REPO}/`, '')}: ${tokens.length} tokens, over ${MAINNET_RPC} (no CRE)`)
	if ((await must(MAINNET_RPC, 'eth_chainId', [])) !== '0x1237') throw new Error('the RPC is not Robinhood Chain (4663)')

	// 1. State first, while the RPC still keeps the checked block.
	const reads = {}
	const stateAt = {}
	for (const token of tokens) {
		const block = results.tokens[token].checked_block
		const at = async (tag) => {
			const code = await rpc(MAINNET_RPC, 'eth_getCode', [token, tag])
			if (code.error) return { error: code.error }
			const slot = await rpc(MAINNET_RPC, 'eth_getStorageAt', [token, PIN.beaconSlot, tag])
			if (slot.error) return { error: slot.error }
			const symbol = await rpc(MAINNET_RPC, 'eth_call', [{ to: token, data: SELECTOR.symbol }, tag])
			const multiplier = byAddress.has(token) ? await rpc(MAINNET_RPC, 'eth_call', [{ to: token, data: SELECTOR.uiMultiplier }, tag]) : {}
			for (const a of [symbol, multiplier]) if (a.error && NO_STATE.test(a.error)) return { error: a.error }
			return { code: code.result, beaconWord: slot.result, symbolHex: symbol.result ?? null, multiplierHex: multiplier.result ?? null }
		}
		let r = useLatest ? { error: 'latest asked for' } : await at(hex(block))
		if (r.error) {
			if (!useLatest && !NO_STATE.test(r.error)) throw new Error(`${token}: ${r.error}`)
			if (!useLatest) say(`  the RPC no longer keeps the state of block ${block} (${r.error.slice(0, 60)}): reading the state as it is now from here on`)
			useLatest = true
			r = await at('latest')
			if (r.error) throw new Error(`${token}: ${r.error}`)
			stateAt[token] = 'latest'
		} else stateAt[token] = 'checked_block'
		reads[token] = r
	}

	// 2. Logs. They never change, so there is no hurry.
	for (const token of tokens) {
		const listed = byAddress.get(token)
		reads[token].factoryNamesToken = false
		reads[token].updates = 0
		if (!listed || listed.deployed_block === null) continue
		const block = results.tokens[token].checked_block
		const deployed = await must(MAINNET_RPC, 'eth_getLogs', [{ address: PIN.factory, topics: [TOPIC.tokenDeployed], fromBlock: hex(listed.deployed_block), toBlock: hex(listed.deployed_block) }])
		reads[token].factoryNamesToken = deployed.some((l) => l.address.toLowerCase() === PIN.factory && `0x${l.data.slice(26, 66)}`.toLowerCase() === token)
		for (let a = listed.deployed_block; a <= block; a += LOG_SPAN) {
			const logs = await must(MAINNET_RPC, 'eth_getLogs', [{ address: token, topics: [TOPIC.multiplierUpdated], fromBlock: hex(a), toBlock: hex(Math.min(block, a + LOG_SPAN - 1)) }])
			reads[token].updates += logs.filter((l) => l.address.toLowerCase() === token && l.topics.length === 1 && l.data.length === 2 + 64 * 3).length
		}
	}

	// 3. Compare.
	const differ = []
	const notRechecked = {}
	let agree = 0
	for (const token of tokens) {
		const row = results.tokens[token]
		const mine = derive(token, byAddress.get(token) ?? null, listedSymbols, reads[token])
		const diffs = compareRow(row, mine)
		for (const r of row.reasons) if (!RECHECKED.includes(r)) notRechecked[r] = (notRechecked[r] ?? 0) + 1
		if (diffs.length === 0) agree++
		else differ.push({ token, state_read_at: stateAt[token], differences: diffs })
		say(`${diffs.length === 0 ? 'AGREE ' : 'DIFFER'}  ${token}  ${row.issuer_token ? 'issuer token' : 'not issuer '}  ${JSON.stringify(row.ticker)}  updates ${row.multiplier_updates}${stateAt[token] === 'latest' ? '  (state read as it is now)' : ''}`)
		for (const d of diffs) say(`        ${d.field}: results ${JSON.stringify(d.results)}, recheck ${JSON.stringify(d.recheck)}`)
	}

	// 4. The trail onchain.
	const problems = []
	const runsOut = []
	const detailsFile = join(dir, 'details.json')
	const anchorFile = join(dir, 'anchor.json')
	const receiver = String(config.receiverAddress).toLowerCase()
	if ((await must(TESTNET_RPC, 'eth_chainId', [])) !== '0xb626') throw new Error('the testnet RPC is not Robinhood Testnet (46630)')
	if (!existsSync(detailsFile)) problems.push('details.json is missing: the runs cannot be matched to their tokens')
	else {
		const details = JSON.parse(readFileSync(detailsFile, 'utf8'))
		const covered = new Set()
		if (details.runs.length !== results.cre_runs.length) problems.push(`results.json names ${results.cre_runs.length} runs, details.json ${details.runs.length}`)
		for (const [i, run] of details.runs.entries()) {
			const rows = Object.fromEntries(run.tokens.map((t) => [t, results.tokens[t]]))
			for (const t of run.tokens) covered.add(t)
			const hash = keccakOfText(canonical(rows))
			const tx = results.cre_runs[i]?.tx
			const receipt = await must(TESTNET_RPC, 'eth_getTransactionReceipt', [tx])
			const log = (receipt?.logs ?? []).find((l) => l.address.toLowerCase() === receiver && l.topics[0] === TOPIC.batchChecked && l.topics[1] === hash)
			const out = { run: i + 1, tx, batch_hash: hash, tokens: run.tokens.length, onchain: Boolean(log) && receipt.status === '0x1', counts_match: false, block_hash_matches: false }
			if (!out.onchain) problems.push(`run ${i + 1}: ${tx} holds no TokenBatchChecked log of ${receiver} with the hash of its rows (${hash})`)
			else {
				const block = Number(BigInt(log.topics[3]))
				const data = log.data.slice(2)
				const blockHash = `0x${data.slice(0, 64)}`
				const n = Number(BigInt(`0x${data.slice(64, 128)}`))
				const issuer = Number(BigInt(`0x${data.slice(128, 192)}`))
				out.counts_match = n === run.tokens.length && issuer === run.tokens.filter((t) => results.tokens[t].issuer_token).length && run.tokens.every((t) => results.tokens[t].checked_block === block)
				if (!out.counts_match) problems.push(`run ${i + 1}: the event's counts or block are not those of the rows`)
				const header = await must(MAINNET_RPC, 'eth_getBlockByNumber', [hex(block), false])
				out.block_hash_matches = header?.hash?.toLowerCase() === blockHash
				if (!out.block_hash_matches) problems.push(`run ${i + 1}: the event names block hash ${blockHash}, Robinhood's RPC gives ${header?.hash} for block ${block}`)
			}
			runsOut.push(out)
			say(`run ${i + 1}  ${tx}  TokenBatchChecked ${out.onchain ? 'found' : 'NOT FOUND'}, counts ${out.counts_match ? 'match' : 'DIFFER'}, block hash ${out.block_hash_matches ? 'matches' : 'DIFFERS'}`)
		}
		if (covered.size !== tokens.length) problems.push(`${tokens.length - covered.size} tokens of the file are in no run`)
	}
	const fileHash = keccak256(bytes)
	let anchorOut = null
	if (!existsSync(anchorFile)) problems.push('anchor.json is missing')
	else {
		const anchor = JSON.parse(readFileSync(anchorFile, 'utf8'))
		const receipt = await must(TESTNET_RPC, 'eth_getTransactionReceipt', [anchor.anchor_tx])
		const log = (receipt?.logs ?? []).find((l) => l.address.toLowerCase() === receiver && l.topics[0] === TOPIC.resultsAnchored && l.topics[1] === fileHash)
		const issuer = tokens.filter((t) => results.tokens[t].issuer_token).length
		let counts = false
		if (log) {
			const d = log.data.slice(2)
			counts = Number(BigInt(`0x${d.slice(0, 64)}`)) === tokens.length && Number(BigInt(`0x${d.slice(64, 128)}`)) === issuer && Number(BigInt(`0x${d.slice(128, 192)}`)) === results.cre_runs.length
		}
		anchorOut = { tx: anchor.anchor_tx, results_keccak: fileHash, onchain: Boolean(log) && receipt.status === '0x1', counts_match: counts }
		if (!anchorOut.onchain) problems.push(`the anchor ${anchor.anchor_tx} holds no TokenCheckResultsAnchored log with keccak256 of the file (${fileHash})`)
		else if (!counts) problems.push("the anchor event's counts are not those of the file")
		say(`anchor ${anchor.anchor_tx}  TokenCheckResultsAnchored ${anchorOut.onchain ? 'found' : 'NOT FOUND'} for keccak256(results.json) ${fileHash}`)
	}

	const latest = Object.values(stateAt).filter((s) => s === 'latest').length
	const out = {
		rechecked_at: new Date().toISOString(),
		results_file: file.replace(`${REPO}/`, ''),
		results_keccak: fileHash,
		how: 'plain JSON-RPC from Node, one request at a time, no CRE and no code of the workflow: eth_getCode hashed here, eth_getStorageAt, symbol(), uiMultiplier(), eth_getLogs',
		rpc: { mainnet: MAINNET_RPC, testnet: TESTNET_RPC },
		rpc_requests: calls,
		tokens: tokens.length,
		agree,
		differ,
		state_read_at: { checked_block: tokens.length - latest, latest },
		compared: { fields: ['issuer_token', 'ticker', 'multiplier_updates', 'reasons'], reasons_derived_here: RECHECKED },
		reasons_not_derived_here: notRechecked,
		runs: runsOut,
		anchor: anchorOut,
		problems,
	}
	writeFileSync(join(dir, 'recheck.json'), `${JSON.stringify(out, null, 2)}\n`)
	say(`RECHECK: ${agree} of ${tokens.length} rows agree, ${differ.length} differ; state read at the checked block for ${tokens.length - latest}, as it is now for ${latest}; ${problems.length} problem${problems.length === 1 ? '' : 's'} with the onchain trail; ${calls} RPC requests`)
	for (const p of problems) say(`  problem: ${p}`)
	if (differ.length > 0 || problems.length > 0) process.exit(1)
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
	main().catch((e) => {
		console.error(`recheck failed: ${e instanceof Error ? e.message : e}`)
		process.exit(2)
	})
}
