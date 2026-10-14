// payGate called directly, against a gate that runs in this process.
//
// The network is replaced: requests to the gate go to makeHandler (its facilitator and
// its CRE run are fakes), requests to Robinhood Chain's RPC are answered from a small
// table, and the two reads that confirm a verdict are functions the test supplies. The
// key is generated for the test and holds nothing. No request leaves the machine.
import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'bun:test'
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { encodeAbiParameters } from 'viem'
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts'
import anchorReceipt from '../../rwa-verify/fixtures/anchor-receipt.json'
import anchored from '../../rwa-verify/fixtures/anchored-record.json'
import { summarizeRecord } from '../../rwa-verify/verify'
import type { Rpc } from '../chain'
import { PAY_TO, USDG } from '../rules'
import { CapReached, RefusedTerms } from '../x402'
import { type ConfirmDeps, confirmVerdict, type GateOpts, type GateVerdict, isLocalGate, payGate, pinnedReceiver, RECORD_CHECKED_TOPIC } from './client'
import { makeHandler, WORKFLOW } from './server'
import { b64json, FACILITATOR_URL, paymentRequired } from './x402'

const REMOTE = `https://gate.example/v1/workflows/${WORKFLOW}`
const LOCAL = `http://127.0.0.1:4021/v1/workflows/${WORKFLOW}`
const MAINNET = 'https://rpc.mainnet.chain.robinhood.com'
const ANCHOR_TX = (anchored as any).anchor_tx.toLowerCase() as string
const FACTS_HASH = (anchored as any).facts_hash.toLowerCase() as string
const VERDICT_TX = `0x${'7e'.repeat(32)}`
const SETTLE_TX = `0x${'65'.repeat(32)}`
const RECEIVER = pinnedReceiver()
const OTHER = `0x${'12'.repeat(20)}`
const ZERO32 = `0x${'0'.repeat(64)}`
const pad32 = (h: string) => `0x${h.slice(2).padStart(64, '0')}`

const key = generatePrivateKey()
const account = privateKeyToAccount(key)
const dir = mkdtempSync(join(tmpdir(), 'gate-client-'))
const KEY_FILE = join(dir, 'test.key')
writeFileSync(KEY_FILE, key)

const MATCH: GateVerdict['result'] = { verdict: 'MATCH', reasonBits: 0, anchorTx: ANCHOR_TX, recomputedFactsHash: FACTS_HASH, anchoredFactsHash: FACTS_HASH }

/** The RecordChecked log RwaVerdictReceiver would emit for `r`. */
function recordChecked(r: GateVerdict['result'], from = RECEIVER) {
	return {
		address: from,
		topics: [RECORD_CHECKED_TOPIC, r.anchorTx, `0x${'a1'.repeat(32)}`, pad32(r.verdict === 'MATCH' ? '0x1' : '0x0')],
		data: encodeAbiParameters(
			[{ type: 'uint32' }, { type: 'bytes32' }, { type: 'bytes32' }, { type: 'uint64' }, { type: 'uint64' }, { type: 'bytes32' }, { type: 'bytes10' }, { type: 'address' }],
			[r.reasonBits, r.recomputedFactsHash as `0x${string}`, r.anchoredFactsHash as `0x${string}`, 1n, 2n, ZERO32 as `0x${string}`, '0x00000000000000000000', OTHER as `0x${string}`],
		),
	}
}

type World = {
	/** what the gate's workflow answers, and the tx it says it wrote */
	result: unknown
	verdictTx: string | null
	/** the receipt Robinhood Testnet holds for that tx */
	testnetReceipt: unknown
	testnetChainId: string
	/** the receipt Robinhood Chain holds for the anchor */
	mainnetReceipt: unknown
	workflowFails: boolean
	settle: unknown
	balance: bigint
	allowance: bigint
	/** what the gate asks for in its 402. Null: the gate's own terms. */
	terms: ((body: any) => void) | null
	firstStatus: number
}
let w: World
let gateRequests: { paid: boolean; body: string }[]
let facilitator: string[]
let runs: unknown[]
let said: string[]
let out: string
let ledger: string
const realFetch = globalThis.fetch

const fresh = (): World => ({
	result: MATCH,
	verdictTx: VERDICT_TX,
	testnetReceipt: { status: '0x1', logs: [recordChecked(MATCH)] },
	testnetChainId: '0xb626',
	mainnetReceipt: anchorReceipt,
	workflowFails: false,
	settle: { success: true, transaction: SETTLE_TX, network: 'eip155:4663', payer: account.address },
	balance: 1_000_000n,
	allowance: 1_000_000n,
	terms: null,
	firstStatus: 402,
})

const confirm = (): ConfirmDeps => ({
	receiver: RECEIVER,
	testnet: (async (method: string) => (method === 'eth_chainId' ? w.testnetChainId : method === 'eth_getTransactionReceipt' ? w.testnetReceipt : null)) as Rpc,
	mainnet: (async (method: string) => (method === 'eth_getTransactionReceipt' ? w.mainnetReceipt : null)) as Rpc,
})

beforeAll(() => {
	globalThis.fetch = (async (input: any, init?: any) => {
		const url = String(input?.url ?? input)
		if (url === REMOTE || url === LOCAL) {
			const headers = new Headers(init?.headers ?? {})
			const paid = headers.has('PAYMENT-SIGNATURE')
			gateRequests.push({ paid, body: String(init?.body ?? '') })
			if (!paid && w.firstStatus !== 402) return new Response('{}', { status: w.firstStatus })
			if (!paid && w.terms) {
				const body = paymentRequired(url) as any
				w.terms(body)
				return new Response(JSON.stringify(body), { status: 402, headers: { 'PAYMENT-REQUIRED': b64json(body) } })
			}
			return handler(new Request(url, { method: 'POST', headers, body: init?.body }))
		}
		if (url === MAINNET) {
			const call = JSON.parse(init.body)
			const data = String(call.params?.[0]?.data ?? '')
			const word = (n: bigint) => `0x${n.toString(16).padStart(64, '0')}`
			const result =
				call.method === 'eth_getCode'
					? '0x6080'
					: call.method === 'eth_call'
						? data.startsWith('0x70a08231')
							? word(w.balance)
							: word(w.allowance)
						: call.method === 'eth_blockNumber'
							? '0x53e7669'
							: call.method === 'eth_chainId'
								? '0x1237'
								: call.method === 'eth_getLogs'
									? []
									: null
			return new Response(JSON.stringify({ jsonrpc: '2.0', id: call.id, result }), { status: 200 })
		}
		return new Response('not mocked', { status: 599 })
	}) as typeof fetch
})
afterAll(() => {
	globalThis.fetch = realFetch
})

let handler: (r: Request) => Promise<Response>
beforeEach(() => {
	w = fresh()
	gateRequests = []
	facilitator = []
	runs = []
	said = []
	out = mkdtempSync(join(tmpdir(), 'gate-out-'))
	ledger = join(mkdtempSync(join(tmpdir(), 'gate-ledger-')), 'spend.json')
	handler = makeHandler({
		broadcast: true,
		fetchImpl: (async (url: string) => {
			const path = String(url).replace(FACILITATOR_URL, '')
			facilitator.push(path)
			return new Response(JSON.stringify(path === '/verify' ? { isValid: true, payer: account.address } : w.settle), { status: 200 })
		}) as unknown as typeof fetch,
		runWorkflow: (payload) => {
			runs.push(payload)
			if (w.workflowFails) throw new Error('cre exited 1')
			return { result: w.result, tx: w.verdictTx }
		},
	})
})

const opts = (over: Partial<GateOpts> = {}): GateOpts => ({
	pay: true,
	approve: false,
	payer: account.address,
	out,
	ledgerFile: ledger,
	keyFile: KEY_FILE,
	capAtomic: 1_000_000n,
	perDecisionAtomic: 10_000n,
	timeoutMs: 5_000,
	say: (s) => void said.push(s),
	confirm: confirm(),
	...over,
})
const INPUT = { tx: ANCHOR_TX, record: anchored }
const entries = () => (existsSync(ledger) ? JSON.parse(readFileSync(ledger, 'utf8')).entries : [])

describe('payGate, dry run', () => {
	test('reads the 402, builds the payment, signs nothing and sends nothing more', async () => {
		const g = await payGate(REMOTE, INPUT, opts({ pay: false, keyFile: join(dir, 'no-such.key') }))
		expect(g.verdict).toBeNull()
		expect(g.purchase).toMatchObject({ mode: 'dry-run', payment_tx: null, settlement: 'not-sent', resource: REMOTE, payer: account.address })
		expect(g.purchase.permit2_digest).toMatch(/^0x[0-9a-f]{64}$/)
		expect(g.terms).toMatchObject({ amount: '10000', network: 'eip155:4663' })
		expect(gateRequests).toEqual([{ paid: false, body: JSON.stringify(INPUT) }])
		expect(facilitator).toEqual([])
		expect(runs).toEqual([])
		expect(existsSync(ledger)).toBe(false)
		const saved = JSON.parse(readFileSync(join(out, 'x402-gate-dry-run.json'), 'utf8'))
		expect(saved.signed).toBe(false)
		expect(saved.permit2_typed_data.message.witness.to.toLowerCase()).toBe(PAY_TO)
		expect(saved.accepted.asset.toLowerCase()).toBe(USDG)
	})
})

describe('payGate, what it refuses before anything is signed', () => {
	const cases: [string, (body: any) => void][] = [
		['another payee', (b) => void (b.accepts[0].payTo = OTHER)],
		['another token', (b) => void (b.accepts[0].asset = OTHER)],
		['another chain', (b) => void (b.accepts[0].network = 'eip155:1')],
		['a higher price', (b) => void (b.accepts[0].amount = '20000')],
		['another transfer method', (b) => void (b.accepts[0].extra.assetTransferMethod = 'eip3009')],
	]
	for (const [name, change] of cases) {
		test(`a gate that asks for ${name}`, async () => {
			w.terms = change
			await expect(payGate(REMOTE, INPUT, opts())).rejects.toThrow(RefusedTerms)
			expect(gateRequests.filter((r) => r.paid)).toEqual([])
			expect(existsSync(ledger)).toBe(false)
		})
	}

	test('a price above the user\'s limit for one decision', async () => {
		await expect(payGate(REMOTE, INPUT, opts({ perDecisionAtomic: 9_999n }))).rejects.toThrow(RefusedTerms)
		expect(gateRequests.filter((r) => r.paid)).toEqual([])
	})

	test('a cap above the hard cap, a wallet at its cap, a balance below the price, a key that is not the payer\'s', async () => {
		await expect(payGate(REMOTE, INPUT, opts({ capAtomic: 1_000_001n }))).rejects.toThrow(/above the hard cap/)
		expect(gateRequests).toEqual([])
		writeFileSync(ledger, JSON.stringify({ payer: account.address, cap_atomic: '1000000', entries: [{ at: '', resource: '', amount_atomic: '995000', status: 'settled', tx: null }] }))
		await expect(payGate(REMOTE, INPUT, opts())).rejects.toThrow(CapReached)
		w.balance = 9_999n
		await expect(payGate(REMOTE, INPUT, opts({ ledgerFile: join(dir, 'other-ledger.json') }))).rejects.toThrow(/balance is below the price/)
		w.balance = 1_000_000n
		const stranger = join(dir, 'stranger.key')
		writeFileSync(stranger, generatePrivateKey())
		await expect(payGate(REMOTE, INPUT, opts({ ledgerFile: join(dir, 'other-ledger.json'), keyFile: stranger }))).rejects.toThrow(/key file and address file disagree/)
		expect(gateRequests.filter((r) => r.paid)).toEqual([])
		expect(existsSync(join(dir, 'other-ledger.json'))).toBe(false)
	})

	test('a gate that does not answer 402 first', async () => {
		w.firstStatus = 200
		await expect(payGate(REMOTE, INPUT, opts())).rejects.toThrow(/expected 402/)
		expect(gateRequests).toHaveLength(1)
	})

	test('an allowance that is short, without --approve', async () => {
		w.allowance = 0n
		await expect(payGate(REMOTE, INPUT, opts())).rejects.toThrow(/allowance is short/)
		expect(gateRequests.filter((r) => r.paid)).toEqual([])
		expect(entries()).toEqual([])
	})
})

describe('payGate, paying', () => {
	test('one signed request, one run, one settlement, one ledger entry, and the verdict is used once the agent has confirmed it', async () => {
		const g = await payGate(REMOTE, INPUT, opts())
		expect(gateRequests.map((r) => r.paid)).toEqual([false, true])
		expect(facilitator).toEqual(['/verify', '/settle'])
		expect(runs).toEqual([INPUT])
		expect(g.purchase).toMatchObject({ mode: 'paid', payment_tx: SETTLE_TX, settlement: 'settled' })
		expect(g.verdict?.result).toEqual(MATCH)
		expect(g.verdict?.verdict_tx).toBe(VERDICT_TX)
		expect(g.unconfirmed).toBeUndefined()
		expect(entries()).toHaveLength(1)
		expect(entries()[0]).toMatchObject({ resource: REMOTE, amount_atomic: '10000', status: 'settled', tx: SETTLE_TX })
		expect(said.some((s) => s.includes('CONFIRMED'))).toBe(true)
		const saved = JSON.parse(readFileSync(join(out, 'x402-gate-paid.json'), 'utf8'))
		expect(saved).toMatchObject({ signed: true, http_status: 200, x_payment_status: 'settled' })
	})

	test('a failed workflow: the gate answers 502, the call throws, and the ledger counts the attempt as unknown', async () => {
		w.workflowFails = true
		await expect(payGate(REMOTE, INPUT, opts())).rejects.toThrow(/the gate answered 502/)
		expect(facilitator).toEqual(['/verify'])
		expect(entries()).toHaveLength(1)
		expect(entries()[0].status).toBe('unknown')
	})

	test('a settlement the facilitator refuses: 402, the call throws, the ledger says failed and nothing is counted', async () => {
		w.settle = { success: false, errorReason: 'nonce_used', transaction: '' }
		await expect(payGate(REMOTE, INPUT, opts())).rejects.toThrow(/the gate answered 402/)
		expect(entries()[0]).toMatchObject({ status: 'failed', tx: null })
	})
})

describe('payGate, a gate that is not on this machine cannot have its word taken', () => {
	const lies: [string, () => void, RegExp][] = [
		['says MATCH, the chain event says MISMATCH', () => void (w.testnetReceipt = { status: '0x1', logs: [recordChecked({ ...MATCH, verdict: 'MISMATCH', reasonBits: 4 })] }), /holds no RecordChecked log/],
		['the event comes from another contract', () => void (w.testnetReceipt = { status: '0x1', logs: [recordChecked(MATCH, OTHER)] }), /holds no RecordChecked log/],
		['the event is about another anchor', () => void (w.testnetReceipt = { status: '0x1', logs: [recordChecked({ ...MATCH, anchorTx: `0x${'99'.repeat(32)}` })] }), /holds no RecordChecked log/],
		['the transaction failed', () => void (w.testnetReceipt = { status: '0x0', logs: [recordChecked(MATCH)] }), /not a successful transaction/],
		['the transaction does not exist', () => void (w.testnetReceipt = null), /not a successful transaction/],
		['it names no transaction', () => void (w.verdictTx = null), /named no transaction/],
		['the RPC it would be read from is another chain', () => void (w.testnetChainId = '0x1'), /not Robinhood Testnet/],
		['says MATCH with a hash RwaAnchor does not hold', () => {
			const lie = { ...MATCH, recomputedFactsHash: `0x${'ab'.repeat(32)}`, anchoredFactsHash: `0x${'ab'.repeat(32)}` }
			w.result = lie
			w.testnetReceipt = { status: '0x1', logs: [recordChecked(lie)] }
		}, /the agent hashes the record to/],
		['says MATCH, the anchor is not on Robinhood Chain', () => void (w.mainnetReceipt = null), /did not succeed on Robinhood Chain/],
		['says MATCH with reason bits set', () => void (w.result = { ...MATCH, reasonBits: 2 }), /contradict/],
		['answers about another anchor', () => void (w.result = { ...MATCH, anchorTx: `0x${'99'.repeat(32)}` }), /the agent asked about/],
		['answers something that is not a verdict', () => void (w.result = { ok: true }), /neither MATCH nor MISMATCH/],
	]
	for (const [name, lie, why] of lies) {
		test(`${name}: paid, recorded, and the verdict is not used`, async () => {
			lie()
			const g = await payGate(REMOTE, INPUT, opts())
			expect(g.verdict).toBeNull()
			expect(g.unconfirmed).toMatch(why)
			expect(g.purchase).toMatchObject({ mode: 'paid', payment_tx: SETTLE_TX, settlement: 'settled' })
			expect(entries()).toHaveLength(1)
			expect(entries()[0].status).toBe('settled')
			expect(said.some((s) => s.includes('UNCONFIRMED'))).toBe(true)
		})
	}

	test('the receiver is the one pinned in this repo, whatever the gate names', async () => {
		// The gate's answer names its own "receiver". The agent never reads that field.
		w.testnetReceipt = { status: '0x1', logs: [recordChecked(MATCH, OTHER)] }
		const g = await payGate(REMOTE, INPUT, opts({ confirm: { ...confirm(), receiver: RECEIVER } }))
		expect(g.verdict).toBeNull()
		expect(RECEIVER).toMatch(/^0x[0-9a-f]{40}$/)
	})

	test('a gate on this machine may answer without a transaction, and is still checked against Robinhood Chain', async () => {
		w.verdictTx = null
		const g = await payGate(LOCAL, INPUT, opts())
		expect(g.verdict?.result).toEqual(MATCH)
		expect(said.some((s) => s.includes('a gate on this machine'))).toBe(true)
		w = { ...fresh(), verdictTx: null, mainnetReceipt: null }
		const g2 = await payGate(LOCAL, INPUT, opts({ ledgerFile: join(mkdtempSync(join(tmpdir(), 'gate-ledger-')), 'spend.json') }))
		expect(g2.verdict).toBeNull()
		expect(isLocalGate(LOCAL)).toBe(true)
		expect(isLocalGate('http://localhost:4021/x')).toBe(true)
		expect(isLocalGate('http://[::1]:4021/x')).toBe(true)
		expect(isLocalGate(REMOTE)).toBe(false)
		expect(isLocalGate('http://localhost.example.com/x')).toBe(false)
		expect(isLocalGate('http://127.0.0.1.example.com/x')).toBe(false)
		expect(isLocalGate('not a url')).toBe(false)
	})
})

describe('confirmVerdict', () => {
	const answer = (result: unknown, verdict_tx: string | null = VERDICT_TX) => ({ workflow: 'vet402-rwa-verify', mode: 'broadcast', result, verdict_tx, receiver: OTHER })

	test('the fixture is what the checks assume: the record hashes to the anchored hash, and the anchor receipt holds it', () => {
		expect(summarizeRecord(anchored).factsHash).toBe(FACTS_HASH)
		expect(JSON.stringify(anchorReceipt)).toContain(FACTS_HASH.slice(2))
	})

	test('a true MATCH and a true MISMATCH are both confirmed', async () => {
		expect(await confirmVerdict(REMOTE, INPUT, answer(MATCH), confirm())).toBeNull()
		// one character of the record changed: the agent's own hash differs from the anchored one, like the gate's
		const changed = structuredClone(anchored) as any
		changed.facts.as_of = String(changed.facts.as_of).replace(/\d(?=\D*$)/, (d: string) => String((Number(d) + 1) % 10))
		const own = summarizeRecord(changed).factsHash
		const mismatch: GateVerdict['result'] = { verdict: 'MISMATCH', reasonBits: 8, anchorTx: ANCHOR_TX, recomputedFactsHash: own, anchoredFactsHash: FACTS_HASH }
		w.testnetReceipt = { status: '0x1', logs: [recordChecked(mismatch)] }
		expect(await confirmVerdict(REMOTE, { tx: ANCHOR_TX, record: changed }, answer(mismatch), confirm())).toBeNull()
		// the same MISMATCH presented as MATCH is not
		expect(await confirmVerdict(REMOTE, { tx: ANCHOR_TX, record: changed }, answer({ ...mismatch, verdict: 'MATCH', reasonBits: 0 }), confirm())).toMatch(/hashes that are not equal/)
	})

	test('with a record given by URL the agent has no hash of its own, and the two chain reads still hold', async () => {
		expect(await confirmVerdict(REMOTE, { tx: ANCHOR_TX, recordUrl: 'https://example.org/r.json' }, answer(MATCH), confirm())).toBeNull()
		const lie = { ...MATCH, recomputedFactsHash: `0x${'ab'.repeat(32)}`, anchoredFactsHash: `0x${'ab'.repeat(32)}` }
		w.testnetReceipt = { status: '0x1', logs: [recordChecked(lie)] }
		expect(await confirmVerdict(REMOTE, { tx: ANCHOR_TX, recordUrl: 'https://example.org/r.json' }, answer(lie), confirm())).toMatch(/RwaAnchor holds .* the gate says/)
	})

	test('a request without an anchor has nothing to confirm against', async () => {
		expect(await confirmVerdict(REMOTE, {}, answer(MATCH), confirm())).toMatch(/named no anchor/)
		expect(await confirmVerdict(REMOTE, INPUT, null, confirm())).toMatch(/not a verdict/)
		expect(await confirmVerdict(REMOTE, INPUT, answer({ ...MATCH, recomputedFactsHash: 'nope' }), confirm())).toMatch(/missing a hash/)
		expect(await confirmVerdict(REMOTE, INPUT, answer(MATCH, 'nope'), confirm())).toMatch(/not a transaction hash/)
	})
})
