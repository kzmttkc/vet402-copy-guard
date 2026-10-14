#!/usr/bin/env node
// verify.mjs: recheck what this repo claims, from the saved files and two public chains.
//
// Needs Node 20 or newer and nothing else. No npm install, no key, no account, no login.
//
//   node verify.mjs                      every check below
//   node verify.mjs 73953009             only the decision about the wallet's move in that block
//   node verify.mjs path/to/trail.json   only that decision
//
//   --only paid-run       sections 1 to 4: the paid run of 2026-10-08
//   --only ledger         section 5: the practice ledger, the mandate and the user's limits
//   --only gate           section 6: the x402 gate in front of the CRE workflow
//   --quick               only the payment, the anchor, the CRE verdicts, the four cards at the top of the
//                         page and the ledger root, in about 20 seconds (the full run takes about 90)
//   --deep                check every decision of the ledger against the chain, not a sample
//   --offline             skip the chain reads; those lines are reported as not checked
//   --rpc URL             another RPC for Robinhood Chain (4663)
//   --testnet-rpc URL     another RPC for Robinhood Testnet (46630)
//
// Every line starts with OK, FAIL or ----. A busy RPC (429, 5xx, no connection) is asked
// again after 0.5, 1, 2, 4 and 8 seconds, and the line says so. A ---- line was not
// checked because no RPC answered even then, so the question stays open. It is never
// counted as a pass.
//
// Exit code   last line
//   0         RESULT: MATCH          every check passed
//   1         RESULT: MISMATCH       at least one check failed
//   2         (usage)                the arguments could not be read
//   3         RESULT: NOT CHECKED    nothing failed, but some checks could not reach an RPC
//
// This file imports nothing from the agent and has no dependency. It carries its own
// keccak256, its own canonical JSON, its own secp256k1 signature recovery and its own
// copy of the rules, the decision cards and the ledger, so it cannot repeat a mistake by
// reusing the agent's code. agent/verify.test.ts and agent/verify-v2.test.ts run the two
// implementations against each other on a few thousand cases.
import { createHash } from 'node:crypto'
import { existsSync, readdirSync, readFileSync, realpathSync } from 'node:fs'
import { basename, dirname, join, relative, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { gunzipSync } from 'node:zlib'

const REPO = dirname(fileURLToPath(import.meta.url))

/** The two largest files of a walk are kept gzipped (`name.gz`). Read the .gz when it is there, else the plain file. */
export function readWalkFile(path) {
	return existsSync(`${path}.gz`) ? gunzipSync(readFileSync(`${path}.gz`)) : readFileSync(path)
}

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
	/** The practice ledger: every version 2 decision, copy-guard next to a ticker copy. */
	ledger: 'docs/ledger.json',
	walkDir: 'docs/walk',
	/** The sha256 of the walk files that are kept gzipped, taken before they were gzipped. */
	compressed: 'docs/verify/compressed.json',
	/** The decisions of the ledger, one file per wallet, which the page loads when asked. */
	pageRowsDir: 'docs/rows',
	/** The page a person reads without a terminal. It carries the ledger. */
	page: 'docs/index.html',
	/** The user's limits and the mandate the principal signs. */
	limits: 'limits.json',
	mandate: 'mandate/mandate.json',
	sampleMandate: 'mandate/sample/mandate.json',
	/** The 402 exchange with the gate in front of the CRE workflow, saved from a dry run. */
	gateDryRun: 'docs/agent/gate-dry-run/x402-gate-dry-run.json',
	agentCard: 'agent.json',
	skill: 'SKILL.md',
}

const PERMIT2 = '0x000000000022d473030f116ddee9f6b43ac78ba3'
const X402_PERMIT2_PROXY = '0x402085c248eea27d92e8b30b2c58ed07f9e20001'

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
	if (trail.trail_version === 2) {
		try {
			return trailProblemsV2(trail)
		} catch (e) {
			return { problems: [`not a readable version 2 trail: ${String(e?.message ?? e).slice(0, 120)}`], again: { rule_results: [], conclusion: 'HOLD', decisive: [], paper_trade: null } }
		}
	}
	const problems = []
	if (trail.trail_version !== 1) problems.push(`trail_version ${trail.trail_version}, this file reads 1 and 2`)
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

// ---------------------------------------------------------------- copy-guard v2: mandate, limits, cards, ledger
// A second, separate writing of agent/mandate.ts, agent/limits.ts, agent/rules-v2.ts,
// agent/card.ts and agent/ledger.ts. Version 2 keeps the 13 rules above and adds three:
// M1 (a mandate signed by the principal covers the decision), L1 and L2 (the user's limits).

// secp256k1, y^2 = x^3 + 7 over the prime field P (SEC 2, section 2.4.1), and public key
// recovery (SEC 1, section 4.1.6). Written for this file. Jacobian coordinates.
const EC_P = 2n ** 256n - 2n ** 32n - 977n
const EC_N = 0xfffffffffffffffffffffffffffffffebaaedce6af48a03bbfd25e8cd0364141n
const EC_G = [0x79be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798n, 0x483ada7726a3c4655da4fbfc0e1108a8fd17b448a68554199c47d08ffb10d4b8n, 1n]
const modp = (a, m) => ((a % m) + m) % m
function powMod(b, e, m) {
	let r = 1n
	let x = modp(b, m)
	for (let k = e; k > 0n; k >>= 1n) {
		if (k & 1n) r = (r * x) % m
		x = (x * x) % m
	}
	return r
}
function ecDouble([x, y, z]) {
	if (y === 0n) return [0n, 1n, 0n]
	const s = modp(4n * x * y * y, EC_P)
	const m = modp(3n * x * x, EC_P)
	const x2 = modp(m * m - 2n * s, EC_P)
	return [x2, modp(m * (s - x2) - 8n * y * y * y * y, EC_P), modp(2n * y * z, EC_P)]
}
function ecAdd(a, b) {
	if (a[2] === 0n) return b
	if (b[2] === 0n) return a
	const z1 = modp(a[2] * a[2], EC_P)
	const z2 = modp(b[2] * b[2], EC_P)
	const u1 = modp(a[0] * z2, EC_P)
	const u2 = modp(b[0] * z1, EC_P)
	const s1 = modp(a[1] * b[2] * z2, EC_P)
	const s2 = modp(b[1] * a[2] * z1, EC_P)
	if (u1 === u2) return s1 === s2 ? ecDouble(a) : [0n, 1n, 0n]
	const h = modp(u2 - u1, EC_P)
	const r = modp(s2 - s1, EC_P)
	const h2 = modp(h * h, EC_P)
	const h3 = modp(h * h2, EC_P)
	const x3 = modp(r * r - h3 - 2n * u1 * h2, EC_P)
	return [x3, modp(r * (u1 * h2 - x3) - s1 * h3, EC_P), modp(h * a[2] * b[2], EC_P)]
}
function ecMul(k, p) {
	let r = [0n, 1n, 0n]
	let q = p
	for (let e = modp(k, EC_N); e > 0n; e >>= 1n) {
		if (e & 1n) r = ecAdd(r, q)
		q = ecDouble(q)
	}
	return r
}

/** The address whose key made this 65-byte signature over a 32-byte hash, or null. */
export function recoverSigner(hash, signature) {
	if (!/^0x[0-9a-fA-F]{64}$/.test(hash ?? '') || !/^0x[0-9a-fA-F]{130}$/.test(signature ?? '')) return null
	const r = BigInt(`0x${signature.slice(2, 66)}`)
	const s = BigInt(`0x${signature.slice(66, 130)}`)
	let v = Number.parseInt(signature.slice(130, 132), 16)
	if (v >= 27) v -= 27
	if ((v !== 0 && v !== 1) || r <= 0n || r >= EC_N || s <= 0n || s >= EC_N) return null
	const y2 = modp(r * r * r + 7n, EC_P)
	let y = powMod(y2, (EC_P + 1n) / 4n, EC_P)
	if (modp(y * y, EC_P) !== y2) return null
	if (Number(y & 1n) !== v) y = EC_P - y
	const rInv = powMod(r, EC_N - 2n, EC_N)
	const q = ecAdd(ecMul(modp(-BigInt(hash) * rInv, EC_N), EC_G), ecMul(modp(s * rInv, EC_N), [r, y, 1n]))
	if (q[2] === 0n) return null
	const zi = powMod(q[2], EC_P - 2n, EC_P)
	const zi2 = modp(zi * zi, EC_P)
	const pub = modp(q[0] * zi2, EC_P).toString(16).padStart(64, '0') + modp(q[1] * zi2 * zi, EC_P).toString(16).padStart(64, '0')
	return `0x${keccak256(hexToBytes(pub)).slice(-40)}`
}

/** EIP-191, what a wallet's "sign message" hashes. */
export function personalHash(message) {
	const bytes = new TextEncoder().encode(message)
	const prefix = new TextEncoder().encode(`\x19Ethereum Signed Message:\n${bytes.length}`)
	const all = new Uint8Array(prefix.length + bytes.length)
	all.set(prefix)
	all.set(bytes, prefix.length)
	return keccak256(all)
}

/** The one line the principal signs. */
export function mandateLine(m) {
	return `vet402 copy-guard mandate v${m.mandate_version}: I, ${m.principal}, authorize the agent whose payment key is ${m.agent.payment_key} to act for me under the mandate with keccak256 ${keccak256(canonicalJson(m))}. Practice trades only: ${m.scope.practice_only ? 'yes' : 'no'}. Valid from ${m.valid_from} until ${m.valid_until}.`
}
const signerCache = new Map()
export function signerOfMandate(m, signature) {
	if (!signature) return null
	const key = `${keccak256(canonicalJson(m))} ${String(signature).trim()}`
	if (!signerCache.has(key)) signerCache.set(key, recoverSigner(personalHash(mandateLine(m)), String(signature).trim()))
	return signerCache.get(key)
}

const toCents = (s) => {
	const [whole, frac = ''] = String(s).split('.')
	return BigInt(whole) * 100n + BigInt(frac.padEnd(2, '0').slice(0, 2))
}
const fromCents = (c) => `${c < 0n ? '-' : ''}${(c < 0n ? -c : c) / 100n}.${((c < 0n ? -c : c) % 100n).toString().padStart(2, '0')}`
const ISO_TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{3})?Z$/

function gapInMandate(inp) {
	const m = inp.mandate
	const d = m.document
	if (!m.signature || !m.signer) return 'the mandate is not signed'
	if (lc(m.signer) !== lc(d.principal)) return `the signature is from ${lc(m.signer)}, not from the principal`
	if (d.scope.practice_only !== true || inp.limits.practice_only !== true) return 'the mandate or the limits do not say practice only'
	if (lc(d.limits_keccak) !== lc(inp.limits_keccak)) return 'the mandate names other limits'
	if (canonicalJson(d.rules) !== canonicalJson(inp.rules)) return 'the mandate names other rules'
	if (lc(d.agent.payment_key) !== lc(inp.payer)) return 'the mandate names another payment key'
	if (d.chain_id !== inp.movement.chain_id) return 'the mandate is for another chain'
	if (!ISO_TIME.test(inp.decided_at) || !ISO_TIME.test(d.valid_from) || !ISO_TIME.test(d.valid_until)) return 'a date cannot be read'
	const t = Date.parse(inp.decided_at)
	if (t < Date.parse(d.valid_from) || t > Date.parse(d.valid_until)) return `decided ${inp.decided_at}, outside ${d.valid_from} to ${d.valid_until}`
	return ''
}

const movedKind = (inp, token) => inp.tokens_moved.find((m) => m.token === lc(token))
const stockLeg2 = (inp) => inp.movement.transfers.find((t) => movedKind(inp, t.token)?.kind === 'stock')

/** The feed's answer as a USD price with four decimals, or null. */
const feedUsd = (p) => (!p || !/^\d+$/.test(p.answer) || BigInt(p.answer) <= 0n ? null : (Number(p.answer) / 10 ** p.decimals).toFixed(4))

function gapInPrice(inp) {
	const p = inp.price
	if (!p || feedUsd(p) === null) return 'no feed value'
	if (p.update_block > inp.movement.block) return 'the feed value is from after the move'
	const ageHours = (Date.parse(inp.move.time) - Date.parse(p.updated_at)) / 3_600_000
	if (!(ageHours <= inp.limits.evidence.max_price_age_hours)) return `the feed value is ${Math.floor(ageHours)} hours old, the limit is ${inp.limits.evidence.max_price_age_hours}`
	return ''
}

function dayRoom(inp) {
	const left = toCents(inp.limits.size.max_usd_per_day) - toCents(inp.book.used_usd_today)
	return left > 0n ? left : 0n
}

function practicePosition(inp, tier, room) {
	const leg = stockLeg2(inp)
	const token = movedKind(inp, leg.token)
	const price = Number(feedUsd(inp.price))
	const want = toCents(tier === 'FULL' ? inp.limits.size.full_usd : inp.limits.size.reduced_usd)
	const notional = fromCents(want < room ? want : room)
	const ex = inp.limits.exit
	const stopLoss = (price * (1 - Number(ex.stop_loss_pct) / 100)).toFixed(4)
	const takeProfit = (price * (1 + Number(ex.take_profit_pct) / 100)).toFixed(4)
	const closeBy = new Date(Date.parse(inp.move.time) + ex.max_holding_days * 86_400_000).toISOString()
	return {
		side: 'buy',
		tier,
		token: token.token,
		symbol: token.ticker,
		price_usd: price.toFixed(4),
		price_round_id: inp.price.round_id,
		notional_usd: notional,
		shares: (Number(notional) / price).toFixed(6),
		exit: {
			when_wallet_sells: ex.when_wallet_sells,
			stop_loss_usd: stopLoss,
			take_profit_usd: takeProfit,
			close_by: closeBy,
			rule: `leave ${ex.when_wallet_sells ? 'when the wallet sells or sends the token, ' : ''}when the feed is at or under ${stopLoss} USD (${ex.stop_loss_pct}% under the entry), at or over ${takeProfit} USD (${ex.take_profit_pct}% over) or on ${closeBy.slice(0, 10)} (${ex.max_holding_days} days), whichever comes first`,
		},
	}
}

const WETH_ADDRESS = '0x0bd7d308f8e1639fab988df18a8011f41eacad73'

/** USDG and WETH that left the wallet, summed per token in log order, and the ETH the transaction carried when the wallet signed it. Nothing else is a payment. */
function whatWasPaid(inp) {
	const order = []
	const sums = {}
	for (const t of inp.movement.transfers) {
		const token = lc(t.token)
		if (t.direction !== 'out' || (token !== USDG && token !== WETH_ADDRESS)) continue
		if (!(token in sums)) {
			sums[token] = 0n
			order.push(token)
		}
		sums[token] += BigInt(t.amount_raw)
	}
	const v = inp.move.value_wei
	const signedByWallet = lc(inp.move.signer) === lc(inp.wallet)
	return { tokens: order.filter((k) => sums[k] > 0n).map((k) => ({ token: k, amount_raw: sums[k].toString() })), eth_wei: signedByWallet && typeof v === 'string' && /^\d+$/.test(v) ? v : '0' }
}

/**
 * out, liquidity, rotation, then purchase or swapped_unpaid (an official swap put it out and the
 * wallet ended with more), then purchase_off_venue (no official swap, the wallet ended with more and
 * paid), else received. `leg` is the first transfer of the token that names the wallet: its direction
 * decides in or out (docs/walk/SELECTION.md, section 2).
 */
const ARRIVAL_KINDS = ['purchase', 'purchase_off_venue', 'rotation', 'liquidity', 'swapped_unpaid', 'received', 'out']
function howItCame(inp, leg) {
	if (leg.direction !== 'in') return 'out'
	if (inp.move.liquidity.length > 0) return 'liquidity'
	const token = lc(leg.token)
	const kind = movedKind(inp, token)?.kind
	if (inp.movement.transfers.some((t) => t.direction === 'out' && lc(t.token) !== token && movedKind(inp, t.token)?.kind === 'stock')) return 'rotation'
	let net = 0n
	for (const t of inp.movement.transfers) if (lc(t.token) === token) net += t.direction === 'in' ? BigInt(t.amount_raw) : -BigInt(t.amount_raw)
	const venues = kind === 'stock' ? inp.venue : inp.other_venue
	const paid = whatWasPaid(inp)
	const paidSomething = paid.tokens.length > 0 || BigInt(paid.eth_wei) > 0n
	if (net > 0n && venues.some((v) => v.kind !== 'other' && v.swapped)) return paidSomething ? 'purchase' : 'swapped_unpaid'
	if (net > 0n && paidSomething) return 'purchase_off_venue'
	return 'received'
}

/**
 * copy-guard v2: one decision that ends in a size. The v1 rows without C5, with C1 and C2
 * asked of the issuer's list and the CRE token-check, then M1, V1, D1, P1, L1 and L2. A
 * failed A4 (no anchor), C3 or C4 makes the size smaller or none as the user's limits say.
 * Any other failed row makes it none. D1 is a purchase: an official swap, paid by the wallet
 * itself in USDG, WETH or ETH, no liquidity log, no other Stock Token out. B2 is asked of the
 * tokens the agent can name.
 */
export function decideV2(inp) {
	const ev = inp.limits.evidence
	const graded = (r) => {
		if (r.id === 'A4' && inp.cre.verdict === 'NO_ANCHOR') return ev.record_not_anchored
		if (r.id === 'C3') return ev.history_partial
		if (r.id === 'C4') return inp.record.realized_usd === null ? ev.wallet_result_unknown : ev.wallet_at_a_loss
		return 'none'
	}
	// C1 and C2 are asked of tokens_moved (the issuer's list, and the CRE token-check when given), not of the record alone.
	const others = inp.tokens_moved.filter((m) => m.kind === 'same_ticker')
	const sLeg = stockLeg2(inp)
	const tc = inp.token_check
	const said = sLeg && tc ? tc.tokens[lc(sLeg.token)] : undefined
	let c2detail = 'no Stock Token moved'
	if (sLeg) {
		let basis = "in the issuer's list (no CRE token-check results given)"
		if (tc && said) basis = `CRE token-check: ${said.issuer_token ? "the issuer's token" : `not confirmed (${said.reasons.join(' ') || 'no reason given'})`}, results ${lc(tc.keccak)}`
		else if (tc) basis = `not in the CRE token-check results ${lc(tc.keccak)}`
		c2detail = `${lc(sLeg.token)} ${sLeg.direction}, ${basis}`
	}
	const unnamed = inp.tokens_moved.filter((m) => m.kind === 'unknown')
	let b2detail = inp.tokens_moved.map((m) => `${m.token} ${m.kind}`).join(', ')
	if (unnamed.length) b2detail = `not named: ${unnamed.map((m) => m.token).join(', ')}`
	if (inp.movement.transfers.length === 0) b2detail = 'no transfers in the movement'
	const reworded = {
		B2: {
			ok: inp.movement.transfers.length > 0 && unnamed.length === 0,
			rule: "every moved token is one the agent can name: a Stock Token of the issuer's list, USDG, WETH, or a different token under a listed ticker",
			detail: b2detail,
		},
		C1: {
			ok: others.length === 0,
			rule: 'no moved token is a different token that uses a listed ticker or name at an address the issuer did not list',
			detail: others.length ? others.map((m) => `${m.token} uses ${m.ticker} (${m.by})`).join(', ') : 'none',
		},
		C2: {
			ok: Boolean(sLeg) && (!tc || said?.issuer_token === true),
			rule: "the move moves a Robinhood Stock Token: its address is in the issuer's list, and the CRE token-check confirms it from the chain when its results are given",
			detail: c2detail,
		},
	}
	const rule_results = decide(inp)
		.rule_results.filter((r) => r.id !== 'C5')
		.map((r) => (reworded[r.id] ? { ...r, ...reworded[r.id] } : r))
		.map((r) => ({ ...r, effect: r.ok ? 'ok' : graded(r) }))
	const add = (id, ok, rule, detail) => rule_results.push({ id, group: id[0], ok, rule, detail, effect: ok ? 'ok' : 'none' })
	const d = inp.mandate.document
	const gap = gapInMandate(inp)
	add('M1', gap === '', 'a mandate signed by the principal covers this decision (signer, practice only, these rules, these limits, this payment key, these dates)', `principal ${lc(d.principal)} signer ${lc(inp.mandate.signer) || '(none)'} mandate ${lc(inp.mandate.keccak)}${gap ? `: ${gap}` : ''}`)
	const leg = stockLeg2(inp)
	add(
		'V1',
		Boolean(leg) && inp.venue.some((v) => v.kind !== 'other' && v.swapped),
		'an official Uniswap venue swapped and sent the Stock Token in the transaction (the v4 PoolManager, or a pool of the official v3 factory)',
		!leg ? 'no Stock Token moved' : inp.venue.length === 0 ? 'no sender to judge' : inp.venue.map((v) => `${lc(v.address)} ${v.kind}${v.swapped ? ' swapped' : ' no swap'}`).join(', '),
	)
	const how = leg ? howItCame(inp, leg) : null
	const signer = lc(inp.move.signer) === lc(inp.wallet) ? 'the wallet' : lc(inp.move.signer)
	let d1detail = 'no Stock Token moved'
	if (how === 'out') d1detail = `sent, signed by ${signer}`
	else if (how === 'liquidity') d1detail = `received in a transaction with liquidity logs (${inp.move.liquidity.join(', ')}): a liquidity operation, not a purchase`
	else if (how === 'rotation') d1detail = 'received while another Stock Token left the wallet: a rotation, not a purchase'
	else if (how === 'purchase' || how === 'purchase_off_venue') {
		const paid = whatWasPaid(inp)
		const money = [...paid.tokens.map((p) => `${p.amount_raw} of ${p.token}`), ...(BigInt(paid.eth_wei) > 0n ? [`${paid.eth_wei} wei of ETH`] : [])].join(' and ')
		d1detail = how === 'purchase' ? `bought: an official swap put it out and the wallet paid ${money}, signed by ${signer}` : `bought outside the official venues: no official swap put it out, and the wallet paid ${money}, signed by ${signer}`
	} else if (how === 'swapped_unpaid') d1detail = `an official swap put it out, but the wallet itself paid no USDG, WETH or ETH, signed by ${signer}`
	else if (how === 'received') d1detail = `received with no official swap of it in the transaction, signed by ${signer}`
	add('D1', how === 'purchase', 'the wallet bought: an official swap put the Stock Token out, the wallet ended with more of it, the wallet itself paid USDG, WETH or ETH, no liquidity log is in the transaction and no other Stock Token left the wallet', d1detail)
	const pg = leg ? gapInPrice(inp) : 'no Stock Token moved'
	add('P1', pg === '', "a Chainlink feed gives the token's price at the block of the move", pg === '' && inp.price ? `${feedUsd(inp.price)} USD, round ${inp.price.round_id}, updated ${inp.price.updated_at} in block ${inp.price.update_block}` : pg)
	const room = dayRoom(inp)
	add('L1', room > 0n, "the user's daily limit leaves room for a practice position", `${inp.limits.size.max_usd_per_day} USD per day, ${inp.book.used_usd_today} USD used on ${inp.book.day}, room ${fromCents(room)} USD`)
	add('L2', inp.book.open_positions < inp.limits.size.max_open_positions, 'fewer practice positions are open than the user allows', `${inp.book.open_positions} open, limit ${inp.limits.size.max_open_positions}`)
	const none = rule_results.filter((r) => r.effect === 'none').map((r) => r.id)
	const reduced = rule_results.filter((r) => r.effect === 'reduced').map((r) => r.id)
	if (none.length) {
		const evidence = rule_results.some((r) => r.effect === 'none' && ['A', 'B', 'M'].includes(r.group))
		return { rule_results, tier: 'NONE', conclusion: evidence ? 'HOLD' : 'DO_NOT_COPY', decisive: none, paper_trade: null }
	}
	const tier = reduced.length ? 'REDUCED' : 'FULL'
	return { rule_results, tier, conclusion: 'COPY', decisive: reduced, paper_trade: practicePosition(inp, tier, room) }
}

const MARKS = new Set(['TICKER_SAME_AS_ISSUER_TOKEN', 'TICKER_SAME_AFTER_FOLDING', 'NAME_SAME_AS_ISSUER_TOKEN', 'NAME_ENDS_LIKE_ISSUER_TOKEN', 'TICKER_OR_NAME_READS_AS_USDG', 'ISSUER_CODE_AT_UNLISTED_ADDRESS'])

/** Code points that render as nothing (Unicode default-ignorables, format controls, the braille blank) and the C0 and C1 controls. */
const INVISIBLE = [[0x0, 0x1f], [0x7f, 0x9f], [0xad, 0xad], [0x34f, 0x34f], [0x600, 0x605], [0x61c, 0x61c], [0x6dd, 0x6dd], [0x70f, 0x70f], [0x890, 0x891], [0x8e2, 0x8e2], [0x115f, 0x1160], [0x17b4, 0x17b5], [0x180b, 0x180f], [0x200b, 0x200f], [0x202a, 0x202e], [0x2060, 0x206f], [0x2800, 0x2800], [0x3164, 0x3164], [0xfe00, 0xfe0f], [0xfeff, 0xfeff], [0xffa0, 0xffa0], [0xfff0, 0xfffb], [0x110bd, 0x110bd], [0x110cd, 0x110cd], [0x13430, 0x1343f], [0x1bca0, 0x1bca3], [0x1d173, 0x1d17a], [0xe0000, 0xe0fff]]
/** Text with every invisible character written as ⟨U+XXXX⟩. */
export function markInvisible(text) {
	return [...String(text ?? '')]
		.map((ch) => {
			const cp = ch.codePointAt(0)
			return INVISIBLE.some(([a, b]) => cp >= a && cp <= b) ? `⟨U+${cp.toString(16).toUpperCase().padStart(4, '0')}⟩` : ch
		})
		.join('')
}
/** What a name() or symbol() call answered: an ABI string, or a zero-padded bytes32. '' otherwise. */
export function textOfCall(hex) {
	const d = String(hex ?? '').replace(/^0x/, '')
	const bytesOf = (h) => new TextDecoder().decode(new Uint8Array((h.match(/../g) ?? []).map((b) => Number.parseInt(b, 16))))
	if (d.length >= 128 && BigInt(`0x${d.slice(0, 64)}`) === 32n) {
		const n = Number(BigInt(`0x${d.slice(64, 128)}`))
		if (n * 2 <= d.length - 128) return bytesOf(d.slice(128, 128 + n * 2))
	}
	return d.length === 64 ? bytesOf(d).replace(/\0+$/, '') : ''
}
/** The name a different token under a listed ticker carries: its own name() on the chain, else the record's, else a note. Never blank. */
function nameForOther(token, names, fromRecord) {
	const onChain = markInvisible(names?.[token]?.name ?? '').trim()
	if (onChain) return onChain
	if (fromRecord.trim()) return fromRecord
	const sym = markInvisible(names?.[token]?.symbol ?? '').trim()
	return sym ? `(no name; symbol ${sym})` : '(no name)'
}

/**
 * What each moved token is, rebuilt from the saved record, the issuer's list (token to
 * { symbol, name }) and the CRE token-check results when the decision read any. USDG and
 * WETH by address first, then the CRE results, then the record's names, then the list.
 * A different token under a listed ticker is named by its own name() as the walk read it
 * from the chain (`names` in docs/walk/tokens.json), then by the record.
 */
export function movedTokensFrom(facts, transfers, decimals, list, check, names = {}) {
	const seen = new Set()
	const out = []
	const listedAt = (ticker) => (ticker === 'USDG' ? USDG : (Object.keys(list).find((k) => list[k].symbol === ticker) ?? null))
	for (const t of transfers) {
		const token = lc(t.token)
		if (seen.has(token)) continue
		seen.add(token)
		const named = (facts?.lookalikes ?? []).find((l) => lc(l.token) === token)
		const listed = list[token]
		const cre = check?.tokens?.[token]
		const name = nameForOther(token, names, String(named?.name_raw ?? ''))
		const make = (kind, ticker, nm, by) => ({ token, kind, ticker, name: nm, decimals: decimals[token] ?? 18, by, listed_at: kind === 'same_ticker' ? listedAt(ticker) : null })
		if (token === USDG) out.push(make('usdg', 'USDG', 'Global Dollar', 'address'))
		else if (token === WETH_ADDRESS) out.push(make('weth', 'WETH', 'Wrapped Ether', 'address'))
		else if (cre) {
			if (cre.issuer_token && listed) out.push(make('stock', listed.symbol, listed.name, 'cre'))
			else if (!cre.issuer_token && cre.reasons.some((r) => MARKS.has(r))) {
				let reads = String(cre.ticker ?? '').replace(/\[U\+[0-9A-F]+\]/g, '').toUpperCase()
				if (named?.imitates) reads = String(named.imitates)
				if (cre.reasons.includes('TICKER_OR_NAME_READS_AS_USDG')) reads = 'USDG'
				out.push(make('same_ticker', reads, name, 'cre'))
			} else out.push(make('unknown', '?', '', 'cre'))
		} else if (named) {
			// The record names the token but not which ticker it imitates: its own symbol(), without invisible characters.
			const own = markInvisible(names?.[token]?.symbol ?? '').replace(/⟨U\+[0-9A-F]+⟩/g, '').trim().toUpperCase()
			out.push(make('same_ticker', named.imitates ? String(named.imitates) : own || '?', name, 'record'))
		}
		else if (listed) out.push(make('stock', listed.symbol, listed.name, 'list'))
		else out.push(make('unknown', '?', '', 'none'))
	}
	return out
}

// The decision card. Fixed sentences filled from the trail. No language model.

const cardAddr = (a) => `${a.slice(0, 6)}…${a.slice(-4)}`
function showAmount(raw, decimals) {
	const base = 10n ** BigInt(decimals)
	const v = BigInt(raw)
	const whole = (v / base).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',')
	const frac = (v % base).toString().padStart(decimals, '0').slice(0, 6).replace(/0+$/, '')
	return frac ? `${whole}.${frac}` : whole
}
function cardLeg(inp) {
	const legs = inp.movement.transfers.map((t) => ({ t, m: movedKind(inp, t.token) })).filter((l) => l.m)
	return legs.find((l) => l.m.kind === 'same_ticker') ?? legs.find((l) => l.m.kind === 'stock') ?? legs[0] ?? null
}
const sumRaw = (inp, pick) => inp.movement.transfers.filter(pick).reduce((s, t) => s + BigInt(t.amount_raw), 0n)
const legTotal = (inp, leg) => sumRaw(inp, (t) => lc(t.token) === lc(leg.t.token) && t.direction === leg.t.direction).toString()

/** What the wallet itself paid, in words, or ''. */
function paidWords(inp) {
	const paid = whatWasPaid(inp)
	const parts = paid.tokens.map((p) => `${showAmount(p.amount_raw, movedKind(inp, p.token)?.decimals ?? 18)} ${p.token === USDG ? 'USDG' : 'WETH'}`)
	if (BigInt(paid.eth_wei) > 0n) parts.push(`${showAmount(paid.eth_wei, 18)} ETH`)
	return parts.join(' and ')
}

const VENUE_WORDS = { 'uniswap-v4-pool-manager': 'the Uniswap v4 PoolManager', 'uniswap-v3-pool': 'an official Uniswap v3 pool' }
/** The official venue that swapped the leg's token out, in words. */
function swappedBy(inp, leg) {
	const v = (leg.m.kind === 'stock' ? inp.venue : inp.other_venue).find((x) => x.kind !== 'other' && x.swapped)
	return v ? `${VENUE_WORDS[v.kind]} (${cardAddr(lc(v.address))})` : ''
}
/** Who the leg's token came from or went to, as the transfer says. */
function otherParty(inp, leg) {
	const other = lc(leg.t.direction === 'in' ? leg.t.from : leg.t.to)
	const v = [...inp.venue, ...inp.other_venue].find((x) => lc(x.address) === other)
	return v && VENUE_WORDS[v.kind] ? `${VENUE_WORDS[v.kind]} (${cardAddr(other)})` : cardAddr(other)
}
/** The other Stock Tokens that left the wallet, in words. */
function rotatedAway(inp, leg) {
	const order = []
	const sums = {}
	for (const t of inp.movement.transfers) {
		const m = movedKind(inp, t.token)
		if (t.direction !== 'out' || m?.kind !== 'stock' || m.token === leg.m.token) continue
		if (!(m.token in sums)) {
			sums[m.token] = 0n
			order.push(m.token)
		}
		sums[m.token] += BigInt(t.amount_raw)
	}
	return order.map((k) => `${showAmount(sums[k].toString(), movedKind(inp, k).decimals)} ${movedKind(inp, k).ticker}`).join(' and ')
}

const NONE_HEAD = {
	A1: 'payment terms not as published',
	A2: 'record does not match its hash',
	A3: 'record is about another wallet',
	A4: 'record not confirmed against its anchor',
	A5: 'record does not replay',
	A6: 'a same-ticker token still under review',
	B1: 'record older than the move',
	B2: 'a moved token the agent cannot name',
	M1: 'no signed mandate covers it',
	C2: 'no Stock Token moved',
	C3: 'track record incomplete',
	C4: 'wallet not in profit',
	V1: 'no official swap put the token out',
	D1: 'not a purchase by the wallet',
	P1: 'no Chainlink price at the block',
	L1: 'daily limit reached',
	L2: 'position limit reached',
}
const CARD_PRIORITY = ['A2', 'A3', 'A1', 'A5', 'A6', 'B1', 'B2', 'M1', 'D1', 'C2', 'V1', 'P1', 'A4', 'C3', 'C4', 'L1', 'L2']

function cardReason(id, inp) {
	const r = inp.record
	const leg = stockLeg2(inp)
	if (id === 'A1') return ['The payment terms offered for the evidence were not the published ones (0.01 USDG on Robinhood Chain, paid to vet402), so the evidence was not trusted.']
	if (id === 'A2') {
		if (inp.record_fetch.http_status !== 200) return [`vet402 answered HTTP ${inp.record_fetch.http_status} when asked for this wallet's record, so there is no record to judge the wallet by. copy-guard opens nothing on a wallet it has no record for.`]
		return ['The record did not match the hash that came with it, so it may have been changed on the way.']
	}
	if (id === 'A3') return ['The record is about another wallet or another chain.']
	if (id === 'A4') {
		if (inp.cre.verdict === 'NO_ANCHOR') return ['vet402 has not anchored a record for this wallet onchain, so the Chainlink CRE workflow had nothing to check its record against.']
		if (inp.cre.verdict === 'MISMATCH') return [`The Chainlink CRE workflow found that the wallet's anchored record does not match its onchain hash (reason bits ${inp.cre.reason_bits}).`]
		return ["The Chainlink CRE workflow did not confirm the wallet's anchored record."]
	}
	if (id === 'A5') return ['The record does not replay to the balances it reports.']
	if (id === 'A6') return ['A token in this wallet that uses a listed ticker at another address is still counted in its figures or waits for review.']
	if (id === 'B1') return [`The record was built at block ${r.as_of_block}, before this move in block ${inp.movement.block}, so it says nothing about it.`]
	if (id === 'B2') return [`A moved token is neither a Stock Token of the issuer's list, USDG, WETH nor a token named as using a listed ticker (${inp.tokens_moved.filter((m) => m.kind === 'unknown').map((m) => cardAddr(m.token)).join(', ')}), so the move cannot be judged.`]
	if (id === 'M1') return [`No signed mandate covers this decision: ${gapInMandate(inp)}.`]
	if (id === 'C1') {
		const out = []
		for (const m of inp.tokens_moved) {
			if (m.kind !== 'same_ticker') continue
			const usdgLike = m.ticker === 'USDG'
			let line = `This is not ${usdgLike ? 'USDG' : `the Robinhood Stock Token ${m.ticker}`}. It is a different token at ${cardAddr(m.token)} with the same ticker, at an address the issuer did not list.`
			if (m.listed_at) line += ` ${usdgLike ? 'USDG' : `The Stock Token ${m.ticker}`} is at ${cardAddr(m.listed_at)}.`
			line += m.by === 'cre' ? ` The Chainlink CRE token-check workflow read it from the chain (${(inp.token_check?.tokens[m.token]?.reasons ?? []).join(', ') || 'no reason given'}).` : ' The vet402 record names it.'
			out.push(`${line} This says what the token is not. It says nothing about who made it or why.`)
		}
		return out
	}
	if (id === 'C2') return ['No Robinhood Stock Token moved, so there is nothing to copy.']
	if (id === 'C3') return [`The wallet's history could only be rebuilt in part (status: ${r.r1_status}), so its track record is not fully known.`]
	if (id === 'C4') {
		if (r.realized_usd === null) return ['The record gives no realized result for this wallet, so it is not known whether its closed trades made or lost money.']
		if (r.realized_usd.startsWith('-')) return [`The wallet's closed trades add up to a loss of ${r.realized_usd.slice(1)} USD.`]
		return [`The wallet's closed trades add up to ${r.realized_usd} USD, which is not a profit.`]
	}
	if (id === 'V1') return ['No official Uniswap venue (the v4 PoolManager or a pool of the official v3 factory) swapped and sent the Stock Token in this transaction.']
	if (id === 'D1') {
		const how = leg ? howItCame(inp, leg) : null
		if (how === 'out') return ['The wallet sold or sent the Stock Token. That opens nothing. It closes a practice position copied from this wallet in the same token, if one is open.']
		if (how === 'liquidity') return [`The transaction changes a liquidity position (${inp.move.liquidity.join(', ')}). Adding to a pool, taking from it and collecting from it move tokens in and out of a wallet, and none of them is a purchase.`]
		if (how === 'rotation') return ['Another Stock Token left the wallet in the same transaction. Exchanging one Stock Token for another is a rotation, and copy-guard copies purchases paid in USDG, WETH or ETH only.']
		if (how === 'swapped_unpaid') return ['An official swap put the Stock Token out, but the wallet itself paid no USDG, WETH or ETH in the transaction. Someone else paid, or it was paid in something whose worth is not known, so it is not counted as a purchase.']
		if (how === 'purchase_off_venue') return [`The wallet itself paid ${paidWords(inp)} for the Stock Token, but no official Uniswap venue (the v4 PoolManager or a pool of the official v3 factory) swapped it out: it was bought somewhere else. copy-guard copies purchases on an official venue only (rule V1). A ticker copy, which does not look at the venue, copies it.`]
		return ['No official swap put the Stock Token out in this transaction. It was sent to the wallet: a transfer, an airdrop or a bridge delivery, not a purchase.']
	}
	if (id === 'P1') return [`No Chainlink feed value can be used as the price at the block of the move (${gapInPrice(inp)}), so a practice position cannot be entered.`]
	if (id === 'L1') return [`The limit of ${inp.limits.size.max_usd_per_day} USD per day leaves no room (${inp.book.used_usd_today} USD used on ${inp.book.day}).`]
	if (id === 'L2') return [`${inp.book.open_positions} practice positions are open, which is the limit the user set.`]
	return [`Rule ${id} failed.`]
}

function cardLimitNote(ids, inp, effect) {
	const graded = ids.filter((id) => (id === 'A4' && inp.cre.verdict === 'NO_ANCHOR') || id === 'C3' || id === 'C4')
	if (!graded.length) return []
	return [effect === 'reduced' ? `The user's limits allow a reduced position on this evidence (${graded.join(', ')}).` : `The user's limits say to open nothing on this evidence (${graded.join(', ')}).`]
}

export function cardOf(inp, d) {
	const leg = cardLeg(inp)
	const own = lc(inp.move.signer) === lc(inp.wallet)
	const sig = own ? 'The wallet signed the transaction.' : `The wallet did not sign the transaction (${cardAddr(lc(inp.move.signer))} did).`
	let happened = 'The transaction holds no token transfer that names this wallet.'
	let blind_view = 'A bot that copies this wallet sees nothing to copy.'
	if (leg) {
		const { t, m } = leg
		const amt = showAmount(legTotal(inp, leg), m.decimals)
		const how = howItCame(inp, { token: t.token, direction: t.direction })
		const n = inp.movement.transfers.length
		const incoming = t.direction === 'in'
		const relayed = own ? 'The wallet signed the transaction.' : `${cardAddr(lc(inp.move.signer))} signed the transaction, and the payment left the wallet itself.`
		const label = m.name && m.name !== m.ticker ? ` (named "${m.name}")` : ''
		if (m.kind === 'same_ticker' || m.kind === 'stock') {
			const what = m.kind === 'same_ticker' ? `${amt} tokens with the ticker ${m.ticker}${label}` : `${amt} ${m.name ? `${m.ticker} (${m.name})` : m.ticker}`
			const marks = m.kind === 'same_ticker' && `${m.name}${m.ticker}`.includes('⟨U+') ? ` The marks ⟨U+…⟩ stand for invisible characters in the name: without them it reads ${m.ticker}.` : ''
			if (how === 'purchase') happened = `The wallet bought ${what} in a swap on ${swappedBy(inp, leg)} and paid ${paidWords(inp)}. ${relayed}`
			else if (how === 'purchase_off_venue') happened = `The wallet bought ${what} through a venue outside the official Uniswap pools, paying ${paidWords(inp)}. No official swap put the token out in the transaction. ${relayed}`
			else if (how === 'rotation') happened = `The wallet received ${what} and gave ${rotatedAway(inp, leg)} in the same transaction: one Stock Token exchanged for another. ${sig}`
			else if (how === 'liquidity') happened = `The wallet received ${what} from ${otherParty(inp, leg)} in a transaction that changes a liquidity position (${inp.move.liquidity.join(', ')}). That is not a purchase. ${sig}`
			else if (how === 'swapped_unpaid') happened = `${what.charAt(0).toUpperCase()}${what.slice(1)} came to the wallet out of a swap on ${swappedBy(inp, leg)}, and the wallet itself paid no USDG, WETH or ETH in the transaction. ${sig}`
			else if (how === 'received') happened = `${otherParty(inp, leg)} sent this wallet ${what}. No official swap put the token out in the transaction. ${sig}`
			else if (m.kind === 'stock') {
				const got = sumRaw(inp, (x) => lc(x.token) === USDG && x.direction === 'in')
				happened = `The wallet sent ${what} to ${otherParty(inp, leg)}${got > 0n ? ` and received ${showAmount(got.toString(), 6)} USDG` : ''}. ${sig}`
			} else happened = `A token with the ticker ${m.ticker}${label} logged a transfer of ${amt} from this wallet to ${cardAddr(t.to)}. ${sig}${own ? '' : ' The wallet never made this payment.'}`
			happened += marks
			if (m.kind === 'same_ticker') blind_view = incoming ? `A bot that goes by the ticker sees ${amt} ${m.ticker} arrive in this wallet.` : `A bot that goes by the log sees this wallet pay ${amt} ${m.ticker} to ${cardAddr(t.to)}.`
			else blind_view = incoming ? `A bot that copies this wallet sees ${amt} ${m.ticker} arrive.` : `A bot that copies this wallet sees ${amt} ${m.ticker} leave.`
		} else {
			if (m.kind === 'usdg' || m.kind === 'weth') happened = `The wallet ${incoming ? 'received' : 'sent'} ${amt} ${m.ticker} and no Stock Token moved. ${sig}`
			else happened = `The wallet ${incoming ? 'received' : 'sent'} ${amt} of a token at ${cardAddr(m.token)} that is not a Stock Token, USDG or WETH. ${sig}`
			blind_view = `A bot that copies this wallet sees ${n} token transfer${n === 1 ? '' : 's'}.`
		}
	}
	if (d.paper_trade) {
		const p = d.paper_trade
		const full = d.tier === 'FULL'
		return {
			headline: `Practice buy, ${full ? 'full' : 'reduced'} size: ${p.notional_usd} USD of ${p.symbol}`,
			happened,
			blind_view,
			why: [
				`${p.symbol} is the Robinhood Stock Token at ${cardAddr(p.token)}, an address in the issuer's list${inp.token_check ? ', confirmed from the chain by the Chainlink CRE token-check workflow' : ''}. No other token with a listed ticker is part of the move. An official Uniswap venue swapped it out, the wallet itself paid, and the transaction holds no liquidity operation.`,
				full
					? `The record matches its hash, the Chainlink CRE workflow confirmed the wallet's anchored record (MATCH), the wallet's full history could be rebuilt and its closed trades add up to a profit of ${inp.record.realized_usd} USD.`
					: 'The record matches its hash, but the evidence about the wallet is weaker:',
				...(full ? [] : [...d.decisive.flatMap((id) => cardReason(id, inp)), ...cardLimitNote(d.decisive, inp, 'reduced')]),
				`A mandate signed by ${cardAddr(lc(inp.mandate.document.principal))} covers the decision.`,
			],
			so: `So copy-guard opened a practice buy of ${p.notional_usd} USD: ${p.shares} ${p.symbol} at ${p.price_usd} USD, the Chainlink feed's value at the block of the move. It will ${p.exit.rule}. No real trade was placed.`,
		}
	}
	const otherToken = d.decisive.includes('C1')
	const noRecord = inp.record_fetch.http_status !== 200
	const rank = (id) => CARD_PRIORITY.indexOf(id) + 1 || 99
	let lead = d.decisive.filter((id) => !(d.decisive.includes('C2') && ['V1', 'D1', 'P1'].includes(id)) && !(id === 'V1' && d.decisive.includes('D1'))).sort((x, y) => rank(x) - rank(y))
	if (otherToken) lead = ['C1']
	else if (noRecord) lead = ['A2']
	const rest = d.decisive.filter((id) => !lead.includes(id))
	let head = NONE_HEAD[lead[0]] ?? 'a rule failed'
	if (lead[0] === 'D1') {
		const sl = stockLeg2(inp)
		const words = { out: 'a sale or a transfer out, not a purchase', liquidity: 'a liquidity operation, not a purchase', rotation: 'one Stock Token exchanged for another, not a purchase', swapped_unpaid: 'swapped, but not paid for by the wallet', purchase_off_venue: 'bought outside the official Uniswap pools', received: 'sent to the wallet, not bought by it' }
		if (sl) head = words[howItCame(inp, sl)] ?? head
	}
	if (noRecord) head = 'vet402 has no record for this wallet'
	if (otherToken) {
		const ticker = inp.tokens_moved.find((m) => m.kind === 'same_ticker')?.ticker ?? ''
		head = `not ${ticker === 'USDG' ? 'USDG' : `the Stock Token ${ticker}`}, a different token with the same ticker`
	}
	return {
		headline: `No position: ${head}`,
		happened,
		blind_view,
		why: [...lead.flatMap((id) => cardReason(id, inp)), ...cardLimitNote(lead, inp, 'none'), ...(rest.length ? [`${rest.length === 1 ? 'Rule' : 'Rules'} ${rest.join(', ')} failed as well. The rule rows show each one.`] : [])],
		so: 'So copy-guard opened no position. No real trade was placed.',
	}
}

// The practice ledger: a walk through the decisions with two books, copy-guard and a
// ticker copy. A second, separate writing of agent/ledger.ts. A Stock Token is valued
// at its Chainlink feed. A different token under the same ticker is valued only from the
// Uniswap v4 pool the wallet bought it in, and otherwise not at all: nothing is assumed
// to be worth zero, and what is not measured is in no sum.

export const BLIND_BASELINE =
	'Ticker copy opens the full size on every purchase of a token with a stock ticker: a Robinhood Stock Token with a usable Chainlink price, or a different token that uses a listed stock ticker. A purchase is what the wallet itself paid for in USDG, WETH or ETH, with no liquidity operation and no other Stock Token out, on an official Uniswap venue or outside one: it goes by the ticker and the amount and does not look at the venue. It buys no record, does not ask whose token it is, and has no daily or open-position limit. For a Stock Token it uses the same entry price and the same exit rules as copy-guard.'
export const LEDGER_NOTE =
	'Practice (paper) trades only. No real trade was placed. The two columns compare two policies on past public moves. This is not a forecast, not a record of real trading and not advice. A position in a token without a Chainlink feed is valued only from a Uniswap v4 pool the wallet itself bought in, otherwise it is not measured and is left out of every sum.'

const pointUsd = (series, pt) => (Number(pt.answer) / 10 ** series.decimals).toFixed(4)
const lastPoint = (series, block) => {
	let hit = null
	for (const pt of series?.points ?? []) {
		if (pt.block > block) break
		hit = pt
	}
	return hit
}
const gain = (notional, entry, exit) => BigInt(Math.round(Number(toCents(notional)) * (Number(exit) / Number(entry) - 1)))

/** How many times its entry price a token is worth at the mark. sqrtPriceX96 squared is the price of currency0 in currency1. */
export function poolTimes(entry, mark) {
	const r = Number(BigInt(mark.sqrt_price_x96)) / Number(BigInt(entry.sqrt_price_x96))
	return entry.token_is_currency0 ? r * r : 1 / (r * r)
}

/** One book of practice positions. Plain objects and a few functions, walked forward block by block. */
function newBook(feeds, limits, marks = {}) {
	const positions = []
	const close = (p, reason, block, price, atDecision) => {
		p.status = 'closed'
		p.exit = { reason, block, price_usd: price, at_decision: atDecision }
		p.result_usd = !price || !p.entry_price_usd ? null : fromCents(gain(p.notional_usd, p.entry_price_usd, price))
	}
	return {
		positions,
		advance(toBlock) {
			for (const p of positions) {
				const series = feeds[p.token]
				if (p.status !== 'open' || !series) continue
				for (; p._cursor < series.points.length && series.points[p._cursor].block <= toBlock; p._cursor++) {
					const pt = series.points[p._cursor]
					if (pt.block <= p.opened_block) continue
					const price = Number(pointUsd(series, pt))
					const reason = price <= p._stop ? 'stop loss' : price >= p._take ? 'take profit' : Date.parse(pt.updated_at) >= p._closeBy ? 'time limit' : null
					if (reason) {
						close(p, reason, pt.block, pointUsd(series, pt), null)
						break
					}
				}
			}
		},
		walletSold(wallet, token, block, n) {
			const closed = []
			if (!limits.exit.when_wallet_sells) return closed
			for (const p of positions) {
				if (p.status !== 'open' || p.wallet !== wallet || p.token !== token || p.opened_block >= block) continue
				const pt = lastPoint(feeds[token], block)
				if (!pt) continue
				close(p, 'wallet sold', block, pointUsd(feeds[token], pt), n)
				closed.push(p.n)
			}
			return closed
		},
		state(day) {
			const used = positions.filter((p) => p.opened_time.slice(0, 10) === day).reduce((s, p) => s + toCents(p.notional_usd), 0n)
			return { day, used_usd_today: fromCents(used), open_positions: positions.filter((p) => p.status === 'open').length }
		},
		open(n, inp, o) {
			const entry = o.entry === null ? Number.NaN : Number(o.entry)
			const stock = o.asset === 'stock'
			positions.push({
				n,
				wallet: lc(inp.wallet),
				token: o.token,
				symbol: o.symbol,
				tier: o.tier,
				asset: o.asset,
				valued_by: stock ? 'feed' : 'none',
				notional_usd: o.notional,
				entry_price_usd: o.entry,
				pool_entry: o.pool,
				opened_block: inp.movement.block,
				opened_time: inp.move.time,
				status: 'open',
				exit: null,
				mark: null,
				result_usd: stock ? '0.00' : null,
				_stop: entry * (1 - Number(limits.exit.stop_loss_pct) / 100),
				_take: entry * (1 + Number(limits.exit.take_profit_pct) / 100),
				_closeBy: Date.parse(inp.move.time) + limits.exit.max_holding_days * 86_400_000,
				_cursor: 0,
			})
		},
		finish(markBlock) {
			this.advance(markBlock)
			for (const p of positions) {
				if (p.status !== 'open') continue
				if (p.asset === 'same_ticker') {
					const m = p.pool_entry ? marks[p.pool_entry.pool_id] : undefined
					if (!m || m.block > markBlock || m.block < p.opened_block) continue
					p.mark = { block: m.block, price_usd: null, pool: m }
					p.valued_by = 'pool'
					p.result_usd = fromCents(BigInt(Math.round(Number(toCents(p.notional_usd)) * (poolTimes(p.pool_entry, m) - 1))))
					continue
				}
				const pt = lastPoint(feeds[p.token], markBlock)
				if (!pt || !p.entry_price_usd) continue
				p.mark = { block: pt.block, price_usd: pointUsd(feeds[p.token], pt), pool: null }
				p.result_usd = fromCents(gain(p.notional_usd, p.entry_price_usd, p.mark.price_usd))
			}
			return positions.map((p) => Object.fromEntries(Object.entries(p).filter(([k]) => !k.startsWith('_'))))
		},
	}
}

function blindOpens(inp) {
	const leg = cardLeg(inp)
	if (!leg || leg.t.direction !== 'in') return null
	// A bot that goes by the ticker copies a purchase wherever it was made: on an official venue or outside one.
	if (!['purchase', 'purchase_off_venue'].includes(howItCame(inp, { token: leg.t.token, direction: 'in' }))) return null
	if (leg.m.kind === 'same_ticker') return leg.m.ticker === 'USDG' ? null : { token: leg.m.token, symbol: leg.m.ticker, entry: null, asset: 'same_ticker', pool: inp.pool_entry ?? null }
	if (leg.m.kind === 'stock' && gapInPrice(inp) === '') return { token: leg.m.token, symbol: leg.m.ticker, entry: feedUsd(inp.price), asset: 'stock', pool: null }
	return null
}

/** The wallet's own receipt of a Stock Token in USD at the feed, or null. */
function moveInUsd(inp) {
	const leg = stockLeg2(inp)
	if (!leg || leg.direction !== 'in' || gapInPrice(inp) !== '') return null
	const raw = sumRaw(inp, (t) => lc(t.token) === lc(leg.token) && t.direction === 'in')
	// Exact: amount times the feed's raw answer in integers, rounded half up to the cent once. No price rounded first.
	const den = 10n ** BigInt((movedKind(inp, leg.token)?.decimals ?? 18) + inp.price.decimals)
	const c = raw * BigInt(inp.price.answer) * 100n
	return fromCents(c / den + (c % den >= den - c % den ? 1n : 0n))
}

/** A binary Merkle root over the leaves in order. An odd last node moves up unchanged. */
export function merkleRootOf(leaves) {
	if (leaves.length === 0) return keccak256('')
	let level = leaves.map((l) => l.toLowerCase())
	while (level.length > 1) {
		const next = []
		for (let i = 0; i < level.length; i += 2) next.push(i + 1 < level.length ? keccak256(hexToBytes(level[i].slice(2) + level[i + 1].slice(2))) : level[i])
		level = next
	}
	return level[0]
}

/** The whole ledger from the trails in walk order, the saved feed values, the walk's context and the block it is marked at. */
export function ledgerOf(trails, feeds, markBlock, context) {
	const first = trails[0].inputs
	const limits = first.limits
	const oneSize = limits.size.reduced_usd
	const guard = newBook(feeds, limits)
	const blind = newBook(feeds, limits, context.pool_marks)
	const blindOne = newBook(feeds, limits, context.pool_marks)
	const cohorts = Object.fromEntries(context.wallets.map((w) => [lc(w.wallet), w.cohort]))
	const hasOther = (t) => t.inputs.tokens_moved.some((x) => x.kind === 'same_ticker')
	const rows = trails.map((t, i) => {
		const n = i + 1
		const inp = t.inputs
		const block = inp.movement.block
		guard.advance(block)
		blind.advance(block)
		blindOne.advance(block)
		const leg = stockLeg2(inp)
		const sold = leg && leg.direction === 'out' && lc(inp.move.signer) === lc(inp.wallet) ? lc(leg.token) : null
		const closedGuard = sold ? guard.walletSold(lc(inp.wallet), sold, block, n) : []
		const closedBlind = sold ? blind.walletSold(lc(inp.wallet), sold, block, n) : []
		if (sold) blindOne.walletSold(lc(inp.wallet), sold, block, n)
		const book = guard.state(inp.move.time.slice(0, 10))
		const p = t.decision.paper_trade
		if (p) guard.open(n, inp, { token: p.token, symbol: p.symbol, tier: p.tier, notional: p.notional_usd, entry: p.price_usd, asset: 'stock', pool: null })
		const b = blindOpens(inp)
		if (b) {
			blind.open(n, inp, { ...b, tier: 'BLIND', notional: limits.size.full_usd })
			blindOne.open(n, inp, { ...b, tier: 'BLIND', notional: oneSize })
		}
		const cohort = cohorts[lc(inp.wallet)]
		if (!cohort) throw new Error(`decision ${n}: wallet ${lc(inp.wallet)} is not in the walk's context`)
		const main = cardLeg(inp)
		return {
			n,
			wallet: lc(inp.wallet),
			cohort,
			move_tx: lc(inp.movement.tx),
			move_block: block,
			move_time: inp.move.time,
			tier: t.decision.tier,
			failed: t.decision.decisive,
			checks: { passed: t.decision.rule_results.filter((r) => r.ok).length, total: t.decision.rule_results.length, flags: t.decision.rule_results.filter((r) => !r.ok).map((r) => r.id) },
			main: main ? { token: main.m.token, kind: main.m.kind, ticker: main.m.ticker, arrival: howItCame(inp, { token: main.t.token, direction: main.t.direction }) } : null,
			move_usd: moveInUsd(inp),
			card: t.card,
			book,
			copy_guard: { opened: p ? { tier: p.tier, notional_usd: p.notional_usd, entry_price_usd: p.price_usd, shares: p.shares } : null, closed_here: closedGuard },
			blind_copy: { opened: b ? { notional_usd: limits.size.full_usd, entry_price_usd: b.entry, asset: b.asset } : null, closed_here: closedBlind },
			leaf: keccak256(canonicalJson(t)),
		}
	})
	const guardPositions = guard.finish(markBlock)
	const blindPositions = blind.finish(markBlock)
	const onePositions = blindOne.finish(markBlock)
	const signedCents = (s) => toCents(s.replace('-', '')) * (s.startsWith('-') ? -1n : 1n)
	const total = (xs) => fromCents(xs.reduce((s, x) => s + (x === null ? 0n : signedCents(x)), 0n))
	const side = (ps) => ({ count: ps.length, put_in_usd: total(ps.map((p) => p.notional_usd)), result_usd: total(ps.map((p) => p.result_usd)) })
	const otherSide = (ps) => {
		const measured = ps.filter((p) => p.result_usd !== null)
		return { count: ps.length, put_in_usd: total(ps.map((p) => p.notional_usd)), measured: measured.length, result_measured_usd: measured.length ? total(measured.map((p) => p.result_usd)) : null, not_measured: ps.length - measured.length }
	}
	const sortedCents = (xs) => xs.map(toCents).sort((a, b) => (a < b ? -1 : a > b ? 1 : 0))
	const median = (xs) => {
		if (!xs.length) return '0.00'
		const c = sortedCents(xs)
		const mid = c.length >> 1
		return fromCents(c.length % 2 ? c[mid] : (c[mid - 1] + c[mid]) / 2n)
	}
	const tierCount = (rs, tier) => rs.filter((r) => r.tier === tier).length
	const m = first.mandate
	const signedByPrincipal = Boolean(m.signer) && lc(m.signer) === lc(m.document.principal)
	const sample = /^SAMPLE\b/.test(m.document.title)
	const reasonCount = {}
	for (const r of rows) {
		if (r.tier !== 'NONE') continue
		const reason = r.card.headline.replace('No position: ', '')
		reasonCount[reason] = (reasonCount[reason] ?? 0) + 1
	}
	const otherList = {}
	const came = Object.fromEntries(ARRIVAL_KINDS.map((k) => [k, 0]))
	let hidden = 0
	let otherMoves = 0
	for (const t of trails) {
		const part = t.inputs.tokens_moved.filter((x) => x.kind === 'same_ticker')
		if (!part.length) continue
		otherMoves++
		for (const x of part) {
			otherList[x.token] ??= { token: x.token, ticker: x.ticker, name: x.name, moves: 0 }
			otherList[x.token].moves++
		}
		const main = cardLeg(t.inputs)
		if (main) came[howItCame(t.inputs, { token: main.t.token, direction: main.t.direction })]++
		if (part.some((x) => `${x.name}${x.ticker}`.includes('⟨U+'))) hidden++
	}
	const openedByGuard = new Set(guardPositions.map((p) => p.n))
	const followed = rows.filter((r) => r.copy_guard.opened && r.move_usd !== null).map((r) => r.move_usd)
	const fc = sortedCents(followed)
	const noRecord = context.wallets.filter((w) => w.record_http !== 200).map((w) => lc(w.wallet))
	const times = rows.map((r) => r.move_time).sort()
	const inCohort = (c) => context.wallets.filter((w) => w.cohort === c).length
	const cohortTotals = (c) => {
		const rs = rows.filter((r) => r.cohort === c)
		return {
			wallets: inCohort(c),
			decisions: rs.length,
			full: tierCount(rs, 'FULL'),
			reduced: tierCount(rs, 'REDUCED'),
			none: tierCount(rs, 'NONE'),
			other_token_moves: rs.filter((r) => hasOther(trails[r.n - 1])).length,
			copy_guard_opened: rs.filter((r) => r.copy_guard.opened).length,
			ticker_copy_opened: rs.filter((r) => r.blind_copy.opened).length,
			ticker_copy_in_other_tokens: rs.filter((r) => r.blind_copy.opened?.asset === 'same_ticker').length,
		}
	}
	const otherBlind = blindPositions.filter((p) => p.asset === 'same_ticker')
	const stockMoves = Object.fromEntries(ARRIVAL_KINDS.map((k) => [k, 0]))
	// The copy-guard book per group: the selected wallets, the observed buyers of another token, and the demo wallet.
	const groupOf = { selected: 'top_buyers', observed_other_token_buyers: 'same_ticker_buyers', demo: 'watched' }
	const groupTotals = (cohort) => {
		const rs = rows.filter((r) => r.cohort === cohort)
		const ns = new Set(rs.map((r) => r.n))
		const ps = guardPositions.filter((p) => ns.has(p.n))
		const fol = rs.filter((r) => r.copy_guard.opened && r.move_usd !== null).map((r) => r.move_usd)
		const fsorted = sortedCents(fol)
		const one = onePositions.filter((p) => ns.has(p.n) && openedByGuard.has(p.n))
		const per = {}
		for (const p of ps) per[p.wallet] = (per[p.wallet] ?? 0) + 1
		let best = null
		for (const [w, k] of Object.entries(per)) if (!best || k > best[1] || (k === best[1] && w < best[0])) best = [w, k]
		let share = null
		if (best) {
			const tenthsOfPct = (BigInt(best[1]) * 1000n * 2n + BigInt(ps.length)) / (2n * BigInt(ps.length))
			share = `${tenthsOfPct / 10n}.${tenthsOfPct % 10n}`
		}
		return {
			cohort,
			wallets: inCohort(cohort),
			wallets_with_decisions: new Set(rs.map((r) => r.wallet)).size,
			decisions: rs.length,
			opened: ps.length,
			declined: rs.length - ps.length,
			put_in_usd: total(ps.map((p) => p.notional_usd)),
			result_usd: total(ps.map((p) => p.result_usd)),
			followed_purchases_usd: { count: fol.length, median: median(fol), sum: total(fol), min: fsorted.length ? fromCents(fsorted[0]) : '0.00', max: fsorted.length ? fromCents(fsorted[fsorted.length - 1]) : '0.00' },
			same_size: { size_usd: one.length ? one[0].notional_usd : oneSize, count: one.length, put_in_usd: total(one.map((p) => p.notional_usd)), result_usd: total(one.map((p) => p.result_usd)) },
			ticker_copy_opened: rs.filter((r) => r.blind_copy.opened).length,
			ticker_copy_in_other_tokens: rs.filter((r) => r.blind_copy.opened?.asset === 'same_ticker').length,
			wallets_opened: Object.keys(per).length,
			top_wallet: best ? { wallet: best[0], opened: best[1], share_pct: share } : null,
		}
	}
	for (const t of trails) {
		const sl = stockLeg2(t.inputs)
		if (sl) stockMoves[howItCame(t.inputs, sl)]++
	}
	return {
		ledger_version: 3,
		note: LEDGER_NOTE,
		baseline: BLIND_BASELINE,
		decided_at: trails[0].decided_at,
		mark_block: markBlock,
		limits,
		limits_keccak: lc(first.limits_keccak),
		mandate: {
			keccak: lc(m.keccak),
			title: m.document.title,
			principal: lc(m.document.principal),
			agent_payment_key: lc(m.document.agent.payment_key),
			signed_by_principal: signedByPrincipal,
			sample,
			status: !signedByPrincipal ? 'not_signed' : sample ? 'sample' : 'signed_by_principal',
			valid_from: m.document.valid_from,
			valid_until: m.document.valid_until,
		},
		rules: trails[0].rules,
		token_check: first.token_check ? { source: first.token_check.source, keccak: lc(first.token_check.keccak) } : null,
		context,
		root: merkleRootOf(rows.map((r) => r.leaf)),
		rows,
		copy_guard_positions: guardPositions,
		blind_copy_positions: blindPositions,
		totals: {
			decisions: rows.length,
			wallets: new Set(rows.map((r) => r.wallet)).size,
			wallets_by_cohort: { watched: inCohort('watched'), top_buyers: inCohort('top_buyers'), same_ticker_buyers: inCohort('same_ticker_buyers') },
			by_cohort: { watched: cohortTotals('watched'), top_buyers: cohortTotals('top_buyers'), same_ticker_buyers: cohortTotals('same_ticker_buyers') },
			wallets_without_record: noRecord.length,
			decisions_without_record: rows.filter((r) => noRecord.includes(r.wallet)).length,
			first_move_time: times[0],
			by_group: Object.fromEntries(Object.entries(groupOf).map(([g, c]) => [g, groupTotals(c)])),
			stock_moves: stockMoves,
			last_move_time: times[times.length - 1],
			full: tierCount(rows, 'FULL'),
			reduced: tierCount(rows, 'REDUCED'),
			none: tierCount(rows, 'NONE'),
			none_by_reason: Object.entries(reasonCount)
				.map(([reason, count]) => ({ reason, count }))
				.sort((x, y) => y.count - x.count || (x.reason < y.reason ? -1 : 1)),
			other_tokens: {
				moves: otherMoves,
				tokens: Object.keys(otherList).length,
				tickers: [...new Set(Object.values(otherList).map((o) => o.ticker))].sort(),
				sent_to_the_wallet: came.received,
				bought_by_the_wallet: came.purchase,
				bought_off_venue: came.purchase_off_venue,
				received_unpaid: came.swapped_unpaid + came.liquidity + came.rotation,
				by_arrival: came,
				logged_as_sent_by_the_wallet: came.out,
				with_invisible_characters: hidden,
				list: Object.values(otherList).sort((x, y) => y.moves - x.moves || (x.token < y.token ? -1 : 1)),
			},
			copy_guard: {
				opened: guardPositions.length,
				closed: guardPositions.filter((p) => p.status === 'closed').length,
				open: guardPositions.filter((p) => p.status === 'open').length,
				put_in_usd: total(guardPositions.map((p) => p.notional_usd)),
				result_usd: total(guardPositions.map((p) => p.result_usd)),
				followed_purchases_usd: { count: followed.length, median: median(followed), sum: total(followed), min: fc.length ? fromCents(fc[0]) : '0.00', max: fc.length ? fromCents(fc[fc.length - 1]) : '0.00' },
			},
			blind_copy: {
				opened: blindPositions.length,
				closed: blindPositions.filter((p) => p.status === 'closed').length,
				open: blindPositions.filter((p) => p.status === 'open').length,
				in_stock_tokens: side(blindPositions.filter((p) => p.asset === 'stock')),
				in_other_tokens: { ...otherSide(otherBlind), tokens: new Set(otherBlind.map((p) => p.token)).size },
			},
			same_size: {
				size_usd: oneSize,
				opened_by_both: side(onePositions.filter((p) => openedByGuard.has(p.n))),
				opened_by_ticker_copy_only_stock: side(onePositions.filter((p) => !openedByGuard.has(p.n) && p.asset === 'stock')),
				opened_by_ticker_copy_only_other: otherSide(onePositions.filter((p) => p.asset === 'same_ticker')),
			},
		},
	}
}

/** Rerun everything a version 2 trail says about itself. An empty list means it holds. */
export function trailProblemsV2(trail) {
	const problems = []
	const inp = trail.inputs
	if (trail.rules?.id !== RULES_ID || trail.rules?.version !== 2) problems.push(`rules ${trail.rules?.id} v${trail.rules?.version}, expected ${RULES_ID} v2`)
	if (canonicalJson(trail.rules) !== canonicalJson(inp.rules)) problems.push('the rules named by the trail and by its inputs differ')
	if (trail.decided_at !== inp.decided_at) problems.push('decided_at differs between the trail and its inputs')
	if (lc(trail.purchase?.payer) !== lc(inp.payer)) problems.push('the payer of the purchase is not the payer the rules read')
	if (keccak256(canonicalJson(inp.limits)) !== lc(inp.limits_keccak)) problems.push('limits_keccak is not the hash of the limits in the trail')
	const m = inp.mandate
	if (keccak256(canonicalJson(m.document)) !== lc(m.keccak)) problems.push('the mandate keccak is not the hash of the mandate in the trail')
	if (lc(signerOfMandate(m.document, m.signature)) !== lc(m.signer)) problems.push('the mandate signature does not recover to the signer the trail names')
	const again = decideV2(inp)
	const said = trail.decision ?? {}
	if (again.tier !== said.tier || again.conclusion !== said.conclusion) problems.push(`the trail says ${said.tier} (${said.conclusion}), the rules give ${again.tier} (${again.conclusion})`)
	const saidRows = said.rule_results ?? []
	const differ = again.rule_results.filter((r, i) => canonicalJson(r) !== canonicalJson(saidRows[i] ?? null)).map((r) => r.id)
	if (differ.length || saidRows.length !== again.rule_results.length) problems.push(`rule rows differ from what the rules give: ${differ.join(' ') || 'extra rows'}`)
	if (canonicalJson({ d: again.decisive, p: again.paper_trade }) !== canonicalJson({ d: said.decisive, p: said.paper_trade })) problems.push('decisive rules or practice position differ from what the rules give')
	if (canonicalJson(cardOf(inp, again)) !== canonicalJson(trail.card ?? null)) problems.push('the decision card is not the one its inputs give')
	const paid = trail.purchase?.mode === 'paid'
	if (paid && !/^0x[0-9a-fA-F]{64}$/.test(trail.purchase.payment_tx ?? '')) problems.push('the trail says paid but names no payment tx')
	if (trail.purchase?.mode === 'dry-run' && trail.purchase.payment_tx !== null) problems.push('the trail says dry-run but names a payment tx')
	return { problems, again }
}

// EIP-712 for the one message the agent signs to pay: Permit2's PermitWitnessTransferFrom
// with the x402 witness. Used to recheck the digest in a saved 402 exchange.
const word32 = (v) => BigInt(v).toString(16).padStart(64, '0')
const PERMIT2_TYPE = 'PermitWitnessTransferFrom(TokenPermissions permitted,address spender,uint256 nonce,uint256 deadline,Witness witness)TokenPermissions(address token,uint256 amount)Witness(address to,uint256 validAfter)'
export function permit2Digest(typed) {
	const k = (hex) => keccak256(hexToBytes(hex)).slice(2)
	const kt = (text) => keccak256(text).slice(2)
	const d = typed.domain
	const m = typed.message
	const domain = k(kt('EIP712Domain(string name,uint256 chainId,address verifyingContract)') + kt(d.name) + word32(d.chainId) + word32(d.verifyingContract))
	const permitted = k(kt('TokenPermissions(address token,uint256 amount)') + word32(m.permitted.token) + word32(m.permitted.amount))
	const witness = k(kt('Witness(address to,uint256 validAfter)') + word32(m.witness.to) + word32(m.witness.validAfter))
	const main = k(kt(PERMIT2_TYPE) + permitted + word32(m.spender) + word32(m.nonce) + word32(m.deadline) + witness)
	return `0x${k(`1901${domain}${main}`)}`
}

// ---------------------------------------------------------------- reading the chains

/** The question could not be asked: no answer from any RPC. Not a failed check. */
export class Unreachable extends Error {}

const RPC_TIMEOUT_MS = 10_000
/**
 * A public RPC answers 429 or 5xx now and then. When no RPC of a chain gives an answer,
 * wait and ask again: after 0.5, 1, 2, 4 and 8 seconds, or longer when the RPC sends
 * Retry-After. Only a question that is still unanswered after that is "not checked".
 */
const RETRY_DELAYS_MS = [500, 1000, 2000, 4000, 8000]
/** No new retry starts later than this after the run began, so a dead network cannot hold the run for minutes. */
const RETRY_BUDGET_MS = 45_000
/** Pause between two requests to the same chain. Requests are sent one at a time. */
const GAP_MS = 120
/** An RPC that failed to connect this many times in a row is left out for the rest of the run. */
const DOWN_AFTER = 4

const realSleep = (ms) => new Promise((r) => setTimeout(r, ms))

/** Shared by the clients of one run: when it started, and how many times a question was asked again. */
export function rpcSession({ sleep = realSleep, now = Date.now } = {}) {
	return { sleep, now, deadline: now() + RETRY_BUDGET_MS, retries: 0 }
}

function retryAfterMs(res) {
	const h = res.headers?.get?.('retry-after')
	if (!h) return 0
	const s = Number(h)
	if (Number.isFinite(s)) return Math.max(0, s * 1000)
	const at = Date.parse(h)
	return Number.isFinite(at) ? Math.max(0, at - Date.now()) : 0
}

const looksRateLimited = (err) => err?.code === 429 || err?.code === -32005 || /rate limit|too many requests/i.test(String(err?.message ?? ''))

/**
 * JSON-RPC over fetch for one chain. One request at a time, a short pause between
 * requests, the same question asked once. A URL is used only after it has answered with
 * the expected chain id. When one URL fails, the next is asked at once; when all fail in
 * a way that may pass (429, 5xx, no connection), it waits and asks again.
 */
export function rpcClient(chain, { offline = false, fetchImpl = fetch, timeoutMs = RPC_TIMEOUT_MS, gapMs = GAP_MS, session = rpcSession() } = {}) {
	const good = new Set()
	const bad = new Map() // url -> why it is left out for the rest of the run
	const netFails = new Map() // url -> connection failures in a row
	const answers = new Map() // question -> answer
	let id = 0
	let lastSentAt = -Infinity
	let queue = Promise.resolve()

	/** One request. Returns { result } or { why, again, waitMs, net }. */
	async function once(url, method, params) {
		const host = new URL(url).host
		const pause = lastSentAt + gapMs - session.now()
		if (pause > 0) await session.sleep(pause)
		lastSentAt = session.now()
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
			return { why: `${host}: ${why}`, again: true, net: true }
		}
		if (!res.ok) return { why: `${host}: HTTP ${res.status}`, again: res.status === 429 || res.status >= 500, waitMs: retryAfterMs(res) }
		let body
		try {
			body = await res.json()
		} catch {
			return { why: `${host}: the answer is not JSON`, again: true }
		}
		if (body.error) return { why: `${host}: ${method}: ${body.error.message ?? 'rpc error'}`, again: looksRateLimited(body.error) }
		return { result: body.result }
	}

	/** One URL, chain id first. Marks a URL that cannot connect, or that is another chain, as left out. */
	async function askUrl(url, method, params) {
		let r
		if (!good.has(url)) {
			r = await once(url, 'eth_chainId', [])
			if ('result' in r) {
				const got = Number(BigInt(r.result))
				if (got !== chain.id) {
					bad.set(url, `${new URL(url).host} is chain ${got}, not ${chain.name} ${chain.id}`)
					return { why: bad.get(url), again: false }
				}
				good.add(url)
			}
		}
		if (good.has(url)) r = await once(url, method, params)
		if (r.net) {
			netFails.set(url, (netFails.get(url) ?? 0) + 1)
			if (netFails.get(url) >= DOWN_AFTER) bad.set(url, r.why)
		} else {
			netFails.set(url, 0)
		}
		return r
	}

	async function ask(method, params) {
		for (let round = 0; ; round++) {
			const why = []
			let again = false
			let waitMs = 0
			for (const url of chain.rpcs) {
				if (bad.has(url)) {
					why.push(bad.get(url))
					continue
				}
				const r = await askUrl(url, method, params)
				if ('result' in r) return r.result
				why.push(r.why)
				if (r.again && !bad.has(url)) {
					again = true
					waitMs = Math.max(waitMs, r.waitMs ?? 0)
				}
			}
			const wait = Math.max(RETRY_DELAYS_MS[round] ?? 0, waitMs)
			if (!again || round >= RETRY_DELAYS_MS.length || session.now() + wait > session.deadline) {
				throw new Unreachable([...new Set(why)].join('; ') || `no RPC given for ${chain.name}`)
			}
			session.retries++
			await session.sleep(wait)
		}
	}

	return (method, params) => {
		if (offline) return Promise.reject(new Unreachable('--offline'))
		const key = `${method} ${JSON.stringify(params)}`
		if (answers.has(key)) return Promise.resolve(answers.get(key))
		const next = queue.then(() => (answers.has(key) ? answers.get(key) : ask(method, params)))
		queue = next.then(
			(result) => void answers.set(key, result),
			() => {},
		)
		return next
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
const rel = (path) => (relative(REPO, path) || '.').split(sep).join('/')

/** Collects rows, prints each as it is decided. */
export class Report {
	constructor(print = console.log, session = { retries: 0 }) {
		this.rows = []
		this.print = print
		this.session = session
	}
	say(line = '') {
		this.print(line)
	}
	/** fn returns [passed, detail]. Unreachable becomes NOT CHECKED; any other error is a FAIL. */
	async check(name, fn) {
		let status
		let detail
		const retriesBefore = this.session.retries
		try {
			const [ok, d] = await fn()
			status = ok ? 'OK' : 'FAIL'
			detail = d
		} catch (e) {
			status = e instanceof Unreachable ? 'NOT CHECKED' : 'FAIL'
			detail = e instanceof Unreachable ? `not checked: ${e.message}` : String(e?.message ?? e)
		}
		const asked = this.session.retries - retriesBefore
		if (asked > 0) detail += ` (after ${asked} ${asked === 1 ? 'retry' : 'retries'})`
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
		const v2 = trail.trail_version === 2 ? ', and the mandate, the limits and the card are the ones its inputs give' : ''
		return [problems.length === 0, problems.length ? problems.join('; ') : `${again.rule_results.length} rules rerun give ${again.conclusion}${again.decisive.length ? ` (failed: ${again.decisive.join(' ')})` : ''}, ${pass} pass, every row as the trail has it${v2}`]
	})
	if (record) {
		await rep.check('record fields', () => {
			const rebuilt = recordFields(record.json, { source_url: trail.inputs.record.source_url, x_facts_hash: trail.inputs.record.x_facts_hash })
			let same = canonicalJson(rebuilt) === canonicalJson(trail.inputs.record)
			if (same && trail.trail_version === 2) {
				// What each moved token is called comes from the record too. The decimals are checked on chain below.
				const decimals = Object.fromEntries(trail.inputs.tokens_moved.map((m) => [m.token, m.decimals]))
				same = canonicalJson(movedTokensFrom(record.json, trail.inputs.movement.transfers, decimals)) === canonicalJson(trail.inputs.tokens_moved)
			}
			return [same, same ? `what the rules read is what ${rel(record.path)} holds` : `the trail's record fields differ from ${rel(record.path)} (it hashes to ${rebuilt.recomputed_facts_hash})`]
		})
	}
	const mv = trail.inputs.movement
	await rep.check('move on chain', async () => {
		const r = await main('eth_getTransactionReceipt', [mv.tx])
		if (!r) return [false, `${short(lc(mv.tx))} is not on Robinhood Chain`]
		const onchain = r.status === '0x1' ? movementFromLogs(trail.inputs.wallet, mv.tx, r.logs ?? []) : null
		const same = onchain !== null && canonicalJson(onchain) === canonicalJson(mv)
		if (!same) return [false, `Robinhood Chain shows ${onchain ? `${onchain.transfers.length} transfers in block ${onchain.block}` : 'no transfer of the wallet'} for ${mv.tx}; the trail lists ${mv.transfers.length} in block ${mv.block}`]
		let more = ''
		if (trail.trail_version === 2) {
			// Version 2 also says when the move happened, who signed it and how many decimals each token has.
			const bad = []
			if (lc(r.from) !== lc(trail.inputs.move.signer)) bad.push(`the tx was signed by ${lc(r.from)}, the trail says ${trail.inputs.move.signer}`)
			const block = await main('eth_getBlockByNumber', [`0x${mv.block.toString(16)}`, false])
			const time = block ? new Date(Number(BigInt(block.timestamp)) * 1000).toISOString() : '(no block)'
			if (time !== trail.inputs.move.time) bad.push(`the block is from ${time}, the trail says ${trail.inputs.move.time}`)
			for (const m of trail.inputs.tokens_moved) {
				// A token without decimals() reverts. The walk reads that as 18, and so does this check. A revert is an answer, not an outage.
		const d = await main('eth_call', [{ to: m.token, data: '0x313ce567' }, 'latest']).then(
			(x) => Number(BigInt(x)),
			(e) => {
				if (/execution reverted/i.test(String(e?.message))) return 18
				throw e
			},
		)
				if (d !== m.decimals) bad.push(`${m.token} has ${d} decimals, the trail says ${m.decimals}`)
			}
			if (bad.length) return [false, bad.join('; ')]
			more = `, at ${trail.inputs.move.time}, signed by ${lc(r.from) === lc(trail.inputs.wallet) ? 'the wallet' : `${shortAddr(lc(r.from))} (not the wallet)`}`
		}
		return [true, `${short(lc(mv.tx))} in block ${mv.block}: ${mv.transfers.length} transfer${mv.transfers.length === 1 ? '' : 's'} of the wallet, as the trail lists${more}`]
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
function rulesSourceHash(file = 'agent/rules.ts') {
	const bytes = readFileSync(join(REPO, file))
	return [keccak256(new Uint8Array(bytes)), keccak256(bytes.toString('utf8').replace(/\r\n/g, '\n'))]
}

// ---------------------------------------------------------------- the two ways to run it

async function verifyPaidRun(rep, main, test) {
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

const LEDGER_RECEIVER = '0xe3f0ca4f474e15364017ee3f6fc0d0949e5af0c9'
const LEDGER_TOPIC = keccak256('LedgerAnchored(bytes32,bytes32,bytes32,bytes32,uint32,uint32,uint32,uint32,uint64,bytes32,bytes10,address)')
const ANSWER_TOPIC = keccak256('AnswerUpdated(int256,uint256,uint256)')
const V4_POOL_MANAGER = '0x8366a39cc670b4001a1121b8f6a443a643e40951'
const V3_FACTORY = '0x1f7d7550b1b028f7571e69a784071f0205fd2efa'
/** The three moves of the demo wallet the paid run decided. They are always among the decisions checked on chain. */
const SHOWCASE = ['0x0eac7685', '0x1b838f40', '0xf7cb51a2']
const V4_SWAP_TOPIC = keccak256('Swap(bytes32,address,int128,int128,uint160,uint128,int24,uint24)')
const V3_SWAP = keccak256('Swap(address,address,int256,int256,uint160,uint128,int24)')
/** The record fields of a wallet vet402 has no record for: all empty, so the evidence rules fail and say so. */
const NO_RECORD_FIELDS = { source_url: '', x_facts_hash: '', recomputed_facts_hash: '', address: '', chain_id: 0, as_of: '', as_of_block: 0, method_version: '', r1_status: 'unverified', realized_usd: null, tokens: [], lookalikes: [] }

/** One decision of the walk against the chain: the transfers, the time, the signer, the decimals, the venue and the feed value. */
async function chainFacts(main, t) {
	const inp = t.inputs
	const mv = inp.movement
	const bad = []
	const r = await main('eth_getTransactionReceipt', [mv.tx])
	if (!r || r.status !== '0x1') return [false, `${short(lc(mv.tx))} is not a successful tx on Robinhood Chain`]
	const onchain = movementFromLogs(inp.wallet, mv.tx, r.logs ?? [])
	if (onchain === null || canonicalJson(onchain) !== canonicalJson(mv)) bad.push('the transfers differ from what the trail lists')
	if (lc(r.from) !== lc(inp.move.signer)) bad.push(`signed by ${lc(r.from)}, the trail says ${inp.move.signer}`)
	const tx = await main('eth_getTransactionByHash', [mv.tx])
	if (!tx || BigInt(tx.value ?? '0x0').toString() !== inp.move.value_wei) bad.push(`the transaction carried ${tx ? BigInt(tx.value ?? '0x0') : '?'} wei, the trail says ${inp.move.value_wei}`)
	if (tx && (lc(tx.to) !== lc(inp.move.to) || String(tx.input ?? '0x').slice(0, 10) !== inp.move.selector)) bad.push('the transaction called another contract or method than the trail says')
	const logs = r.logs ?? []
	const topic0 = (l) => lc(l.topics?.[0] ?? '')
	const LIQ = { [keccak256('Mint(address,address,int24,int24,uint128,uint256,uint256)')]: 'Mint', [keccak256('Burn(address,int24,int24,uint128,uint256,uint256)')]: 'Burn', [keccak256('Collect(address,address,int24,int24,uint128,uint128)')]: 'Collect', [keccak256('IncreaseLiquidity(uint256,uint128,uint256,uint256)')]: 'IncreaseLiquidity', [keccak256('DecreaseLiquidity(uint256,uint128,uint256,uint256)')]: 'DecreaseLiquidity', [keccak256('Collect(uint256,address,uint256,uint256)')]: 'Collect', [keccak256('ModifyLiquidity(bytes32,address,int24,int24,int256,bytes32)')]: 'ModifyLiquidity' }
	const liquidity = [...new Set(logs.map((l) => LIQ[topic0(l)]).filter(Boolean))].sort()
	if (canonicalJson(liquidity) !== canonicalJson(inp.move.liquidity)) bad.push(`the transaction holds liquidity logs ${liquidity.join(' ') || 'none'}, the trail says ${inp.move.liquidity.join(' ') || 'none'}`)
	const emitters = new Set(logs.filter((l) => topic0(l) === V4_SWAP_TOPIC || topic0(l) === V3_SWAP).map((l) => lc(l.address)))
	for (const v of [...inp.venue, ...inp.other_venue]) if (emitters.has(lc(v.address)) !== v.swapped) bad.push(`${v.address} ${emitters.has(lc(v.address)) ? 'emitted' : 'did not emit'} a swap log, the trail says otherwise`)
	if (inp.pool_entry) {
		const e = inp.pool_entry
		const swap = (r.logs ?? []).find((l) => lc(l.address) === V4_POOL_MANAGER && lc(l.topics?.[0]) === V4_SWAP_TOPIC && Number(BigInt(l.logIndex)) === e.log_index)
		const d = swap ? swap.data.slice(2) : ''
		const abs = (w) => {
			const v = BigInt.asIntN(256, BigInt(`0x${w}`))
			return v < 0n ? -v : v
		}
		const got = sumRaw(inp, (t) => t.direction === 'in' && movedKind(inp, t.token)?.kind === 'same_ticker')
		if (!swap || lc(swap.topics[1]) !== e.pool_id || BigInt(`0x${d.slice(128, 192)}`).toString() !== e.sqrt_price_x96 || abs(d.slice(e.token_is_currency0 ? 0 : 64, e.token_is_currency0 ? 64 : 128)) !== got) bad.push('the Uniswap v4 swap log is not the one the trail names for the pool price')
	}
	const block = await main('eth_getBlockByNumber', [`0x${mv.block.toString(16)}`, false])
	const time = block ? new Date(Number(BigInt(block.timestamp)) * 1000).toISOString() : '(no block)'
	if (time !== inp.move.time) bad.push(`the block is from ${time}, the trail says ${inp.move.time}`)
	for (const m of inp.tokens_moved) {
		// A token without decimals() reverts. The walk reads that as 18, and so does this check. A revert is an answer, not an outage.
		const d = await main('eth_call', [{ to: m.token, data: '0x313ce567' }, 'latest']).then(
			(x) => Number(BigInt(x)),
			(e) => {
				if (/execution reverted/i.test(String(e?.message))) return 18
				throw e
			},
		)
		if (d !== m.decimals) bad.push(`${m.token} has ${d} decimals, the trail says ${m.decimals}`)
		if (m.kind === 'same_ticker') {
			// The name the trail carries is the token's own name() on the chain, with invisible characters marked.
			const said = await main('eth_call', [{ to: m.token, data: '0x06fdde03' }, 'latest']).then(textOfCall, (e) => (/execution reverted/i.test(String(e?.message)) ? '' : Promise.reject(e)))
			const shownName = markInvisible(said).trim()
			if (shownName && shownName !== m.name) bad.push(`${m.token} answers name() "${shownName}", the trail says "${m.name}"`)
		}
	}
	for (const v of inp.venue) {
		let kind = 'other'
		if (lc(v.address) === V4_POOL_MANAGER) kind = 'uniswap-v4-pool-manager'
		else {
			// factory() reverts on anything that is not a pool: that is an answer (not a v3 pool), not an outage.
			const f = await main('eth_call', [{ to: v.address, data: '0xc45a0155' }, 'latest']).catch((e) => (e instanceof Unreachable && !/execution reverted/i.test(String(e.message)) ? Promise.reject(e) : '0x'))
			if (typeof f === 'string' && f.length === 66 && addrOf(f) === V3_FACTORY) kind = 'uniswap-v3-pool'
		}
		if (kind !== v.kind) bad.push(`${v.address} is ${kind}, the trail says ${v.kind}`)
	}
	const p = inp.price
	if (p) {
		if (addrOf(await main('eth_call', [{ to: p.feed, data: '0x245a7bfc' }, 'latest'])) !== lc(p.aggregator)) bad.push('the feed names another aggregator')
		const u = await main('eth_getTransactionReceipt', [p.update_tx])
		const log = (u?.logs ?? []).find((l) => l.address.toLowerCase() === lc(p.aggregator) && l.topics?.[0]?.toLowerCase() === ANSWER_TOPIC && BigInt(l.topics[2]).toString() === p.round_id)
		if (!log || BigInt(log.topics[1]).toString() !== p.answer || Number(BigInt(log.blockNumber)) !== p.update_block) bad.push('the feed value is not the one its update tx published')
		const later = await main('eth_getLogs', [{ address: p.aggregator, fromBlock: `0x${(p.update_block + 1).toString(16)}`, toBlock: `0x${mv.block.toString(16)}`, topics: [ANSWER_TOPIC] }])
		if (p.update_block < mv.block && (later ?? []).length) bad.push('the feed published a newer value before the move')
	}
	if (bad.length) return [false, `${short(lc(mv.tx))}: ${bad.join('; ')}`]
	const signer = lc(r.from) === lc(inp.wallet) ? 'the wallet' : `${shortAddr(lc(r.from))}, not the wallet`
	const sl = stockLeg2(inp) ?? cardLeg(inp)?.t
	const how = sl ? howItCame(inp, sl) : null
	const came = how === 'purchase' ? `, a purchase: an official swap, paid ${paidWords(inp)} by the wallet` : how ? `, ${how}${inp.move.liquidity.length ? ` (${inp.move.liquidity.join(', ')})` : ''}` : ''
	return [true, `${short(lc(mv.tx))} in block ${mv.block} (${inp.move.time}): ${mv.transfers.length} transfer${mv.transfers.length === 1 ? '' : 's'} as listed, signed by ${signer}${came}${inp.venue.length ? `, venue ${inp.venue.map((v) => v.kind).join(' and ')}` : ''}${p ? `, feed value ${feedUsd(p)} USD from round ${p.round_id}` : ''}`]
}

/** The Merkle root of the ledger, against anchor.json and the LedgerAnchored log on Robinhood Testnet. */
async function checkLedgerRoot(rep, test, ledger, dir) {
	await rep.check('root onchain', async () => {
		const anchor = readJson(join(dir, 'anchor.json'))
		if (lc(anchor.root) !== lc(ledger.root)) return [false, `${CLAIMS.walkDir}/anchor.json names root ${anchor.root}, the ledger gives ${ledger.root}`]
		if (!anchor.ledger_tx) return [false, 'the walk was only simulated: its root is not onchain']
		const r = await test('eth_getTransactionReceipt', [anchor.ledger_tx])
		const log = (r?.logs ?? []).find((l) => l.address.toLowerCase() === LEDGER_RECEIVER && l.topics?.[0]?.toLowerCase() === LEDGER_TOPIC)
		if (!log || r.status !== '0x1') return [false, `no LedgerAnchored from LedgerRootReceiver in ${short(anchor.ledger_tx)}`]
		const t = ledger.totals
		const bad = []
		if (lc(log.topics[1]) !== lc(ledger.root)) bad.push(`onchain root ${lc(log.topics[1])}`)
		if (lc(log.topics[2]) !== ledger.mandate.keccak) bad.push('another mandate')
		if (lc(log.topics[3]) !== ledger.limits_keccak) bad.push('other limits')
		if (word(log.data, 0) !== keccak256(canonicalJson(ledger.rules))) bad.push('other rules')
		const n = (i) => Number(BigInt(word(log.data, i)))
		if (n(1) !== t.decisions || n(2) !== t.full || n(3) !== t.reduced || n(4) !== t.none) bad.push(`counts ${n(1)}/${n(2)}/${n(3)}/${n(4)}`)
		if (n(5) !== ledger.mark_block) bad.push(`mark block ${n(5)}`)
		return [bad.length === 0, bad.length ? `LedgerAnchored in ${short(anchor.ledger_tx)} differs: ${bad.join('; ')}` : `LedgerAnchored in ${short(anchor.ledger_tx)} on Robinhood Testnet has the Merkle root ${short(lc(ledger.root))} of all ${t.decisions} decisions, the same mandate, limits and rules, and the same counts`]
	})
}

/** 5. The practice ledger: every decision of the walk, both books, the mandate, the user's limits, the root and the page. */
async function verifyLedger(rep, main, test, deep) {
	rep.say(`5. The practice ledger: a walk through every decision, copy-guard next to a ticker copy`)
	const dir = join(REPO, CLAIMS.walkDir)
	let trails = []
	let feeds = {}
	let ledger = null
	let context = null
	let selection = null
	if (existsSync(join(REPO, CLAIMS.compressed))) {
		await rep.check('gzipped', () => {
			const list = readJson(join(REPO, CLAIMS.compressed)).files
			const bad = list.filter((f) => createHash('sha256').update(readWalkFile(join(REPO, f.file))).digest('hex') !== f.sha256)
			return [list.length > 0 && bad.length === 0, bad.length ? `${bad.map((f) => `${f.file}.gz`).join(', ')} does not unpack to the sha256 in ${CLAIMS.compressed}` : `${list.map((f) => `${basename(f.file)}.gz`).join(' and ')} unpack to the bytes whose sha256 ${CLAIMS.compressed} recorded before they were gzipped (${list.map((f) => `${(f.bytes / 1e6).toFixed(1)} MB`).join(' and ')})`]
		})
	}
	await rep.check('decisions', () => {
		trails = readWalkFile(join(dir, 'trails.jsonl')).toString('utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l))
		const bad = []
		for (const [i, t] of trails.entries()) {
			const { problems } = trailProblems(t)
			if (problems.length) bad.push(`decision ${i + 1}: ${problems[0]}`)
		}
		const tier = (x) => trails.filter((t) => t.decision.tier === x).length
		return [trails.length > 0 && bad.length === 0, bad.length ? bad.slice(0, 3).join('; ') : `${trails.length} decisions rerun, ${trails[0].decision.rule_results.length} rules each: FULL ${tier('FULL')}, REDUCED ${tier('REDUCED')}, NONE ${tier('NONE')}. Every row, card, mandate and limits hash is the one its inputs give`]
	})
	await rep.check('selection', () => {
		context = readJson(join(dir, 'context.json'))
		selection = readJson(join(dir, 'selection.json'))
		const listed = readJson(join(dir, 'wallets.json'))
		const bad = []
		if (canonicalJson(listed.map((w) => [lc(w.wallet), w.cohort, w.rank, w.purchases_usd])) !== canonicalJson(context.wallets.map((w) => [lc(w.wallet), w.cohort, w.rank, w.purchases_usd]))) bad.push('the walk did not follow the wallets the selection wrote')
		if (canonicalJson([selection.window.from, selection.window.to]) !== canonicalJson([context.window.from_block, context.window.to_block])) bad.push('the window of the walk is not the window of the selection')
		const c = selection.counts
		// Every place of the ranking gone through is either selected or passed over: a router or another contract (not asked), or an address vet402 could build no record for.
		const passed = selection.no_record
		const notAsked = passed.filter((w) => w.asked === false)
		if (c.considered !== c.selected + passed.length || c.asked !== c.selected + passed.length - notAsked.length || c.no_record !== passed.length - notAsked.length || selection.wallets.length !== c.selected) bad.push('the counts of the selection do not add up')
		if (!(c.selected >= selection.top || c.asked >= selection.max_asked || c.considered >= c.receivers)) bad.push('the selection stopped before either limit')
		const routers = new Set((selection.routers ?? []).map((r) => lc(r.address)))
		for (const w of notAsked) if (!(w.not_a_wallet === 'router' ? routers.has(lc(w.wallet)) : w.not_a_wallet === 'contract' && w.has_code === true)) bad.push(`${w.wallet} was passed over without asking, and is neither a listed router nor a contract`)
		const asked = [...selection.wallets.map((w) => ({ ...w, ok: true })), ...passed.map((w) => ({ ...w, ok: false }))].sort((x, y) => x.bound_rank - y.bound_rank)
		asked.forEach((w, i) => {
			if (w.bound_rank !== i + 1) bad.push(`rank ${i + 1} was skipped`)
			if (i > 0 && Number(asked[i - 1].bound_usd) < Number(w.bound_usd)) bad.push(`${w.wallet} is out of order`)
			if (w.asked === false) return
			const file = join(dir, 'records', `${lc(w.wallet)}.json`)
			if (!existsSync(file)) return void bad.push(`no saved answer for ${w.wallet}`)
			const saved = readJson(file)
			if ((saved.http_status === 200 && Boolean(saved.facts)) !== w.ok) bad.push(`${w.wallet}: the saved answer says ${saved.http_status}, the selection says ${w.ok ? 'selected' : 'no record'}`)
		})
		const ranked = (selection.ranking_top ?? []).slice(0, asked.length)
		if (canonicalJson(ranked.map((r) => lc(r.wallet))) !== canonicalJson(asked.map((w) => lc(w.wallet)))) bad.push('the addresses gone through are not the top of the ranking')
		if (canonicalJson(context.selection.no_record) !== canonicalJson(selection.no_record)) bad.push("the walk's context lists other addresses with no record")
		const strangers = [...new Set(trails.map((t) => lc(t.inputs.wallet)))].filter((w) => !context.wallets.some((x) => lc(x.wallet) === w))
		if (strangers.length) bad.push(`${strangers.length} wallets in the walk are not in the selection`)
		const by = (k) => context.wallets.filter((w) => w.cohort === k).length
		return [bad.length === 0, bad.length ? bad.slice(0, 3).join('; ') : `${CLAIMS.walkDir}/selection.json went through the top ${c.considered} addresses by what official venues sent them, directly or through ${routers.size} listed routers, in blocks ${selection.window.from} to ${selection.window.to} (${selection.window.from_time.slice(0, 10)} to ${selection.window.to_time.slice(0, 10)}): ${notAsked.length} routers or other contracts passed over without asking, ${c.asked} asked, ${c.selected} selected, ${c.no_record} with no record, each with its saved answer. ${selection.stop} Observations apart: ${by('watched')} watched wallet and ${by('same_ticker_buyers')} buyers of one token with the ticker ${selection.same_ticker_buyers?.ticker ?? '?'}`]
	})
	if (!context) return
	await rep.check('records', () => {
		const snapshot = readJson(join(REPO, 'token-check/registry-snapshot.json'))
		const chainNames = existsSync(join(dir, 'tokens.json')) ? (readJson(join(dir, 'tokens.json')).names ?? {}) : {}
		const list = Object.fromEntries(snapshot.tokens.map((t) => [lc(t.token), { symbol: t.symbol, name: t.name }]))
		const resultsPath = join(REPO, 'docs/token-check/results.json')
		const results = existsSync(resultsPath) ? { keccak: keccak256(new Uint8Array(readFileSync(resultsPath))), tokens: readJson(resultsPath).tokens ?? {} } : null
		const wallets = [...new Set(trails.map((t) => lc(t.inputs.wallet)))]
		let without = 0
		for (const w of wallets) {
			const saved = readJson(join(dir, 'records', `${w}.json`))
			const http = saved.http_status ?? 200
			if (context.wallets.find((x) => lc(x.wallet) === w)?.record_http !== http) return [false, `records/${w}.json says HTTP ${http}, the walk's context says otherwise`]
			let fields
			if (saved.facts) {
				if (factsHash(saved.facts) !== lc(saved.x_facts_hash)) return [false, `records/${w}.json does not hash to the X-Facts-Hash saved with it`]
				fields = canonicalJson(recordFields(saved.facts, { source_url: saved.source_url, x_facts_hash: saved.x_facts_hash }))
			} else {
				if (http === 200) return [false, `records/${w}.json has no record but says HTTP 200`]
				without++
				fields = canonicalJson({ ...NO_RECORD_FIELDS, source_url: saved.source_url })
			}
			for (const t of trails.filter((x) => lc(x.inputs.wallet) === w)) {
				if (canonicalJson(t.inputs.record) !== fields) return [false, `a decision about ${w} read record fields that records/${w}.json does not give`]
				if (canonicalJson(t.inputs.record_fetch) !== canonicalJson({ url: saved.source_url, http_status: http })) return [false, `a decision about ${w} names another answer of vet402 than records/${w}.json`]
				const tc = t.inputs.token_check
				if (Boolean(tc) !== Boolean(results)) return [false, results ? `a decision about ${w} did not read docs/token-check/results.json` : `a decision about ${w} names CRE token-check results, and docs/token-check/results.json is missing`]
				if (tc && lc(tc.keccak) !== results.keccak) return [false, `a decision about ${w} names token-check results ${tc.keccak}, the file hashes to ${results.keccak}`]
				for (const [token, said] of Object.entries(tc?.tokens ?? {})) {
					const f = results.tokens[token] ?? Object.entries(results.tokens).find(([k]) => lc(k) === token)?.[1]
					if (!f || (f.issuer_token === true) !== said.issuer_token || (f.ticker ?? null) !== said.ticker || canonicalJson(f.reasons ?? []) !== canonicalJson(said.reasons)) return [false, `a decision about ${w} says something else about ${token} than docs/token-check/results.json`]
				}
				const decimals = Object.fromEntries(t.inputs.tokens_moved.map((m) => [m.token, m.decimals]))
				if (canonicalJson(movedTokensFrom(saved.facts, t.inputs.movement.transfers, decimals, list, tc, chainNames)) !== canonicalJson(t.inputs.tokens_moved)) return [false, `a decision about ${w} names a moved token differently from the issuer's list, the token-check results and the record`]
			}
		}
		return [wallets.length > 0, `${wallets.length - without} records in ${CLAIMS.walkDir}/records hash to the X-Facts-Hash vet402 sent with them and give the fields every decision read. For ${without} wallets vet402 gave no record, and their decisions say so. Every moved token is named as the issuer's list (${snapshot.count} Stock Tokens, taken ${snapshot.list_taken_at.slice(0, 10)})${results ? `, the CRE token-check results ${short(results.keccak)}` : ''} and the record give it${results ? '' : '. No CRE token-check results file is present, so no decision names one'}`]
	})
	await rep.check('prices', () => {
		feeds = readJson(join(dir, 'feeds.json'))
		let priced = 0
		for (const [i, t] of trails.entries()) {
			const leg = stockLeg2(t.inputs)
			const series = leg ? feeds[lc(leg.token)] : null
			const pt = series ? lastPoint(series, t.inputs.movement.block) : null
			const want = pt ? { feed: series.feed, aggregator: series.aggregator, answer: pt.answer, decimals: series.decimals, round_id: pt.round_id, updated_at: pt.updated_at, update_block: pt.block, update_tx: pt.tx } : null
			if (canonicalJson(want) !== canonicalJson(t.inputs.price)) return [false, `decision ${i + 1}: the price it read is not the last feed value at or before block ${t.inputs.movement.block} in ${CLAIMS.walkDir}/feeds.json`]
			if (want) priced++
		}
		const n = Object.values(feeds).reduce((s, f) => s + f.points.length, 0)
		return [true, `${priced} decisions read a price, each the last Chainlink feed value at or before the block of the move, out of ${n} values of ${Object.keys(feeds).length} feeds saved in ${CLAIMS.walkDir}/feeds.json`]
	})
	await rep.check('ledger', () => {
		ledger = readJson(join(REPO, CLAIMS.ledger))
		const rebuilt = ledgerOf(trails, feeds, ledger.mark_block, context)
		const i = rebuilt.rows.findIndex((r, k) => canonicalJson(r) !== canonicalJson(ledger.rows?.[k] ?? null))
		if (i >= 0) return [false, `row ${i + 1} of ${CLAIMS.ledger} is not what the walk gives`]
		if (canonicalJson(rebuilt) !== canonicalJson(ledger)) return [false, `${CLAIMS.ledger} differs from what the walk gives outside its rows (a position, a total, the root, the limits or the mandate)`]
		const k = trails.findIndex((t, j) => canonicalJson(t.inputs.book) !== canonicalJson(rebuilt.rows[j].book))
		if (k >= 0) return [false, `decision ${k + 1} read a practice book that the walk up to it does not give`]
		// What a position of copy-guard rests on: a Stock Token the wallet bought. Signed by it, paid for by it. Never a collect.
		const notBought = rebuilt.rows.filter((r) => r.copy_guard.opened && !(r.main?.kind === 'stock' && r.main.arrival === 'purchase'))
		if (notBought.length) return [false, `decision ${notBought[0].n} opened a position on something that is not a purchase by the wallet`]
		const t = rebuilt.totals
		const o = t.other_tokens
		const b = t.blind_copy
		const z = t.same_size
		return [
			true,
			`${CLAIMS.ledger} is what the walk gives: ${t.decisions} decisions about ${t.wallets} wallets (FULL ${t.full}, REDUCED ${t.reduced}, NONE ${t.none}). Incoming Stock Tokens by kind: ${Object.entries(t.stock_moves).map(([k, v]) => `${k} ${v}`).join(', ')}. copy-guard opened ${t.copy_guard.opened} practice positions, every one on a purchase (an official swap the wallet itself paid for, median ${t.copy_guard.followed_purchases_usd.median} USD), and none in a token the issuer did not list. A ticker copy opened ${b.opened}: ${b.in_stock_tokens.count} in Stock Tokens and ${b.in_other_tokens.count} in ${b.in_other_tokens.tokens} other token${b.in_other_tokens.tokens === 1 ? '' : 's'} under a listed ticker. Different tokens under a listed ticker were part of ${o.moves} moves (${o.tokens} tokens: ${o.tickers.join(', ')}): ${o.sent_to_the_wallet} sent to the wallet, ${o.bought_by_the_wallet} bought by it, ${o.received_unpaid} received unpaid, ${o.logged_as_sent_by_the_wallet} logged as sent by it. At one size (${z.size_usd} USD each): the ${z.opened_by_both.count} both opened ${z.opened_by_both.result_usd} USD, the ${z.opened_by_ticker_copy_only_stock.count} Stock Token positions only the ticker copy opened ${z.opened_by_ticker_copy_only_stock.result_usd} USD, and its ${z.opened_by_ticker_copy_only_other.count} in other tokens: ${z.opened_by_ticker_copy_only_other.measured} valued at a pool (${z.opened_by_ticker_copy_only_other.result_measured_usd ?? 'none'} USD), ${z.opened_by_ticker_copy_only_other.not_measured} not measured and in no sum`,
		]
	})
	if (!ledger) return
	await rep.check('groups', () => {
		// Recomputed here from the rows and the positions, not read from the ledger: the copy-guard book per group of wallets.
		const rebuilt = ledgerOf(trails, feeds, ledger.mark_block, context).totals.by_group
		if (canonicalJson(rebuilt) !== canonicalJson(ledger.totals.by_group ?? null)) return [false, `totals.by_group of ${CLAIMS.ledger} is not what the walk gives`]
		const sum = (k) => Object.values(rebuilt).reduce((x, g) => x + g[k], 0)
		if (sum('opened') !== ledger.totals.copy_guard.opened || sum('decisions') !== ledger.totals.decisions) return [false, 'the groups do not add up to the whole book']
		const line = (name, g) => `${name}: ${g.wallets} wallets, ${g.decisions} decisions, copy-guard opened ${g.opened} and declined ${g.declined}, followed purchases median ${g.followed_purchases_usd.median} USD (sum ${g.followed_purchases_usd.sum}), at ${g.same_size.size_usd} USD each ${g.same_size.result_usd} USD${g.top_wallet ? `, ${g.top_wallet.opened} of ${g.opened} from ${shortAddr(g.top_wallet.wallet)}` : ''}`
		return [true, `copy-guard per group, recomputed: ${Object.entries(rebuilt).map(([k, g]) => line(k, g)).join('; ')}`]
	})
	await rep.check('page', () => {
		const html = readFileSync(join(REPO, CLAIMS.page), 'utf8')
		const block = (id) => {
			const m = html.match(new RegExp(`<script type="application/json" id="${id}">([\\s\\S]*?)</script>`))
			return m ? JSON.parse(m[1]) : null
		}
		const head = block('ledger-data')
		const carried = block('rows-data')
		if (!head || !carried) return [false, `${CLAIMS.page} carries no ledger`]
		const { rows, ...rest } = ledger
		const bad = []
		if (canonicalJson(head) !== canonicalJson(rest)) bad.push(`the totals, books and positions inside ${CLAIMS.page} are not those of ${CLAIMS.ledger}`)
		// the cards at the top: full rows, exactly as the ledger has them
		for (const r of carried.featured) if (canonicalJson(r) !== canonicalJson(rows[r.n - 1])) bad.push(`card ${r.n} on the page is not row ${r.n} of the ledger`)
		// the short form of every decision in which a position opened, a different token under a listed ticker moved, or the size was not NONE
		const shortRow = (r) => ({ n: r.n, wallet: r.wallet, cohort: r.cohort, move_tx: r.move_tx, move_time: r.move_time, tier: r.tier, main: r.main ?? null, copy_guard: { opened: r.copy_guard.opened }, blind_copy: { opened: r.blind_copy.opened }, card: { headline: r.card.headline } })
		const other = (r) => (r.main ? ['same_ticker', 'fake'].includes(r.main.kind) : r.failed.includes('C1'))
		const want = rows.filter((r) => Boolean(r.copy_guard.opened || r.blind_copy.opened) || r.tier !== 'NONE' || other(r)).map(shortRow)
		if (canonicalJson(carried.short) !== canonicalJson(want)) bad.push(`the decisions listed in ${CLAIMS.page} are not the ${want.length} rows of the ledger in which a position opened, another token moved or the size was not NONE`)
		// one file per wallet: exactly its rows, and one line per wallet with the counts and the file's hash
		const files = existsSync(join(REPO, CLAIMS.pageRowsDir)) ? readdirSync(join(REPO, CLAIMS.pageRowsDir)).filter((f) => f.endsWith('.js')) : []
		let inFiles = 0
		for (const w of carried.wallets) {
			const mine = rows.filter((r) => lc(r.wallet) === lc(w.wallet))
			const path = join(REPO, CLAIMS.pageRowsDir, `${lc(w.wallet)}.js`)
			if (w.file !== `${CLAIMS.pageRowsDir}/${lc(w.wallet)}.js` || !existsSync(path)) {
				bad.push(`no ${CLAIMS.pageRowsDir}/${lc(w.wallet)}.js`)
				continue
			}
			const bytes = readFileSync(path)
			const text = bytes.toString('utf8')
			const m = text.match(/^vet402Rows\(([\s\S]*)\)\n$/)
			if (!m || canonicalJson(JSON.parse(m[1])) !== canonicalJson(mine)) bad.push(`${CLAIMS.pageRowsDir}/${lc(w.wallet)}.js does not hold the ${mine.length} rows of that wallet`)
			if (keccak256(new Uint8Array(bytes)) !== w.keccak || bytes.length !== w.bytes) bad.push(`${CLAIMS.pageRowsDir}/${lc(w.wallet)}.js is not the file the page names`)
			const count = (f) => mine.filter(f).length
			const got = [w.decisions, w.full, w.reduced, w.none, w.other_token_moves, w.copy_guard_opened, w.ticker_copy_opened, w.ticker_copy_in_other_tokens]
			const exp = [mine.length, count((r) => r.tier === 'FULL'), count((r) => r.tier === 'REDUCED'), count((r) => r.tier === 'NONE'), count(other), count((r) => r.copy_guard.opened), count((r) => r.blind_copy.opened), count((r) => r.blind_copy.opened && (r.blind_copy.opened.asset === 'same_ticker' || r.blind_copy.opened.fake === true))]
			if (canonicalJson(got) !== canonicalJson(exp)) bad.push(`the page's line for ${shortAddr(lc(w.wallet))} does not give the counts of its rows`)
			inFiles += mine.length
		}
		if (inFiles !== rows.length || files.length !== carried.wallets.length) bad.push(`${CLAIMS.pageRowsDir} holds ${files.length} files with ${inFiles} rows; the ledger has ${rows.length} rows`)
		return [bad.length === 0, bad.length ? bad.slice(0, 3).join('; ') : `${CLAIMS.page} carries the totals, both books with every position, the ${carried.featured.length} cards at the top as full rows and ${carried.short.length} decisions in short form (every one that opened a position, moved a different token under a listed ticker or was not NONE), all as ${CLAIMS.ledger} has them. The other decisions are in ${files.length} files of ${CLAIMS.pageRowsDir}, one per wallet, which hold the ${rows.length} rows exactly and give the page's counts per wallet`]
	})
	await rep.check('limits', () => {
		const limits = readJson(join(REPO, CLAIMS.limits))
		const h = keccak256(canonicalJson(limits))
		const named = [...new Set(trails.flatMap((t) => [lc(t.inputs.limits_keccak), lc(t.inputs.mandate.document.limits_keccak)]))]
		const ok = named.length === 1 && named[0] === h
		return [ok, ok ? `${CLAIMS.limits} hashes to ${short(h)}, the limits every decision and the mandate name: full ${limits.size.full_usd} USD, reduced ${limits.size.reduced_usd} USD, ${limits.size.max_usd_per_day} USD per day, a wallet at a loss opens ${limits.evidence.wallet_at_a_loss === 'none' ? 'nothing' : 'a reduced position'}` : `${CLAIMS.limits} hashes to ${h}; the decisions and the mandate name ${named.join(', ') || '(none)'}`]
	})
	await rep.check('rules files', () => {
		const v1 = rulesSourceHash('agent/rules.ts')
		const v2 = rulesSourceHash('agent/rules-v2.ts')
		const named = [...new Set(trails.flatMap((t) => [canonicalJson([t.rules.source_keccak, t.rules.limits_rules_keccak]), canonicalJson([t.inputs.mandate.document.rules.source_keccak, t.inputs.mandate.document.rules.limits_rules_keccak])]))]
		const ok = named.length === 1 && [canonicalJson([v1[0], v2[0]]), canonicalJson([v1[1], v2[1]])].includes(named[0])
		return [ok, ok ? `agent/rules.ts hashes to ${short(v1[0])}, the file the paid run's trails name, and agent/rules-v2.ts to ${short(v2[0])}, as every decision and the mandate say` : `agent/rules.ts hashes to ${v1[0]} and agent/rules-v2.ts to ${v2[0]}; the decisions and the mandate name ${named.join(', ') || '(none)'}`]
	})
	await rep.check('mandate', () => {
		const refs = [...new Set(trails.map((t) => lc(t.inputs.mandate.keccak)))]
		if (refs.length !== 1) return [false, `the decisions name ${refs.length} mandates`]
		const m = trails[0].inputs.mandate
		if (!trails.every((t) => lc(t.inputs.mandate.signature) === lc(m.signature))) return [false, 'the decisions carry different signatures for the same mandate']
		const real = readJson(join(REPO, CLAIMS.mandate))
		const samplePath = join(REPO, CLAIMS.sampleMandate)
		const isReal = keccak256(canonicalJson(real)) === refs[0]
		const isSample = existsSync(samplePath) && keccak256(canonicalJson(readJson(samplePath))) === refs[0]
		if (!isReal && !isSample) return [false, `the decisions name mandate ${refs[0]}, which is neither ${CLAIMS.mandate} nor ${CLAIMS.sampleMandate}`]
		const signer = signerOfMandate(m.document, m.signature)
		const byPrincipal = signer !== null && signer === lc(m.document.principal)
		if (isReal) {
			if (lc(real.principal) !== CLAIMS.payee) return [false, `the principal of ${CLAIMS.mandate} is ${real.principal}`]
			return [true, byPrincipal ? `${CLAIMS.mandate} hashes to ${short(refs[0])}, and the signature in every decision recovers to its principal ${shortAddr(signer)}: practice only, payment key ${shortAddr(lc(real.agent.payment_key))}, valid ${real.valid_from} to ${real.valid_until}` : `${CLAIMS.mandate} hashes to ${short(refs[0])}. Its principal had not signed it when these decisions were made, so rule M1 made every one of them NONE`]
		}
		return [byPrincipal, byPrincipal ? `SAMPLE mandate ${CLAIMS.sampleMandate} (${short(refs[0])}): the signature in every decision recovers to its principal ${shortAddr(signer)}, a testnet-only key that stands in for the principal. The real mandate, ${CLAIMS.mandate}, is not signed yet` : `the sample mandate is not signed by its principal`]
	})
	await checkLedgerRoot(rep, test, ledger, dir)
	const seenVerdict = new Set()
	for (const t of trails) {
		const vtx = lc(t.inputs.cre.verdict_tx)
		if (!vtx || seenVerdict.has(vtx)) continue
		seenVerdict.add(vtx)
		await checkVerdict(rep, test, t, null)
	}
	// The pool marks: the last swap of each pool at or before the mark block, read again from the chain.
	for (const [id, m] of Object.entries(context.pool_marks ?? {})) {
		await rep.check('pool mark', async () => {
			const at = await main('eth_getLogs', [{ address: V4_POOL_MANAGER, fromBlock: `0x${m.block.toString(16)}`, toBlock: `0x${ledger.mark_block.toString(16)}`, topics: [V4_SWAP_TOPIC, id] }])
			const last = (at ?? [])[at.length - 1]
			const ok = last && Number(BigInt(last.blockNumber)) === m.block && Number(BigInt(last.logIndex)) === m.log_index && lc(last.transactionHash) === lc(m.tx) && BigInt(`0x${last.data.slice(2 + 128, 2 + 192)}`).toString() === m.sqrt_price_x96
			const valued = ledger.blind_copy_positions.filter((p) => p.valued_by === 'pool' && p.pool_entry?.pool_id === id)
			return [Boolean(ok), ok ? `the last swap of Uniswap v4 pool ${short(id)} at or before block ${ledger.mark_block} is in ${short(lc(m.tx))} (block ${m.block}), the price ${valued.length} ticker-copy position${valued.length === 1 ? ' is' : 's are'} marked at` : `the last swap of pool ${short(id)} on chain is not the one ${CLAIMS.walkDir}/context.json names`]
		})
	}
	const picked = new Set()
	if (deep) trails.forEach((_, i) => picked.add(i))
	else {
		const take = (test, max) => trails.forEach((t, i) => void (test(t) && [...picked].filter((k) => test(trails[k])).length < max && picked.add(i)))
		take((t) => SHOWCASE.some((h) => t.inputs.movement.tx.startsWith(h)), 3)
		take((t) => t.decision.paper_trade !== null, 10)
		take((t) => t.decision.decisive.includes('C1') && cardLeg(t.inputs) && howItCame(t.inputs, cardLeg(t.inputs).t) === 'purchase', 3)
		take((t) => t.decision.decisive.includes('C1'), 6)
		take((t) => t.inputs.move.liquidity.length > 0, 1)
		take((t) => stockLeg2(t.inputs) && howItCame(t.inputs, stockLeg2(t.inputs)) === 'rotation', 1)
	}
	rep.say(deep ? `  every decision against Robinhood Chain` : `  ${picked.size} of the ${trails.length} decisions against Robinhood Chain (--deep checks every one)`)
	for (const i of [...picked].sort((a, b) => a - b)) await rep.check(`decision ${i + 1}`, () => chainFacts(main, trails[i]))
}

/**
 * --quick: what a reader checks first, in seconds. The x402 payment, the record vet402
 * anchored and the CRE verdict on it, the cards at the top of the page (each decision
 * rerun and read against the chain), and the ledger's Merkle root against the testnet.
 */
async function verifyQuick(rep, main, test) {
	const dir = join(REPO, CLAIMS.runDir)
	let paid = []
	rep.say('1. The x402 payment')
	await rep.check('evidence', () => {
		paid = loadTrails(dir)
		return [paid.length > 0, `${rel(dir)} holds the record, the 402 exchange and ${paid.length} trails`]
	})
	await checkPayment(rep, main, {
		tx: CLAIMS.paymentTx,
		payer: CLAIMS.payer,
		payee: CLAIMS.payee,
		amount: CLAIMS.priceAtomic,
		alsoNamedBy: [[`${CLAIMS.runDir}/x402-paid.json`, readJson(join(dir, 'x402-paid.json')).settlement?.transaction], ...paid.map((t) => [basename(t.path), t.trail.purchase.payment_tx])],
	})
	rep.say('2. The record vet402 anchored, and the CRE verdict on it')
	await checkAnchor(rep, main, test, paid)
	rep.say('3. The cards at the top of the page, and the ledger root')
	const walk = join(REPO, CLAIMS.walkDir)
	let ledger = null
	let trails = []
	let featured = []
	await rep.check('cards', () => {
		ledger = readJson(join(REPO, CLAIMS.ledger))
		trails = readWalkFile(join(walk, 'trails.jsonl')).toString('utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l))
		const html = readFileSync(join(REPO, CLAIMS.page), 'utf8')
		const m = html.match(/<script type="application\/json" id="rows-data">([\s\S]*?)<\/script>/)
		featured = m ? JSON.parse(m[1]).featured : []
		const bad = []
		for (const r of featured) {
			const t = trails[r.n - 1]
			if (!t) bad.push(`card ${r.n} has no decision`)
			else {
				const { problems } = trailProblems(t)
				if (problems.length) bad.push(`card ${r.n}: ${problems[0]}`)
				if (keccak256(canonicalJson(t)) !== lc(r.leaf)) bad.push(`card ${r.n} is not the decision whose leaf it names`)
				if (canonicalJson(r.card) !== canonicalJson(t.card)) bad.push(`card ${r.n} on the page is not the card of its decision`)
			}
			if (canonicalJson(r) !== canonicalJson(ledger.rows[r.n - 1] ?? null)) bad.push(`card ${r.n} is not row ${r.n} of ${CLAIMS.ledger}`)
		}
		return [featured.length > 0 && bad.length === 0, bad.length ? bad.slice(0, 3).join('; ') : `the ${featured.length} cards at the top of ${CLAIMS.page} (decisions ${featured.map((r) => r.n).join(', ')}) rerun to the size, the rule rows and the card they show, and are rows of ${CLAIMS.ledger} with their leaves`]
	})
	for (const r of featured) await rep.check(`card ${r.n}`, () => chainFacts(main, trails[r.n - 1]))
	if (!ledger) return
	await rep.check('ledger leaves', () => {
		const root = merkleRootOf(ledger.rows.map((r) => r.leaf))
		return [root === lc(ledger.root), root === lc(ledger.root) ? `the ${ledger.rows.length} leaves of ${CLAIMS.ledger} give its root ${short(root)}` : `the leaves give ${root}, the ledger says ${ledger.root}`]
	})
	await checkLedgerRoot(rep, test, ledger, walk)
	const seen = new Set()
	for (const t of trails) {
		const v = lc(t.inputs.cre.verdict_tx)
		if (!v || seen.has(v)) continue
		seen.add(v)
		await checkVerdict(rep, test, t, null)
	}
}

/** 6. The gate: the saved 402 exchange, the payment the agent built and did not sign, and the agent card. No chain read. */
async function verifyGate(rep) {
	rep.say(`6. The x402 gate in front of the CRE workflow (a dry run: nothing signed, nothing paid)`)
	let x = null
	await rep.check('gate 402', () => {
		x = readJson(join(REPO, CLAIMS.gateDryRun))
		const a = x.accepted ?? {}
		const ok = x.status === 402 && a.scheme === 'exact' && a.network === 'eip155:4663' && lc(a.asset) === USDG && lc(a.payTo) === CLAIMS.payee && String(a.amount) === CLAIMS.priceAtomic && a.extra?.assetTransferMethod === 'permit2' && /\/v1\/workflows\/rwa-verify$/.test(x.resource ?? '')
		return [ok, ok ? `the gate answered 402 for ${new URL(x.resource).pathname}: exact, eip155:4663, ${usdg(a.amount)} to ${shortAddr(lc(a.payTo))} (vet402), Permit2` : `the saved 402 does not carry the published terms: ${canonicalJson(a)}`]
	})
	if (!x) return
	await rep.check('payment built', () => {
		const t = x.permit2_typed_data
		const m = t.message
		const bad = []
		if (x.signed !== false) bad.push('the file says a payment was signed')
		if (lc(t.domain.verifyingContract) !== PERMIT2 || Number(t.domain.chainId) !== 4663) bad.push('the typed data is not for Permit2 on Robinhood Chain')
		if (lc(m.permitted.token) !== USDG || String(m.permitted.amount) !== CLAIMS.priceAtomic) bad.push('it is not for 0.01 USDG')
		if (lc(m.spender) !== X402_PERMIT2_PROXY) bad.push('the spender is not the x402 Permit2 proxy')
		if (lc(m.witness.to) !== CLAIMS.payee) bad.push('the recipient is not the vet402 wallet')
		if (BigInt(m.deadline) - BigInt(m.witness.validAfter) > 180n) bad.push('it would be valid for more than 120 s')
		const d = permit2Digest(t)
		if (d !== lc(x.permit2_digest)) bad.push(`the typed data hashes to ${d}, the file says ${x.permit2_digest}`)
		return [bad.length === 0, bad.length ? bad.join('; ') : `the payment the agent built and did not sign hashes to ${short(d)}: 0.01 USDG, spender the x402 Permit2 proxy, recipient pinned to ${shortAddr(CLAIMS.payee)}, valid 120 s`]
	})
	await rep.check('agent card', () => {
		const c = readJson(join(REPO, CLAIMS.agentCard))
		const p = c.payment ?? {}
		const front = /^---\nname: \S.*\ndescription: \S.*\n---\n/.test(readFileSync(join(REPO, CLAIMS.skill), 'utf8').replace(/\r\n/g, '\n'))
		const ok = p.protocol === 'x402' && p.network === 'eip155:4663' && lc(p.asset_address) === USDG && lc(p.pay_to) === CLAIMS.payee && p.atomic === CLAIMS.priceAtomic && (c.skills ?? []).some((k) => k.id === 'rwa-verify') && front
		return [ok, ok ? `${CLAIMS.agentCard} and ${CLAIMS.skill} offer the workflow rwa-verify under the same terms: 0.01 USDG on eip155:4663 to ${shortAddr(CLAIMS.payee)}` : `${CLAIMS.agentCard} or ${CLAIMS.skill} does not carry the gate's terms`]
	})
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
const SECTIONS = ['paid-run', 'ledger', 'gate']

export function parseArgs(argv) {
	const a = { offline: false, target: null, rpc: null, testnetRpc: null, only: null, deep: false, quick: false }
	for (let i = 0; i < argv.length; i++) {
		const k = argv[i]
		const value = () => {
			if (argv[i + 1] === undefined) throw new Usage(`${k} needs a URL`)
			return argv[++i]
		}
		if (k === '--offline') a.offline = true
		else if (k === '--rpc') a.rpc = value()
		else if (k === '--testnet-rpc') a.testnetRpc = value()
		else if (k === '--deep') a.deep = true
		else if (k === '--quick') a.quick = true
		else if (k === '--only') {
			a.only = argv[++i]
			if (!SECTIONS.includes(a.only)) throw new Usage(`--only takes one of: ${SECTIONS.join(', ')}`)
		}
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

const USAGE = `usage: node verify.mjs [trail.json | block number] [--quick] [--only paid-run|ledger|gate] [--deep] [--offline] [--rpc URL] [--testnet-rpc URL]
  no argument    recheck the paid run in ${CLAIMS.runDir}, the practice ledger ${CLAIMS.ledger} and the gate
  --quick        only the payment, the anchor, the CRE verdicts, the cards at the top of the page and the ledger root (seconds)
  block number   one of ${Object.keys(CLAIMS.decisions).join(', ')}
exit code: 0 MATCH, 1 MISMATCH, 2 usage, 3 NOT CHECKED (an RPC could not be reached and nothing failed)`

export async function run(argv, { print = console.log, fetchImpl = fetch, sleep, now, gapMs } = {}) {
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
	const session = rpcSession({ sleep, now })
	const main = rpcClient(mainChain, { offline: args.offline, fetchImpl, gapMs, session })
	const test = rpcClient(testChain, { offline: args.offline, fetchImpl, gapMs, session })
	const rep = new Report(print, session)
	rep.say('vet402 copy-guard: recheck with no key, no account and no install')
	rep.say(args.offline ? '  chains  not read (--offline)' : `  chains  ${mainChain.name} ${mainChain.id} at ${new URL(mainChain.rpcs[0]).host}, ${testChain.name} ${testChain.id} at ${new URL(testChain.rpcs[0]).host}`)
	await rep.check('keccak256', () => [checkKeccak(), checkKeccak() ? 'the built-in hash gives the published test values' : 'the built-in hash is broken; no other line can be trusted'])
	if (path) await verifyOne(rep, main, test, path)
	else if (args.quick) await verifyQuick(rep, main, test)
	else {
		if (!args.only || args.only === 'paid-run') await verifyPaidRun(rep, main, test)
		if (!args.only || args.only === 'ledger') await verifyLedger(rep, main, test, args.deep)
		if (!args.only || args.only === 'gate') await verifyGate(rep)
	}
	const res = rep.result()
	const count = (s) => rep.rows.filter((r) => r.status === s).length
	rep.say('')
	rep.say(`${count('OK')} OK, ${count('FAIL')} FAIL, ${count('NOT CHECKED')} not checked${session.retries ? ` (an RPC was busy: asked again ${session.retries} ${session.retries === 1 ? 'time' : 'times'})` : ''}`)
	rep.say(`RESULT: ${res.text}`)
	if (args.quick && !path) rep.say('To check every decision, the selection, the page and the gate: node verify.mjs (about 90 seconds)')
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
