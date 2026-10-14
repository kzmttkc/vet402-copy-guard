// The pure check: hand-built chain states, plus the real answers saved in fixtures/.
import { describe, expect, test } from 'bun:test'
import qqqBuy from './fixtures/qqq-buy.json'
import {
	addressInWord,
	type CheckInput,
	check,
	claimsRobinhoodToken,
	codeHashOf,
	decimal18,
	decodeAbiText,
	decodeUint,
	EIP1967_BEACON_SLOT,
	factoryNames,
	type Log,
	listedToken,
	MULTIPLIER_ONE,
	multiplierUpdates,
	nameKey,
	Reason,
	REASON_INFO,
	type ReasonName,
	reasonNames,
	render,
	renderHeader,
	showText,
	SNAPSHOT,
	STOCK_TOKEN_BEACON,
	STOCK_TOKEN_CODE_HASH,
	STOCK_TOKEN_FACTORY,
	stripHidden,
	type TokenState,
	TOKEN_DEPLOYED_TOPIC,
	TRANSFER_TOPIC,
	tickerKey,
	UI_MULTIPLIER_UPDATED_TOPIC,
	USDG,
	walletTransfers,
} from './check'

const WALLET = '0xe9b08727131e34010b34006c660d4c1b436ec25f'
const OTHER = '0x1111111111111111111111111111111111111111'
const TX = `0x${'ab'.repeat(32)}`
const BLOCK = 70_000_000
const QQQ = '0xd5f3879160bc7c32ebb4dc785f8a4f505888de68'
const NVDA = '0xd0601ce157db5bdc3162bbac2a2c8af5320d9eec'
const FAKE = '0x5dd716fe12275b69f04b26beeca343843c8e3539'
const BEACON_WORD = `0x${'0'.repeat(24)}${STOCK_TOKEN_BEACON.slice(2)}`
const ZERO_WORD = `0x${'0'.repeat(64)}`
const OTHER_CODE = `0x${'cd'.repeat(32)}`

const pad = (a: string) => `0x${'0'.repeat(24)}${a.slice(2)}`
const word = (n: bigint) => n.toString(16).padStart(64, '0')

function transfer(token: string, from: string, to: string, amount: bigint, logIndex: number, tx = TX): Log {
	return {
		address: token,
		topics: [TRANSFER_TOPIC, pad(from), pad(to)],
		data: `0x${word(amount)}`,
		blockNumber: `0x${BLOCK.toString(16)}`,
		transactionHash: tx,
		logIndex: `0x${logIndex.toString(16)}`,
	}
}

/** A token the chain shows as a genuine Stock Token, unless fields are overridden. */
function state(token: string, over: Partial<TokenState> = {}): TokenState {
	return {
		token,
		codeHash: STOCK_TOKEN_CODE_HASH,
		beaconSlot: BEACON_WORD,
		symbol: listedToken(token)?.symbol ?? null,
		name: listedToken(token) ? `${listedToken(token)!.name} • Robinhood Token` : null,
		multiplier: MULTIPLIER_ONE,
		factoryLog: listedToken(token) ? true : null,
		multiplierUpdates: listedToken(token) ? [] : null,
		multiplierLogsComplete: Boolean(listedToken(token)),
		...over,
	}
}

/** An address outside the list with code of its own. */
function stranger(token: string, symbol: string | null, name: string | null, over: Partial<TokenState> = {}): TokenState {
	return state(token, { codeHash: OTHER_CODE, beaconSlot: ZERO_WORD, symbol, name, multiplier: null, ...over })
}

function input(tokens: TokenState[], logs?: Log[], over: Partial<CheckInput> = {}): CheckInput {
	return {
		chainId: 4663,
		tx: TX,
		wallet: WALLET,
		txFound: true,
		block: BLOCK,
		logs: logs ?? tokens.map((t, i) => transfer(t.token, OTHER, WALLET, 5n, i)),
		tokens,
		skipped: 0,
		...over,
	}
}

const one = (s: TokenState) => check(input([s])).tokens[0]

describe('reason bits', () => {
	test('each reason is one bit, and each has a kind and a text', () => {
		const values = Object.values(Reason)
		expect(new Set(values).size).toBe(values.length)
		for (const v of values) expect(v > 0 && (v & (v - 1)) === 0).toBe(true)
		for (const n of Object.keys(Reason) as ReasonName[]) {
			expect(['blocks', 'explains', 'notice']).toContain(REASON_INFO[n].kind)
			expect(REASON_INFO[n].text.length).toBeGreaterThan(10)
		}
		expect(Math.max(...values)).toBeLessThan(2 ** 32)
	})

	test('reasonNames lists the set bits, lowest first', () => {
		expect(reasonNames(Reason.BEACON_DIFFERS | Reason.NOT_IN_LIST)).toEqual(['NOT_IN_LIST', 'BEACON_DIFFERS'])
		expect(reasonNames(0)).toEqual([])
	})
})

describe('the bundled list', () => {
	test('195 Stock Tokens, lower-case addresses, no address or ticker twice', () => {
		expect(SNAPSHOT.count).toBe(195)
		expect(SNAPSHOT.tokens).toHaveLength(195)
		expect(new Set(SNAPSHOT.tokens.map((t) => t.token)).size).toBe(195)
		expect(new Set(SNAPSHOT.tokens.map((t) => t.symbol)).size).toBe(195)
		for (const t of SNAPSHOT.tokens) {
			expect(t.token).toMatch(/^0x[0-9a-f]{40}$/)
			expect(t.deployed_block).toBeGreaterThan(0)
		}
	})

	test('names its source, its date and the hash of the file it was cut from', () => {
		expect(SNAPSHOT.source).toBe('https://docs.robinhood.com/chain/contracts')
		expect(SNAPSHOT.list_taken_at).toMatch(/^2026-/)
		expect(SNAPSHOT.source_file_keccak256).toMatch(/^0x[0-9a-f]{64}$/)
	})

	test('QQQ, NVDA and USDG are where the chain has them', () => {
		expect(listedToken(QQQ)?.symbol).toBe('QQQ')
		expect(listedToken(NVDA.toUpperCase().replace('0X', '0x'))?.symbol).toBe('NVDA')
		expect(listedToken(USDG)).toBeNull()
		expect(USDG).toBe('0x5fc5360d0400a0fd4f2af552add042d716f1d168')
	})
})

describe('a genuine Stock Token', () => {
	test('listed address, pinned code, pinned beacon, factory log, listed ticker', () => {
		const r = check(input([state(QQQ)]))
		expect(r.allow).toBe(true)
		expect(r.reasonBits).toBe(0)
		expect(r.tokens[0]).toMatchObject({ token: QQQ, verdict: 'GENUINE_STOCK_TOKEN', reasons: [], ticker: 'QQQ', direction: 'in', amountInRaw: '5' })
		expect(r.tokens[0].multiplier).toBe('1')
		expect(r.tokens[0].multiplierChanged).toBe(false)
		expect(r.tokens[0].multiplierChangedAfterTx).toBe(false)
	})

	test('the real QQQ code saved from the chain hashes to the pinned value', () => {
		const answers = qqqBuy.exchanges.flatMap((e) => (e.request as any[]).map((q, i) => ({ q, a: (e.response as any[])[i] })))
		const code = answers.find((x) => x.q.method === 'eth_getCode' && x.q.params[0] === QQQ)!.a.result as string
		const slot = answers.find((x) => x.q.method === 'eth_getStorageAt' && x.q.params[0] === QQQ)!
		expect(codeHashOf(code)).toBe(STOCK_TOKEN_CODE_HASH)
		expect(slot.q.params[1]).toBe(EIP1967_BEACON_SLOT)
		expect(addressInWord(slot.a.result)).toBe(STOCK_TOKEN_BEACON)
		// the proxy code embeds the beacon address
		expect(code).toContain(STOCK_TOKEN_BEACON.slice(2))
	})

	test('USDG at its own address', () => {
		const t = one(stranger(USDG, 'USDG', 'Global Dollar'))
		expect(t.verdict).toBe('USDG')
		expect(t.reasonBits).toBe(0)
		expect(t.multiplier).toBeNull()
	})

	test('a buy: USDG out, QQQ in', () => {
		const logs = [transfer(USDG, WALLET, OTHER, 3_250_000_000n, 4), transfer(QQQ, OTHER, WALLET, 7n, 9)]
		const r = check(input([stranger(USDG, 'USDG', 'Global Dollar'), state(QQQ)], logs))
		expect(r.allow).toBe(true)
		expect(r.tokens.map((t) => [t.verdict, t.direction])).toEqual([
			['USDG', 'out'],
			['GENUINE_STOCK_TOKEN', 'in'],
		])
		expect(r.tokens[0].amountOutRaw).toBe('3250000000')
	})
})

describe('a listed address the chain does not confirm', () => {
	const cases: [string, Partial<TokenState>, number][] = [
		['other code', { codeHash: OTHER_CODE }, Reason.CODE_HASH_DIFFERS],
		['no code', { codeHash: null }, Reason.NO_CONTRACT_CODE],
		['other beacon', { beaconSlot: pad(OTHER) }, Reason.BEACON_DIFFERS],
		['no factory log', { factoryLog: false }, Reason.FACTORY_LOG_MISSING],
		['factory log not read', { factoryLog: null }, Reason.FACTORY_LOG_MISSING],
		['another ticker', { symbol: 'QQQX' }, Reason.LISTED_SYMBOL_DIFFERS],
		['a ticker with a hidden character', { symbol: 'QQ\u200bQ' }, Reason.LISTED_SYMBOL_DIFFERS],
		['symbol() reverts', { symbol: null }, Reason.LISTED_SYMBOL_DIFFERS],
	]
	for (const [label, over, bit] of cases) {
		test(`${label}: UNVERIFIED, not allowed, never called a look-alike`, () => {
			const r = check(input([state(QQQ, over)]))
			expect(r.tokens[0].verdict).toBe('UNVERIFIED')
			expect(r.tokens[0].reasonBits).toBe(bit)
			expect(r.allow).toBe(false)
			expect(r.tokens[0].multiplier).toBeNull()
		})
	}
})

describe('look-alikes', () => {
	test('fake NVDA: the listed ticker and company name at another address', () => {
		const r = check(input([stranger(FAKE, 'NVDA', 'NVIDIA Robinhood Coin')]))
		expect(r.allow).toBe(false)
		expect(r.tokens[0].verdict).toBe('LOOKALIKE')
		expect(r.tokens[0].ticker).toBe('NVDA')
		expect(r.tokens[0].reasons).toEqual([
			'NOT_IN_LIST',
			'CODE_HASH_DIFFERS',
			'BEACON_DIFFERS',
			'SYMBOL_COPIES_LISTED',
			'NAME_COPIES_LISTED',
			'NAME_CLAIMS_ROBINHOOD_TOKEN',
		])
	})

	test('fake USDG: the ticker with invisible characters between the letters', () => {
		const r = check(input([stranger(FAKE, 'U\u206fS\u206fDG', 'U\u206fS\u206fDG')]))
		expect(r.allow).toBe(false)
		expect(r.tokens[0].verdict).toBe('LOOKALIKE')
		expect(r.tokens[0].ticker).toBe('USDG')
		expect(r.tokens[0].reasonBits & Reason.IMITATES_USDG).toBeTruthy()
		expect(r.tokens[0].reasonBits & Reason.HIDDEN_CHARACTERS).toBeTruthy()
		// the hidden characters are visible in the output
		expect(r.tokens[0].symbol).toBe('U[U+206F]S[U+206F]DG')
	})

	test('"Global Dollar" as a name is enough', () => {
		expect(one(stranger(FAKE, 'USD', 'Global Dollar')).verdict).toBe('LOOKALIKE')
	})

	const disguises: [string, string, boolean, boolean][] = [
		['zero-width space', 'NV\u200bDA', true, false],
		['Cyrillic A', 'NVD\u0410', false, true],
		['Greek N', '\u039dVDA', false, true],
		['full-width letters', '\uff2e\uff36\uff24\uff21', false, true],
		['mathematical bold letters', '\ud835\udc0d\ud835\udc15\ud835\udc03\ud835\udc00', false, true],
		['lower case', 'nvda', false, false],
		['spaces', 'N V D A', false, false],
	]
	for (const [label, symbol, hidden, confusable] of disguises) {
		test(`a disguised ticker (${label})`, () => {
			const t = one(stranger(FAKE, symbol, 'Some Token'))
			expect(t.verdict).toBe('LOOKALIKE')
			expect(t.ticker).toBe('NVDA')
			expect(t.reasonBits & Reason.SYMBOL_DISGUISES_LISTED).toBeTruthy()
			expect(t.reasonBits & Reason.SYMBOL_COPIES_LISTED).toBe(0)
			expect(Boolean(t.reasonBits & Reason.HIDDEN_CHARACTERS)).toBe(hidden)
			expect(Boolean(t.reasonBits & Reason.CONFUSABLE_CHARACTERS)).toBe(confusable)
		})
	}

	test('zero in place of the letter O', () => {
		const t = one(stranger(FAKE, 'C0ST', 'Some Token'))
		expect(t.verdict).toBe('LOOKALIKE')
		expect(t.ticker).toBe('COST')
		expect(t.reasonBits & Reason.CONFUSABLE_CHARACTERS).toBeTruthy()
	})

	test('a name that ends like a Stock Token, with a ticker that is not listed', () => {
		const t = one(stranger(FAKE, 'OPENAI', 'OpenAI • Robinhood Token'))
		expect(t.verdict).toBe('LOOKALIKE')
		expect(t.reasons).toEqual(['NOT_IN_LIST', 'CODE_HASH_DIFFERS', 'BEACON_DIFFERS', 'NAME_CLAIMS_ROBINHOOD_TOKEN'])
	})

	test('the Stock Token code and beacon at an unlisted address, with a listed ticker', () => {
		const t = one(state(FAKE, { symbol: 'NVDA', name: 'NVIDIA • Robinhood Token', factoryLog: null, multiplierUpdates: null }))
		expect(t.verdict).toBe('LOOKALIKE')
		expect(t.reasons).toEqual(['NOT_IN_LIST', 'SYMBOL_COPIES_LISTED', 'NAME_COPIES_LISTED', 'NAME_CLAIMS_ROBINHOOD_TOKEN', 'STOCK_TOKEN_CODE_UNLISTED'])
		expect(t.multiplier).toBeNull()
	})

	test('the Stock Token code and beacon at an unlisted address, with a ticker the list does not have', () => {
		const r = check(input([state(FAKE, { symbol: 'NEWCO', name: 'NewCo • Robinhood Token', factoryLog: null, multiplierUpdates: null })]))
		expect(r.tokens[0].verdict).toBe('UNVERIFIED')
		expect(r.tokens[0].reasons).toEqual(['NOT_IN_LIST', 'NAME_CLAIMS_ROBINHOOD_TOKEN', 'STOCK_TOKEN_CODE_UNLISTED'])
		expect(r.allow).toBe(false)
	})

	test('the Stock Token code with another beacon is not the issuer code', () => {
		const t = one(state(FAKE, { symbol: 'NVDA', name: 'NVIDIA', beaconSlot: pad(OTHER), factoryLog: null }))
		expect(t.verdict).toBe('LOOKALIKE')
		expect(t.reasonBits & Reason.BEACON_DIFFERS).toBeTruthy()
		expect(t.reasonBits & Reason.STOCK_TOKEN_CODE_UNLISTED).toBe(0)
	})

	test('one look-alike next to genuine tokens blocks the whole tx', () => {
		const r = check(input([state(QQQ), stranger(USDG, 'USDG', 'Global Dollar'), stranger(FAKE, 'NVDA', 'NVIDIA')]))
		expect(r.tokens.map((t) => t.verdict)).toEqual(['GENUINE_STOCK_TOKEN', 'USDG', 'LOOKALIKE'])
		expect(r.allow).toBe(false)
	})
})

describe('an ordinary token', () => {
	test('its own ticker and name: NOT_A_STOCK_TOKEN, allowed', () => {
		const r = check(input([stranger(FAKE, 'WETH', 'Wrapped Ether')]))
		expect(r.allow).toBe(true)
		expect(r.tokens[0].verdict).toBe('NOT_A_STOCK_TOKEN')
		expect(r.tokens[0].reasons).toEqual(['NOT_IN_LIST', 'CODE_HASH_DIFFERS', 'BEACON_DIFFERS'])
		expect(r.tokens[0].ticker).toBeNull()
	})

	test('no symbol() and no name()', () => {
		expect(one(stranger(FAKE, null, null)).verdict).toBe('NOT_A_STOCK_TOKEN')
	})

	test('hidden characters alone, with no listed ticker behind them, are not a look-alike', () => {
		const t = one(stranger(FAKE, 'ZZ\u200bZZ', 'Zed'))
		expect(t.verdict).toBe('NOT_A_STOCK_TOKEN')
		expect(t.reasonBits & Reason.HIDDEN_CHARACTERS).toBe(0)
	})
})

describe('refusals for the whole tx', () => {
	test('another chain', () => {
		const r = check(input([state(QQQ)], undefined, { chainId: 1 }))
		expect(r).toMatchObject({ allow: false, reasonBits: Reason.WRONG_CHAIN, reasons: ['WRONG_CHAIN'], tokens: [] })
	})

	test('a tx that is not in a block', () => {
		expect(check(input([], [], { txFound: false })).reasons).toEqual(['TX_NOT_FOUND'])
	})

	test('no transfer of the wallet in the tx', () => {
		const r = check(input([state(QQQ)], [transfer(QQQ, OTHER, OTHER, 1n, 0), transfer(QQQ, OTHER, WALLET, 1n, 1, `0x${'cd'.repeat(32)}`)]))
		expect(r.allow).toBe(false)
		expect(r.reasons).toEqual(['NO_WALLET_TRANSFER'])
	})

	test('more tokens than were read', () => {
		const r = check(input([state(QQQ)], undefined, { skipped: 3 }))
		expect(r.tokens[0].verdict).toBe('GENUINE_STOCK_TOKEN')
		expect(r.reasons).toEqual(['TOO_MANY_TRANSFERS'])
		expect(r.allow).toBe(false)
	})

	test('a token with a transfer but no state', () => {
		const r = check(input([state(QQQ)], [transfer(QQQ, OTHER, WALLET, 1n, 0), transfer(NVDA, OTHER, WALLET, 1n, 1)]))
		expect(r.allow).toBe(false)
		expect(r.reasonBits & Reason.TOO_MANY_TRANSFERS).toBeTruthy()
	})
})

describe('the multiplier (corporate actions)', () => {
	const AFTER = '1000700791241405425'
	const update = (block: number, logIndex = 0) => ({ block, logIndex, tx: `0x${'ee'.repeat(32)}`, before: MULTIPLIER_ONE, after: AFTER, effectiveAt: 1790035834 })

	test('changed after the tx: a notice, the tx is still allowed', () => {
		const r = check(input([state(QQQ, { multiplier: AFTER, multiplierUpdates: [update(BLOCK + 10)] })]))
		const t = r.tokens[0]
		expect(r.allow).toBe(true)
		expect(t.verdict).toBe('GENUINE_STOCK_TOKEN')
		expect(t.reasons).toEqual(['MULTIPLIER_CHANGED', 'MULTIPLIER_CHANGED_AFTER_TX'])
		expect(t.multiplier).toBe('1.000700791241405425')
		expect(t.multiplierChanged).toBe(true)
		expect(t.multiplierChangedAfterTx).toBe(true)
		expect(t.multiplierUpdates).toEqual([
			{ block: BLOCK + 10, tx: `0x${'ee'.repeat(32)}`, before: '1', after: '1.000700791241405425', effectiveAt: 1790035834, afterTx: true },
		])
	})

	test('changed before the tx only (no update log since the tx, window complete)', () => {
		const t = one(state(QQQ, { multiplier: AFTER, multiplierUpdates: [] }))
		expect(t.reasons).toEqual(['MULTIPLIER_CHANGED'])
		expect(t.multiplierChanged).toBe(true)
		expect(t.multiplierChangedAfterTx).toBe(false)
	})

	test('in the block of the tx: after it only when the log comes after the transfer', () => {
		const logs = [transfer(QQQ, OTHER, WALLET, 1n, 5)]
		expect(check(input([state(QQQ, { multiplier: AFTER, multiplierUpdates: [update(BLOCK, 9)] })], logs)).tokens[0].multiplierChangedAfterTx).toBe(true)
		expect(check(input([state(QQQ, { multiplier: AFTER, multiplierUpdates: [update(BLOCK, 2)] })], logs)).tokens[0].multiplierChangedAfterTx).toBe(false)
	})

	test('not 1, and the log window did not reach the head: after the tx is unknown', () => {
		const t = one(state(QQQ, { multiplier: AFTER, multiplierUpdates: [], multiplierLogsComplete: false }))
		expect(t.multiplierChanged).toBe(true)
		expect(t.multiplierChangedAfterTx).toBeNull()
	})

	test('uiMultiplier() does not answer: a notice', () => {
		const t = one(state(QQQ, { multiplier: null }))
		expect(t.verdict).toBe('GENUINE_STOCK_TOKEN')
		expect(t.reasons).toEqual(['MULTIPLIER_UNREADABLE'])
		expect(t.multiplierChanged).toBeNull()
	})

	test('a look-alike that answers uiMultiplier() gets no multiplier', () => {
		const t = one(stranger(FAKE, 'NVDA', 'NVIDIA', { multiplier: '2000000000000000000' }))
		expect(t.multiplier).toBeNull()
		expect(t.multiplierChanged).toBeNull()
	})

	test('multiplierUpdates decodes the token log and skips anything else', () => {
		const log: Log = {
			address: QQQ,
			topics: [UI_MULTIPLIER_UPDATED_TOPIC],
			data: `0x${word(10n ** 18n)}${word(BigInt(AFTER))}${word(1790035834n)}`,
			blockNumber: '0x4201376',
			transactionHash: `0x${'EE'.repeat(32)}`,
			logIndex: '0x3a',
		}
		expect(multiplierUpdates(QQQ, [log, { ...log, address: NVDA }, { ...log, data: '0x' }, transfer(QQQ, OTHER, WALLET, 1n, 0)])).toEqual([
			{ block: 69210998, logIndex: 58, tx: `0x${'ee'.repeat(32)}`, before: MULTIPLIER_ONE, after: AFTER, effectiveAt: 1790035834 },
		])
	})

	test('decimal18', () => {
		expect(decimal18(MULTIPLIER_ONE)).toBe('1')
		expect(decimal18('2000000000000000000')).toBe('2')
		expect(decimal18('500000000000000000')).toBe('0.5')
		expect(decimal18(AFTER)).toBe('1.000700791241405425')
	})
})

describe('reading logs and call answers', () => {
	test('walletTransfers: only this tx, only this wallet, each log once, in log order', () => {
		const logs = [
			transfer(QQQ, OTHER, WALLET, 7n, 9),
			transfer(USDG, WALLET, OTHER, 3n, 4),
			transfer(USDG, WALLET, OTHER, 3n, 4),
			transfer(NVDA, OTHER, OTHER, 1n, 5),
			transfer(NVDA, OTHER, WALLET, 1n, 6, `0x${'cd'.repeat(32)}`),
			{ ...transfer(NVDA, OTHER, WALLET, 1n, 7), topics: [TRANSFER_TOPIC, pad(OTHER)] },
		]
		expect(walletTransfers(WALLET.toUpperCase().replace('0X', '0x'), TX, logs).map((t) => [t.token, t.direction, t.amountRaw, t.logIndex])).toEqual([
			[USDG, 'out', '3', 4],
			[QQQ, 'in', '7', 9],
		])
	})

	test('factoryNames: the factory, the deployment topic, and the token in the first data word', () => {
		const log: Log = {
			address: STOCK_TOKEN_FACTORY,
			topics: [TOKEN_DEPLOYED_TOPIC],
			data: `0x${'0'.repeat(24)}${QQQ.slice(2)}${word(96n)}${word(160n)}`,
			blockNumber: '0xbc9f',
			transactionHash: TX,
			logIndex: '0x1',
		}
		expect(factoryNames(QQQ, [log])).toBe(true)
		expect(factoryNames(NVDA, [log])).toBe(false)
		expect(factoryNames(QQQ, [{ ...log, address: OTHER }])).toBe(false)
		expect(factoryNames(QQQ, [{ ...log, topics: [TRANSFER_TOPIC] }])).toBe(false)
		expect(factoryNames(QQQ, [])).toBe(false)
	})

	test('decodeAbiText: an ABI string, a bytes32, and answers that are neither', () => {
		const abi = (hexText: string, length: number) => `0x${word(32n)}${word(BigInt(length))}${hexText.padEnd(64, '0')}`
		expect(decodeAbiText(abi('515151', 3))).toBe('QQQ')
		expect(decodeAbiText(abi('55e281af53e281af4447', 10))).toBe('U\u206fS\u206fDG')
		expect(decodeAbiText(`0x${'4d4b52'.padEnd(64, '0')}`)).toBe('MKR')
		expect(decodeAbiText('0x')).toBeNull()
		expect(decodeAbiText(null)).toBeNull()
		expect(decodeAbiText(`0x${word(32n)}${word(4000n)}${'00'.repeat(32)}`)).toBeNull()
		// a very long answer is cut
		expect(decodeAbiText(abi('41'.repeat(200), 200).replace(/0+$/, '').padEnd(2 + 64 * 9, '0'))).toHaveLength(96)
	})

	test('decodeUint, codeHashOf, addressInWord', () => {
		expect(decodeUint('0x0000000000000000000000000000000000000000000000000de33411546573f1')).toBe('1000700791241405425')
		expect(decodeUint('0x')).toBeNull()
		expect(codeHashOf('0x')).toBeNull()
		expect(codeHashOf(null)).toBeNull()
		expect(codeHashOf('0x00')).toBe('0xbc36789e7a1e281436464229828f817d6612f7b477d66591ff96a9e064bcc98a')
		expect(addressInWord(BEACON_WORD)).toBe(STOCK_TOKEN_BEACON)
		expect(addressInWord('0x0')).toBe(`0x${'0'.repeat(40)}`)
	})
})

describe('text folding', () => {
	test('stripHidden removes what the eye cannot see', () => {
		expect(stripHidden('U\u206fS\u206fDG')).toBe('USDG')
		expect(stripHidden('N\u200bV\u200dD\ufeffA\u00ad')).toBe('NVDA')
		expect(stripHidden('NVDA\u2800')).toBe('NVDA')
		expect(stripHidden('N\u0301VDA')).toBe('NVDA')
		expect(stripHidden('A\u00a0B\u3000C')).toBe('A B C')
	})

	test('tickerKey and nameKey', () => {
		expect(tickerKey(' nvd\u0430 ')).toBe('NVDA')
		expect(nameKey('NVIDIA • Robinhood Token')).toBe('nvidia')
		expect(nameKey('NVIDIA Robinhood Coin')).toBe('nvidia')
		expect(nameKey('Invesco  QQQ - Robinhood Stock Token')).toBe('invesco qqq')
		expect(nameKey('Global\u200b Dollar')).toBe('global dollar')
	})

	test('claimsRobinhoodToken', () => {
		expect(claimsRobinhoodToken('Invesco QQQ • Robinhood Token')).toBe(true)
		expect(claimsRobinhoodToken('NVIDIA Robinhood Coin')).toBe(true)
		expect(claimsRobinhoodToken('Robinhood Fan Club')).toBe(false)
		expect(claimsRobinhoodToken('Wrapped Ether')).toBe(false)
	})

	test('every listed ticker and name folds to itself, and to nothing else in the list', () => {
		expect(new Set(SNAPSHOT.tokens.map((t) => tickerKey(t.symbol))).size).toBe(195)
		for (const t of SNAPSHOT.tokens) expect(tickerKey(t.symbol)).toBe(t.symbol.toUpperCase())
	})

	test('showText makes every non-ASCII character visible, the bullet excepted', () => {
		expect(showText('Invesco QQQ • Robinhood Token')).toBe('Invesco QQQ • Robinhood Token')
		expect(showText('NVD\u0410')).toBe('NVD[U+0410]')
		expect(showText('\ud835\udc0d')).toBe('[U+1D40D]')
	})
})

describe('render', () => {
	test('one line per token and reason, a result line at the end, no line near the 1 kb log limit', () => {
		const r = check(input([state(QQQ), stranger(FAKE, 'NVDA', 'NVIDIA Robinhood Coin')]))
		const lines = render(r)
		expect(lines.at(-1)).toBe(`RESULT: DO NOT ALLOW  reasonBits ${r.reasonBits}`)
		expect(lines.some((l) => l.startsWith('LOOKALIKE'))).toBe(true)
		expect(renderHeader(TX, WALLET)[3]).toContain('195 Stock Tokens')
		expect(lines.some((l) => l.includes('SYMBOL_COPIES_LISTED'))).toBe(true)
		for (const l of lines) expect(l.length).toBeLessThan(400)
	})
})
