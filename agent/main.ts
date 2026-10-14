// copy-guard: an agent that watches a Robinhood Chain wallet and, before it would
// copy a move, buys the wallet's vet402 /rwa record over x402, has Chainlink CRE
// re-verify the wallet's anchor, runs fixed rules, and records the decision as a
// paper trade with a reasoning trail whose hash goes onchain through CRE.
//
//   bun agent/main.ts [--wallet 0x…] [--from-block N] [--to-block N | --blocks N,N,…] [--max N]
//                     [--broadcast] [--pay [--approve]] [--out docs/agent/<name>]
//                     [--limits limits.json] [--mandate mandate] [--book docs/agent/<run>]
//                     [--gate http://127.0.0.1:4021/v1/workflows/rwa-verify] [--anchor-record file.json]
//
// Every decision is a version 2 trail (agent/rules-v2.ts): the 13 rules, the mandate
// (who the agent acts for), the user's limits from limits.json, the practice position
// with its exit, and a decision card in plain sentences.
// --gate pays the x402 gate in front of the CRE workflow instead of the record route.
// --book names the folder whose earlier trails count against the daily limit.
// --anchor-record gives the anchored record as a local file when vet402's public repo
// does not hold it yet.
//
// Default is a dry run: the 402 is read and the Permit2 payment is built, but
// nothing is signed or sent. --pay signs and pays, never past MAX_SPEND_ATOMIC
// (1 USDG). --approve (only with --pay) sends approve(Permit2, 1 USDG) once when
// the allowance is short, which needs a little ETH on Robinhood Chain for gas.
// --broadcast writes the CRE results to Robinhood Testnet (testnet ETH only).
// No real trade is ever made.
import { randomBytes } from 'node:crypto'
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join, relative } from 'node:path'
import { readdirSync, statSync } from 'node:fs'
import { createPublicClient, createWalletClient, getAddress, type Hex, http, keccak256 } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { type AnchorRef, httpRpc, LOG_SPAN, movements, newestAnchor, RPC, type Rpc } from './chain'
import { type CreRun, REPO, simulate } from './cre'
import { chain, erc20 } from './evm'
import { feedSeries, priceAt, venueOf } from './facts'
import { payGate } from './gate/client'
import { confirmGateVerdict, ownReceiver, TESTNET_RPC } from './gate/verdict'
import { cents, limitsKeccak, type Limits, parseLimits, paymentCapAtomic, usd, usdgAtomic } from './limits'
import { mandateRef, type MandateRef, parseMandate } from './mandate'
import { recordInputs } from './record'
import { type CreInputs, type Movement, USDG } from './rules'
import { type Book, type DecisionInputsV2, movedTokens, RULES_V2, type RulesRef, stockLegV2, type Venue } from './rules-v2'
import { effectiveSpent, ledgerPath, payOnce, readChainSpend } from './pay'
import { buildTrailV2, type Purchase, type TrailV2, trailHash } from './trail'
import {
	assertUnderCap,
	CHAIN_ID,
	decodeRequired,
	loadLedger,
	MAX_SPEND_ATOMIC,
	PERMIT2,
	paymentHeader,
	permit2TypedData,
	pickAccept,
	RefusedTerms,
	termsOf,
	X402_PERMIT2_PROXY,
} from './x402'

const DEMO_WALLET = '0xE9B08727131E34010b34006c660D4c1B436EC25f'
const VET402 = 'https://vet402.com'
const VET402_REPO_RAW = 'https://raw.githubusercontent.com/kzmttkc/vet402/main'
const KEY_FILE = process.env.BLI_AGENT_KEY_FILE ?? join(homedir(), '.vet402/bli-agent.key')
const ADDRESS_FILE = process.env.BLI_AGENT_ADDRESS_FILE ?? join(homedir(), '.vet402/bli-agent.address')
/** Fixed. Only a test run may point it elsewhere (agent/pay.ts ledgerPath). */
const LEDGER_FILE = ledgerPath()
const STATE_DIR = join(REPO, 'agent/state')
/**
 * How long the paid request may take. The first settlement took 1.5 s. A request with no
 * limit could hang while it holds the ledger lock; after ten minutes another run may take
 * that lock over. When the limit passes, the request is abandoned and the payment is
 * written to the ledger as unknown, which counts as spent.
 */
export const PAID_REQUEST_TIMEOUT_MS = 60_000

type Args = {
	wallet: string
	fromBlock?: number
	toBlock?: number
	/** Replay: look only at these blocks. */
	blocks?: number[]
	max: number
	pay: boolean
	approve: boolean
	broadcast: boolean
	out?: string
	/** The user's limits, relative to the repo. */
	limits?: string
	/** Folder with mandate.json and, once the principal has signed, mandate.sig. */
	mandate?: string
	/** Folder whose earlier version 2 trails count against the daily limit. */
	book?: string
	/** URL of the x402 gate in front of the CRE workflow. */
	gate?: string
	/** A local anchored-record JSON, as vet402's anchor script writes it. */
	anchorRecord?: string
}

export function parseArgs(argv: string[]): Args {
	const a: Args = { wallet: DEMO_WALLET, max: 5, pay: false, approve: false, broadcast: false }
	for (let i = 0; i < argv.length; i++) {
		const k = argv[i]
		const v = () => {
			const x = argv[++i]
			if (x === undefined) throw new Error(`${k} needs a value`)
			return x
		}
		if (k === '--wallet') a.wallet = getAddress(v())
		else if (k === '--from-block') a.fromBlock = Number(v())
		else if (k === '--to-block') a.toBlock = Number(v())
		else if (k === '--blocks') a.blocks = v().split(',').map(Number)
		else if (k === '--max') a.max = Number(v())
		else if (k === '--out') a.out = v()
		else if (k === '--pay') a.pay = true
		else if (k === '--approve') a.approve = true
		else if (k === '--broadcast') a.broadcast = true
		else if (k === '--limits') a.limits = v()
		else if (k === '--mandate') a.mandate = v()
		else if (k === '--book') a.book = v()
		else if (k === '--gate') a.gate = v()
		else if (k === '--anchor-record') a.anchorRecord = v()
		else throw new Error(`unknown argument ${k}`)
	}
	if (a.approve && !a.pay) throw new Error('--approve only goes with --pay')
	return a
}

const say = (s: string) => console.log(s)

type Bought = { facts: any; xFactsHash: string; sourceUrl: string; purchase: Purchase; terms: ReturnType<typeof termsOf>; x402: unknown }

/** Step 2: buy the record (or, in a dry run, build the payment and read the same JSON from the free route). */
export async function buyRecord(
	wallet: string,
	args: Args,
	payer: string,
	out: string,
	opts: { paidTimeoutMs?: number; capAtomic?: bigint; perDecisionAtomic?: bigint } = {},
): Promise<Bought> {
	const paidTimeoutMs = opts.paidTimeoutMs ?? PAID_REQUEST_TIMEOUT_MS
	// The user's limits can lower the cap. They can never raise it above MAX_SPEND_ATOMIC.
	const cap = opts.capAtomic !== undefined && opts.capAtomic < MAX_SPEND_ATOMIC ? opts.capAtomic : MAX_SPEND_ATOMIC
	const pub = createPublicClient({ chain, transport: http(RPC) })
	const paidUrl = `${VET402}/api/v1/rwa/paid/facts/${wallet}`
	const first = await fetch(paidUrl)
	const reqHeader = first.headers.get('PAYMENT-REQUIRED')
	if (first.status !== 402 || !reqHeader) throw new Error(`expected 402 with PAYMENT-REQUIRED, got ${first.status}`)
	const required = decodeRequired(reqHeader)
	const accept = pickAccept(required)
	const terms = termsOf(accept)
	for (const [name, addr] of [
		['Permit2', PERMIT2],
		['x402ExactPermit2Proxy', X402_PERMIT2_PROXY],
	] as const) {
		const code = await pub.getCode({ address: addr })
		if (!code || code === '0x') throw new Error(`${name} has no code on 4663; nothing signed`)
	}
	const [balance, allowance] = await Promise.all([
		pub.readContract({ address: USDG as Hex, abi: erc20, functionName: 'balanceOf', args: [payer as Hex] }),
		pub.readContract({ address: USDG as Hex, abi: erc20, functionName: 'allowance', args: [payer as Hex, PERMIT2] }),
	])
	// Spent = the larger of the ledger and the chain (every USDG the payer sent, and last approval - allowance).
	const latest = Number(await pub.getBlockNumber())
	const onchain = await readChainSpend(httpRpc(RPC), payer, latest, allowance)
	const spent = effectiveSpent(LEDGER_FILE, loadLedger(LEDGER_FILE, payer), onchain.spentAtomic)
	const amount = BigInt(accept.amount)
	if (opts.perDecisionAtomic !== undefined && amount > opts.perDecisionAtomic) {
		throw new RefusedTerms(`the route asks ${amount} USDG atomic, above the user's limit of ${opts.perDecisionAtomic} for one decision`)
	}
	// The cap is checked before a payment is even built, in a dry run too.
	assertUnderCap(spent, amount, cap)
	const now = Math.floor(Date.now() / 1000)
	const nonce = BigInt(`0x${randomBytes(32).toString('hex')}`)
	const built = permit2TypedData(accept, payer, now, nonce)
	const x402 = {
		resource: paidUrl,
		status: first.status,
		payment_required: required,
		accepted: accept,
		payer,
		usdg_balance_atomic: balance.toString(),
		permit2_allowance_atomic: allowance.toString(),
		chain_spent_atomic: onchain.spentAtomic.toString(),
		spent_before_atomic: spent.toString(),
		cap_atomic: cap.toString(),
		permit2_typed_data: JSON.parse(JSON.stringify(built.typedData, (_k, v) => (typeof v === 'bigint' ? v.toString() : v))),
		permit2_digest: built.digest,
		signed: false,
	}
	say(`  402 terms   ${accept.scheme} ${accept.network} ${accept.amount} USDG atomic to ${accept.payTo} (${accept.extra?.assetTransferMethod})`)
	say(`  payer       ${payer}  USDG ${balance} atomic, Permit2 allowance ${allowance}, spent ${spent} of cap ${cap}`)
	say(`  permit2     digest ${built.digest} (spender ${X402_PERMIT2_PROXY}, witness.to ${accept.payTo})`)

	if (!args.pay) {
		// The free route serves the same JSON; the dry run reads it there so nothing is paid.
		const freeUrl = `${VET402}/api/v1/rwa/facts/${wallet}?chain=4663`
		const res = await fetch(freeUrl)
		if (res.status !== 200) throw new Error(`free route ${res.status}`)
		const facts = await res.json()
		writeFileSync(join(out, 'x402-dry-run.json'), `${JSON.stringify(x402, null, 2)}\n`)
		say('  DRY RUN     nothing signed, nothing sent; record read from the free route (same JSON)')
		return {
			facts,
			xFactsHash: (res.headers.get('x-facts-hash') ?? '').toLowerCase(),
			sourceUrl: freeUrl,
			terms,
			x402,
			purchase: {
				mode: 'dry-run',
				resource: paidUrl,
				payer,
				payment_tx: null,
				settlement: 'not-sent',
				spent_before_atomic: spent.toString(),
				cap_atomic: cap.toString(),
				permit2_digest: built.digest,
			},
		}
	}

	// --pay. Everything from the cap check to the last ledger write runs under the ledger lock.
	if (balance < amount) throw new Error('USDG balance is below the price; nothing sent')
	const key = readFileSync(KEY_FILE, 'utf8').trim() as Hex
	const account = privateKeyToAccount(key)
	if (account.address.toLowerCase() !== payer.toLowerCase()) throw new Error('key file and address file disagree')
	let paid: Response | null = null
	let signedDigest = built.digest
	const result = await payOnce({
		ledgerFile: LEDGER_FILE,
		payer,
		amount,
		resource: paidUrl,
		chainSpentAtomic: onchain.spentAtomic,
		allowance,
		cap,
		approve: args.approve
			? async (remaining) => {
					// Approve only what is left under the cap, so Permit2 itself can never pull past it.
					const wallet = createWalletClient({ account, chain, transport: http(RPC) })
					const hash = await wallet.writeContract({ address: USDG as Hex, abi: erc20, functionName: 'approve', args: [PERMIT2, remaining] })
					await pub.waitForTransactionReceipt({ hash })
					say(`  approve     Permit2 ${remaining} USDG atomic (cap ${cap} minus spent), tx ${hash}`)
				}
			: undefined,
		send: async () => {
			// Built again here so the validity window (at most 120 s) starts at signing time.
			const fresh = permit2TypedData(accept, payer, Math.floor(Date.now() / 1000), BigInt(`0x${randomBytes(32).toString('hex')}`))
			signedDigest = fresh.digest
			const signature = await account.signTypedData(fresh.typedData)
			paid = await fetch(paidUrl, {
				headers: { 'PAYMENT-SIGNATURE': paymentHeader(required, accept, fresh.authorization, signature) },
				signal: AbortSignal.timeout(paidTimeoutMs),
			})
			const resp = paid.headers.get('PAYMENT-RESPONSE')
			return { httpStatus: paid.status, settlement: resp ? JSON.parse(Buffer.from(resp, 'base64').toString('utf8')) : null }
		},
	})
	const res = paid as unknown as Response
	const last = result.outcome
	writeFileSync(
		join(out, 'x402-paid.json'),
		`${JSON.stringify({ ...x402, signed: true, permit2_digest: signedDigest, http_status: result.httpStatus, x_payment_status: res.headers.get('X-Payment-Status'), settlement: result.settlement }, null, 2)}\n`,
	)
	if (result.httpStatus !== 200) throw new Error(`paid route answered ${result.httpStatus} (${last.status}); see x402-paid.json`)
	say(`  PAID        ${amount} USDG atomic, settlement ${last.status} tx ${last.tx}`)
	const paidRes = res
	return {
		facts: await paidRes.json(),
		xFactsHash: (paidRes.headers.get('x-facts-hash') ?? '').toLowerCase(),
		sourceUrl: paidUrl,
		terms,
		x402,
		purchase: {
			mode: 'paid',
			resource: paidUrl,
			payer,
			payment_tx: last.tx,
			settlement: last.status === 'settled' ? 'settled' : 'unknown',
			spent_before_atomic: spent.toString(),
			cap_atomic: cap.toString(),
			permit2_digest: signedDigest,
		},
	}
}

type VerifyResult = {
	verdict: 'MATCH' | 'MISMATCH'
	reasonBits: number
	anchorTx: string
	recomputedFactsHash: string
	anchoredFactsHash: string
}

/** Step 3: Chainlink CRE re-verifies the wallet's newest anchor against Robinhood Chain. */
function verifyAnchor(anchor: (AnchorRef & { record?: unknown }) | null, args: Args, out: string): CreInputs {
	const receiver = JSON.parse(readFileSync(join(REPO, 'rwa-verify/config.json'), 'utf8')).receiverAddress
	if (!anchor) {
		return {
			workflow: 'vet402-rwa-verify',
			anchor_tx: '',
			anchor_record_url: '',
			verdict: 'NO_ANCHOR',
			reason_bits: 0,
			recomputed_facts_hash: '',
			anchored_facts_hash: '',
			receiver,
			mode: args.broadcast ? 'broadcast' : 'simulate',
			verdict_tx: null,
		}
	}
	say(`  anchor      ${anchor.methodVersion} tx ${anchor.tx} block ${anchor.block}`)
	const run: CreRun<VerifyResult> = simulate('rwa-verify', anchor.record ? { tx: anchor.tx, record: anchor.record } : { tx: anchor.tx, recordUrl: anchor.recordUrl }, { broadcast: args.broadcast, workDir: out, label: 'cre-verify' })
	say(`  CRE verify  ${run.result.verdict} reasons ${run.result.reasonBits}${run.tx ? `, RecordChecked tx ${run.tx}` : ' (simulated, not broadcast)'}`)
	return {
		workflow: 'vet402-rwa-verify',
		anchor_tx: anchor.tx,
		anchor_record_url: anchor.recordUrl,
		verdict: run.result.verdict,
		reason_bits: run.result.reasonBits,
		recomputed_facts_hash: run.result.recomputedFactsHash.toLowerCase(),
		anchored_facts_hash: run.result.anchoredFactsHash.toLowerCase(),
		receiver,
		mode: args.broadcast ? 'broadcast' : 'simulate',
		verdict_tx: run.tx,
	}
}

// ---------------------------------------------------------------- the policy: limits, mandate, book

export type Policy = { limits: Limits; limitsKeccak: string; mandate: MandateRef; rules: RulesRef; mandateDir: string }

/** limits.json, the mandate and its signature, and the two rule files named by hash. */
export function loadPolicy(args: Pick<Args, 'limits' | 'mandate'>): Policy {
	const limits = parseLimits(JSON.parse(readFileSync(join(REPO, args.limits ?? 'limits.json'), 'utf8')))
	const mandateDir = args.mandate ?? 'mandate'
	const document = parseMandate(JSON.parse(readFileSync(join(REPO, mandateDir, 'mandate.json'), 'utf8')))
	const sigFile = join(REPO, mandateDir, 'mandate.sig')
	const signature = existsSync(sigFile) ? readFileSync(sigFile, 'utf8').trim() : null
	const rules: RulesRef = {
		id: RULES_V2.id,
		version: RULES_V2.version,
		source_keccak: keccak256(readFileSync(join(REPO, 'agent/rules.ts'))),
		limits_rules_keccak: keccak256(readFileSync(join(REPO, 'agent/rules-v2.ts'))),
	}
	return { limits, limitsKeccak: limitsKeccak(limits), mandate: mandateRef(document, signature || null), rules, mandateDir }
}

/** Every version 2 trail under a folder. */
export function loadTrails(dir: string): TrailV2[] {
	if (!existsSync(dir)) return []
	const out: TrailV2[] = []
	for (const name of readdirSync(dir)) {
		const p = join(dir, name)
		if (statSync(p).isDirectory()) out.push(...loadTrails(p))
		else if (/^trail-\d+-[0-9a-f]+\.json$/.test(name)) {
			const t = JSON.parse(readFileSync(p, 'utf8')).trail
			if (t?.trail_version === 2) out.push(t)
		}
	}
	return out
}

/** What earlier decisions already used on the UTC day of this move. A trail about the same move is left out. */
export function bookAt(earlier: TrailV2[], moveTime: string, moveTx: string): Book {
	const day = moveTime.slice(0, 10)
	const copies = earlier.filter((t) => t.decision.conclusion === 'COPY' && t.decision.paper_trade && t.inputs.movement.tx.toLowerCase() !== moveTx.toLowerCase())
	const used = copies.filter((t) => t.inputs.move.time.slice(0, 10) === day).reduce((s, t) => s + cents(t.decision.paper_trade?.notional_usd ?? '0'), 0n)
	return { day, used_usd_today: usd(used), open_positions: copies.length }
}

/** When the move happened, who signed its transaction, and the decimals of each moved token. All public chain reads. */
async function moveFacts(rpc: Rpc, mv: Movement): Promise<{ time: string; signer: string; decimals: Record<string, number> }> {
	const block = await rpc('eth_getBlockByNumber', [`0x${mv.block.toString(16)}`, false])
	const tx = await rpc('eth_getTransactionByHash', [mv.tx])
	const decimals: Record<string, number> = {}
	for (const token of new Set(mv.transfers.map((t) => t.token.toLowerCase()))) {
		try {
			decimals[token] = Number(BigInt(await rpc('eth_call', [{ to: token, data: '0x313ce567' }, 'latest'])))
		} catch {
			decimals[token] = 18
		}
	}
	return { time: new Date(Number(BigInt(block.timestamp)) * 1000).toISOString(), signer: String(tx.from).toLowerCase(), decimals }
}

export async function main(argv: string[]) {
	const args = parseArgs(argv)
	const wallet = args.wallet.toLowerCase()
	const payer = getAddress(readFileSync(ADDRESS_FILE, 'utf8').trim())
	const policy = loadPolicy(args)
	const cap = paymentCapAtomic(policy.limits, MAX_SPEND_ATOMIC)
	const perDecision = usdgAtomic(policy.limits.payments.max_usdg_per_decision)
	const rpc = httpRpc(RPC)
	const latest = Number(BigInt(await rpc('eth_blockNumber', [])))
	mkdirSync(STATE_DIR, { recursive: true })
	const cursorFile = join(STATE_DIR, 'cursor.json')
	const cursor = existsSync(cursorFile) ? JSON.parse(readFileSync(cursorFile, 'utf8')) : {}
	const fromBlock = args.fromBlock ?? (cursor[wallet] ? cursor[wallet] + 1 : latest - LOG_SPAN + 1)
	const toBlock = Math.min(args.toBlock ?? latest, latest)
	const stamp = new Date().toISOString().replace(/[:.]/g, '-')
	const out = join(REPO, args.out ?? `agent/state/runs/${stamp}`)
	mkdirSync(out, { recursive: true })

	say(`copy-guard ${RULES_V2.id} v${RULES_V2.version}  ${args.pay ? 'PAY' : 'DRY RUN'}${args.broadcast ? ' + testnet broadcast' : ''}`)
	const replay = args.blocks?.length ? args.blocks : null
	say(`  watching    ${getAddress(wallet)} on Robinhood Chain 4663, ${replay ? `replay of blocks ${replay.join(', ')}` : `blocks ${fromBlock}..${toBlock}`}`)
	const m = policy.mandate
	const signedByPrincipal = Boolean(m.signer) && m.signer?.toLowerCase() === m.document.principal.toLowerCase()
	say(`  mandate     ${m.keccak} principal ${m.document.principal} ${signedByPrincipal ? 'signed by the principal' : m.signature ? `signed by ${m.signer}, NOT the principal` : 'NOT SIGNED: every decision will be NONE'} (${policy.mandateDir}/)`)
	say(`  limits      ${policy.limitsKeccak} full ${policy.limits.size.full_usd} USD, reduced ${policy.limits.size.reduced_usd} USD, ${policy.limits.size.max_usd_per_day} USD per day, payments at most ${cap} USDG atomic in total`)

	// 1. Detect.
	const found = replay
		? (await Promise.all(replay.map((b) => movements(rpc, wallet, b, b)))).flat().sort((x, y) => x.block - y.block)
		: await movements(rpc, wallet, fromBlock, toBlock)
	say(`  movements   ${found.length}`)
	if (!replay && args.fromBlock === undefined && args.toBlock === undefined) {
		cursor[wallet] = toBlock
		writeFileSync(cursorFile, `${JSON.stringify(cursor, null, 2)}\n`)
	}
	if (found.length === 0) {
		writeFileSync(join(out, 'summary.txt'), `no movement of ${wallet} in blocks ${fromBlock}..${toBlock}\n`)
		say('  nothing to decide')
		return []
	}
	const todo = found.slice(0, args.max)

	// The wallet's newest anchor. With --anchor-record the anchored record is a local file.
	let anchor: (AnchorRef & { record?: unknown }) | null = await newestAnchor(rpc, wallet, latest, VET402_REPO_RAW)
	if (args.anchorRecord) {
		const rec = JSON.parse(readFileSync(join(REPO, args.anchorRecord), 'utf8'))
		if (!anchor || anchor.tx !== String(rec.anchor_tx).toLowerCase()) throw new Error(`--anchor-record is for anchor ${rec.anchor_tx}, but the wallet's newest anchor onchain is ${anchor?.tx ?? '(none)'}`)
		anchor = { ...anchor, record: rec, recordUrl: `file:${args.anchorRecord}` }
		writeFileSync(join(out, 'anchored-record.json'), `${JSON.stringify(rec, null, 2)}\n`)
	}

	// 2. Buy the evidence once per run; every decision in the run reads the same bytes.
	let facts: any
	let xFactsHash: string
	let sourceUrl: string
	let purchase: Purchase
	let terms: Bought['terms']
	let cre: CreInputs
	if (args.gate) {
		// The payment sits at the entrance of the CRE workflow. The record itself comes from the free route.
		sourceUrl = `${VET402}/api/v1/rwa/facts/${getAddress(wallet)}?chain=4663`
		const res = await fetch(sourceUrl)
		if (res.status !== 200) throw new Error(`free route ${res.status}`)
		facts = await res.json()
		xFactsHash = (res.headers.get('x-facts-hash') ?? '').toLowerCase()
		const gate = await payGate(args.gate, anchor ? (anchor.record ? { tx: anchor.tx, record: anchor.record } : { tx: anchor.tx, recordUrl: anchor.recordUrl }) : {}, {
			// With no anchor there is nothing for the workflow to check, so nothing is paid.
			pay: args.pay && anchor !== null,
			approve: args.approve,
			payer,
			out,
			ledgerFile: LEDGER_FILE,
			keyFile: KEY_FILE,
			capAtomic: cap,
			perDecisionAtomic: perDecision,
			timeoutMs: 110_000,
			say,
		})
		purchase = gate.purchase
		terms = gate.terms
		// The gate's answer is a claim. It is used only after the agent has read the RecordChecked
		// event itself on Robinhood Testnet, from its own receiver, and found the same verdict there
		// (agent/gate/verdict.ts, which also says what that does not prove). Otherwise the agent runs
		// the same CRE workflow itself, as in a dry run.
		const receiver = ownReceiver()
		const checked =
			gate.verdict && anchor
				? await confirmGateVerdict(gate.verdict, { receiver, anchorTx: anchor.tx, wallet, anchoredFactsHash: anchor.factsHash, anchorBlock: anchor.block }, httpRpc(TESTNET_RPC))
				: null
		if (checked) writeFileSync(join(out, 'x402-gate-verdict-check.json'), `${JSON.stringify({ gate: args.gate, gate_answer: gate.verdict, read_from: TESTNET_RPC, receiver, check: checked }, null, 2)}\n`)
		if (checked?.ok && anchor) {
			const e = checked.event
			say(`  CRE verify  ${e.isMatch ? 'MATCH' : 'MISMATCH'} reasons ${e.reasons}, run by the gate, RecordChecked tx ${checked.tx} read back from Robinhood Testnet`)
			// Every value below is the agent's own or decoded from the event. None is copied from the gate's answer.
			cre = {
				workflow: 'vet402-rwa-verify',
				anchor_tx: anchor.tx,
				anchor_record_url: anchor.recordUrl,
				verdict: e.isMatch ? 'MATCH' : 'MISMATCH',
				reason_bits: e.reasons,
				recomputed_facts_hash: e.recomputedFactsHash,
				anchored_facts_hash: e.anchoredFactsHash,
				receiver,
				mode: 'broadcast',
				verdict_tx: checked.tx,
			}
		} else {
			if (checked && !checked.ok) say(`  gate answer not used: ${checked.why.join('; ')}. The agent runs the CRE workflow itself`)
			cre = verifyAnchor(anchor, args, out)
		}
	} else {
		const bought = await buyRecord(getAddress(wallet), args, payer, out, { capAtomic: cap, perDecisionAtomic: perDecision })
		facts = bought.facts
		xFactsHash = bought.xFactsHash
		sourceUrl = bought.sourceUrl
		purchase = bought.purchase
		terms = bought.terms
		// 3. CRE re-verification of the newest anchor.
		cre = verifyAnchor(anchor, args, out)
	}
	writeFileSync(join(out, 'record.json'), `${JSON.stringify(facts, null, 2)}\n`)
	const record = recordInputs(facts, { source_url: sourceUrl, x_facts_hash: xFactsHash })
	say(`  record      ${record.method_version} as_of ${record.as_of} block ${record.as_of_block}, factsHash ${record.recomputed_facts_hash}`)

	// 4. Decide, write the trail, notarize it through CRE, keep the practice trade.
	const earlier = args.book ? loadTrails(join(REPO, args.book)) : []
	const venueCache = new Map<string, Venue['kind']>()
	const results = []
	for (const mv of todo) {
		const mf = await moveFacts(rpc, mv)
		const tokensMoved = movedTokens(facts, mv.transfers, mf.decimals, USDG)
		// Who the Stock Token came from, and the Chainlink feed's value at the block of the move.
		const leg = stockLegV2({ movement: mv, tokens_moved: tokensMoved } as DecisionInputsV2)
		const venue: Venue[] = []
		let price: DecisionInputsV2['price'] = null
		if (leg) {
			const others = [...new Set(mv.transfers.filter((t) => t.token.toLowerCase() === leg.token.toLowerCase() && t.direction === leg.direction).map((t) => (leg.direction === 'in' ? t.from : t.to)))]
			for (const a of others) venue.push(await venueOf(rpc, a, venueCache))
			const stock = (facts.tokens ?? []).find((k: any) => k.canonical === true && String(k.token).toLowerCase() === leg.token.toLowerCase() && k.feed)
			if (stock) price = priceAt(await feedSeries(rpc, leg.token, stock.symbol, stock.feed, mv.block - 6_000_000, mv.block), mv.block)
		}
		const inputs: DecisionInputsV2 = {
			wallet,
			movement: mv,
			terms,
			record,
			cre,
			decided_at: new Date().toISOString(),
			payer: payer.toLowerCase(),
			rules: policy.rules,
			move: { time: mf.time, signer: mf.signer },
			tokens_moved: tokensMoved,
			venue,
			price,
			limits: policy.limits,
			limits_keccak: policy.limitsKeccak,
			mandate: policy.mandate,
			book: bookAt(earlier, mf.time, mv.tx),
		}
		const trail: TrailV2 = buildTrailV2(inputs, purchase)
		earlier.push(trail)
		const hash = trailHash(trail)
		const label = `trail-${mv.block}-${mv.tx.slice(2, 10)}`
		say('')
		say(`  movement    ${mv.tx} block ${mv.block} at ${mf.time}`)
		for (const t of mv.transfers) say(`              ${t.direction === 'in' ? 'in ' : 'out'} ${t.token} ${t.amount_raw}`)
		for (const r of trail.decision.rule_results) say(`    ${r.ok ? 'OK  ' : 'FAIL'} ${r.id} ${r.detail}`)
		say(`  DECISION    ${trail.decision.tier} (${trail.decision.conclusion})${trail.decision.decisive.length ? ` (${trail.decision.decisive.join(', ')})` : ''}`)
		say(`  CARD        ${trail.card.headline}`)
		say(`              ${trail.card.happened}`)
		for (const w of trail.card.why) say(`              ${w}`)
		say(`              ${trail.card.so}`)
		say(`  trail hash  ${hash}`)
		const run = simulate<{ trailHash: string }>('trail-anchor', { trail }, { broadcast: args.broadcast, workDir: out, label })
		if (run.result.trailHash !== hash) throw new Error(`CRE hashed the trail as ${run.result.trailHash}, the agent as ${hash}`)
		say(`  CRE trail   rules re-run, movement checked${run.tx ? `, DecisionRecorded tx ${run.tx}` : ' (simulated, not broadcast)'}`)
		const envelope = {
			trail,
			trail_hash: hash,
			trail_tx: run.tx,
			trail_receiver: JSON.parse(readFileSync(join(REPO, 'trail-anchor/config.json'), 'utf8')).receiverAddress,
			network: run.tx ? 'robinhood-testnet (46630)' : 'simulated',
		}
		writeFileSync(join(out, `${label}.json`), `${JSON.stringify(envelope, null, 2)}\n`)
		appendFileSync(
			join(STATE_DIR, 'paper-trades.jsonl'),
			`${JSON.stringify({ decided_at: trail.decided_at, wallet, movement_tx: mv.tx, conclusion: trail.decision.conclusion, paper_trade: trail.decision.paper_trade, trail_hash: hash, trail_tx: run.tx })}\n`,
		)
		results.push(envelope)
	}
	const summary = results
		.map((e) => `${e.trail.inputs.movement.block} ${e.trail.inputs.movement.tx} ${e.trail.decision.conclusion} [${e.trail.decision.decisive.join(',')}] trail ${e.trail_hash} tx ${e.trail_tx ?? '-'}`)
		.join('\n')
	writeFileSync(join(out, 'summary.txt'), `${summary}\n`)
	say('')
	say(`  saved       ${relative(REPO, out)}/`)
	return results
}

if (import.meta.main) {
	main(process.argv.slice(2)).catch((e) => {
		console.error(String(e instanceof Error ? e.message : e).slice(0, 600))
		process.exit(1)
	})
}
