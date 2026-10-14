// payGate, the agent's side of the gate, called directly. Nothing here reaches a network
// or a real wallet: the gate is makeHandler from server.ts with a fake facilitator and a
// fake CRE run, Robinhood Chain is a fake transport, the ledger is a temp file, and the
// only key is one made for the test and thrown away.
import { describe, expect, test } from 'bun:test'
import { existsSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { custom, decodeFunctionData, getAddress, keccak256, parseTransaction, verifyTypedData } from 'viem'
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts'
import type { Rpc } from '../chain'
import { erc20 } from '../evm'
import { TRANSFER_TOPIC } from '../movement'
import { LedgerMissing } from '../pay'
import { PAY_TO, USDG } from '../rules'
import { CapReached, CHAIN_ID, MAX_SPEND_ATOMIC, PERMIT2, PERMIT2_TYPES, RefusedTerms, X402_PERMIT2_PROXY } from '../x402'
import { type GateOpts, payGate } from './client'
import { makeHandler, WORKFLOW } from './server'
import { b64json, FACILITATOR_URL, paymentRequired } from './x402'

const GATE_URL = `http://gate.test/v1/workflows/${WORKFLOW}`
const ANCHOR_TX = `0x${'15'.repeat(32)}`
const VERDICT = { verdict: 'MATCH', reasonBits: 0, anchorTx: ANCHOR_TX, recomputedFactsHash: `0x${'9d'.repeat(32)}`, anchoredFactsHash: `0x${'9d'.repeat(32)}` }
const SETTLE_TX = `0x${'65'.repeat(32)}`
const INPUT = { tx: ANCHOR_TX }
const word = (n: bigint) => `0x${n.toString(16).padStart(64, '0')}`

type Sent = { url: string; headers: Record<string, string>; body: string }

/** A fake Robinhood Chain: what the payer holds, what it allowed Permit2, and the USDG logs it left. */
function fakeChain(over: { balance?: bigint; allowance?: bigint; transfers?: bigint[] } = {}) {
	const state = { balance: over.balance ?? 0n, allowance: over.allowance ?? 0n, transfers: over.transfers ?? [], calls: [] as string[], rawTxs: [] as `0x${string}`[] }
	const request = async ({ method, params }: { method: string; params?: any }) => {
		state.calls.push(method)
		if (method === 'eth_chainId') return `0x${CHAIN_ID.toString(16)}`
		if (method === 'eth_getCode') return '0x6080'
		if (method === 'eth_blockNumber') return '0x4fc5a00'
		if (method === 'eth_call') {
			const data = String(params[0].data)
			if (data.startsWith('0x70a08231')) return word(state.balance)
			if (data.startsWith('0xdd62ed3e')) return word(state.allowance)
			throw new Error(`unexpected eth_call ${data.slice(0, 10)}`)
		}
		// Only the approve path gets this far.
		if (method === 'eth_getTransactionCount') return '0x0'
		if (method === 'eth_estimateGas') return '0xea60'
		if (method === 'eth_gasPrice' || method === 'eth_maxPriorityFeePerGas') return '0x1'
		if (method === 'eth_getBlockByNumber') return { number: '0x4fc5a00', hash: `0x${'b1'.repeat(32)}`, timestamp: '0x6abc7b37', baseFeePerGas: '0x1', gasLimit: '0x1c9c380', gasUsed: '0x0', transactions: [] }
		if (method === 'eth_sendRawTransaction') {
			const raw = params[0] as `0x${string}`
			state.rawTxs.push(raw)
			const tx = parseTransaction(raw)
			const call = decodeFunctionData({ abi: erc20, data: tx.data as `0x${string}` })
			if (call.functionName === 'approve') state.allowance = call.args[1]
			return keccak256(raw)
		}
		if (method === 'eth_getTransactionByHash') return { hash: params[0], blockNumber: '0x4fc5a00', blockHash: `0x${'b1'.repeat(32)}`, nonce: '0x0', from: `0x${'00'.repeat(20)}`, to: USDG, value: '0x0', gas: '0xea60', input: '0x', transactionIndex: '0x0', type: '0x2' }
		if (method === 'eth_getTransactionReceipt')
			return { transactionHash: params[0], blockNumber: '0x4fc5a00', blockHash: `0x${'b1'.repeat(32)}`, status: '0x1', logs: [], cumulativeGasUsed: '0xea60', gasUsed: '0xea60', effectiveGasPrice: '0x2', transactionIndex: '0x0', type: '0x2', contractAddress: null, from: `0x${'00'.repeat(20)}`, to: USDG }
		throw new Error(`fake chain: ${method} is not mocked`)
	}
	const rpc: Rpc = async (method, params) => {
		state.calls.push(method)
		if (method !== 'eth_getLogs') throw new Error(`fake rpc: ${method} is not mocked`)
		const topic0 = (params[0] as any).topics[0]
		return topic0 === TRANSFER_TOPIC ? state.transfers.map((v) => ({ data: word(v) })) : []
	}
	return { state, transport: custom({ request }), rpc }
}

/** The real gate handler in front of a fake facilitator and a fake CRE run. */
function fakeGate(over: { verify?: unknown; settle?: unknown; failWorkflow?: boolean; answer?: (res: Response) => Response | Promise<Response> } = {}) {
	const sent: Sent[] = []
	const facilitator: string[] = []
	const runs: unknown[] = []
	const handler = makeHandler({
		broadcast: false,
		fetchImpl: (async (url: string) => {
			facilitator.push(String(url).replace(FACILITATOR_URL, ''))
			const body = String(url).endsWith('/verify') ? (over.verify ?? { isValid: true }) : (over.settle ?? { success: true, transaction: SETTLE_TX, network: 'eip155:4663' })
			return new Response(JSON.stringify(body), { status: 200 })
		}) as unknown as typeof fetch,
		runWorkflow: (payload) => {
			runs.push(payload)
			if (over.failWorkflow) throw new Error('cre exited 1')
			return { result: VERDICT, tx: null }
		},
	})
	const fetchImpl = (async (url: string, init: RequestInit) => {
		const headers: Record<string, string> = {}
		new Headers(init.headers ?? {}).forEach((v, k) => (headers[k] = v))
		sent.push({ url: String(url), headers, body: String(init.body) })
		const res = await handler(new Request(url, init))
		return headers['payment-signature'] && over.answer ? over.answer(res) : res
	}) as unknown as typeof fetch
	return { sent, facilitator, runs, fetchImpl }
}

/** A gate that answers the first request with terms of its own choosing. */
function gateAsking(change: (required: any) => void) {
	const sent: Sent[] = []
	const fetchImpl = (async (url: string, init: RequestInit) => {
		const headers: Record<string, string> = {}
		new Headers(init.headers ?? {}).forEach((v, k) => (headers[k] = v))
		sent.push({ url: String(url), headers, body: String(init.body) })
		const required = paymentRequired(GATE_URL) as any
		change(required)
		return new Response(JSON.stringify(required), { status: 402, headers: { 'PAYMENT-REQUIRED': b64json(required) } })
	}) as unknown as typeof fetch
	return { sent, fetchImpl }
}

/** A fresh folder, ledger path and throwaway key for one test. */
function setup(over: Partial<GateOpts> = {}) {
	const dir = mkdtempSync(join(tmpdir(), 'gate-client-'))
	const key = generatePrivateKey()
	const account = privateKeyToAccount(key)
	const keyFile = join(dir, 'throwaway.key')
	const said: string[] = []
	const opts: GateOpts = {
		pay: false,
		approve: false,
		payer: account.address,
		out: dir,
		ledgerFile: join(dir, 'spend.json'),
		keyFile,
		capAtomic: MAX_SPEND_ATOMIC,
		perDecisionAtomic: 10_000n,
		timeoutMs: 5_000,
		say: (s) => void said.push(s),
		...over,
	}
	return { dir, account, key, keyFile, opts, said, withKey: () => writeFileSync(keyFile, key) }
}

const signedRequests = (sent: Sent[]) => sent.filter((s) => s.headers['payment-signature'])
const ledgerOf = (file: string) => JSON.parse(readFileSync(file, 'utf8')) as { entries: { status: string; amount_atomic: string; tx: string | null; resource: string }[] }
const settledLedger = (payer: string, atomic: string) => JSON.stringify({ payer, cap_atomic: '1000000', entries: [{ at: '', resource: '', amount_atomic: atomic, status: 'settled', tx: null }] })

describe('payGate, dry run', () => {
	test('reads the 402, checks the terms and the cap, builds the payment, signs nothing and returns no verdict', async () => {
		const s = setup()
		const gate = fakeGate()
		const chain = fakeChain()
		const got = await payGate(GATE_URL, INPUT, s.opts, { fetchImpl: gate.fetchImpl, transport: chain.transport, rpc: chain.rpc })
		expect(got.verdict).toBeNull()
		expect(got.purchase).toMatchObject({ mode: 'dry-run', resource: GATE_URL, payer: s.account.address, payment_tx: null, settlement: 'not-sent', spent_before_atomic: '0', cap_atomic: '1000000' })
		expect(got.purchase.permit2_digest).toMatch(/^0x[0-9a-f]{64}$/)
		expect(got.terms).toMatchObject({ scheme: 'exact', network: 'eip155:4663', amount: '10000', assetTransferMethod: 'permit2' })
		expect(got.terms.payTo.toLowerCase()).toBe(PAY_TO)
		// one request left, the unpaid one, carrying the workflow input; the gate did nothing with it
		expect(gate.sent).toHaveLength(1)
		expect(gate.sent[0]).toMatchObject({ url: GATE_URL, body: JSON.stringify(INPUT) })
		expect(signedRequests(gate.sent)).toEqual([])
		expect(gate.facilitator).toEqual([])
		expect(gate.runs).toEqual([])
		// no key was needed, no spend was recorded, no lock was left
		expect(existsSync(s.keyFile)).toBe(false)
		expect(existsSync(s.opts.ledgerFile)).toBe(false)
		expect(readdirSync(s.dir)).toEqual(['x402-gate-dry-run.json'])
		const saved = JSON.parse(readFileSync(join(s.dir, 'x402-gate-dry-run.json'), 'utf8'))
		expect(saved).toMatchObject({ signed: false, resource: GATE_URL, request_body: INPUT, payer: s.account.address, cap_atomic: '1000000', spent_before_atomic: '0', permit2_digest: got.purchase.permit2_digest })
		expect(saved.signature).toBeUndefined()
		expect(saved.permit2_typed_data.message.spender).toBe(getAddress(X402_PERMIT2_PROXY))
		expect(saved.permit2_typed_data.message.witness.to).toBe(getAddress(PAY_TO))
		expect(saved.permit2_typed_data.message.permitted).toEqual({ token: getAddress(USDG), amount: '10000' })
		expect(s.said.some((l) => l.includes('DRY RUN'))).toBe(true)
	})

	test('a gate that does not answer 402 with PAYMENT-REQUIRED stops the run', async () => {
		const s = setup()
		const chain = fakeChain()
		const fetchImpl = (async () => new Response('{"verdict":"MATCH"}', { status: 200 })) as unknown as typeof fetch
		await expect(payGate(GATE_URL, INPUT, s.opts, { fetchImpl, transport: chain.transport, rpc: chain.rpc })).rejects.toThrow(/expected 402/)
		expect(chain.state.calls).toEqual([])
		expect(readdirSync(s.dir)).toEqual([])
	})
})

describe('payGate refuses before anything is signed', () => {
	test('a gate that asks for another payee, a higher price, another chain, token, method or protocol version', async () => {
		const stranger = privateKeyToAccount(generatePrivateKey()).address
		const cases: [string, (r: any) => void][] = [
			['another payee', (r) => void (r.accepts[0].payTo = stranger)],
			['a higher price', (r) => void (r.accepts[0].amount = '10001')],
			['a price of zero', (r) => void (r.accepts[0].amount = '0')],
			['another network', (r) => void (r.accepts[0].network = 'eip155:8453')],
			['another token', (r) => void (r.accepts[0].asset = stranger)],
			['another scheme', (r) => void (r.accepts[0].scheme = 'upto')],
			['another transfer method', (r) => void (r.accepts[0].extra.assetTransferMethod = 'eip3009')],
			['x402 version 1', (r) => void (r.x402Version = 1)],
			['no terms at all', (r) => void (r.accepts = [])],
		]
		for (const [name, change] of cases) {
			// --pay, with a funded wallet and its key at hand: the refusal is not for want of means.
			const s = setup({ pay: true, approve: true })
			s.withKey()
			const gate = gateAsking(change)
			const chain = fakeChain({ balance: 1_000_000n, allowance: 1_000_000n })
			await expect(payGate(GATE_URL, INPUT, s.opts, { fetchImpl: gate.fetchImpl, transport: chain.transport, rpc: chain.rpc }), name).rejects.toThrow(RefusedTerms)
			expect(gate.sent, name).toHaveLength(1)
			expect(signedRequests(gate.sent), name).toEqual([])
			expect(chain.state.calls, name).toEqual([])
			expect(existsSync(s.opts.ledgerFile), name).toBe(false)
			expect(readdirSync(s.dir), name).toEqual(['throwaway.key'])
		}
	})

	test('good terms offered next to bad ones: only the good ones are ever signed', async () => {
		const stranger = privateKeyToAccount(generatePrivateKey()).address
		const s = setup()
		const gate = gateAsking((r) => void r.accepts.unshift({ ...r.accepts[0], payTo: stranger, amount: '999999' }))
		const chain = fakeChain()
		const got = await payGate(GATE_URL, INPUT, s.opts, { fetchImpl: gate.fetchImpl, transport: chain.transport, rpc: chain.rpc })
		expect(got.terms.payTo.toLowerCase()).toBe(PAY_TO)
		expect(got.terms.amount).toBe('10000')
		const saved = JSON.parse(readFileSync(join(s.dir, 'x402-gate-dry-run.json'), 'utf8'))
		expect(saved.permit2_typed_data.message.witness.to).toBe(getAddress(PAY_TO))
	})

	test("a price above the user's limit for one decision", async () => {
		for (const pay of [false, true]) {
			const s = setup({ pay, perDecisionAtomic: 9_999n })
			s.withKey()
			const gate = fakeGate()
			const chain = fakeChain({ balance: 1_000_000n, allowance: 1_000_000n })
			await expect(payGate(GATE_URL, INPUT, s.opts, { fetchImpl: gate.fetchImpl, transport: chain.transport, rpc: chain.rpc })).rejects.toThrow(RefusedTerms)
			expect(signedRequests(gate.sent)).toEqual([])
			expect(chain.state.calls).toEqual([])
			expect(existsSync(s.opts.ledgerFile)).toBe(false)
			expect(readdirSync(s.dir)).toEqual(['throwaway.key'])
		}
	})

	test('a payment that would cross the cap: by the ledger, by the chain, or by a lower cap from the user', async () => {
		const run = async (pay: boolean, prepare: (s: ReturnType<typeof setup>) => Parameters<typeof fakeChain>[0], over: Partial<GateOpts> = {}) => {
			const s = setup({ pay, ...over })
			s.withKey()
			const chain = fakeChain({ balance: 1_000_000n, allowance: 1_000_000n, ...prepare(s) })
			const gate = fakeGate()
			await expect(payGate(GATE_URL, INPUT, s.opts, { fetchImpl: gate.fetchImpl, transport: chain.transport, rpc: chain.rpc })).rejects.toThrow(CapReached)
			expect(signedRequests(gate.sent)).toEqual([])
			expect(gate.facilitator).toEqual([])
			expect(existsSync(join(s.dir, 'x402-gate-dry-run.json'))).toBe(false)
			expect(existsSync(join(s.dir, 'x402-gate-paid.json'))).toBe(false)
			return s
		}
		for (const pay of [false, true]) {
			// the ledger says 0.995 USDG is spent: 0.995 + 0.01 > 1
			const before = settledLedger('', '995000')
			const s = await run(pay, (x) => (writeFileSync(x.opts.ledgerFile, settledLedger(x.account.address, '995000')), {}))
			expect(JSON.parse(readFileSync(s.opts.ledgerFile, 'utf8')).entries).toEqual(JSON.parse(before).entries)
			// the ledger says nothing was spent, the chain shows 0.995 USDG sent: the larger one counts
			await run(pay, (x) => (writeFileSync(x.opts.ledgerFile, settledLedger(x.account.address, '0')), { transfers: [995_000n] }))
			// the user's own cap is lower than the code's
			await run(pay, () => ({}), { capAtomic: 5_000n })
		}
		// exactly at the cap is allowed: 0.99 + 0.01 = 1
		const s = setup()
		writeFileSync(s.opts.ledgerFile, settledLedger(s.account.address, '990000'))
		const chain = fakeChain()
		const gate = fakeGate()
		expect((await payGate(GATE_URL, INPUT, s.opts, { fetchImpl: gate.fetchImpl, transport: chain.transport, rpc: chain.rpc })).purchase.spent_before_atomic).toBe('990000')
	})

	test('a cap above the hard cap is refused before the gate is even asked', async () => {
		const s = setup({ pay: true, capAtomic: MAX_SPEND_ATOMIC + 1n })
		s.withKey()
		const gate = fakeGate()
		const chain = fakeChain({ balance: 10_000_000n, allowance: 10_000_000n })
		await expect(payGate(GATE_URL, INPUT, s.opts, { fetchImpl: gate.fetchImpl, transport: chain.transport, rpc: chain.rpc })).rejects.toThrow(/hard cap/)
		expect(gate.sent).toEqual([])
		expect(chain.state.calls).toEqual([])
	})

	test('no ledger while the chain shows spending: a deleted ledger does not reset the cap', async () => {
		const s = setup({ pay: true })
		s.withKey()
		const gate = fakeGate()
		const chain = fakeChain({ balance: 1_000_000n, allowance: 1_000_000n, transfers: [10_000n] })
		await expect(payGate(GATE_URL, INPUT, s.opts, { fetchImpl: gate.fetchImpl, transport: chain.transport, rpc: chain.rpc })).rejects.toThrow(LedgerMissing)
		expect(signedRequests(gate.sent)).toEqual([])
	})

	test('--pay with too little USDG, a key that is not the payer, or a short allowance and no --approve', async () => {
		// balance below the price
		let s = setup({ pay: true })
		s.withKey()
		let gate = fakeGate()
		let chain = fakeChain({ balance: 9_999n, allowance: 10_000n })
		await expect(payGate(GATE_URL, INPUT, s.opts, { fetchImpl: gate.fetchImpl, transport: chain.transport, rpc: chain.rpc })).rejects.toThrow(/balance is below the price/)
		expect(signedRequests(gate.sent)).toEqual([])
		expect(existsSync(s.opts.ledgerFile)).toBe(false)

		// the key file holds another wallet's key
		s = setup({ pay: true })
		writeFileSync(s.keyFile, generatePrivateKey())
		gate = fakeGate()
		chain = fakeChain({ balance: 10_000n, allowance: 10_000n })
		await expect(payGate(GATE_URL, INPUT, s.opts, { fetchImpl: gate.fetchImpl, transport: chain.transport, rpc: chain.rpc })).rejects.toThrow(/disagree/)
		expect(signedRequests(gate.sent)).toEqual([])
		expect(existsSync(s.opts.ledgerFile)).toBe(false)

		// allowance short, --approve not given: no approve tx, no signature, no ledger entry, no lock left
		s = setup({ pay: true })
		s.withKey()
		gate = fakeGate()
		chain = fakeChain({ balance: 10_000n, allowance: 9_999n })
		await expect(payGate(GATE_URL, INPUT, s.opts, { fetchImpl: gate.fetchImpl, transport: chain.transport, rpc: chain.rpc })).rejects.toThrow(/allowance is short/)
		expect(signedRequests(gate.sent)).toEqual([])
		expect(chain.state.rawTxs).toEqual([])
		expect(existsSync(s.opts.ledgerFile)).toBe(false)
		expect(existsSync(`${s.opts.ledgerFile}.lock`)).toBe(false)
	})
})

describe('payGate --pay, against the gate with a throwaway key', () => {
	test('one signed payment for exactly the published terms; the gate verifies, runs, settles; the ledger shows it', async () => {
		const s = setup({ pay: true })
		s.withKey()
		const gate = fakeGate()
		const chain = fakeChain({ balance: 10_000n, allowance: 10_000n })
		const got = await payGate(GATE_URL, INPUT, s.opts, { fetchImpl: gate.fetchImpl, transport: chain.transport, rpc: chain.rpc })
		expect(got.purchase).toMatchObject({ mode: 'paid', resource: GATE_URL, payer: s.account.address, payment_tx: SETTLE_TX, settlement: 'settled', spent_before_atomic: '0', cap_atomic: '1000000' })
		expect(got.verdict).toMatchObject({ workflow: 'vet402-rwa-verify', mode: 'simulate', result: VERDICT, verdict_tx: null })
		expect(gate.facilitator).toEqual(['/verify', '/settle'])
		expect(gate.runs).toEqual([INPUT])
		// two requests: the unpaid one and one signed one. No approve tx, the allowance was enough.
		expect(gate.sent).toHaveLength(2)
		expect(chain.state.rawTxs).toEqual([])
		const [paid] = signedRequests(gate.sent)
		expect(paid.body).toBe(JSON.stringify(INPUT))
		const payload = JSON.parse(Buffer.from(paid.headers['payment-signature'], 'base64').toString('utf8'))
		const auth = payload.payload.permit2Authorization
		expect(payload.accepted).toMatchObject({ scheme: 'exact', network: 'eip155:4663', amount: '10000' })
		expect(auth.permitted).toEqual({ token: getAddress(USDG), amount: '10000' })
		expect(auth.spender).toBe(getAddress(X402_PERMIT2_PROXY))
		expect(auth.witness.to).toBe(getAddress(PAY_TO))
		expect(auth.from).toBe(s.account.address)
		// valid for at most 120 s from now
		const now = Math.floor(Date.now() / 1000)
		expect(Number(auth.deadline)).toBeLessThanOrEqual(now + 120)
		expect(Number(auth.deadline)).toBeGreaterThan(now + 100)
		// the signature is the payer's, over exactly these fields
		const message = { permitted: { token: auth.permitted.token, amount: BigInt(auth.permitted.amount) }, spender: auth.spender, nonce: BigInt(auth.nonce), deadline: BigInt(auth.deadline), witness: { to: auth.witness.to, validAfter: BigInt(auth.witness.validAfter) } }
		expect(await verifyTypedData({ address: s.account.address, domain: { name: 'Permit2', chainId: CHAIN_ID, verifyingContract: PERMIT2 }, types: PERMIT2_TYPES, primaryType: 'PermitWitnessTransferFrom', message, signature: payload.payload.signature })).toBe(true)
		// ledger: one settled entry for the gate; nothing left locked
		const ledger = ledgerOf(s.opts.ledgerFile)
		expect(ledger.entries).toHaveLength(1)
		expect(ledger.entries[0]).toMatchObject({ status: 'settled', amount_atomic: '10000', tx: SETTLE_TX, resource: GATE_URL })
		expect(existsSync(`${s.opts.ledgerFile}.lock`)).toBe(false)
		const saved = JSON.parse(readFileSync(join(s.dir, 'x402-gate-paid.json'), 'utf8'))
		expect(saved).toMatchObject({ signed: true, http_status: 200, x_payment_status: 'settled', permit2_digest: got.purchase.permit2_digest })
		expect(saved.settlement.transaction).toBe(SETTLE_TX)
		expect(JSON.stringify(saved)).not.toContain(s.key.slice(2))
		expect(existsSync(join(s.dir, 'x402-gate-dry-run.json'))).toBe(false)

		// a second run counts the first: spent_before is 0.01, and a new nonce is signed
		const again = await payGate(GATE_URL, INPUT, s.opts, { fetchImpl: gate.fetchImpl, transport: chain.transport, rpc: chain.rpc })
		expect(again.purchase.spent_before_atomic).toBe('10000')
		expect(ledgerOf(s.opts.ledgerFile).entries).toHaveLength(2)
		const nonces = signedRequests(gate.sent).map((r) => JSON.parse(Buffer.from(r.headers['payment-signature'], 'base64').toString('utf8')).payload.permit2Authorization.nonce)
		expect(new Set(nonces).size).toBe(2)
	})

	test('--approve with a short allowance approves only what is left under the cap, then pays', async () => {
		const s = setup({ pay: true, approve: true, capAtomic: 500_000n })
		s.withKey()
		writeFileSync(s.opts.ledgerFile, settledLedger(s.account.address, '120000'))
		const gate = fakeGate()
		const chain = fakeChain({ balance: 10_000n, allowance: 0n })
		const got = await payGate(GATE_URL, INPUT, s.opts, { fetchImpl: gate.fetchImpl, transport: chain.transport, rpc: chain.rpc })
		expect(got.purchase).toMatchObject({ mode: 'paid', settlement: 'settled', spent_before_atomic: '120000', cap_atomic: '500000' })
		expect(chain.state.rawTxs).toHaveLength(1)
		const tx = parseTransaction(chain.state.rawTxs[0])
		expect(tx.to?.toLowerCase()).toBe(USDG)
		expect(tx.chainId).toBe(CHAIN_ID)
		expect(tx.value ?? 0n).toBe(0n)
		const call = decodeFunctionData({ abi: erc20, data: tx.data as `0x${string}` })
		expect(call.functionName).toBe('approve')
		expect(call.args).toEqual([getAddress(PERMIT2), 380_000n])
		expect(signedRequests(gate.sent)).toHaveLength(1)
	}, 20_000)

	test('a gate whose workflow fails does not settle; the agent stops and counts the payment as possibly spent', async () => {
		const s = setup({ pay: true })
		s.withKey()
		const gate = fakeGate({ failWorkflow: true })
		const chain = fakeChain({ balance: 10_000n, allowance: 10_000n })
		await expect(payGate(GATE_URL, INPUT, s.opts, { fetchImpl: gate.fetchImpl, transport: chain.transport, rpc: chain.rpc })).rejects.toThrow(/the gate answered 502/)
		expect(gate.facilitator).toEqual(['/verify'])
		// The agent does not take the gate's word ("charged": false) for it: only a 402 with no tx is "nothing moved".
		expect(ledgerOf(s.opts.ledgerFile).entries[0]).toMatchObject({ status: 'unknown', amount_atomic: '10000', tx: null })
		expect(JSON.parse(readFileSync(join(s.dir, 'x402-gate-paid.json'), 'utf8'))).toMatchObject({ signed: true, http_status: 502 })
	})

	test('a settlement the facilitator says did not happen: 402, no verdict, and the ledger does not count it', async () => {
		const s = setup({ pay: true })
		s.withKey()
		const gate = fakeGate({ settle: { success: false, errorReason: 'insufficient_funds', transaction: '' } })
		const chain = fakeChain({ balance: 10_000n, allowance: 10_000n })
		await expect(payGate(GATE_URL, INPUT, s.opts, { fetchImpl: gate.fetchImpl, transport: chain.transport, rpc: chain.rpc })).rejects.toThrow(/the gate answered 402/)
		expect(ledgerOf(s.opts.ledgerFile).entries[0]).toMatchObject({ status: 'failed', tx: null })
		// so the next dry run still sees nothing spent
		const dry = await payGate(GATE_URL, INPUT, { ...s.opts, pay: false }, { fetchImpl: gate.fetchImpl, transport: chain.transport, rpc: chain.rpc })
		expect(dry.purchase.spent_before_atomic).toBe('0')
	})

	test('a gate that takes the payment and answers with something unreadable: paid, in the ledger, and no verdict', async () => {
		for (const junk of ['<html>oops</html>', '"MATCH"', '[]', 'null']) {
			const s = setup({ pay: true })
			s.withKey()
			const gate = fakeGate({ answer: (res) => new Response(junk, { status: 200, headers: res.headers }) })
			const chain = fakeChain({ balance: 10_000n, allowance: 10_000n })
			const got = await payGate(GATE_URL, INPUT, s.opts, { fetchImpl: gate.fetchImpl, transport: chain.transport, rpc: chain.rpc })
			expect(got.verdict).toBeNull()
			expect(got.purchase).toMatchObject({ mode: 'paid', payment_tx: SETTLE_TX, settlement: 'settled' })
			expect(ledgerOf(s.opts.ledgerFile).entries[0]).toMatchObject({ status: 'settled', tx: SETTLE_TX })
		}
	})

	test('a gate that never answers the paid request is given up on, and the payment counts as spent', async () => {
		const s = setup({ pay: true, timeoutMs: 50 })
		s.withKey()
		const gate = fakeGate()
		const chain = fakeChain({ balance: 10_000n, allowance: 10_000n })
		let aborted = false
		const fetchImpl = ((url: string, init: RequestInit) => {
			if (!new Headers(init.headers ?? {}).get('payment-signature')) return gate.fetchImpl(url, init)
			return new Promise((_resolve, reject) => {
				if (!init.signal) return reject(new Error('the paid request has no time limit'))
				init.signal.addEventListener('abort', () => ((aborted = true), reject(init.signal?.reason)))
			})
		}) as unknown as typeof fetch
		const started = Date.now()
		await expect(payGate(GATE_URL, INPUT, s.opts, { fetchImpl, transport: chain.transport, rpc: chain.rpc })).rejects.toMatchObject({ name: 'TimeoutError' })
		expect(aborted).toBe(true)
		expect(Date.now() - started).toBeLessThan(5000)
		expect(ledgerOf(s.opts.ledgerFile).entries).toHaveLength(1)
		expect(ledgerOf(s.opts.ledgerFile).entries[0]).toMatchObject({ status: 'unknown', amount_atomic: '10000', tx: null })
		expect(existsSync(`${s.opts.ledgerFile}.lock`)).toBe(false)
	})
})
