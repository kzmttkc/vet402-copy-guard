// Runs the whole HTTP-trigger handler in the CRE SDK's test runtime. HTTP and
// EVM are the SDK's capability mocks, fed with the real responses saved in
// fixtures/. The report the workflow writes is decoded and checked.
import { describe, expect } from 'bun:test'
import { getNetwork, TxStatus } from '@chainlink/cre-sdk'
import { EvmMock, HttpActionsMock, newTestRuntime, test } from '@chainlink/cre-sdk/test'
import { decodeAbiParameters } from 'viem'
import anchored from './fixtures/anchored-record.json'
import receipt from './fixtures/anchor-receipt.json'
import code from './fixtures/rwaanchor-code.json'
import live from './fixtures/live-facts-2026-10-08.json'
import liveHeaders from './fixtures/live-facts-2026-10-08.headers.json'
import mismatchPayload from './payloads/mismatch-one-char.json'
import config from './config.json'
import { fromUtf8, Reason, utf8 } from './verify'
import { type Config, initWorkflow, onHttpTrigger, REPORT_ABI } from './workflow'

const b64 = (s: string) => Buffer.from(utf8(s)).toString('base64')

type Seen = { urls: string[]; rpc: string[]; reports: string[]; receivers: string[] }

function wire(opts: { recordBody?: string; liveStatus?: number } = {}): Seen {
	const seen: Seen = { urls: [], rpc: [], reports: [], receivers: [] }
	const http = HttpActionsMock.testInstance()
	http.sendRequest = (req) => {
		seen.urls.push(req.url)
		if (req.url.startsWith('https://vet402.com/')) {
			return {
				statusCode: opts.liveStatus ?? 200,
				headers: { 'X-Facts-Hash': liveHeaders['x-facts-hash'] },
				body: b64(JSON.stringify(live)),
			}
		}
		if (req.url === config.recordUrl) {
			return { statusCode: 200, body: b64(opts.recordBody ?? JSON.stringify(anchored)) }
		}
		if (req.url === config.robinhoodRpc) {
			const call = JSON.parse(fromUtf8(req.body))
			seen.rpc.push(call.method)
			const result =
				call.method === 'eth_chainId'
					? '0x1237'
					: call.method === 'eth_getTransactionReceipt'
						? call.params[0] === anchored.anchor_tx
							? receipt
							: null
						: code.code
			return { statusCode: 200, body: b64(JSON.stringify({ jsonrpc: '2.0', id: 1, result })) }
		}
		return { statusCode: 404, body: '' }
	}
	const net = getNetwork({ chainFamily: 'evm', chainSelectorName: config.chainSelectorName, isTestnet: true })
	if (!net) throw new Error('robinhood-testnet not in the SDK chain list')
	const evm = EvmMock.testInstance(net.chainSelector.selector)
	evm.writeReport = (input) => {
		seen.receivers.push(Buffer.from(input.receiver).toString('hex'))
		seen.reports.push(`0x${Buffer.from(input.report!.rawReport).toString('hex')}`)
		return { txStatus: TxStatus.SUCCESS, txHash: new Uint8Array(32) }
	}
	return seen
}

/** rawReport = 109 bytes of forwarder metadata + the workflow's ABI payload. */
function decodeReport(raw: string) {
	const payload = `0x${raw.slice(2 + 109 * 2)}` as `0x${string}`
	const [anchorTx, subject, isMatch, reasons, recomputed, anchoredHash, asOf, block] = decodeAbiParameters(REPORT_ABI, payload)
	return { anchorTx, subject, isMatch, reasons, recomputed, anchoredHash, asOf, block }
}

const run = (payload: object) => {
	const runtime = newTestRuntime<Config>(null, undefined, config as Config)
	const out = onHttpTrigger(runtime as any, { input: utf8(JSON.stringify(payload)) } as any)
	return { out: JSON.parse(out), logs: runtime.getLogs().join('\n') }
}

describe('onHttpTrigger', () => {
	test('MATCH: the anchored record from the pinned URL', () => {
		const seen = wire()
		const { out, logs } = run({ tx: anchored.anchor_tx })
		expect(out.verdict).toBe('MATCH')
		expect(out.live.xFactsHashMatchesBody).toBe(true)
		expect(seen.rpc).toEqual(['eth_chainId', 'eth_getTransactionReceipt', 'eth_getCode'])
		expect(seen.receivers).toEqual([config.receiverAddress.slice(2).toLowerCase()])
		const r = decodeReport(seen.reports[0])
		expect(r.isMatch).toBe(true)
		expect(r.reasons).toBe(0)
		expect(r.anchorTx).toBe(anchored.anchor_tx as `0x${string}`)
		expect(r.subject).toBe(anchored.subject.keccak as `0x${string}`)
		expect(r.recomputed).toBe(anchored.facts_hash as `0x${string}`)
		expect(r.anchoredHash).toBe(anchored.facts_hash as `0x${string}`)
		expect(r.asOf).toBe(BigInt(anchored.as_of.unix))
		expect(r.block).toBe(76177721n)
		expect(logs).toContain('RESULT: MATCH')
		expect(logs).toContain('newer than the record under test')
	})

	test('MISMATCH: the same record with one character changed, passed in the payload', () => {
		const seen = wire()
		const { out } = run(mismatchPayload)
		expect(out.verdict).toBe('MISMATCH')
		expect(out.reasonBits).toBe(Reason.FACTS_HASH | Reason.RECORD_FACTS_HASH)
		// the record came from the payload, so only vet402.com and the RPC were called
		expect(seen.urls.filter((u) => u === config.recordUrl)).toHaveLength(0)
		const r = decodeReport(seen.reports[0])
		expect(r.isMatch).toBe(false)
		expect(r.anchoredHash).toBe(anchored.facts_hash as `0x${string}`)
		expect(r.recomputed).not.toBe(anchored.facts_hash as `0x${string}`)
	})

	test('MISMATCH: a tx with no anchor', () => {
		const seen = wire()
		const { out } = run({ tx: `0x${'ab'.repeat(32)}` })
		expect(out.verdict).toBe('MISMATCH')
		expect(out.reasonBits & Reason.TX_FAILED).toBeTruthy()
		expect(decodeReport(seen.reports[0]).isMatch).toBe(false)
	})

	test('a vet402.com outage does not change the verdict on the record', () => {
		wire({ liveStatus: 503 })
		const { out } = run({})
		expect(out.verdict).toBe('MATCH')
		expect(out.live.xFactsHashMatchesBody).toBe(false)
	})

	test('rejects payload fields it does not know', () => {
		wire()
		expect(() => run({ tx: anchored.anchor_tx, amount: 1 })).toThrow()
	})
})

describe('initWorkflow', () => {
	test('registers one HTTP-triggered handler', () => {
		const handlers = initWorkflow(config as Config)
		expect(handlers).toHaveLength(1)
		expect(handlers[0].fn).toBe(onHttpTrigger)
	})
})
