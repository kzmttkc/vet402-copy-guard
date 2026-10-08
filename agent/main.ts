// copy-guard: an agent that watches a Robinhood Chain wallet and, before it would
// copy a move, buys the wallet's vet402 /rwa record over x402, has Chainlink CRE
// re-verify the wallet's anchor, runs fixed rules, and records the decision as a
// paper trade with a reasoning trail whose hash goes onchain through CRE.
//
//   bun agent/main.ts [--wallet 0x…] [--from-block N] [--to-block N | --blocks N,N,…] [--max N]
//                     [--broadcast] [--pay [--approve]] [--out docs/agent/<name>]
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
import { createPublicClient, createWalletClient, getAddress, type Hex, http, keccak256, parseAbi } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { type AnchorRef, httpRpc, LOG_SPAN, movements, newestAnchor, RPC } from './chain'
import { type CreRun, REPO, simulate } from './cre'
import { recordInputs } from './record'
import { type CreInputs, type DecisionInputs, RULES, USDG } from './rules'
import { effectiveSpent, ledgerPath, payOnce, readChainSpend } from './pay'
import { buildTrail, type Purchase, type Trail, trailHash } from './trail'
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
		else throw new Error(`unknown argument ${k}`)
	}
	if (a.approve && !a.pay) throw new Error('--approve only goes with --pay')
	return a
}

const chain = {
	id: CHAIN_ID,
	name: 'Robinhood Chain',
	nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
	rpcUrls: { default: { http: [RPC] } },
} as const
const erc20 = parseAbi([
	'function balanceOf(address) view returns (uint256)',
	'function allowance(address,address) view returns (uint256)',
	'function approve(address,uint256) returns (bool)',
])

const say = (s: string) => console.log(s)

type Bought = { facts: any; xFactsHash: string; sourceUrl: string; purchase: Purchase; terms: ReturnType<typeof termsOf>; x402: unknown }

/** Step 2: buy the record (or, in a dry run, build the payment and read the same JSON from the free route). */
export async function buyRecord(wallet: string, args: Args, payer: string, out: string): Promise<Bought> {
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
	// The cap is checked before a payment is even built, in a dry run too.
	assertUnderCap(spent, amount)
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
		cap_atomic: MAX_SPEND_ATOMIC.toString(),
		permit2_typed_data: JSON.parse(JSON.stringify(built.typedData, (_k, v) => (typeof v === 'bigint' ? v.toString() : v))),
		permit2_digest: built.digest,
		signed: false,
	}
	say(`  402 terms   ${accept.scheme} ${accept.network} ${accept.amount} USDG atomic to ${accept.payTo} (${accept.extra?.assetTransferMethod})`)
	say(`  payer       ${payer}  USDG ${balance} atomic, Permit2 allowance ${allowance}, spent ${spent} of cap ${MAX_SPEND_ATOMIC}`)
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
				cap_atomic: MAX_SPEND_ATOMIC.toString(),
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
		approve: args.approve
			? async (remaining) => {
					// Approve only what is left under the cap, so Permit2 itself can never pull past it.
					const wallet = createWalletClient({ account, chain, transport: http(RPC) })
					const hash = await wallet.writeContract({ address: USDG as Hex, abi: erc20, functionName: 'approve', args: [PERMIT2, remaining] })
					await pub.waitForTransactionReceipt({ hash })
					say(`  approve     Permit2 ${remaining} USDG atomic (cap ${MAX_SPEND_ATOMIC} minus spent), tx ${hash}`)
				}
			: undefined,
		send: async () => {
			// Built again here so the validity window (at most 120 s) starts at signing time.
			const fresh = permit2TypedData(accept, payer, Math.floor(Date.now() / 1000), BigInt(`0x${randomBytes(32).toString('hex')}`))
			signedDigest = fresh.digest
			const signature = await account.signTypedData(fresh.typedData)
			paid = await fetch(paidUrl, { headers: { 'PAYMENT-SIGNATURE': paymentHeader(required, accept, fresh.authorization, signature) } })
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
			cap_atomic: MAX_SPEND_ATOMIC.toString(),
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
function verifyAnchor(anchor: AnchorRef | null, args: Args, out: string): CreInputs {
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
	const run: CreRun<VerifyResult> = simulate('rwa-verify', { tx: anchor.tx, recordUrl: anchor.recordUrl }, { broadcast: args.broadcast, workDir: out, label: 'cre-verify' })
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

export async function main(argv: string[]) {
	const args = parseArgs(argv)
	const wallet = args.wallet.toLowerCase()
	const payer = getAddress(readFileSync(ADDRESS_FILE, 'utf8').trim())
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

	say(`copy-guard ${RULES.id} v${RULES.version}  ${args.pay ? 'PAY' : 'DRY RUN'}${args.broadcast ? ' + testnet broadcast' : ''}`)
	const replay = args.blocks?.length ? args.blocks : null
	say(`  watching    ${getAddress(wallet)} on Robinhood Chain 4663, ${replay ? `replay of blocks ${replay.join(', ')}` : `blocks ${fromBlock}..${toBlock}`}`)

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

	// 2. Buy the record once per run; every decision in the run reads the same bytes.
	const bought = await buyRecord(getAddress(wallet), args, payer, out)
	writeFileSync(join(out, 'record.json'), `${JSON.stringify(bought.facts, null, 2)}\n`)
	const record = recordInputs(bought.facts, { source_url: bought.sourceUrl, x_facts_hash: bought.xFactsHash })
	say(`  record      ${record.method_version} as_of ${record.as_of} block ${record.as_of_block}, factsHash ${record.recomputed_facts_hash}`)

	// 3. CRE re-verification of the newest anchor.
	const anchor = await newestAnchor(rpc, wallet, latest, VET402_REPO_RAW)
	const cre = verifyAnchor(anchor, args, out)

	// 4. Decide, write the trail, notarize it through CRE, keep the paper trade.
	const rulesSourceKeccak = keccak256(readFileSync(join(REPO, 'agent/rules.ts')))
	const results = []
	for (const mv of todo) {
		const inputs: DecisionInputs = { wallet, movement: mv, terms: bought.terms, record, cre }
		const trail: Trail = buildTrail(inputs, bought.purchase, { decided_at: new Date().toISOString(), rules_source_keccak: rulesSourceKeccak })
		const hash = trailHash(trail)
		const label = `trail-${mv.block}-${mv.tx.slice(2, 10)}`
		say('')
		say(`  movement    ${mv.tx} block ${mv.block}`)
		for (const t of mv.transfers) say(`              ${t.direction === 'in' ? 'in ' : 'out'} ${t.token} ${t.amount_raw}`)
		for (const r of trail.decision.rule_results) say(`    ${r.ok ? 'OK  ' : 'FAIL'} ${r.id} ${r.detail}`)
		say(`  DECISION    ${trail.decision.conclusion}${trail.decision.decisive.length ? ` (${trail.decision.decisive.join(', ')})` : ''}`)
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
