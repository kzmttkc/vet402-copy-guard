// Runs the whole HTTP-trigger handler in the CRE SDK's test runtime. HTTP is the
// SDK's capability mock, fed with the real answers of the public Robinhood Chain
// RPC saved in fixtures/ (recorded by record-fixtures.ts). No EVM mock is set up:
// the workflow writes nothing onchain.
import { describe, expect } from 'bun:test'
import { readFileSync } from 'node:fs'
import { HttpActionsMock, newTestRuntime, test } from '@chainlink/cre-sdk/test'
import { canonicalJson, fromUtf8, utf8 } from '../rwa-verify/verify'
import { REASON_INFO, Reason, type ReasonName } from './check'
import config from './config.json'
import fakeNvda from './fixtures/fake-nvda.json'
import fakeUsdg from './fixtures/fake-usdg.json'
import qqqBuy from './fixtures/qqq-buy.json'
import fakeNvdaPayload from './payloads/fake-nvda.json'
import fakeUsdgPayload from './payloads/fake-usdg.json'
import qqqBuyPayload from './payloads/qqq-buy.json'
import { type Config, initWorkflow, MAX_HTTP_CALLS, MAX_TOKENS, MAX_WALLET_LOGS, onHttpTrigger } from './workflow'

const b64 = (s: string) => Buffer.from(utf8(s)).toString('base64')

type Item = { id: number; method: string; params: unknown[] }
type Fixture = { exchanges: { request: unknown; status: number; response: unknown }[] }
type Seen = { requests: number; rpc: string[]; batches: Item[][] }
type Override = (call: Item, recorded: unknown) => unknown

/** Every recorded answer of the fixtures, keyed by the call that got it. */
function recorded(fixtures: Fixture[]): Map<string, unknown> {
	const answers = new Map<string, unknown>()
	for (const f of fixtures) {
		for (const e of f.exchanges) {
			const calls = e.request as Item[]
			const items = e.response as { id: number }[]
			for (const c of calls) {
				const { id: _id, jsonrpc: _v, ...answer } = items.find((i) => i.id === c.id) as any
				answers.set(`${c.method} ${canonicalJson(c.params)}`, answer)
			}
		}
	}
	return answers
}

/**
 * Wires the HTTP mock. Each call of a batch is answered with what the chain
 * answered when the fixture was recorded. `override` may replace an answer
 * ({ result } or { error }), `status` may fail a whole request.
 */
function wire(fixtures: Fixture[], opts: { override?: Override; status?: (n: number) => number } = {}): Seen {
	const answers = recorded(fixtures)
	const seen: Seen = { requests: 0, rpc: [], batches: [] }
	const http = HttpActionsMock.testInstance()
	http.sendRequest = (req) => {
		if (req.url !== config.robinhoodRpc) return { statusCode: 404, body: '' }
		seen.requests++
		const status = opts.status?.(seen.requests) ?? 200
		if (status !== 200) return { statusCode: status, body: '' }
		const calls = JSON.parse(fromUtf8(req.body)) as Item[]
		seen.batches.push(calls)
		const out = calls.map((c) => {
			seen.rpc.push(c.method)
			const hit = answers.get(`${c.method} ${canonicalJson(c.params)}`)
			const answer = opts.override ? opts.override(c, hit) : hit
			if (answer === undefined) return { jsonrpc: '2.0', id: c.id, error: { code: -32000, message: `not in the fixture: ${c.method}` } }
			return { jsonrpc: '2.0', id: c.id, ...(answer as object) }
		})
		return { statusCode: 200, body: b64(JSON.stringify(out)) }
	}
	return seen
}

const run = (payload: object) => {
	const runtime = newTestRuntime<Config>(null, undefined, config as Config)
	const out = onHttpTrigger(runtime as any, { input: utf8(JSON.stringify(payload)) } as any)
	return { out: JSON.parse(out), logs: runtime.getLogs().join('\n') }
}

const QQQ = '0xd5f3879160bc7c32ebb4dc785f8a4f505888de68'
const USDG = '0x5fc5360d0400a0fd4f2af552add042d716f1d168'
const FAKE_NVDA = '0x5dd716fe12275b69f04b26beeca343843c8e3539'
const FAKE_USDG = '0xe7391e4047c7e5d48f31cd2b87004c10e875f288'
const WALLET = '0xe9b08727131e34010b34006c660d4c1b436ec25f'

describe('token-check onHttpTrigger, real transactions', () => {
	test('a real QQQ buy: USDG out, genuine QQQ in, allowed, and the QQQ multiplier changed after it', () => {
		const seen = wire([qqqBuy])
		const { out, logs } = run(qqqBuyPayload)
		expect(out.tx).toBe(qqqBuyPayload.tx)
		expect(out.wallet).toBe(WALLET)
		expect(out.block).toBe(68837431)
		expect(out.allow).toBe(true)
		expect(out.reasonBits).toBe(Reason.MULTIPLIER_CHANGED | Reason.MULTIPLIER_CHANGED_AFTER_TX)
		expect(out.tokens).toHaveLength(2)

		const usdg = out.tokens.find((t: any) => t.token === USDG)
		expect(usdg).toMatchObject({ verdict: 'USDG', reasons: [], symbol: 'USDG', name: 'Global Dollar', direction: 'out', multiplier: null, multiplierChanged: null })

		const qqq = out.tokens.find((t: any) => t.token === QQQ)
		expect(qqq).toMatchObject({
			verdict: 'GENUINE_STOCK_TOKEN',
			reasons: ['MULTIPLIER_CHANGED', 'MULTIPLIER_CHANGED_AFTER_TX'],
			symbol: 'QQQ',
			name: 'Invesco QQQ • Robinhood Token',
			ticker: 'QQQ',
			direction: 'in',
			multiplier: '1.000700791241405425',
			multiplierChanged: true,
			multiplierChangedAfterTx: true,
		})
		expect(qqq.multiplierUpdates).toEqual([
			{
				block: 69210998,
				tx: '0x6331915e6ddac124b1ea59b0db720892615fbd8ffbbea59cc9772147e326bba6',
				before: '1',
				after: '1.000700791241405425',
				effectiveAt: 1790035834,
				afterTx: true,
			},
		])

		// 1 batch for the tx, 1 for the wallet's logs, 1 per token
		expect(seen.requests).toBe(4)
		expect(seen.rpc.slice(0, 5)).toEqual(['eth_chainId', 'eth_blockNumber', 'eth_getTransactionByHash', 'eth_getLogs', 'eth_getLogs'])
		expect(logs).toContain('RESULT: ALLOW')
		expect(logs).toContain('GENUINE_STOCK_TOKEN')
		expect(logs).toContain('UIMultiplierUpdated in block 69210998')
	})

	test('25 fake NVDA received: LOOKALIKE, not allowed', () => {
		const seen = wire([fakeNvda])
		const { out, logs } = run(fakeNvdaPayload)
		expect(out.block).toBe(73953009)
		expect(out.allow).toBe(false)
		expect(out.tokens).toHaveLength(1)
		expect(out.tokens[0]).toMatchObject({
			token: FAKE_NVDA,
			verdict: 'LOOKALIKE',
			symbol: 'NVDA',
			name: 'NVIDIA Robinhood Coin',
			ticker: 'NVDA',
			direction: 'in',
			multiplier: null,
			multiplierChanged: null,
		})
		expect(out.tokens[0].reasons).toEqual([
			'NOT_IN_LIST',
			'CODE_HASH_DIFFERS',
			'BEACON_DIFFERS',
			'SYMBOL_COPIES_LISTED',
			'NAME_COPIES_LISTED',
			'NAME_CLAIMS_ROBINHOOD_TOKEN',
		])
		expect(out.reasonBits).toBe(out.tokens[0].reasonBits)
		expect(BigInt(out.tokens[0].amountInRaw)).toBeGreaterThan(0n)
		// an address outside the list: no factory log and no multiplier logs are asked for
		expect(seen.requests).toBe(3)
		expect(seen.batches[2].map((c) => c.method)).toEqual(['eth_getCode', 'eth_getStorageAt', 'eth_call', 'eth_call', 'eth_call'])
		expect(logs).toContain('RESULT: DO NOT ALLOW')
	})

	test('a fake USDG "transfer" log naming the wallet: LOOKALIKE, not allowed', () => {
		wire([fakeUsdg])
		const { out } = run(fakeUsdgPayload)
		expect(out.block).toBe(81262132)
		expect(out.allow).toBe(false)
		expect(out.tokens).toHaveLength(1)
		expect(out.tokens[0]).toMatchObject({
			token: FAKE_USDG,
			verdict: 'LOOKALIKE',
			symbol: 'U[U+206F]S[U+206F]DG',
			ticker: 'USDG',
		})
		expect(out.tokens[0].reasons).toEqual(['NOT_IN_LIST', 'CODE_HASH_DIFFERS', 'BEACON_DIFFERS', 'IMITATES_USDG', 'HIDDEN_CHARACTERS'])
	})
})

describe('token-check onHttpTrigger, what it refuses and how it reads', () => {
	test('an RPC on another chain is refused before anything else is read', () => {
		const seen = wire([qqqBuy], { override: (c, hit) => (c.method === 'eth_chainId' ? { result: '0x1' } : hit) })
		const { out } = run(qqqBuyPayload)
		expect(out.allow).toBe(false)
		expect(out.reasons).toEqual(['WRONG_CHAIN'])
		expect(out.tokens).toEqual([])
		expect(seen.requests).toBe(1)
	})

	test('a tx the chain does not know', () => {
		const seen = wire([qqqBuy], { override: (c, hit) => (c.method === 'eth_getTransactionByHash' ? { result: null } : hit) })
		const { out } = run({ tx: `0x${'ab'.repeat(32)}`, wallet: WALLET })
		expect(out.allow).toBe(false)
		expect(out.reasons).toEqual(['TX_NOT_FOUND'])
		expect(seen.requests).toBe(1)
	})

	test('a wallet with no transfer in that tx', () => {
		wire([qqqBuy], { override: (c, hit) => (c.method === 'eth_getLogs' ? { result: [] } : hit) })
		const { out } = run({ tx: qqqBuyPayload.tx, wallet: `0x${'12'.repeat(20)}` })
		expect(out.allow).toBe(false)
		expect(out.reasons).toEqual(['NO_WALLET_TRANSFER'])
	})

	test('with `block` in the payload the tx object is never fetched', () => {
		const seen = wire([fakeNvda])
		const { out } = run({ ...fakeNvdaPayload, block: 73953009 })
		expect(out.allow).toBe(false)
		expect(out.tokens[0].verdict).toBe('LOOKALIKE')
		expect(seen.rpc).not.toContain('eth_getTransactionByHash')
	})

	test('`block` pointing at another block finds no transfer and is not allowed', () => {
		wire([fakeNvda], { override: (c, hit) => (c.method === 'eth_getLogs' ? (hit ?? { result: [] }) : hit) })
		const { out } = run({ ...fakeNvdaPayload, block: 73953010 })
		expect(out.allow).toBe(false)
		expect(out.reasons).toEqual(['NO_WALLET_TRANSFER'])
	})

	test('the genuine token with its code swapped is UNVERIFIED, not allowed', () => {
		wire([qqqBuy], {
			override: (c, hit) => (c.method === 'eth_getCode' && c.params[0] === QQQ ? { result: '0x60006000' } : hit),
		})
		const { out } = run(qqqBuyPayload)
		const qqq = out.tokens.find((t: any) => t.token === QQQ)
		expect(qqq.verdict).toBe('UNVERIFIED')
		expect(qqq.reasons).toEqual(['CODE_HASH_DIFFERS'])
		expect(out.allow).toBe(false)
	})

	test('the genuine token without its factory log is UNVERIFIED', () => {
		wire([qqqBuy], {
			override: (c, hit) => (c.method === 'eth_getLogs' && (c.params[0] as any).address === '0x4783c67b63de2b358ac5951a7d41f47a38f3c046' ? { result: [] } : hit),
		})
		const { out } = run(qqqBuyPayload)
		expect(out.tokens.find((t: any) => t.token === QQQ).reasons).toEqual(['FACTORY_LOG_MISSING'])
		expect(out.allow).toBe(false)
	})

	test('a 429 is asked again and the answer is the same', () => {
		const seen = wire([qqqBuy], { status: (n) => (n === 2 ? 429 : 200) })
		const { out } = run(qqqBuyPayload)
		expect(out.allow).toBe(true)
		expect(seen.requests).toBe(5)
	})

	test('a rate-limited item inside a batch is asked again alone', () => {
		let limited = 0
		const seen = wire([qqqBuy], {
			override: (c, hit) => {
				if (c.method === 'eth_getStorageAt' && c.params[0] === QQQ && limited++ === 0) return { error: { code: -32005, message: 'Too Many Requests' } }
				return hit
			},
		})
		const { out } = run(qqqBuyPayload)
		expect(out.allow).toBe(true)
		expect(out.tokens.find((t: any) => t.token === QQQ).verdict).toBe('GENUINE_STOCK_TOKEN')
		expect(seen.batches.some((b) => b.length === 1 && b[0].method === 'eth_getStorageAt')).toBe(true)
	})

	test('an RPC that keeps answering 429 fails the run, no verdict comes out', () => {
		const seen = wire([qqqBuy], { status: () => 429 })
		expect(() => run(qqqBuyPayload)).toThrow(/rate limited/)
		expect(seen.requests).toBeLessThanOrEqual(MAX_HTTP_CALLS)
	})

	test('a state read the RPC refuses fails the run', () => {
		wire([qqqBuy], { override: (c, hit) => (c.method === 'eth_getCode' ? { error: { code: -32000, message: 'missing trie node' } } : hit) })
		expect(() => run(qqqBuyPayload)).toThrow(/eth_getCode/)
	})

	test('a tx that moves ten tokens: eight are read, the run says so and does not allow', () => {
		const pad = (x: string) => `0x${'0'.repeat(24)}${x.slice(2)}`
		const logs = Array.from({ length: 10 }, (_, i) => ({
			address: `0x${(i + 1).toString(16).padStart(40, '0')}`,
			topics: ['0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef', pad(`0x${'99'.repeat(20)}`), pad(WALLET)],
			data: `0x${'0'.repeat(63)}1`,
			blockNumber: '0x41a6037',
			blockHash: `0x${'00'.repeat(32)}`,
			transactionHash: qqqBuyPayload.tx,
			transactionIndex: '0x1',
			logIndex: `0x${i.toString(16)}`,
			removed: false,
		}))
		const seen = wire([qqqBuy], {
			override: (c, hit) => {
				if (c.method === 'eth_getLogs') return { result: (c.params[0] as any).topics[2] ? logs : [] }
				if (c.method === 'eth_getCode') return { result: '0x6000' }
				if (c.method === 'eth_getStorageAt') return { result: `0x${'0'.repeat(64)}` }
				if (c.method === 'eth_call') return { error: { code: 3, message: 'execution reverted' } }
				return hit
			},
		})
		const { out } = run(qqqBuyPayload)
		expect(out.tokens).toHaveLength(MAX_TOKENS)
		expect(out.tokens.every((t: any) => t.verdict === 'NOT_A_STOCK_TOKEN' && t.symbol === null)).toBe(true)
		expect(out.reasonBits & Reason.TOO_MANY_TRANSFERS).toBeTruthy()
		expect(out.allow).toBe(false)
		expect(seen.requests).toBe(2 + MAX_TOKENS)
		expect(seen.requests).toBeLessThanOrEqual(MAX_HTTP_CALLS)
	})

	test('more transfer logs of the wallet than one run keeps: not allowed', () => {
		const pad = (x: string) => `0x${'0'.repeat(24)}${x.slice(2)}`
		const logs = Array.from({ length: MAX_WALLET_LOGS + 5 }, (_, i) => ({
			address: USDG,
			topics: ['0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef', pad(WALLET), pad(`0x${'99'.repeat(20)}`)],
			data: `0x${'0'.repeat(63)}1`,
			blockNumber: '0x41a6037',
			transactionHash: qqqBuyPayload.tx,
			logIndex: `0x${i.toString(16)}`,
		}))
		wire([qqqBuy], { override: (c, hit) => (c.method === 'eth_getLogs' && (c.params[0] as any).topics?.[1] && !(c.params[0] as any).address ? { result: logs } : hit) })
		const { out } = run(qqqBuyPayload)
		expect(out.tokens).toHaveLength(1)
		expect(out.tokens[0]).toMatchObject({ verdict: 'USDG', amountOutRaw: String(MAX_WALLET_LOGS) })
		expect(out.reasons).toEqual(['TOO_MANY_TRANSFERS'])
		expect(out.allow).toBe(false)
	})

	test('the reason table in docs/token-check/README.md is the one in the code', () => {
		const readme = readFileSync(new URL('../docs/token-check/README.md', import.meta.url), 'utf8')
		for (const name of Object.keys(Reason) as ReasonName[]) {
			expect(readme).toContain(`| ${Reason[name]} | \`${name}\` | ${REASON_INFO[name].kind} | ${REASON_INFO[name].text} |`)
		}
	})

	test('rejects a payload without a wallet, with a bad hash, or with fields it does not know', () => {
		wire([qqqBuy])
		expect(() => run({ tx: qqqBuyPayload.tx })).toThrow()
		expect(() => run({ tx: '0x1234', wallet: WALLET })).toThrow()
		expect(() => run({ ...qqqBuyPayload, amount: 1 })).toThrow()
		expect(() => run({})).toThrow()
	})

	test('only the configured RPC is called, never a vet402 API', () => {
		const urls: string[] = []
		const seen = wire([qqqBuy])
		const http = HttpActionsMock.testInstance()
		const inner = http.sendRequest!
		http.sendRequest = (req) => {
			urls.push(req.url)
			return inner(req)
		}
		run(qqqBuyPayload)
		expect(seen.requests).toBe(4)
		expect(new Set(urls)).toEqual(new Set([config.robinhoodRpc]))
	})
})

describe('initWorkflow', () => {
	test('registers one HTTP-triggered handler', () => {
		const handlers = initWorkflow(config as Config)
		expect(handlers).toHaveLength(1)
		expect(handlers[0].fn).toBe(onHttpTrigger)
	})
})
