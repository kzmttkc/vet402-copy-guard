// The agent's side of the gate: read the 402, check the terms, and (only with --pay)
// sign one Permit2 payment and get the CRE verdict back.
//
// Every guard of the record-buying path applies here unchanged, because this file calls
// the same functions: pickAccept (the only terms the agent signs), assertUnderCap,
// effectiveSpent (ledger and chain), payOnce (lock, pending entry before sending) and
// permit2TypedData (120 s validity, witness.to pinned to the vet402 wallet). A gate that
// asks for another payee, token, chain or price is refused before anything is signed.
//
// What the gate answers is not taken on its word. Before the verdict is used the agent
// reads, itself: the RecordChecked event in the transaction the gate names on Robinhood
// Testnet (it must come from the receiver pinned in this repo and carry exactly the
// verdict the gate returned), and the Anchored log of the anchor on Robinhood Chain (the
// hash the verdict calls "anchored" must be the one RwaAnchor holds). A verdict that
// cannot be confirmed this way is dropped and the agent runs the same workflow itself.
// Only a gate on this machine (localhost) may answer without a transaction.
import { randomBytes } from 'node:crypto'
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { createPublicClient, createWalletClient, type Hex, http, keccak256, toHex } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { anchoredLogs, RWA_ANCHOR_ADDRESS, type RpcReceipt, summarizeRecord } from '../../rwa-verify/verify'
import { httpRpc, RPC, type Rpc } from '../chain'
import { REPO } from '../cre'
import { chain, erc20 } from '../evm'
import { effectiveSpent, payOnce, readChainSpend } from '../pay'
import { type Terms, USDG } from '../rules'
import type { Purchase } from '../trail'
import { assertUnderCap, decodeRequired, loadLedger, MAX_SPEND_ATOMIC, PERMIT2, paymentHeader, permit2TypedData, pickAccept, RefusedTerms, termsOf, X402_PERMIT2_PROXY } from '../x402'

export type GateVerdict = {
	workflow: string
	mode: 'simulate' | 'broadcast'
	result: { verdict: 'MATCH' | 'MISMATCH'; reasonBits: number; anchorTx: string; recomputedFactsHash: string; anchoredFactsHash: string }
	verdict_tx: string | null
	receiver: string
}

/** `verdict` is null when nothing was paid, or when what the gate answered could not be confirmed (`unconfirmed` says why). */
export type GateExchange = { purchase: Purchase; terms: Terms; verdict: GateVerdict | null; unconfirmed?: string }

// ---------------------------------------------------------------- confirming what the gate answered

export const TESTNET_RPC = 'https://rpc.testnet.chain.robinhood.com'
const TESTNET_CHAIN_ID = 46630
/** keccak256 of the event RwaVerdictReceiver emits for one verdict. */
export const RECORD_CHECKED_TOPIC = keccak256(toHex('RecordChecked(bytes32,bytes32,bool,uint32,bytes32,bytes32,uint64,uint64,bytes32,bytes10,address)'))
const HASH32 = /^0x[0-9a-fA-F]{64}$/
const ZERO32 = `0x${'0'.repeat(64)}`

/** The receiver the agent trusts: the one in this repo's rwa-verify/config.json, never the one a gate names. */
export function pinnedReceiver(): string {
	return String(JSON.parse(readFileSync(join(REPO, 'rwa-verify/config.json'), 'utf8')).receiverAddress).toLowerCase()
}

/** A gate on this machine. Only such a gate may answer without a transaction. */
export function isLocalGate(gateUrl: string): boolean {
	try {
		const h = new URL(gateUrl).hostname.toLowerCase()
		return h === 'localhost' || h === '127.0.0.1' || h === '[::1]' || h === '::1'
	} catch {
		return false
	}
}

export type ConfirmDeps = { testnet: Rpc; mainnet: Rpc; receiver: string }

/**
 * Is the gate's answer the verdict that stands onchain? Returns null when it is, else the
 * reason it is not used.
 *
 *  1. The answer has the shape of a verdict, is about the anchor that was asked about, and
 *     is consistent with itself (MATCH means no reason bit and equal hashes).
 *  2. When the request carried the record inline, the agent hashes it itself: the
 *     recomputed hash must be the gate's.
 *  3. Robinhood Chain: the hash the verdict calls anchored is in an Anchored log of
 *     RwaAnchor in that anchor transaction.
 *  4. Robinhood Testnet: the transaction the gate names succeeded and holds a RecordChecked
 *     log of the pinned receiver with the same anchor, verdict, reason bits and hashes.
 *
 * The limit of 4: the receiver takes reports from CRE's simulation forwarder, which anyone
 * can call. So 4 proves that this verdict is committed in public where it can be disputed,
 * not that a DON produced it. 2 and 3 are the agent's own reads and do not depend on the gate.
 */
export async function confirmVerdict(gateUrl: string, input: unknown, v: unknown, deps: ConfirmDeps): Promise<string | null> {
	const asked = typeof (input as { tx?: unknown })?.tx === 'string' ? ((input as { tx: string }).tx.toLowerCase() as string) : null
	if (!asked) return 'the request named no anchor transaction'
	const r = (v as GateVerdict | null)?.result as GateVerdict['result'] | undefined
	if (!v || typeof v !== 'object' || !r || typeof r !== 'object') return 'the answer is not a verdict'
	if (r.verdict !== 'MATCH' && r.verdict !== 'MISMATCH') return 'the answer is neither MATCH nor MISMATCH'
	if (!Number.isInteger(r.reasonBits) || r.reasonBits < 0) return 'the answer has no reason bits'
	for (const h of [r.anchorTx, r.recomputedFactsHash, r.anchoredFactsHash]) if (typeof h !== 'string' || !HASH32.test(h)) return 'the answer is missing a hash'
	const recomputed = r.recomputedFactsHash.toLowerCase()
	const anchored = r.anchoredFactsHash.toLowerCase()
	if (r.anchorTx.toLowerCase() !== asked) return `the answer is about anchor ${r.anchorTx}, the agent asked about ${asked}`
	if ((r.verdict === 'MATCH') !== (r.reasonBits === 0)) return 'the verdict and its reason bits contradict each other'
	if (r.verdict === 'MATCH' && (recomputed !== anchored || anchored === ZERO32)) return 'MATCH with hashes that are not equal'

	const record = (input as { record?: unknown }).record
	if (record !== undefined) {
		// An unreadable record has no hash: the workflow reports zero for it, and so does the agent.
		const own = summarizeRecord(record)
		const ownHash = own.readable ? own.factsHash.toLowerCase() : ZERO32
		if (ownHash !== recomputed) return `the agent hashes the record to ${ownHash}, the gate says ${recomputed}`
	}

	const anchorReceipt = (await deps.mainnet('eth_getTransactionReceipt', [asked])) as RpcReceipt
	const onChain = anchoredLogs(anchorReceipt).filter((l) => l.address === RWA_ANCHOR_ADDRESS).map((l) => l.factsHash)
	if (r.verdict === 'MATCH' && anchorReceipt?.status !== '0x1') return 'MATCH, but the anchor transaction did not succeed on Robinhood Chain'
	if (anchored !== ZERO32 && !onChain.includes(anchored)) return `RwaAnchor holds ${onChain.join(', ') || 'no hash'} in that transaction, the gate says ${anchored}`

	const tx = (v as GateVerdict).verdict_tx
	if (tx === null || tx === undefined) return isLocalGate(gateUrl) ? null : 'the gate named no transaction for its verdict, and it is not on this machine'
	if (typeof tx !== 'string' || !HASH32.test(tx)) return 'verdict_tx is not a transaction hash'
	if (Number(BigInt((await deps.testnet('eth_chainId', [])) as string)) !== TESTNET_CHAIN_ID) return 'the testnet RPC is not Robinhood Testnet'
	const receipt = (await deps.testnet('eth_getTransactionReceipt', [tx])) as { status?: string; logs?: { address: string; topics: string[]; data: string }[] } | null
	if (!receipt || receipt.status !== '0x1') return `${tx} is not a successful transaction on Robinhood Testnet`
	const word = (data: string, i: number) => `0x${data.slice(2 + 64 * i, 2 + 64 * (i + 1))}`.toLowerCase()
	const found = (receipt.logs ?? []).some(
		(l) =>
			l.address.toLowerCase() === deps.receiver &&
			l.topics.length === 4 &&
			l.topics[0].toLowerCase() === RECORD_CHECKED_TOPIC &&
			l.topics[1].toLowerCase() === asked &&
			BigInt(l.topics[3]) === (r.verdict === 'MATCH' ? 1n : 0n) &&
			l.data.length >= 2 + 64 * 3 &&
			BigInt(word(l.data, 0)) === BigInt(r.reasonBits) &&
			word(l.data, 1) === recomputed &&
			word(l.data, 2) === anchored,
	)
	return found ? null : `${tx} holds no RecordChecked log of ${deps.receiver} with this anchor, verdict, reason bits and hashes`
}

export type GateOpts = {
	pay: boolean
	approve: boolean
	payer: string
	out: string
	ledgerFile: string
	keyFile: string
	/** The cap in force: the smaller of the code's 1 USDG and the user's limit. Never above MAX_SPEND_ATOMIC. */
	capAtomic: bigint
	/** The user's limit for one decision. */
	perDecisionAtomic: bigint
	timeoutMs: number
	say: (s: string) => void
	/** Test seam: how the agent reads the two chains to confirm the gate's answer. Default: the public RPCs and the pinned receiver. */
	confirm?: ConfirmDeps
}

export async function payGate(gateUrl: string, input: unknown, o: GateOpts): Promise<GateExchange> {
	if (o.capAtomic > MAX_SPEND_ATOMIC) throw new Error('the cap passed in is above the hard cap')
	const body = JSON.stringify(input)
	const post = (headers: Record<string, string> = {}, signal?: AbortSignal) => fetch(gateUrl, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body, signal })
	const first = await post()
	const reqHeader = first.headers.get('PAYMENT-REQUIRED')
	if (first.status !== 402 || !reqHeader) throw new Error(`expected 402 with PAYMENT-REQUIRED from the gate, got ${first.status}`)
	const required = decodeRequired(reqHeader)
	const accept = pickAccept(required)
	const terms = termsOf(accept)
	const amount = BigInt(accept.amount)
	if (amount > o.perDecisionAtomic) throw new RefusedTerms(`the gate asks ${amount} USDG atomic, above the user's limit of ${o.perDecisionAtomic} for one decision`)
	const pub = createPublicClient({ chain, transport: http(RPC) })
	for (const [name, addr] of [
		['Permit2', PERMIT2],
		['x402ExactPermit2Proxy', X402_PERMIT2_PROXY],
	] as const) {
		const code = await pub.getCode({ address: addr })
		if (!code || code === '0x') throw new Error(`${name} has no code on 4663; nothing signed`)
	}
	const [balance, allowance] = await Promise.all([
		pub.readContract({ address: USDG as Hex, abi: erc20, functionName: 'balanceOf', args: [o.payer as Hex] }),
		pub.readContract({ address: USDG as Hex, abi: erc20, functionName: 'allowance', args: [o.payer as Hex, PERMIT2] }),
	])
	const latest = Number(await pub.getBlockNumber())
	const onchain = await readChainSpend(httpRpc(RPC), o.payer, latest, allowance)
	const spent = effectiveSpent(o.ledgerFile, loadLedger(o.ledgerFile, o.payer), onchain.spentAtomic)
	assertUnderCap(spent, amount, o.capAtomic)
	const built = permit2TypedData(accept, o.payer, Math.floor(Date.now() / 1000), BigInt(`0x${randomBytes(32).toString('hex')}`))
	const x402 = {
		resource: gateUrl,
		request_body: input,
		status: first.status,
		payment_required: required,
		accepted: accept,
		payer: o.payer,
		usdg_balance_atomic: balance.toString(),
		permit2_allowance_atomic: allowance.toString(),
		chain_spent_atomic: onchain.spentAtomic.toString(),
		spent_before_atomic: spent.toString(),
		cap_atomic: o.capAtomic.toString(),
		permit2_typed_data: JSON.parse(JSON.stringify(built.typedData, (_k, v) => (typeof v === 'bigint' ? v.toString() : v))),
		permit2_digest: built.digest,
		signed: false,
	}
	o.say(`  gate 402    ${accept.scheme} ${accept.network} ${accept.amount} USDG atomic to ${accept.payTo} (${accept.extra?.assetTransferMethod}) for ${gateUrl}`)
	o.say(`  payer       ${o.payer}  USDG ${balance} atomic, Permit2 allowance ${allowance}, spent ${spent} of cap ${o.capAtomic}`)
	o.say(`  permit2     digest ${built.digest} (spender ${X402_PERMIT2_PROXY}, witness.to ${accept.payTo})`)
	const purchase = (over: Partial<Purchase>): Purchase => ({
		mode: 'dry-run',
		resource: gateUrl,
		payer: o.payer,
		payment_tx: null,
		settlement: 'not-sent',
		spent_before_atomic: spent.toString(),
		cap_atomic: o.capAtomic.toString(),
		permit2_digest: built.digest,
		...over,
	})
	if (!o.pay) {
		writeFileSync(join(o.out, 'x402-gate-dry-run.json'), `${JSON.stringify(x402, null, 2)}\n`)
		o.say('  DRY RUN     nothing signed, nothing sent to the gate; the agent runs the same CRE workflow itself')
		return { purchase: purchase({}), terms, verdict: null }
	}

	// --pay. Everything from the cap check to the last ledger write runs under the ledger lock.
	if (balance < amount) throw new Error('USDG balance is below the price; nothing sent')
	const account = privateKeyToAccount(readFileSync(o.keyFile, 'utf8').trim() as Hex)
	if (account.address.toLowerCase() !== o.payer.toLowerCase()) throw new Error('key file and address file disagree')
	let paid: Response | null = null
	let signedDigest = built.digest
	const result = await payOnce({
		ledgerFile: o.ledgerFile,
		payer: o.payer,
		amount,
		resource: gateUrl,
		chainSpentAtomic: onchain.spentAtomic,
		allowance,
		cap: o.capAtomic,
		approve: o.approve
			? async (remaining) => {
					const wallet = createWalletClient({ account, chain, transport: http(RPC) })
					const hash = await wallet.writeContract({ address: USDG as Hex, abi: erc20, functionName: 'approve', args: [PERMIT2, remaining] })
					await pub.waitForTransactionReceipt({ hash })
					o.say(`  approve     Permit2 ${remaining} USDG atomic (cap ${o.capAtomic} minus spent), tx ${hash}`)
				}
			: undefined,
		send: async () => {
			const fresh = permit2TypedData(accept, o.payer, Math.floor(Date.now() / 1000), BigInt(`0x${randomBytes(32).toString('hex')}`))
			signedDigest = fresh.digest
			const signature = await account.signTypedData(fresh.typedData)
			paid = await post({ 'PAYMENT-SIGNATURE': paymentHeader(required, accept, fresh.authorization, signature) }, AbortSignal.timeout(o.timeoutMs))
			const resp = paid.headers.get('PAYMENT-RESPONSE')
			return { httpStatus: paid.status, settlement: resp ? JSON.parse(Buffer.from(resp, 'base64').toString('utf8')) : null }
		},
	})
	const res = paid as unknown as Response
	const text = await res.text()
	writeFileSync(
		join(o.out, 'x402-gate-paid.json'),
		`${JSON.stringify({ ...x402, signed: true, permit2_digest: signedDigest, http_status: result.httpStatus, x_payment_status: res.headers.get('X-Payment-Status'), settlement: result.settlement, response: text.slice(0, 20_000) }, null, 2)}\n`,
	)
	if (result.httpStatus !== 200) throw new Error(`the gate answered ${result.httpStatus} (${result.outcome.status}); see x402-gate-paid.json`)
	o.say(`  PAID        ${amount} USDG atomic to the gate's payee, settlement ${result.outcome.status} tx ${result.outcome.tx}`)
	const paidFor = purchase({ mode: 'paid', payment_tx: result.outcome.tx, settlement: result.outcome.status === 'settled' ? 'settled' : 'unknown', permit2_digest: signedDigest })

	// The payment is done and recorded. What follows only decides whether the gate's answer is used.
	let verdict: GateVerdict | null = null
	let unconfirmed: string | null
	try {
		const answered = JSON.parse(text) as unknown
		unconfirmed = await confirmVerdict(gateUrl, input, answered, o.confirm ?? { testnet: httpRpc(TESTNET_RPC), mainnet: httpRpc(RPC), receiver: pinnedReceiver() })
		if (unconfirmed === null) verdict = answered as GateVerdict
	} catch (e) {
		unconfirmed = `could not be checked (${String(e instanceof Error ? e.message : e).slice(0, 160)})`
	}
	if (unconfirmed !== null) {
		o.say(`  UNCONFIRMED the gate's verdict is not used: ${unconfirmed}`)
		return { purchase: paidFor, terms, verdict: null, unconfirmed }
	}
	o.say(`  CONFIRMED   the gate's verdict against Robinhood Chain${verdict?.verdict_tx ? ` and RecordChecked in ${verdict.verdict_tx} on Robinhood Testnet` : ' (a gate on this machine, nothing broadcast)'}`)
	return { purchase: paidFor, terms, verdict }
}
