// The trail workflow in the CRE SDK's test runtime. The RPC answers with the
// real logs of the movement (agent/fixtures), the EVM write is captured and decoded.
import { describe, expect } from 'bun:test'
import { getNetwork, TxStatus } from '@chainlink/cre-sdk'
import { EvmMock, HttpActionsMock, newTestRuntime, test } from '@chainlink/cre-sdk/test'
import { decodeAbiParameters } from 'viem'
import r73953009 from '../agent/fixtures/receipt-73953009.json'
import r68837431 from '../agent/fixtures/receipt-68837431.json'
import { DRY_PURCHASE, FAKE_NVDA, inputs, QQQ_BUY } from '../agent/test-helpers'
import { buildTrail, type Trail, trailHash } from '../agent/trail'
import { fromUtf8, utf8 } from '../rwa-verify/verify'
import config from './config.json'
import { merkleRoot } from '../agent/ledger'
import { type Config, initWorkflow, LEDGER_REPORT_ABI, onHttpTrigger, REPORT_ABI } from './workflow'

const b64 = (s: string) => Buffer.from(utf8(s)).toString('base64')
const meta = { decided_at: '2026-10-09T06:00:00.000Z', rules_source_keccak: `0x${'cd'.repeat(32)}` }
const RECEIPTS: Record<number, any> = { 73953009: r73953009, 68837431: r68837431 }

type Seen = { rpc: string[]; reports: string[] }

function wire(opts: { chainId?: string; paymentReceipt?: unknown } = {}): Seen {
	const seen: Seen = { rpc: [], reports: [] }
	const http = HttpActionsMock.testInstance()
	http.sendRequest = (req) => {
		if (req.url !== config.robinhoodRpc) return { statusCode: 404, body: '' }
		const call = JSON.parse(fromUtf8(req.body))
		seen.rpc.push(call.method)
		let result: unknown = null
		if (call.method === 'eth_chainId') result = opts.chainId ?? '0x1237'
		if (call.method === 'eth_getLogs') {
			const f = call.params[0]
			const block = Number(BigInt(f.fromBlock))
			const logs = (RECEIPTS[block]?.logs ?? []) as any[]
			result = logs.filter(
				(l) =>
					l.topics[0] === f.topics[0] &&
					(f.topics[1] == null || l.topics[1] === f.topics[1]) &&
					(f.topics[2] == null || l.topics[2] === f.topics[2]),
			)
		}
		if (call.method === 'eth_getTransactionReceipt') result = opts.paymentReceipt ?? null
		return { statusCode: 200, body: b64(JSON.stringify({ jsonrpc: '2.0', id: 1, result })) }
	}
	const net = getNetwork({ chainFamily: 'evm', chainSelectorName: config.chainSelectorName, isTestnet: true })
	if (!net) throw new Error('robinhood-testnet not in the SDK chain list')
	const evm = EvmMock.testInstance(net.chainSelector.selector)
	evm.writeReport = (input) => {
		seen.reports.push(`0x${Buffer.from(input.report!.rawReport).toString('hex')}`)
		return { txStatus: TxStatus.SUCCESS, txHash: new Uint8Array(32).fill(7) }
	}
	return seen
}

function decodeReport(raw: string) {
	const payload = `0x${raw.slice(2 + 109 * 2)}` as `0x${string}`
	const [trailHash, subject, conclusion, recordFactsHash, movementTx, verdictTx, paymentTx, rulesVersion] = decodeAbiParameters(REPORT_ABI, payload)
	return { trailHash, subject, conclusion, recordFactsHash, movementTx, verdictTx, paymentTx, rulesVersion }
}

const run = (trail: Trail) => {
	const runtime = newTestRuntime<Config>(null, undefined, config as Config)
	const out = onHttpTrigger(runtime as any, { input: utf8(JSON.stringify({ trail })) } as any)
	return { out: JSON.parse(out), logs: runtime.getLogs().join('\n') }
}

describe('trail-anchor onHttpTrigger', () => {
	test('a fake NVDA decision: rules re-run, movement found on chain, hash written', () => {
		const seen = wire()
		const trail = buildTrail(inputs(FAKE_NVDA), DRY_PURCHASE, meta)
		const { out, logs } = run(trail)
		expect(out.conclusion).toBe('DO_NOT_COPY')
		expect(out.trailHash).toBe(trailHash(trail))
		expect(seen.rpc).toEqual(['eth_chainId', 'eth_getLogs', 'eth_getLogs'])
		const r = decodeReport(seen.reports[0])
		expect(r.trailHash).toBe(trailHash(trail) as `0x${string}`)
		expect(r.conclusion).toBe(1)
		expect(r.movementTx).toBe(FAKE_NVDA.tx as `0x${string}`)
		expect(r.subject).toBe('0xa158baaf573f2b072b47acaa019ef60de680571a8a2a6ad234faf0e8a3d3bfc5')
		expect(r.paymentTx).toBe(`0x${'0'.repeat(64)}`)
		expect(r.rulesVersion).toBe(1)
		expect(logs).toContain('payment: dry run, nothing paid')
	})

	test('a trail whose conclusion was edited is refused and nothing is written', () => {
		const seen = wire()
		const trail = buildTrail(inputs(QQQ_BUY), DRY_PURCHASE, meta)
		trail.decision.conclusion = 'COPY'
		expect(() => run(trail)).toThrow(/does not follow/)
		expect(seen.reports).toHaveLength(0)
	})

	test('a trail that lists a transfer the chain does not have is refused', () => {
		const seen = wire()
		const mv = { ...QQQ_BUY, transfers: QQQ_BUY.transfers.slice(1) }
		const trail = buildTrail(inputs(mv), DRY_PURCHASE, meta)
		expect(() => run(trail)).toThrow(/movement is not what the chain shows/)
		expect(seen.reports).toHaveLength(0)
	})

	test('a paid trail whose settlement tx shows no payment is refused', () => {
		const seen = wire({ paymentReceipt: { status: '0x1', logs: [] } })
		const trail = buildTrail(inputs(FAKE_NVDA), { ...DRY_PURCHASE, mode: 'paid', payment_tx: `0x${'1'.repeat(64)}`, settlement: 'settled' }, meta)
		expect(() => run(trail)).toThrow(/payment is not what the chain shows/)
		expect(seen.reports).toHaveLength(0)
	})

	test('a paid trail with the USDG transfer on chain is written with its payment tx', () => {
		const payer = DRY_PURCHASE.payer.toLowerCase().slice(2)
		const seen = wire({
			paymentReceipt: {
				status: '0x1',
				logs: [
					{
						address: '0x5fc5360d0400a0fd4f2af552add042d716f1d168',
						topics: [
							'0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef',
							`0x${'0'.repeat(24)}${payer}`,
							'0x000000000000000000000000973cd8a91a771c2c04c6036888f8175d6b4f6227',
						],
						data: `0x${(10000).toString(16).padStart(64, '0')}`,
					},
				],
			},
		})
		const tx = `0x${'1'.repeat(64)}`
		const trail = buildTrail(inputs(FAKE_NVDA), { ...DRY_PURCHASE, mode: 'paid', payment_tx: tx, settlement: 'settled' }, meta)
		run(trail)
		expect(decodeReport(seen.reports[0]).paymentTx).toBe(tx as `0x${string}`)
	})

	test('an RPC that is not Robinhood Chain is refused', () => {
		const seen = wire({ chainId: '0x2105' })
		expect(() => run(buildTrail(inputs(FAKE_NVDA), DRY_PURCHASE, meta))).toThrow(/not Robinhood Chain/)
		expect(seen.reports).toHaveLength(0)
	})
})

describe('initWorkflow', () => {
	test('registers one HTTP-triggered handler', () => {
		const handlers = initWorkflow(config as Config)
		expect(handlers).toHaveLength(1)
		expect(handlers[0].fn).toBe(onHttpTrigger)
	})

	test('a ledger payload: the root is recomputed from the leaves and written once; another root is refused', () => {
		const seen = wire()
		const leaves = ['FULL', 'REDUCED', 'NONE', 'NONE', 'NONE'].map((tier, i) => ({ leaf: `0x${String(i + 1).repeat(64)}`, tier }))
		const ledger = { leaves, mandate_keccak: `0x${'a'.repeat(64)}`, limits_keccak: `0x${'b'.repeat(64)}`, rules: { id: 'copy-guard', version: 2 }, mark_block: 87947981 }
		const runtime = newTestRuntime<Config>(null, undefined, { ...(config as Config), ledgerReceiverAddress: '0x000000000000000000000000000000000000dEaD' })
		const root = merkleRoot(leaves.map((l) => l.leaf))
		const out = JSON.parse(onHttpTrigger(runtime as any, { input: utf8(JSON.stringify({ ledger: { ...ledger, root } })) } as any))
		expect(out).toMatchObject({ root, decisions: 5, full: 1, reduced: 1, none: 3 })
		expect(seen.reports).toHaveLength(1)
		const [r, m, l, , decisions, full, reduced, none, mark] = decodeAbiParameters(LEDGER_REPORT_ABI, `0x${seen.reports[0].slice(2 + 109 * 2)}` as `0x${string}`)
		expect([r, m, l, decisions, full, reduced, none, mark]).toEqual([root as `0x${string}`, ledger.mandate_keccak as `0x${string}`, ledger.limits_keccak as `0x${string}`, 5, 1, 1, 3, 87947981n])
		expect(() => onHttpTrigger(runtime as any, { input: utf8(JSON.stringify({ ledger: { ...ledger, root: `0x${'f'.repeat(64)}` } })) } as any)).toThrow(/ledger refused/)
		expect(seen.reports).toHaveLength(1)
	})
})
