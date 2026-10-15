// The agent's side of the gate: read the 402, check the terms, and (only with --pay)
// sign one Permit2 payment and get the CRE verdict back.
//
// Every guard of the record-buying path applies here unchanged, because this file calls
// the same functions: pickAccept (the only terms the agent signs), assertUnderCap,
// effectiveSpent (ledger and chain), payOnce (lock, pending entry before sending) and
// permit2TypedData (120 s validity, witness.to pinned to the vet402 wallet). A gate that
// asks for another payee, token, chain or price is refused before anything is signed.
import { randomBytes } from 'node:crypto'
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { createPublicClient, createWalletClient, type Hex, http, type Transport } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { httpRpc, RPC, type Rpc } from '../chain'
import { chain, erc20 } from '../evm'
import { effectiveSpent, payOnce, readChainSpend } from '../pay'
import { type Terms, USDG } from '../rules'
import type { Purchase } from '../trail'
import { assertUnderCap, decodeRequired, loadLedger, MAX_SPEND_ATOMIC, PERMIT2, paymentHeader, permit2TypedData, pickAccept, RefusedTerms, termsOf, X402_PERMIT2_PROXY } from '../x402'
import { guardCheck, vet402SpendGuard } from '../spend-guard'

export type GateVerdict = {
	workflow: string
	mode: 'simulate' | 'broadcast'
	result: { verdict: 'MATCH' | 'MISMATCH'; reasonBits: number; anchorTx: string; recomputedFactsHash: string; anchoredFactsHash: string }
	verdict_tx: string | null
	receiver: string
}

export type GateExchange = { purchase: Purchase; terms: Terms; verdict: GateVerdict | null }

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
}

/**
 * What payGate reaches the outside world through. Left out, each one is what it always was:
 * the global fetch and the public Robinhood Chain RPC. The tests pass fakes, so they run
 * the whole function, signing included, without a network.
 */
export type GateClientDeps = {
	/** Sends the two requests to the gate. */
	fetchImpl?: typeof fetch
	/** viem transport for the reads on Robinhood Chain (code, balance, allowance, block) and the approve tx. */
	transport?: Transport
	/** Raw JSON-RPC for the log reads behind the chain floor (readChainSpend). */
	rpc?: Rpc
}

export async function payGate(gateUrl: string, input: unknown, o: GateOpts, deps: GateClientDeps = {}): Promise<GateExchange> {
	if (o.capAtomic > MAX_SPEND_ATOMIC) throw new Error('the cap passed in is above the hard cap')
	const fetchImpl = deps.fetchImpl ?? fetch
	const transport = deps.transport ?? http(RPC)
	const body = JSON.stringify(input)
	const post = (headers: Record<string, string> = {}, signal?: AbortSignal) => fetchImpl(gateUrl, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body, signal })
	const first = await post()
	const reqHeader = first.headers.get('PAYMENT-REQUIRED')
	if (first.status !== 402 || !reqHeader) throw new Error(`expected 402 with PAYMENT-REQUIRED from the gate, got ${first.status}`)
	const required = decodeRequired(reqHeader)
	const accept = pickAccept(required)
	const terms = termsOf(accept)
	const amount = BigInt(accept.amount)
	if (amount > o.perDecisionAtomic) throw new RefusedTerms(`the gate asks ${amount} USDG atomic, above the user's limit of ${o.perDecisionAtomic} for one decision`)
	const pub = createPublicClient({ chain, transport })
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
	const onchain = await readChainSpend(deps.rpc ?? httpRpc(RPC), o.payer, latest, allowance)
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
		guard: guardCheck(vet402SpendGuard(o.perDecisionAtomic, o.capAtomic), accept.payTo),
		ledgerFile: o.ledgerFile,
		payer: o.payer,
		amount,
		resource: gateUrl,
		chainSpentAtomic: onchain.spentAtomic,
		allowance,
		cap: o.capAtomic,
		approve: o.approve
			? async (remaining) => {
					const wallet = createWalletClient({ account, chain, transport })
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
	return {
		purchase: purchase({ mode: 'paid', payment_tx: result.outcome.tx, settlement: result.outcome.status === 'settled' ? 'settled' : 'unknown', permit2_digest: signedDigest }),
		terms,
		verdict: parseVerdict(text),
	}
}

/**
 * The gate's answer, or null when it is not a JSON object. The payment is already made and
 * in the ledger at this point, so an unreadable answer must not stop the run: the caller
 * treats null as "no verdict from the gate" and runs the CRE workflow itself. Whatever
 * comes back here is still only the gate's claim (see verdict.ts).
 */
function parseVerdict(text: string): GateVerdict | null {
	try {
		const v = JSON.parse(text)
		return v && typeof v === 'object' && !Array.isArray(v) ? (v as GateVerdict) : null
	} catch {
		return null
	}
}
