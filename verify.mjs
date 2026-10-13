#!/usr/bin/env node
// verify.mjs: recheck what this repo claims, from the saved files and two public chains.
//
// Needs Node 20 or newer and nothing else. No npm install, no key, no account, no login.
//
//   node verify.mjs                      every check below
//   node verify.mjs 73953009             only the decision about the wallet's move in that block
//   node verify.mjs path/to/trail.json   only that decision
//
//   --offline             skip the chain reads; those lines are reported as not checked
//   --rpc URL             another RPC for Robinhood Chain (4663)
//   --testnet-rpc URL     another RPC for Robinhood Testnet (46630)
//
// Every line starts with OK, FAIL or ----. A ---- line was not checked because no RPC
// answered, so the question stays open. It is never counted as a pass.
//
// Exit code   last line
//   0         RESULT: MATCH          every check passed
//   1         RESULT: MISMATCH       at least one check failed
//   2         (usage)                the arguments could not be read
//   3         RESULT: NOT CHECKED    nothing failed, but some checks could not reach an RPC
//
// This file imports nothing from the agent and has no dependency. It carries its own
// keccak256, its own canonical JSON and its own copy of the 13 rules, so it cannot
// repeat a mistake by reusing the agent's code. agent/verify.test.ts runs the two
// implementations against each other on a few thousand cases.
import { existsSync, readdirSync, readFileSync, realpathSync } from 'node:fs'
import { basename, dirname, join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

const REPO = dirname(fileURLToPath(import.meta.url))

// ---------------------------------------------------------------- what this repo claims

export const CLAIMS = {
	/** The wallet the agent watched. */
	wallet: '0xe9b08727131e34010b34006c660d4c1b436ec25f',
	/** The paid run of 2026-10-08 22:24 UTC: the record, the 402 exchange and three trails. */
	runDir: 'docs/agent/first-paid-run',
	/** The record vet402 anchored on 2026-09-30, saved in this repo. */
	anchoredRecord: 'rwa-verify/fixtures/anchored-record.json',
	anchorTx: '0x15f9ed8ae5dd466c2f35021c9f1291e7a624abbb52c8ac26b54d47442f585c7f',
	/** The x402 settlement on Robinhood Chain. */
	paymentTx: '0x65c314bd758a59dfc79c78d8da76e557450fa1144726ddc4bfc77e183287af61',
	/** The agent's wallet. */
	payer: '0xc380d9f41d90765a4820429b9da151889e8bed94',
	/** The vet402 wallet. It receives the payment and it is the operator that writes anchors. */
	payee: '0x973cd8a91a771c2c04c6036888f8175d6b4f6227',
	/** 0.01 USDG, 6 decimals. */
	priceAtomic: '10000',
	/** Block of the wallet's move, and what the agent concluded about it. */
	decisions: { 68837431: 'DO_NOT_COPY', 73953009: 'DO_NOT_COPY', 81262132: 'DO_NOT_COPY' },
}

export const CHAINS = {
	mainnet: { id: 4663, name: 'Robinhood Chain', rpcs: ['https://rpc.mainnet.chain.robinhood.com', 'https://robinhood-rpc.publicnode.com'] },
	testnet: { id: 46630, name: 'Robinhood Testnet', rpcs: ['https://rpc.testnet.chain.robinhood.com'] },
}

export const USDG = '0x5fc5360d0400a0fd4f2af552add042d716f1d168'
/** vet402's anchor contract on Robinhood Chain. */
export const RWA_ANCHOR = '0x1955137e7773f2459eb75fb88842026c6517c22d'
/** keccak256 of RwaAnchor's runtime code. vet402 pins the same value in its own forge test. */
export const RWA_ANCHOR_RUNTIME_KECCAK = '0x9032fa493b888a32b4773a18ae74814d4f492d136c4cd55ade593eb783f9b5b0'
/** The two receivers on Robinhood Testnet that the CRE workflows write to. */
export const VERDICT_RECEIVER = '0x8bf4d455d38301e9d330b12144ade02f16bc2cb3'
export const TRAIL_RECEIVER = '0x991311c2eca78b83da3593c7500804af6feea0b3'

// ---------------------------------------------------------------- keccak256
// Keccak-256 as Ethereum uses it: the Keccak-f[1600] permutation of FIPS 202
// (https://nvlpubs.nist.gov/nistpubs/FIPS/NIST.FIPS.202.pdf, sections 3.2 and 3.3),
// rate 136 bytes, with the original Keccak padding 0x01 … 0x80 (SHA3-256 pads 0x06).
// Written for this file from the specification. No third-party code. MIT, like the
// rest of this repo. checkKeccak() below tests it against published values on every run.

const MASK = (1n << 64n) - 1n
const ROUND_CONSTANTS = [
	0x0000000000000001n, 0x0000000000008082n, 0x800000000000808an, 0x8000000080008000n, 0x000000000000808bn, 0x0000000080000001n,
	0x8000000080008081n, 0x8000000000008009n, 0x000000000000008an, 0x0000000000000088n, 0x0000000080008009n, 0x000000008000000an,
	0x000000008000808bn, 0x800000000000008bn, 0x8000000000008089n, 0x8000000000008003n, 0x8000000000008002n, 0x8000000000000080n,
	0x000000000000800an, 0x800000008000000an, 0x8000000080008081n, 0x8000000000008080n, 0x0000000080000001n, 0x8000000080008008n,
]
const rotl = (v, n) => ((v << n) | (v >> (64n - n))) & MASK

/** The permutation on 25 lanes of 64 bits; lane (x, y) is a[x + 5 * y]. */
function keccakF(a) {
	for (let round = 0; round < 24; round++) {
		// theta
		const c = [0, 1, 2, 3, 4].map((x) => a[x] ^ a[x + 5] ^ a[x + 10] ^ a[x + 15] ^ a[x + 20])
		for (let x = 0; x < 5; x++) {
			const d = c[(x + 4) % 5] ^ rotl(c[(x + 1) % 5], 1n)
			for (let y = 0; y < 25; y += 5) a[x + y] ^= d
		}
		// rho and pi
		let x = 1
		let y = 0
		let carried = a[1]
		for (let t = 0; t < 24; t++) {
			;[x, y] = [y, (2 * x + 3 * y) % 5]
			const next = a[x + 5 * y]
			a[x + 5 * y] = rotl(carried, BigInt((((t + 1) * (t + 2)) / 2) % 64))
			carried = next
		}
		// chi
		for (let y5 = 0; y5 < 25; y5 += 5) {
			const row = a.slice(y5, y5 + 5)
			for (let i = 0; i < 5; i++) a[y5 + i] = row[i] ^ (~row[(i + 1) % 5] & MASK & row[(i + 2) % 5])
		}
		// iota
		a[0] ^= ROUND_CONSTANTS[round]
	}
}

/** keccak256 of bytes (Uint8Array) or of a string's UTF-8 bytes, as 0x-hex. */
export function keccak256(input) {
	const bytes = typeof input === 'string' ? new TextEncoder().encode(input) : input
	const rate = 136
	const padded = new Uint8Array((Math.floor(bytes.length / rate) + 1) * rate)
	padded.set(bytes)
	padded[bytes.length] ^= 0x01
	padded[padded.length - 1] ^= 0x80
	const a = new Array(25).fill(0n)
	// Lanes are little-endian 64-bit words.
	const view = new DataView(padded.buffer)
	for (let off = 0; off < padded.length; off += rate) {
		for (let i = 0; i < rate / 8; i++) a[i] ^= view.getBigUint64(off + 8 * i, true)
		keccakF(a)
	}
	let out = '0x'
	for (let i = 0; i < 4; i++) for (let k = 0n; k < 8n; k++) out += ((a[i] >> (8n * k)) & 0xffn).toString(16).padStart(2, '0')
	return out
}

export function hexToBytes(hex) {
	const h = hex.startsWith('0x') ? hex.slice(2) : hex
	const out = new Uint8Array(h.length / 2)
	for (let i = 0; i < out.length; i++) out[i] = Number.parseInt(h.slice(2 * i, 2 * i + 2), 16)
	return out
}

// Event topics, computed from the signatures a reader can compare with the contracts.
export const TRANSFER_TOPIC = keccak256('Transfer(address,address,uint256)')
export const ANCHORED_TOPIC = keccak256('Anchored(bytes32,bytes32,uint32,uint64,address)')
export const RECORD_CHECKED_TOPIC = keccak256('RecordChecked(bytes32,bytes32,bool,uint32,bytes32,bytes32,uint64,uint64,bytes32,bytes10,address)')
export const DECISION_TOPIC = keccak256('DecisionRecorded(bytes32,bytes32,uint8,bytes32,bytes32,bytes32,bytes32,uint16,bytes32,bytes10,address)')

/** Published values: keccak256 of the empty string, and the ERC-20 Transfer topic every explorer shows. */
export function checkKeccak() {
	return (
		keccak256('') === '0xc5d2460186f7233c927e7db2dcc703c0e500b653ca82273b7bfad8045d85a470' &&
		TRANSFER_TOPIC === '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef'
	)
}

// ---------------------------------------------------------------- the hash of a record

/** Sorted keys, no spaces, undefined dropped. The same rules as vet402's verify-record.mjs. */
export function canonicalJson(v) {
	if (v === null) return 'null'
	if (Array.isArray(v)) return `[${v.map((x) => (x === undefined ? 'null' : canonicalJson(x))).join(',')}]`
	if (typeof v === 'string' || typeof v === 'boolean') return JSON.stringify(v)
	if (typeof v === 'number') {
		if (!Number.isFinite(v)) throw new Error('canonical JSON: non-finite number')
		return JSON.stringify(v)
	}
	if (typeof v === 'object') {
		const keys = Object.keys(v)
			.filter((k) => v[k] !== undefined)
			.sort()
		return `{${keys.map((k) => `${JSON.stringify(k)}:${canonicalJson(v[k])}`).join(',')}}`
	}
	throw new Error(`canonical JSON: cannot encode ${typeof v}`)
}

const METHOD_NUMBERS = { 'rwa-recon-0.1': 1, 'rwa-recon-0.2': 2, 'rwa-recon-0.3': 3 }

/**
 * vet402's factsHash. Five fields joined by newlines, and from rwa-recon-0.3 on a sixth:
 * the keccak256 of the whole record as canonical JSON. One changed character anywhere
 * in the record changes the hash.
 */
export function factsHash(facts) {
	const n = METHOD_NUMBERS[facts.method_version]
	if (n === undefined) throw new Error(`unknown method_version ${facts.method_version}`)
	const address = String(facts.address).toLowerCase()
	const fields = [facts.method_version, address, facts.as_of, facts.r1_status, facts.realized_usd ?? 'null']
	if (n >= 3) fields.push(keccak256(canonicalJson({ ...facts, address })))
	return keccak256(fields.join('\n'))
}

export const subjectOf = (address) => keccak256(String(address).toLowerCase())

/** The few fields of a record that the rules read. */
export function recordFields(facts, meta) {
	return {
		source_url: meta.source_url,
		x_facts_hash: String(meta.x_facts_hash).toLowerCase(),
		recomputed_facts_hash: factsHash(facts),
		address: String(facts.address).toLowerCase(),
		chain_id: Number(facts.chain_id),
		as_of: String(facts.as_of),
		as_of_block: Number(facts.as_of_block),
		method_version: String(facts.method_version),
		r1_status: String(facts.r1_status),
		realized_usd: facts.realized_usd ?? null,
		tokens: (facts.tokens ?? []).map((t) => ({
			token: String(t.token).toLowerCase(),
			symbol: String(t.symbol),
			canonical: t.canonical === true,
			usd: t.usd ?? null,
			shares_ui: String(t.shares_ui),
		})),
		lookalikes: (facts.lookalikes ?? []).map((l) => ({
			token: String(l.token).toLowerCase(),
			imitates: String(l.imitates),
			counted: l.counted !== false,
			needs_review: l.needs_review === true,
		})),
	}
}

// ---------------------------------------------------------------- the 13 rules (copy-guard v1)
// A second, separate writing of agent/rules.ts. A and B ask whether the evidence is good
// enough to judge at all; a failure there gives HOLD. C asks whether the move should be
// copied; a failure there gives DO_NOT_COPY. Every rule passes: COPY, a paper trade only.

export const RULES_ID = 'copy-guard'
export const RULES_VERSION = 1
const MAX_PRICE_ATOMIC = 10000n
const PAPER_NOTIONAL_USD = '100.00'
const lc = (s) => String(s ?? '').toLowerCase()
const HASH32 = /^0x[0-9a-f]{64}$/

/** What the record says a token is. A look-alike entry wins over everything else. */
function kindOf(token, record) {
	const t = lc(token)
	if (record.lookalikes.some((l) => lc(l.token) === t)) return 'fake'
	if (t === USDG) return 'usdg'
	if (record.tokens.some((k) => k.canonical && lc(k.token) === t)) return 'stock'
	return 'unknown'
}

const stockLeg = (inp) => inp.movement.transfers.find((t) => kindOf(t.token, inp.record) === 'stock')

function paperTrade(inp) {
	const leg = stockLeg(inp)
	if (!leg) return null
	const tok = inp.record.tokens.find((k) => lc(k.token) === lc(leg.token))
	if (!tok || tok.usd === null) return null
	const shares = Number(tok.shares_ui)
	const usd = Number(tok.usd)
	if (!(shares > 0) || !(usd > 0)) return null
	const price = (usd / shares).toFixed(4)
	return {
		side: leg.direction === 'in' ? 'buy' : 'sell',
		token: lc(leg.token),
		symbol: tok.symbol,
		price_usd: price,
		notional_usd: PAPER_NOTIONAL_USD,
		shares: (Number(PAPER_NOTIONAL_USD) / Number(price)).toFixed(6),
	}
}

const isProfit = (s) => s !== null && /^-?\d+(\.\d+)?$/.test(s) && !s.startsWith('-') && /[1-9]/.test(s)

/** Each rule: id, the sentence the trail carries, and a function giving [passed, what it saw]. */
export const RULE_TABLE = [
	{
		id: 'A1',
		rule: 'the record was offered under the published x402 terms (exact, eip155:4663, USDG, at most 0.01, paid to the vet402 anchor wallet)',
		run: ({ terms: t }) => [
			t.scheme === 'exact' &&
				t.network === 'eip155:4663' &&
				lc(t.asset) === USDG &&
				lc(t.payTo) === CLAIMS.payee &&
				t.assetTransferMethod === 'permit2' &&
				/^\d+$/.test(t.amount) &&
				BigInt(t.amount) > 0n &&
				BigInt(t.amount) <= MAX_PRICE_ATOMIC,
			`${t.scheme} ${t.network} ${lc(t.asset)} amount ${t.amount} payTo ${lc(t.payTo)} ${t.assetTransferMethod}`,
		],
	},
	{
		id: 'A2',
		rule: 'X-Facts-Hash sent with the record equals the hash recomputed from its body',
		run: ({ record: r }) => [
			HASH32.test(lc(r.x_facts_hash)) && lc(r.x_facts_hash) === lc(r.recomputed_facts_hash),
			`header ${lc(r.x_facts_hash) || '(none)'} recomputed ${lc(r.recomputed_facts_hash)}`,
		],
	},
	{
		id: 'A3',
		rule: 'the record is about the watched wallet on Robinhood Chain 4663',
		run: ({ record: r, wallet }) => [
			lc(r.address) === lc(wallet) && r.chain_id === 4663 && /^rwa-recon-0\.[0-9]+$/.test(r.method_version),
			`record ${lc(r.address)} chain ${r.chain_id} ${r.method_version}`,
		],
	},
	{
		id: 'A4',
		rule: "the CRE workflow re-verified the wallet's newest vet402 anchor: MATCH",
		run: ({ cre: c }) => [
			c.verdict === 'MATCH' && c.reason_bits === 0 && lc(c.recomputed_facts_hash) === lc(c.anchored_facts_hash),
			`${c.verdict} reasons ${c.reason_bits} anchor tx ${lc(c.anchor_tx) || '(none)'}`,
		],
	},
	{
		id: 'A5',
		rule: 'the record replays to the balances it reports (r1_status is not unverified)',
		run: ({ record: r }) => [r.r1_status !== 'unverified', `r1_status ${r.r1_status}`],
	},
	{
		id: 'A6',
		rule: 'every look-alike token is left out of the figures and none waits for review',
		run: ({ record: r }) => {
			const shaky = r.lookalikes.filter((l) => l.counted || l.needs_review)
			return [shaky.length === 0, `${r.lookalikes.length} look-alikes, ${shaky.length} counted or needing review`]
		},
	},
	{
		id: 'B1',
		rule: 'the record was built at or after the block of the movement',
		run: ({ record: r, movement: m }) => [r.as_of_block >= m.block, `record block ${r.as_of_block}, movement block ${m.block}`],
	},
	{
		id: 'B2',
		rule: 'the record says what every moved token is (Stock Token, USDG or named look-alike)',
		run: ({ record: r, movement: m }) => {
			const kinds = m.transfers.map((x) => ({ token: lc(x.token), kind: kindOf(x.token, r) }))
			const unknown = kinds.filter((k) => k.kind === 'unknown')
			return [
				m.transfers.length > 0 && unknown.length === 0,
				m.transfers.length === 0
					? 'no transfers in the movement'
					: unknown.length
						? `not judged by the record: ${unknown.map((k) => k.token).join(', ')}`
						: kinds.map((k) => `${k.token} ${k.kind}`).join(', '),
			]
		},
	},
	{
		id: 'C1',
		rule: 'no token in the movement is a look-alike the record names as fake',
		run: ({ record: r, movement: m }) => {
			const fakes = m.transfers.map((x) => lc(x.token)).filter((t) => kindOf(t, r) === 'fake')
			const name = (t) => `${t} imitating ${r.lookalikes.find((x) => lc(x.token) === t)?.imitates ?? '?'}`
			return [fakes.length === 0, fakes.length ? `fake: ${fakes.map(name).join(', ')}` : 'none']
		},
	},
	{
		id: 'C2',
		rule: 'the movement moves a Robinhood Stock Token',
		run: (inp) => {
			const leg = stockLeg(inp)
			return [Boolean(leg), leg ? `${lc(leg.token)} ${leg.direction}` : 'no Stock Token moved']
		},
	},
	{
		id: 'C3',
		rule: "the wallet's track record is complete (r1_status reconstructed)",
		run: ({ record: r }) => [r.r1_status === 'reconstructed', `r1_status ${r.r1_status}`],
	},
	{
		id: 'C4',
		rule: 'the wallet has a realized profit (realized_usd above zero)',
		run: ({ record: r }) => [isProfit(r.realized_usd), `realized_usd ${r.realized_usd ?? 'null'}`],
	},
	{
		id: 'C5',
		rule: 'the moved Stock Token has a USD price in the record, so a paper trade can be sized',
		run: (inp) => {
			const pt = paperTrade(inp)
			return [pt !== null, pt ? `${pt.symbol} ${pt.price_usd} USD` : 'no priced Stock Token leg']
		},
	},
]

/** Run the rules on a trail's inputs. HOLD wins over DO_NOT_COPY. */
export function decide(inputs) {
	const rule_results = RULE_TABLE.map((r) => {
		const [ok, detail] = r.run(inputs)
		return { id: r.id, group: r.id[0], ok, rule: r.rule, detail }
	})
	const failed = (groups) => rule_results.filter((x) => groups.includes(x.group) && !x.ok).map((x) => x.id)
	const hold = failed(['A', 'B'])
	if (hold.length) return { rule_results, conclusion: 'HOLD', decisive: hold, paper_trade: null }
	const no = failed(['C'])
	if (no.length) return { rule_results, conclusion: 'DO_NOT_COPY', decisive: no, paper_trade: null }
	return { rule_results, conclusion: 'COPY', decisive: [], paper_trade: paperTrade(inputs) }
}

export const CONCLUSION_CODE = { HOLD: 0, DO_NOT_COPY: 1, COPY: 2 }

/** Rerun the rules on the trail's own inputs. An empty list means the trail says what the rules give. */
export function trailProblems(trail) {
	const problems = []
	if (trail.trail_version !== 1) problems.push(`trail_version ${trail.trail_version}, this file reads 1`)
	if (trail.rules?.id !== RULES_ID || trail.rules?.version !== RULES_VERSION) problems.push(`rules ${trail.rules?.id} v${trail.rules?.version}, this file has ${RULES_ID} v${RULES_VERSION}`)
	const again = decide(trail.inputs)
	const said = trail.decision ?? {}
	if (again.conclusion !== said.conclusion) problems.push(`the trail says ${said.conclusion}, the rules give ${again.conclusion}`)
	const saidRows = said.rule_results ?? []
	const differ = again.rule_results.filter((r, i) => canonicalJson(r) !== canonicalJson(saidRows[i] ?? null)).map((r) => r.id)
	if (differ.length || saidRows.length !== again.rule_results.length) problems.push(`rule rows differ from what the rules give: ${differ.join(' ') || 'extra rows'}`)
	if (canonicalJson({ d: again.decisive, p: again.paper_trade }) !== canonicalJson({ d: said.decisive, p: said.paper_trade })) problems.push('decisive rules or paper trade differ from what the rules give')
	const paid = trail.purchase?.mode === 'paid'
	if (paid && !/^0x[0-9a-fA-F]{64}$/.test(trail.purchase.payment_tx ?? '')) problems.push('the trail says paid but names no payment tx')
	if (trail.purchase?.mode === 'dry-run' && trail.purchase.payment_tx !== null) problems.push('the trail says dry-run but names a payment tx')
	return { problems, again }
}

// ---------------------------------------------------------------- reading the chains

/** The question could not be asked: no answer from any RPC. Not a failed check. */
export class Unreachable extends Error {}

const RPC_TIMEOUT_MS = 15_000
/** A busy public RPC answers 429 or 5xx now and then. Ask up to three times before giving up on it. */
const RPC_ATTEMPTS = 3

/** JSON-RPC over fetch. Tries each URL in turn, and uses a URL only after it has answered with the expected chain id. */
export function rpcClient(chain, { offline = false, fetchImpl = fetch, timeoutMs = RPC_TIMEOUT_MS, pauseMs = 700 } = {}) {
	const good = new Set()
	/** An RPC that did not answer at all is not asked again in this run. */
	const down = new Map()
	let id = 0
	async function once(url, method, params) {
		const host = new URL(url).host
		let res
		try {
			res = await fetchImpl(url, {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ jsonrpc: '2.0', id: ++id, method, params }),
				signal: AbortSignal.timeout(timeoutMs),
			})
		} catch (e) {
			const why = e?.name === 'TimeoutError' ? `no answer in ${timeoutMs / 1000} s` : (e?.cause?.code ?? e?.cause?.errors?.[0]?.code ?? e?.cause?.message ?? e?.message ?? 'network error')
			throw Object.assign(new Unreachable(`${host}: ${why}`), { again: true, silent: true })
		}
		if (!res.ok) throw Object.assign(new Unreachable(`${host}: HTTP ${res.status}`), { again: res.status === 429 || res.status >= 500 })
		let body
		try {
			body = await res.json()
		} catch {
			throw Object.assign(new Unreachable(`${host}: the answer is not JSON`), { again: true })
		}
		if (body.error) throw new Unreachable(`${host}: ${method}: ${body.error.message ?? 'rpc error'}`)
		return body.result
	}
	async function post(url, method, params) {
		if (down.has(url)) throw new Unreachable(down.get(url))
		for (let attempt = 1; ; attempt++) {
			try {
				return await once(url, method, params)
			} catch (e) {
				if (!(e instanceof Unreachable) || !e.again || attempt >= RPC_ATTEMPTS) {
					if (e.silent) down.set(url, e.message)
					throw e
				}
				await new Promise((r) => setTimeout(r, pauseMs * attempt))
			}
		}
	}
	return async (method, params) => {
		if (offline) throw new Unreachable('--offline')
		const why = []
		for (const url of chain.rpcs) {
			try {
				if (!good.has(url)) {
					const got = Number(BigInt(await post(url, 'eth_chainId', [])))
					if (got !== chain.id) throw new Unreachable(`${new URL(url).host} is chain ${got}, not ${chain.name} ${chain.id}`)
					good.add(url)
				}
				return await post(url, method, params)
			} catch (e) {
				if (!(e instanceof Unreachable)) throw e
				why.push(e.message)
			}
		}
		throw new Unreachable(why.join('; ') || `no RPC given for ${chain.name}`)
	}
}

const addrOf = (topic) => `0x${topic.slice(-40)}`.toLowerCase()
const word = (data, i) => `0x${data.slice(2 + 64 * i, 66 + 64 * i)}`.toLowerCase()
const ZERO32 = `0x${'0'.repeat(64)}`

/** ERC-20 Transfer logs of one tx that name the wallet, in log order. The shape the trail stores. */
export function movementFromLogs(wallet, tx, logs) {
	const w = wallet.toLowerCase()
	const seen = new Set()
	const items = []
	let block = 0
	for (const l of logs) {
		if (l.topics?.[0]?.toLowerCase() !== TRANSFER_TOPIC || l.topics.length !== 3) continue
		if (l.transactionHash.toLowerCase() !== tx.toLowerCase()) continue
		const key = `${l.transactionHash}:${l.logIndex}`
		if (seen.has(key)) continue
		seen.add(key)
		const from = addrOf(l.topics[1])
		const to = addrOf(l.topics[2])
		if (from !== w && to !== w) continue
		block = Number(BigInt(l.blockNumber))
		items.push({
			idx: Number(BigInt(l.logIndex)),
			t: { token: l.address.toLowerCase(), from, to, amount_raw: l.data && l.data !== '0x' ? BigInt(l.data.slice(0, 66)).toString() : '0', direction: to === w ? 'in' : 'out' },
		})
	}
	if (items.length === 0) return null
	return { chain_id: 4663, tx: tx.toLowerCase(), block, transfers: items.sort((a, b) => a.idx - b.idx).map((i) => i.t) }
}

// ---------------------------------------------------------------- the checks

const short = (h) => (h ? `${h.slice(0, 10)}…${h.slice(-6)}` : '(none)')
const shortAddr = (a) => `${a.slice(0, 6)}…${a.slice(-4)}`
const usdg = (atomic) => `${(Number(atomic) / 1e6).toString()} USDG`
const readJson = (path) => JSON.parse(readFileSync(path, 'utf8'))
const rel = (path) => relative(REPO, path) || '.'

/** Collects rows, prints each as it is decided. */
export class Report {
	constructor(print = console.log) {
		this.rows = []
		this.print = print
	}
	say(line = '') {
		this.print(line)
	}
	/** fn returns [passed, detail]. Unreachable becomes NOT CHECKED; any other error is a FAIL. */
	async check(name, fn) {
		let status
		let detail
		try {
			const [ok, d] = await fn()
			status = ok ? 'OK' : 'FAIL'
			detail = d
		} catch (e) {
			status = e instanceof Unreachable ? 'NOT CHECKED' : 'FAIL'
			detail = e instanceof Unreachable ? `not checked: ${e.message}` : String(e?.message ?? e)
		}
		this.rows.push({ status, name, detail })
		this.print(`  ${{ OK: 'OK  ', FAIL: 'FAIL', 'NOT CHECKED': '----' }[status]}  ${name.padEnd(15)} ${detail}`)
		return status === 'OK'
	}
	result() {
		if (this.rows.some((r) => r.status === 'FAIL')) return { text: 'MISMATCH', code: 1 }
		if (this.rows.some((r) => r.status === 'NOT CHECKED')) return { text: 'NOT CHECKED', code: 3 }
		return { text: 'MATCH', code: 0 }
	}
}

/** 1. The record the agent bought hashes to the X-Facts-Hash that came with it. */
async function checkBoughtRecord(rep, dir, trails) {
	const path = join(dir, 'record.json')
	await rep.check('record hash', () => {
		const h = factsHash(readJson(path))
		const named = [...new Set(trails.map((t) => lc(t.trail.inputs.record.x_facts_hash)))]
		const ok = named.length === 1 && named[0] === h
		return [ok, ok ? `${rel(path)} hashes to ${short(h)}, the X-Facts-Hash vet402 sent with it, which all ${trails.length} trails name` : `${rel(path)} hashes to ${h}, but the X-Facts-Hash the trails name is ${named.join(', ') || '(none)'}`]
	})
}

/** 2. The anchored record against RwaAnchor on Robinhood Chain, and what the CRE workflow wrote about it. */
async function checkAnchor(rep, main, test, trails) {
	const path = join(REPO, CLAIMS.anchoredRecord)
	let rec = null
	let receipt = null
	await rep.check('record file', () => {
		rec = readJson(path)
		const h = factsHash(rec.facts)
		const ok = lc(rec.facts_hash) === h && lc(rec.anchor_tx) === CLAIMS.anchorTx && lc(rec.facts.address) === CLAIMS.wallet
		return [ok, ok ? `${rel(path)} hashes to ${short(h)}, the hash written in it` : `recomputed ${h}; the file says facts_hash ${rec.facts_hash}, anchor_tx ${rec.anchor_tx}, wallet ${rec.facts.address}`]
	})
	if (!rec) return
	const want = { hash: factsHash(rec.facts), subject: subjectOf(rec.facts.address), asOf: String(Math.floor(Date.parse(rec.facts.as_of) / 1000)), method: METHOD_NUMBERS[rec.facts.method_version] }
	await rep.check('anchor tx', async () => {
		receipt = await main('eth_getTransactionReceipt', [CLAIMS.anchorTx])
		if (!receipt) return [false, `${short(CLAIMS.anchorTx)} is not on Robinhood Chain`]
		return [receipt.status === '0x1', `${short(CLAIMS.anchorTx)} ${receipt.status === '0x1' ? 'succeeded' : 'failed'} in block ${Number(BigInt(receipt.blockNumber))} on Robinhood Chain`]
	})
	await rep.check('anchor contract', async () => {
		const code = await main('eth_getCode', [RWA_ANCHOR, 'latest'])
		const k = code && code !== '0x' ? keccak256(hexToBytes(code)) : '(no code)'
		return [k === RWA_ANCHOR_RUNTIME_KECCAK, k === RWA_ANCHOR_RUNTIME_KECCAK ? `RwaAnchor ${shortAddr(RWA_ANCHOR)} runs the pinned build: no owner, no upgrade path` : `RwaAnchor code hashes to ${k}, expected ${RWA_ANCHOR_RUNTIME_KECCAK}`]
	})
	await rep.check('anchored hash', async () => {
		if (!receipt) receipt = await main('eth_getTransactionReceipt', [CLAIMS.anchorTx])
		const log = (receipt?.logs ?? []).find((l) => l.address.toLowerCase() === RWA_ANCHOR && l.topics?.[0]?.toLowerCase() === ANCHORED_TOPIC && l.topics.length === 4)
		if (!log) return [false, `no Anchored log from RwaAnchor in ${short(CLAIMS.anchorTx)}`]
		const got = { subject: lc(log.topics[1]), hash: lc(log.topics[2]), by: addrOf(log.topics[3]), method: Number(BigInt(word(log.data, 0))), asOf: BigInt(word(log.data, 1)).toString() }
		const bad = []
		if (got.hash !== want.hash) bad.push(`anchored ${got.hash}, recomputed ${want.hash}`)
		if (got.subject !== want.subject) bad.push('the anchor is about another wallet')
		if (got.by !== CLAIMS.payee || got.by !== lc(rec.anchored_by)) bad.push(`anchored by ${got.by}`)
		if (got.method !== want.method) bad.push(`method version ${got.method}`)
		if (got.asOf !== want.asOf) bad.push(`as_of ${got.asOf}, the record gives ${want.asOf}`)
		return [bad.length === 0, bad.length ? bad.join('; ') : `onchain ${short(got.hash)} = recomputed; wallet ${shortAddr(CLAIMS.wallet)}, written by ${shortAddr(got.by)}, as of ${rec.facts.as_of}`]
	})
	const verdictTxs = [...new Set(trails.map((t) => lc(t.trail.inputs.cre.verdict_tx)).filter(Boolean))]
	for (const tx of verdictTxs) await checkVerdict(rep, test, trails.find((t) => lc(t.trail.inputs.cre.verdict_tx) === tx).trail, want.hash)
}

/** The CRE workflow's own verdict on the anchor, as RwaVerdictReceiver emitted it on Robinhood Testnet. */
async function checkVerdict(rep, test, trail, wantHash) {
	const cre = trail.inputs.cre
	await rep.check('CRE verdict', async () => {
		if (!cre.verdict_tx) return [true, 'simulated only, the trail names no verdict tx']
		const r = await test('eth_getTransactionReceipt', [cre.verdict_tx])
		if (!r) return [false, `${short(cre.verdict_tx)} is not on Robinhood Testnet`]
		const log = (r.logs ?? []).find((l) => l.address.toLowerCase() === VERDICT_RECEIVER && l.topics?.[0]?.toLowerCase() === RECORD_CHECKED_TOPIC)
		if (!log || r.status !== '0x1') return [false, `no RecordChecked from RwaVerdictReceiver in ${short(cre.verdict_tx)}`]
		const bad = []
		if (lc(log.topics[1]) !== lc(cre.anchor_tx)) bad.push(`it is about anchor ${short(lc(log.topics[1]))}`)
		if (lc(log.topics[2]) !== subjectOf(trail.inputs.wallet)) bad.push('it is about another wallet')
		if ((BigInt(log.topics[3]) === 1n) !== (cre.verdict === 'MATCH')) bad.push(`isMatch ${BigInt(log.topics[3])}, the trail says ${cre.verdict}`)
		if (Number(BigInt(word(log.data, 0))) !== cre.reason_bits) bad.push(`reasons ${Number(BigInt(word(log.data, 0)))}`)
		if (word(log.data, 1) !== lc(cre.recomputed_facts_hash) || word(log.data, 2) !== lc(cre.anchored_facts_hash)) bad.push('hashes differ from the trail')
		if (wantHash && word(log.data, 1) !== wantHash) bad.push(`the workflow recomputed ${word(log.data, 1)}, this script ${wantHash}`)
		return [bad.length === 0, bad.length ? bad.join('; ') : `the CRE workflow wrote ${cre.verdict} for anchor ${short(lc(cre.anchor_tx))} in ${short(lc(cre.verdict_tx))} on Robinhood Testnet`]
	})
}

/** 3. The x402 settlement moved the price in USDG from the agent to vet402. */
async function checkPayment(rep, main, { tx, payer, payee, amount, alsoNamedBy }) {
	let receipt = null
	await rep.check('settlement tx', async () => {
		for (const [who, named] of alsoNamedBy ?? []) if (lc(named) !== lc(tx)) return [false, `${who} names ${named}, expected ${tx}`]
		receipt = await main('eth_getTransactionReceipt', [tx])
		if (!receipt) return [false, `${short(tx)} is not on Robinhood Chain`]
		return [receipt.status === '0x1', `${short(lc(tx))} ${receipt.status === '0x1' ? 'succeeded' : 'failed'} in block ${Number(BigInt(receipt.blockNumber))} on Robinhood Chain`]
	})
	await rep.check('USDG moved', async () => {
		if (!receipt) receipt = await main('eth_getTransactionReceipt', [tx])
		const moves = (receipt?.logs ?? []).filter((l) => l.address.toLowerCase() === USDG && l.topics?.[0]?.toLowerCase() === TRANSFER_TOPIC && l.topics.length === 3)
		const hit = moves.filter((l) => addrOf(l.topics[1]) === lc(payer) && addrOf(l.topics[2]) === lc(payee) && BigInt(l.data) === BigInt(amount))
		const ok = receipt?.status === '0x1' && hit.length === 1 && moves.length === 1
		return [ok, ok ? `${usdg(amount)} from ${shortAddr(lc(payer))} (the agent) to ${shortAddr(lc(payee))} (vet402), the only USDG transfer in the tx` : `${moves.length} USDG transfers in the tx, ${hit.length} of them ${amount} atomic from ${payer} to ${payee}`]
	})
}

/** 4. One decision: hash, rules, record fields, the move on Robinhood Chain, the event on Robinhood Testnet. */
async function checkTrail(rep, main, test, file, { record, expected } = {}) {
	const trail = file.trail ?? file
	const hash = keccak256(canonicalJson(trail))
	await rep.check('trail hash', () => {
		if (file.trail && file.trail_hash === undefined) return [false, 'the file carries no trail_hash']
		const said = file.trail ? file.trail_hash : hash
		return [said === hash, said === hash ? `the trail hashes to ${short(hash)}, as the file says` : `the trail hashes to ${hash}, the file says ${said}`]
	})
	await rep.check('rules', () => {
		const { problems, again } = trailProblems(trail)
		if (expected && again.conclusion !== expected) problems.push(`this repo claims ${expected}`)
		const pass = again.rule_results.filter((r) => r.ok).length
		return [problems.length === 0, problems.length ? problems.join('; ') : `${again.rule_results.length} rules rerun give ${again.conclusion}${again.decisive.length ? ` (failed: ${again.decisive.join(' ')})` : ''}, ${pass} pass, every row as the trail has it`]
	})
	if (record) {
		await rep.check('record fields', () => {
			const rebuilt = recordFields(record.json, { source_url: trail.inputs.record.source_url, x_facts_hash: trail.inputs.record.x_facts_hash })
			const same = canonicalJson(rebuilt) === canonicalJson(trail.inputs.record)
			return [same, same ? `what the rules read is what ${rel(record.path)} holds` : `the trail's record fields differ from ${rel(record.path)} (it hashes to ${rebuilt.recomputed_facts_hash})`]
		})
	}
	const mv = trail.inputs.movement
	await rep.check('move on chain', async () => {
		const w = `0x${'0'.repeat(24)}${lc(trail.inputs.wallet).slice(2)}`
		const range = { fromBlock: `0x${mv.block.toString(16)}`, toBlock: `0x${mv.block.toString(16)}` }
		const [sent, received] = await Promise.all([main('eth_getLogs', [{ ...range, topics: [TRANSFER_TOPIC, w] }]), main('eth_getLogs', [{ ...range, topics: [TRANSFER_TOPIC, null, w] }])])
		const onchain = movementFromLogs(trail.inputs.wallet, mv.tx, [...sent, ...received])
		const same = onchain !== null && canonicalJson(onchain) === canonicalJson(mv)
		return [same, same ? `${short(lc(mv.tx))} in block ${mv.block}: ${mv.transfers.length} transfer${mv.transfers.length === 1 ? '' : 's'} of the wallet, as the trail lists` : `Robinhood Chain shows ${onchain ? `${onchain.transfers.length} transfers` : 'no transfer of the wallet'} for ${mv.tx} in block ${mv.block}; the trail lists ${mv.transfers.length}`]
	})
	await rep.check('trail onchain', async () => {
		if (!file.trail_tx) return [false, 'the file names no trail tx (a simulated run writes nothing onchain)']
		const r = await test('eth_getTransactionReceipt', [file.trail_tx])
		if (!r) return [false, `${short(file.trail_tx)} is not on Robinhood Testnet`]
		const log = (r.logs ?? []).find((l) => l.address.toLowerCase() === TRAIL_RECEIVER && l.topics?.[0]?.toLowerCase() === DECISION_TOPIC)
		if (!log || r.status !== '0x1') return [false, `no DecisionRecorded from ReasoningTrailReceiver in ${short(file.trail_tx)}`]
		const bad = []
		if (lc(log.topics[1]) !== hash) bad.push(`onchain trail hash ${lc(log.topics[1])}`)
		if (lc(log.topics[2]) !== subjectOf(trail.inputs.wallet)) bad.push('another wallet')
		if (Number(BigInt(log.topics[3])) !== CONCLUSION_CODE[trail.decision.conclusion]) bad.push(`conclusion code ${Number(BigInt(log.topics[3]))}`)
		if (word(log.data, 0) !== lc(trail.inputs.record.recomputed_facts_hash)) bad.push('another record hash')
		if (word(log.data, 1) !== lc(mv.tx)) bad.push('another movement tx')
		if (word(log.data, 2) !== lc(trail.inputs.cre.verdict_tx ?? ZERO32)) bad.push('another verdict tx')
		if (word(log.data, 3) !== lc(trail.purchase.payment_tx ?? ZERO32)) bad.push('another payment tx')
		if (Number(BigInt(word(log.data, 4))) !== trail.rules.version) bad.push('another rules version')
		return [bad.length === 0, bad.length ? `DecisionRecorded in ${short(file.trail_tx)} differs: ${bad.join('; ')}` : `DecisionRecorded in ${short(file.trail_tx)} on Robinhood Testnet has this hash, ${trail.decision.conclusion}, the same record, move and payment`]
	})
}

function loadTrails(dir) {
	return readdirSync(dir)
		.filter((f) => /^trail-\d+-[0-9a-f]+\.json$/.test(f))
		.map((f) => ({ path: join(dir, f), ...readJson(join(dir, f)) }))
		.sort((a, b) => a.trail.inputs.movement.block - b.trail.inputs.movement.block)
}

/** agent/rules.ts is the file the trails name by hash. A Windows checkout may have turned LF into CRLF. */
function rulesSourceHash() {
	const bytes = readFileSync(join(REPO, 'agent/rules.ts'))
	return [keccak256(new Uint8Array(bytes)), keccak256(bytes.toString('utf8').replace(/\r\n/g, '\n'))]
}

// ---------------------------------------------------------------- the two ways to run it

async function verifyAll(rep, main, test) {
	const dir = join(REPO, CLAIMS.runDir)
	let trails = []
	rep.say(`1. The record the agent bought`)
	await rep.check('evidence', () => {
		trails = loadTrails(dir)
		const blocks = trails.map((t) => String(t.trail.inputs.movement.block))
		const want = Object.keys(CLAIMS.decisions)
		const ok = canonicalJson(blocks) === canonicalJson(want) && trails.every((t) => lc(t.trail.inputs.wallet) === CLAIMS.wallet)
		return [ok, ok ? `${rel(dir)} holds the record, the 402 exchange and ${trails.length} trails about wallet ${shortAddr(CLAIMS.wallet)}` : `${rel(dir)} holds trails for blocks ${blocks.join(', ') || '(none)'}, expected ${want.join(', ')}`]
	})
	await checkBoughtRecord(rep, dir, trails)

	rep.say(`2. The record vet402 anchored, against RwaAnchor on Robinhood Chain`)
	await checkAnchor(rep, main, test, trails)

	rep.say(`3. The x402 payment`)
	await checkPayment(rep, main, {
		tx: CLAIMS.paymentTx,
		payer: CLAIMS.payer,
		payee: CLAIMS.payee,
		amount: CLAIMS.priceAtomic,
		alsoNamedBy: [[`${CLAIMS.runDir}/x402-paid.json`, readJson(join(dir, 'x402-paid.json')).settlement?.transaction], ...trails.map((t) => [basename(t.path), t.trail.purchase.payment_tx])],
	})

	rep.say(`4. The three decisions`)
	await rep.check('rules file', () => {
		const [raw, lf] = rulesSourceHash()
		const named = [...new Set(trails.map((t) => t.trail.rules.source_keccak))]
		const ok = named.length === 1 && (named[0] === raw || named[0] === lf)
		return [ok, ok ? `agent/rules.ts hashes to ${short(named[0])}, the rules every trail names` : `agent/rules.ts hashes to ${raw}; the trails name ${named.join(', ') || '(none)'}`]
	})
	const record = { path: join(dir, 'record.json'), json: readJson(join(dir, 'record.json')) }
	for (const t of trails) {
		const mv = t.trail.inputs.movement
		rep.say(`  ${basename(t.path)}: the wallet's move in block ${mv.block}`)
		await checkTrail(rep, main, test, t, { record, expected: CLAIMS.decisions[mv.block] })
	}
}

async function verifyOne(rep, main, test, path) {
	const file = readJson(path)
	const trail = file.trail ?? file
	const mv = trail.inputs.movement
	rep.say(`${rel(path)}: wallet ${lc(trail.inputs.wallet)}, move ${mv.tx} in block ${mv.block}, the trail says ${trail.decision?.conclusion}`)
	const recordPath = join(dirname(path), 'record.json')
	const record = existsSync(recordPath) ? { path: recordPath, json: readJson(recordPath) } : undefined
	await checkTrail(rep, main, test, file, { record })
	if (trail.purchase.mode === 'paid') await checkPayment(rep, main, { tx: trail.purchase.payment_tx, payer: trail.purchase.payer, payee: CLAIMS.payee, amount: trail.inputs.terms.amount })
	else await rep.check('payment', () => [true, 'dry run: the trail says nothing was paid, and names no payment tx'])
	await checkVerdict(rep, test, trail, null)
}

export class Usage extends Error {}

export function parseArgs(argv) {
	const a = { offline: false, target: null, rpc: null, testnetRpc: null }
	for (let i = 0; i < argv.length; i++) {
		const k = argv[i]
		const value = () => {
			if (argv[i + 1] === undefined) throw new Usage(`${k} needs a URL`)
			return argv[++i]
		}
		if (k === '--offline') a.offline = true
		else if (k === '--rpc') a.rpc = value()
		else if (k === '--testnet-rpc') a.testnetRpc = value()
		else if (k === '-h' || k === '--help') throw new Usage('')
		else if (k.startsWith('--')) throw new Usage(`unknown option ${k}`)
		else if (a.target === null) a.target = k
		else throw new Usage('give one trail file or one block number, not more')
	}
	return a
}

/** A block number picks the trail of the paid run about that block; anything else is a path. */
export function resolveTarget(target) {
	if (/^\d+$/.test(target)) {
		const dir = join(REPO, CLAIMS.runDir)
		const hit = readdirSync(dir).filter((f) => new RegExp(`^trail-${target}-[0-9a-f]+\\.json$`).test(f))
		if (hit.length !== 1) throw new Usage(`no trail for block ${target} in ${CLAIMS.runDir}; it has blocks ${Object.keys(CLAIMS.decisions).join(', ')}`)
		return join(dir, hit[0])
	}
	if (!existsSync(target)) throw new Usage(`no such file: ${target}`)
	return target
}

const USAGE = `usage: node verify.mjs [trail.json | block number] [--offline] [--rpc URL] [--testnet-rpc URL]
  no argument    recheck the paid run in ${CLAIMS.runDir}
  block number   one of ${Object.keys(CLAIMS.decisions).join(', ')}
exit code: 0 MATCH, 1 MISMATCH, 2 usage, 3 NOT CHECKED (an RPC could not be reached and nothing failed)`

export async function run(argv, { print = console.log, fetchImpl = fetch, pauseMs } = {}) {
	let args
	let path = null
	try {
		args = parseArgs(argv)
		if (args.target !== null) path = resolveTarget(args.target)
	} catch (e) {
		if (!(e instanceof Usage)) throw e
		print(e.message ? `${e.message}\n${USAGE}` : USAGE)
		return 2
	}
	const mainChain = { ...CHAINS.mainnet, rpcs: args.rpc ? [args.rpc] : CHAINS.mainnet.rpcs }
	const testChain = { ...CHAINS.testnet, rpcs: args.testnetRpc ? [args.testnetRpc] : CHAINS.testnet.rpcs }
	const main = rpcClient(mainChain, { offline: args.offline, fetchImpl, pauseMs })
	const test = rpcClient(testChain, { offline: args.offline, fetchImpl, pauseMs })
	const rep = new Report(print)
	rep.say('vet402 copy-guard: recheck with no key, no account and no install')
	rep.say(args.offline ? '  chains  not read (--offline)' : `  chains  ${mainChain.name} ${mainChain.id} at ${new URL(mainChain.rpcs[0]).host}, ${testChain.name} ${testChain.id} at ${new URL(testChain.rpcs[0]).host}`)
	await rep.check('keccak256', () => [checkKeccak(), checkKeccak() ? 'the built-in hash gives the published test values' : 'the built-in hash is broken; no other line can be trusted'])
	if (path) await verifyOne(rep, main, test, path)
	else await verifyAll(rep, main, test)
	const res = rep.result()
	const count = (s) => rep.rows.filter((r) => r.status === s).length
	rep.say('')
	rep.say(`${count('OK')} OK, ${count('FAIL')} FAIL, ${count('NOT CHECKED')} not checked`)
	rep.say(`RESULT: ${res.text}`)
	return res.code
}

const invoked = process.argv[1] && existsSync(process.argv[1]) && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)
if (invoked) {
	// `node verify.mjs | head` closes the pipe early. No stack trace for that, and no exit code 0:
	// a run whose output was cut off has not reported MATCH.
	process.stdout.on('error', () => process.exit(3))
	run(process.argv.slice(2)).then(
		(code) => {
			process.exitCode = code
		},
		(e) => {
			console.log(`  FAIL  verify.mjs      stopped: ${e?.message ?? e}`)
			console.log('RESULT: MISMATCH')
			process.exitCode = 1
		},
	)
}
