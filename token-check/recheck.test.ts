// recheck.mjs shares no code with the workflow. These tests feed the same chain
// answers to both and expect the same row, and expect a changed row to be noticed.
import { describe, expect, test } from 'bun:test'
import { encodeAbiParameters, keccak256 } from 'viem'
import { canonicalJson, keccakText } from '../rwa-verify/verify'
import { BATCH_REASONS, type BatchTokenState, EMPTY_CODE_HASH, judgeBatchToken } from './batch'
import { decodeAbiText, EIP1967_BEACON_SLOT, SNAPSHOT, STOCK_TOKEN_BEACON, STOCK_TOKEN_CODE_HASH, STOCK_TOKEN_FACTORY, showText, TOKEN_DEPLOYED_TOPIC, UI_MULTIPLIER_UPDATED_TOPIC, USDG } from './check'
import qqqBuy from './fixtures/qqq-buy.json'
// @ts-expect-error a plain .mjs file without types
import { canonical, compareRow, decodeText, derive, keccakOfText, PIN, RECHECKED, show, TOPIC } from './recheck.mjs'
import { TOKEN_BATCH_CHECKED_TOPIC } from './workflow'

const BLOCK = 87_990_000
const NVDA = SNAPSHOT.tokens.find((t) => t.symbol === 'NVDA')!
const QQQ = SNAPSHOT.tokens.find((t) => t.symbol === 'QQQ')!
const STRANGER = '0x5dd716fe12275b69f04b26beeca343843c8e3539'
const SYMBOLS = new Set(SNAPSHOT.tokens.map((t) => t.symbol))
const abi = (s: string) => encodeAbiParameters([{ type: 'string' }], [s])
const uint = (n: bigint) => encodeAbiParameters([{ type: 'uint256' }], [n])
const slot = (a: string) => `0x${'0'.repeat(24)}${a.slice(2)}`

/** The real runtime code of a Stock Token, as the public RPC returned it for QQQ. */
const STOCK_CODE = (() => {
	for (const e of (qqqBuy as any).exchanges) {
		const calls = e.request as { id: number; method: string; params: any[] }[]
		const hit = calls.find((c) => c.method === 'eth_getCode' && c.params[0] === QQQ.token)
		if (hit) return (e.response as { id: number; result: string }[]).find((r) => r.id === hit.id)!.result
	}
	throw new Error('no eth_getCode of QQQ in the fixture')
})()
const OTHER_CODE = '0x6080604052'

type Case = { name: string; token: string; code: string; beacon: string; symbol: string | null; name_: string | null; multiplier: bigint | null; factory: boolean; updates: number }
const base = (t: { token: string; symbol: string; name: string }): Case => ({ name: '', token: t.token, code: STOCK_CODE, beacon: STOCK_TOKEN_BEACON, symbol: t.symbol, name_: `${t.name} • Robinhood Token`, multiplier: 10n ** 18n, factory: true, updates: 0 })
const stranger: Case = { name: '', token: STRANGER, code: OTHER_CODE, beacon: `0x${'0'.repeat(40)}`, symbol: 'WETH', name_: 'Wrapped Ether', multiplier: null, factory: false, updates: 0 }
const CASES: Case[] = [
	{ ...base(NVDA), name: 'the issuer\'s token' },
	{ ...base(QQQ), name: 'a changed multiplier, one update', multiplier: 1000700791241405425n, updates: 1 },
	{ ...base(QQQ), name: 'an update logged, multiplier still 1', updates: 1 },
	{ ...base(NVDA), name: 'listed, other code', code: OTHER_CODE },
	{ ...base(NVDA), name: 'listed, no code', code: '0x' },
	{ ...base(NVDA), name: 'listed, other beacon', beacon: STRANGER },
	{ ...base(NVDA), name: 'listed, the factory log does not name it', factory: false },
	{ ...base(NVDA), name: 'listed, another ticker', symbol: 'NVDX' },
	{ ...base(NVDA), name: 'listed, symbol() reverts', symbol: null },
	{ ...base(NVDA), name: 'listed, uiMultiplier() reverts', multiplier: null },
	{ ...stranger, name: 'USDG', token: USDG, symbol: 'USDG', name_: 'Global Dollar' },
	{ ...stranger, name: 'an ordinary token' },
	{ ...stranger, name: 'a listed ticker at another address', symbol: 'NVDA', name_: 'NVIDIA Robinhood Coin' },
	{ ...stranger, name: 'invisible characters in the ticker', symbol: 'U⁯S⁯DG', name_: 'Global Dollar' },
	{ ...stranger, name: 'a Cyrillic letter in the ticker', symbol: 'NVDА' },
	{ ...stranger, name: 'the issuer\'s code at an unlisted address', code: STOCK_CODE, beacon: STOCK_TOKEN_BEACON, symbol: 'NVDA', name_: 'NVIDIA' },
	{ ...stranger, name: 'the issuer\'s code, another beacon', code: STOCK_CODE },
	{ ...stranger, name: 'no code, no symbol', code: '0x', symbol: null, name_: null },
]

function both(c: Case) {
	const state: BatchTokenState = {
		token: c.token,
		codeHash: c.code === '0x' ? EMPTY_CODE_HASH : keccak256(c.code as `0x${string}`),
		beaconSlot: slot(c.beacon),
		symbol: c.symbol,
		name: c.name_,
		multiplier: c.multiplier === null ? null : c.multiplier.toString(),
		factoryLog: SNAPSHOT.tokens.some((t) => t.token === c.token) ? c.factory : null,
		multiplierUpdates: SNAPSHOT.tokens.some((t) => t.token === c.token) ? c.updates : null,
	}
	const row = judgeBatchToken(state, BLOCK).result
	const mine = derive(c.token, SNAPSHOT.tokens.find((t) => t.token === c.token) ?? null, SYMBOLS, {
		code: c.code,
		beaconWord: slot(c.beacon),
		symbolHex: c.symbol === null ? null : abi(c.symbol),
		multiplierHex: c.multiplier === null ? null : uint(c.multiplier),
		factoryNamesToken: c.factory,
		updates: c.updates,
	})
	return { row, mine }
}

describe('recheck.mjs against the workflow\'s own decision', () => {
	test('the real Stock Token code hashes to the pinned code hash, in both', () => {
		expect(keccak256(STOCK_CODE as `0x${string}`)).toBe(STOCK_TOKEN_CODE_HASH)
		expect(PIN.codeHash).toBe(STOCK_TOKEN_CODE_HASH)
		expect(PIN.beacon).toBe(STOCK_TOKEN_BEACON)
		expect(PIN.beaconSlot).toBe(EIP1967_BEACON_SLOT)
		expect(PIN.factory).toBe(STOCK_TOKEN_FACTORY)
		expect(PIN.usdg).toBe(USDG)
	})

	test('the event topics of recheck.mjs are the ones the workflow pins', () => {
		expect(TOPIC.tokenDeployed).toBe(TOKEN_DEPLOYED_TOPIC)
		expect(TOPIC.multiplierUpdated).toBe(UI_MULTIPLIER_UPDATED_TOPIC)
		expect(TOPIC.batchChecked).toBe(TOKEN_BATCH_CHECKED_TOPIC)
		expect(keccakOfText('UIMultiplierUpdated(uint256,uint256,uint256)')).toBe(UI_MULTIPLIER_UPDATED_TOPIC)
	})

	for (const c of CASES) {
		test(`same answers, same row: ${c.name}`, () => {
			const { row, mine } = both(c)
			expect(compareRow(row, mine)).toEqual([])
			expect(mine.issuer_token).toBe(row.issuer_token)
		})
	}

	test('four cases are the issuer\'s token (an unreadable multiplier is a notice, not a failed ground), and every reason either road gives is a defined one', () => {
		expect(CASES.map((c, i) => (both(c).row.issuer_token ? i : -1)).filter((i) => i >= 0)).toEqual([0, 1, 2, 9])
		for (const c of CASES) for (const r of both(c).mine.reasons) expect(RECHECKED).toContain(r)
		for (const r of RECHECKED) expect(BATCH_REASONS).toContain(r)
	})

	test('a row that was changed is noticed, field by field', () => {
		const { row, mine } = both(CASES[12])
		expect(compareRow({ ...row, issuer_token: true }, mine)).toEqual([{ field: 'issuer_token', results: true, recheck: false }])
		expect(compareRow({ ...row, ticker: 'NVDA2' }, mine)[0]).toMatchObject({ field: 'ticker' })
		expect(compareRow({ ...row, multiplier_updates: 3 }, mine)[0]).toMatchObject({ field: 'multiplier_updates' })
		expect(compareRow({ ...row, reasons: row.reasons.filter((r) => r !== 'TICKER_SAME_AS_ISSUER_TOKEN') }, mine)[0]).toMatchObject({ field: 'reasons' })
		expect(compareRow({ ...row, reasons: [...row.reasons, 'CODE_HASH_MATCHES'] }, mine)[0]).toMatchObject({ field: 'reasons' })
	})

	test('its own canonical JSON, text decoding and text display are the workflow\'s', () => {
		const v = { b: [1, 'x', { z: null, a: true }], a: 'q"•', c: 0 }
		expect(canonical(v)).toBe(canonicalJson(v))
		expect(keccakOfText(canonical(v))).toBe(keccakText(canonicalJson(v)))
		for (const s of ['NVDA', 'Invesco QQQ • Robinhood Token', 'U⁯S⁯DG', '', 'x'.repeat(200), '\u{1d400}BC']) {
			expect(decodeText(abi(s))).toBe(decodeAbiText(abi(s)))
			expect(show(decodeText(abi(s)))).toBe(showText(decodeAbiText(abi(s)) as string))
		}
		const bytes32 = `0x${Buffer.from('MKR').toString('hex').padEnd(64, '0')}`
		expect(decodeText(bytes32)).toBe('MKR')
		expect(decodeText(bytes32)).toBe(decodeAbiText(bytes32))
		expect(decodeText('0x')).toBeNull()
		expect(decodeText(null)).toBeNull()
	})
})
