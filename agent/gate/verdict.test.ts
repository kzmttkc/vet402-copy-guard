// The agent holds a gate's answer against the RecordChecked event it reads itself.
// The two receipts below are real: the logs of the two Robinhood Testnet txs saved in
// docs/broadcast-match.receipt.txt and docs/broadcast-mismatch-one-char.receipt.txt,
// copied field for field. Nothing here reaches a network.
import { describe, expect, test } from 'bun:test'
import { subjectHash } from '../../rwa-verify/verify'
import type { Rpc } from '../chain'
import { checkVerdictReceipt, confirmGateVerdict, decodeRecordChecked, ownReceiver, RECORD_CHECKED_TOPIC, TESTNET_CHAIN_ID, type VerdictCheck, type VerdictExpect } from './verdict'

const WALLET = '0xE9B08727131E34010b34006c660D4c1B436EC25f'
const RECEIVER = '0x8bf4d455d38301e9d330b12144ade02f16bc2cb3'
const FORWARDER = '0x0b93082d9b3c7c97facd250082899bacf3af3885'
const ANCHOR_TX = '0x15f9ed8ae5dd466c2f35021c9f1291e7a624abbb52c8ac26b54d47442f585c7f'
const SUBJECT = '0xa158baaf573f2b072b47acaa019ef60de680571a8a2a6ad234faf0e8a3d3bfc5'
const ANCHORED = '0x9d0e83d968786570beebf0d322b36e0836dc81ebe896bd186304405ba8f721ee'
const RECOMPUTED_ONE_CHAR_OFF = '0x29175278b6592826d444b57a80964b250f16efc7943d393a48b6d66ced0e0d99'
const ANCHOR_BLOCK = 76177721
const TOPIC = '0xd4c3e2f5744cc48d8bd2d35c78c2f893372b9b370d456461dedea1f6ec44827d'
const TAIL =
	'000000000000000000000000000000000000000000000000000000006abc7b37' +
	'00000000000000000000000000000000000000000000000000000000048a6139' +
	'1111111111111111111111111111111111111111111111111111111111111111' +
	'6433626635376132663900000000000000000000000000000000000000000000' +
	'000000000000000000000000aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
const forwarderLog = (id: string) => ({
	address: FORWARDER,
	topics: ['0x3617b009e9785c42daebadb6d3fb553243a4bf586d07ea72d65d80013ce116b5', `0x000000000000000000000000${RECEIVER.slice(2)}`, id, '0x0001000000000000000000000000000000000000000000000000000000000000'],
	data: '0x0000000000000000000000000000000000000000000000000000000000000001',
})

const MATCH_TX = '0x34ca26b37ca844ff857fc297c9c4f9404a7f28111abe5dfa65457b1066b8662d'
const MATCH_RECEIPT = {
	transactionHash: MATCH_TX,
	status: '0x1',
	blockNumber: '0x7d340e6',
	logs: [
		{ address: RECEIVER, topics: [TOPIC, ANCHOR_TX, SUBJECT, `0x${'0'.repeat(63)}1`], data: `0x${'0'.repeat(64)}${ANCHORED.slice(2)}${ANCHORED.slice(2)}${TAIL}` },
		forwarderLog('0x8ddb2f6a13459d40ed6fb01bc1d965d2430db0753ee0e82d1a502f721e9580b6'),
	],
}
const MISMATCH_TX = '0x7c5fd35427be3e1e2531d957f7fd2712adc1c591d6c3ec7937bfca8372ffebeb'
const MISMATCH_RECEIPT = {
	transactionHash: MISMATCH_TX,
	status: '0x1',
	blockNumber: '0x7d34340',
	logs: [
		{ address: RECEIVER, topics: [TOPIC, ANCHOR_TX, SUBJECT, `0x${'0'.repeat(64)}`], data: `0x${'0'.repeat(61)}120${RECOMPUTED_ONE_CHAR_OFF.slice(2)}${ANCHORED.slice(2)}${TAIL}` },
		forwarderLog('0x3821f02ab5afbc02245185203df88b368d6c44cd2581ff3686fe13b0302a3937'),
	],
}

/** What an honest gate running with --broadcast answers (agent/gate/server.ts). */
const matchAnswer = () => ({
	workflow: 'vet402-rwa-verify',
	mode: 'broadcast',
	result: { verdict: 'MATCH', reasons: [], reasonBits: 0, anchorTx: ANCHOR_TX, anchorBlock: ANCHOR_BLOCK, subject: SUBJECT, recomputedFactsHash: ANCHORED, anchoredFactsHash: ANCHORED },
	verdict_tx: MATCH_TX,
	receiver: RECEIVER,
})
const mismatchAnswer = () => ({
	workflow: 'vet402-rwa-verify',
	mode: 'broadcast',
	result: { verdict: 'MISMATCH', reasonBits: 288, anchorTx: ANCHOR_TX, recomputedFactsHash: RECOMPUTED_ONE_CHAR_OFF, anchoredFactsHash: ANCHORED },
	verdict_tx: MISMATCH_TX,
	receiver: RECEIVER,
})
const want = (over: Partial<VerdictExpect> = {}): VerdictExpect => ({ receiver: RECEIVER, anchorTx: ANCHOR_TX, wallet: WALLET, anchoredFactsHash: ANCHORED, anchorBlock: ANCHOR_BLOCK, ...over })
const why = (c: VerdictCheck) => (c.ok ? [] : c.why).join(' | ')
const clone = <T>(v: T): T => structuredClone(v)

describe('the RecordChecked event', () => {
	test('the topic is the one in the saved receipts, and the receiver is the one in the agent config', () => {
		expect(RECORD_CHECKED_TOPIC).toBe(TOPIC)
		expect(ownReceiver().toLowerCase()).toBe(RECEIVER)
		expect(subjectHash(WALLET)).toBe(SUBJECT)
		expect(TESTNET_CHAIN_ID).toBe(46630)
	})

	test('decodes the real MATCH and MISMATCH logs as docs/*.receipt.txt has them', () => {
		expect(decodeRecordChecked(MATCH_RECEIPT.logs[0])).toEqual({
			anchorTx: ANCHOR_TX,
			subject: SUBJECT,
			isMatch: true,
			reasons: 0,
			recomputedFactsHash: ANCHORED,
			anchoredFactsHash: ANCHORED,
			asOf: '1790737207',
			anchorBlock: ANCHOR_BLOCK,
			workflowId: `0x${'11'.repeat(32)}`,
			workflowName: '0x64336266353761326639',
			workflowOwner: `0x${'aa'.repeat(20)}`,
		})
		expect(decodeRecordChecked(MISMATCH_RECEIPT.logs[0])).toMatchObject({ isMatch: false, reasons: 288, recomputedFactsHash: RECOMPUTED_ONE_CHAR_OFF, anchoredFactsHash: ANCHORED })
	})

	test('a log of another shape is not decoded', () => {
		const log = MATCH_RECEIPT.logs[0]
		expect(decodeRecordChecked(MATCH_RECEIPT.logs[1])).toBeNull()
		expect(decodeRecordChecked({ ...log, topics: log.topics.slice(0, 3) })).toBeNull()
		expect(decodeRecordChecked({ ...log, data: log.data.slice(0, -64) })).toBeNull()
		expect(decodeRecordChecked({ ...log, data: `${log.data}${'0'.repeat(64)}` })).toBeNull()
		expect(decodeRecordChecked({ ...log, topics: [...log.topics.slice(0, 3), `0x${'0'.repeat(63)}2`] })).toBeNull()
		expect(decodeRecordChecked({ ...log, data: `0x${'0'.repeat(55)}100000000${log.data.slice(66)}` })).toBeNull()
		for (const junk of [null, undefined, 7, 'log', {}, { topics: 'x', data: 1 }]) expect(decodeRecordChecked(junk)).toBeNull()
	})
})

describe("the gate's answer against the receipt", () => {
	test('an honest answer passes, and what comes back is decoded from the event', () => {
		const m = checkVerdictReceipt(MATCH_RECEIPT, matchAnswer(), want())
		expect(m).toMatchObject({ ok: true, tx: MATCH_TX, event: { isMatch: true, reasons: 0, anchorTx: ANCHOR_TX, anchoredFactsHash: ANCHORED } })
		const mm = checkVerdictReceipt(MISMATCH_RECEIPT, mismatchAnswer(), want())
		expect(mm).toMatchObject({ ok: true, tx: MISMATCH_TX, event: { isMatch: false, reasons: 288, recomputedFactsHash: RECOMPUTED_ONE_CHAR_OFF } })
		// upper case in the gate's answer or the agent's own values changes nothing
		const loud = matchAnswer()
		loud.verdict_tx = `0x${MATCH_TX.slice(2).toUpperCase()}`
		loud.result.anchoredFactsHash = `0x${ANCHORED.slice(2).toUpperCase()}`
		expect(checkVerdictReceipt(MATCH_RECEIPT, loud, want({ receiver: '0x8bf4d455d38301e9d330B12144AdE02F16BC2Cb3', wallet: WALLET.toLowerCase() })).ok).toBe(true)
	})

	test('a gate that says MATCH while the event it points at says MISMATCH is not believed', () => {
		const lie = matchAnswer()
		lie.verdict_tx = MISMATCH_TX
		const c = checkVerdictReceipt(MISMATCH_RECEIPT, lie, want())
		expect(c.ok).toBe(false)
		expect(why(c)).toContain('the gate says MATCH, the event says MISMATCH')
		expect(why(c)).toContain('reason bits 0, the event 288')
		expect(why(c)).toContain('recomputed hash')
	})

	test('one field of the answer off, one at a time', () => {
		const cases: [string, (a: any) => void, RegExp][] = [
			['verdict', (a) => void (a.result.verdict = 'MISMATCH'), /the gate says MISMATCH, the event says MATCH/],
			['reason bits', (a) => void (a.result.reasonBits = 32), /reason bits 32/],
			['reason bits as a string', (a) => void (a.result.reasonBits = '0'), /reason bits/],
			['anchor tx', (a) => void (a.result.anchorTx = `0x${'16'.repeat(32)}`), /the gate says anchor/],
			['recomputed hash', (a) => void (a.result.recomputedFactsHash = RECOMPUTED_ONE_CHAR_OFF), /recomputed hash/],
			['anchored hash', (a) => void (a.result.anchoredFactsHash = RECOMPUTED_ONE_CHAR_OFF), /anchored hash/],
			['a verdict that is neither', (a) => void (a.result.verdict = 'OK'), /neither MATCH nor MISMATCH/],
			['no result', (a) => void delete a.result, /neither MATCH nor MISMATCH/],
			['no verdict tx', (a) => void (a.verdict_tx = null), /names no verdict tx/],
			['a verdict tx that is not a hash', (a) => void (a.verdict_tx = '0x1234'), /names no verdict tx/],
		]
		for (const [name, change, expected] of cases) {
			const a = matchAnswer()
			change(a)
			const c = checkVerdictReceipt(MATCH_RECEIPT, a, want())
			expect(c.ok, name).toBe(false)
			expect(why(c), name).toMatch(expected)
		}
		for (const junk of [null, undefined, 'MATCH', 7, []]) expect(checkVerdictReceipt(MATCH_RECEIPT, junk, want()).ok).toBe(false)
	})

	test("the gate's own `receiver` is never read: an event from its contract does not count", () => {
		const theirs = `0x${'be'.repeat(20)}`
		const receipt = clone(MATCH_RECEIPT)
		receipt.logs[0].address = theirs
		const answer = { ...matchAnswer(), receiver: theirs }
		const c = checkVerdictReceipt(receipt, answer, want())
		expect(c.ok).toBe(false)
		expect(why(c)).toContain("0 RecordChecked events from the agent's receiver")
		// and the honest receipt passes whatever the answer puts in `receiver`
		expect(checkVerdictReceipt(MATCH_RECEIPT, answer, want()).ok).toBe(true)
	})

	test('a real event about something else: another anchor, another wallet, a failed tx, another tx, two events', () => {
		// the gate points at a true MATCH for anchor A while the agent asked about anchor B
		let c = checkVerdictReceipt(MATCH_RECEIPT, matchAnswer(), want({ anchorTx: `0x${'16'.repeat(32)}` }))
		expect(why(c)).toContain('the agent asked about')
		c = checkVerdictReceipt(MATCH_RECEIPT, matchAnswer(), want({ wallet: `0x${'12'.repeat(20)}` }))
		expect(why(c)).toContain('another wallet')
		c = checkVerdictReceipt({ ...MATCH_RECEIPT, status: '0x0' }, matchAnswer(), want())
		expect(why(c)).toContain('did not succeed')
		c = checkVerdictReceipt({ ...MATCH_RECEIPT, transactionHash: MISMATCH_TX }, matchAnswer(), want())
		expect(why(c)).toContain('the receipt read is for')
		c = checkVerdictReceipt(null, matchAnswer(), want())
		expect(why(c)).toContain('is not on Robinhood Testnet')
		const two = clone(MATCH_RECEIPT)
		two.logs.push(clone(MISMATCH_RECEIPT.logs[0]))
		c = checkVerdictReceipt(two, matchAnswer(), want())
		expect(why(c)).toContain('2 RecordChecked events')
		const none = { ...MATCH_RECEIPT, logs: [MATCH_RECEIPT.logs[1]] }
		expect(why(checkVerdictReceipt(none, matchAnswer(), want()))).toContain('0 RecordChecked events')
		const cut = clone(MATCH_RECEIPT)
		cut.logs[0].data = cut.logs[0].data.slice(0, -64)
		expect(why(checkVerdictReceipt(cut, matchAnswer(), want()))).toContain('cannot be decoded')
	})

	test("a MATCH is held against the agent's own read of the anchor; a MISMATCH is not", () => {
		// The forwarder takes a report from anyone, so a gate can write a MATCH with hashes of its choosing.
		const forgedHash = `0x${'ab'.repeat(32)}`
		const receipt = clone(MATCH_RECEIPT)
		receipt.logs[0].data = `0x${'0'.repeat(64)}${forgedHash.slice(2)}${forgedHash.slice(2)}${TAIL}`
		const answer = matchAnswer()
		answer.result.recomputedFactsHash = forgedHash
		answer.result.anchoredFactsHash = forgedHash
		let c = checkVerdictReceipt(receipt, answer, want())
		expect(c.ok).toBe(false)
		expect(why(c)).toContain('from RwaAnchor')
		// without the agent's own read there is nothing to hold it against: this is the limit of the check
		expect(checkVerdictReceipt(receipt, answer, want({ anchoredFactsHash: undefined, anchorBlock: undefined })).ok).toBe(true)
		c = checkVerdictReceipt(MATCH_RECEIPT, matchAnswer(), want({ anchorBlock: ANCHOR_BLOCK + 1 }))
		expect(why(c)).toContain('anchor block')
		// an event that contradicts itself: MATCH with reason bits, MATCH with two different hashes, MISMATCH with none
		const bits = clone(MATCH_RECEIPT)
		bits.logs[0].data = `0x${'0'.repeat(63)}1${bits.logs[0].data.slice(66)}`
		const withBits = matchAnswer()
		withBits.result.reasonBits = 1
		expect(why(checkVerdictReceipt(bits, withBits, want()))).toContain('MATCH with reason bits 1')
		const split = clone(MATCH_RECEIPT)
		split.logs[0].data = `0x${'0'.repeat(64)}${RECOMPUTED_ONE_CHAR_OFF.slice(2)}${ANCHORED.slice(2)}${TAIL}`
		const splitAnswer = matchAnswer()
		splitAnswer.result.recomputedFactsHash = RECOMPUTED_ONE_CHAR_OFF
		expect(why(checkVerdictReceipt(split, splitAnswer, want()))).toContain('its two hashes differ')
		const clean = clone(MISMATCH_RECEIPT)
		clean.logs[0].data = `0x${'0'.repeat(64)}${clean.logs[0].data.slice(66)}`
		const cleanAnswer = mismatchAnswer()
		cleanAnswer.result.reasonBits = 0
		expect(why(checkVerdictReceipt(clean, cleanAnswer, want()))).toContain('MISMATCH with reason bits 0')
		// a MISMATCH may carry any anchored hash (zero when no anchor log was found)
		expect(checkVerdictReceipt(MISMATCH_RECEIPT, mismatchAnswer(), want({ anchoredFactsHash: forgedHash, anchorBlock: 1 })).ok).toBe(true)
	})
})

describe('reading the tx from Robinhood Testnet', () => {
	const fakeRpc = (over: { chainId?: unknown; receipts?: unknown[]; fail?: boolean; hang?: boolean } = {}) => {
		const calls: [string, unknown[]][] = []
		const receipts = [...(over.receipts ?? [MATCH_RECEIPT])]
		const rpc: Rpc = async (method, params) => {
			calls.push([method, params])
			if (over.hang) return new Promise(() => {})
			if (over.fail) throw new Error('fetch failed')
			if (method === 'eth_chainId') return 'chainId' in over ? over.chainId : '0xb626'
			if (method === 'eth_getTransactionReceipt') return receipts.length > 1 ? receipts.shift() : receipts[0]
			throw new Error(`fake rpc: ${method} is not mocked`)
		}
		return { rpc, calls }
	}

	test('asks for the chain id and the receipt of the tx the gate names, and passes an honest answer', async () => {
		const { rpc, calls } = fakeRpc()
		const c = await confirmGateVerdict(matchAnswer(), want(), rpc)
		expect(c).toMatchObject({ ok: true, tx: MATCH_TX })
		expect(calls).toEqual([
			['eth_chainId', []],
			['eth_getTransactionReceipt', [MATCH_TX]],
		])
	})

	test('a gate that only simulated names no tx: nothing is read and the answer is not used', async () => {
		for (const tx of [null, undefined]) {
			const { rpc, calls } = fakeRpc()
			const c = await confirmGateVerdict({ ...matchAnswer(), mode: 'simulate', verdict_tx: tx }, want(), rpc)
			expect(c.ok).toBe(false)
			expect(why(c)).toContain('only simulated')
			expect(calls).toEqual([])
		}
		const { rpc, calls } = fakeRpc()
		expect((await confirmGateVerdict({ ...matchAnswer(), verdict_tx: 'https://evil.test/tx' }, want(), rpc)).ok).toBe(false)
		expect((await confirmGateVerdict(null, want(), rpc)).ok).toBe(false)
		expect(calls).toEqual([])
	})

	test('a tx that is not there, an RPC for another chain, one that fails and one that hangs: not used, never thrown', async () => {
		let r = fakeRpc({ receipts: [null] })
		let c = await confirmGateVerdict(matchAnswer(), want(), r.rpc, { tries: 3, waitMs: 1 })
		expect(why(c)).toContain('is not on Robinhood Testnet')
		expect(r.calls.filter(([m]) => m === 'eth_getTransactionReceipt')).toHaveLength(3)

		// not there yet on the first read, there on the second
		r = fakeRpc({ receipts: [null, MATCH_RECEIPT] })
		expect((await confirmGateVerdict(matchAnswer(), want(), r.rpc, { waitMs: 1 })).ok).toBe(true)

		// Robinhood Chain mainnet (4663) is not the testnet
		r = fakeRpc({ chainId: '0x1237' })
		c = await confirmGateVerdict(matchAnswer(), want(), r.rpc)
		expect(why(c)).toContain('not Robinhood Testnet')
		expect(r.calls.map(([m]) => m)).toEqual(['eth_chainId'])
		expect((await confirmGateVerdict(matchAnswer(), want(), fakeRpc({ chainId: null }).rpc)).ok).toBe(false)

		c = await confirmGateVerdict(matchAnswer(), want(), fakeRpc({ fail: true }).rpc)
		expect(why(c)).toContain('could not be read: fetch failed')

		const started = Date.now()
		c = await confirmGateVerdict(matchAnswer(), want(), fakeRpc({ hang: true }).rpc, { timeoutMs: 30 })
		expect(why(c)).toContain('did not answer in time')
		expect(Date.now() - started).toBeLessThan(2000)
	})
})
