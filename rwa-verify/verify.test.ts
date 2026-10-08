// Tests for the verification core, on real data saved from Robinhood Chain and
// vet402 /rwa (see fixtures/). The expected hashes are the ones vet402 wrote in
// its anchor record and onchain, so these tests hold this port to vet402's own
// numbers.
import { describe, expect, test } from 'bun:test'
import anchored from './fixtures/anchored-record.json'
import receipt from './fixtures/anchor-receipt.json'
import code from './fixtures/rwaanchor-code.json'
import live from './fixtures/live-facts-2026-10-08.json'
import liveHeaders from './fixtures/live-facts-2026-10-08.headers.json'
import {
	anchoredLogs,
	canonicalJson,
	commitment,
	compare,
	fromUtf8,
	keccakText,
	Reason,
	reasonList,
	RWA_ANCHOR_RUNTIME_KECCAK,
	renderVerdict,
	subjectHash,
	summarizeChain,
	summarizeRecord,
	utf8,
} from './verify'

const clone = <T>(x: T): T => JSON.parse(JSON.stringify(x))
const chain = () => summarizeChain('0x1237', receipt as any, code.code)

describe('hashing matches what vet402 anchored', () => {
	test('facts_json_keccak, preimage and facts_hash of the anchored record', () => {
		const facts = anchored.facts as any
		const c = commitment(facts)
		expect(c.material).toBe(2)
		expect(keccakText(canonicalJson({ ...facts, address: facts.address.toLowerCase() }))).toBe(anchored.facts_json_keccak)
		expect(c.preimage).toBe(anchored.preimage)
		expect(c.hash).toBe(anchored.facts_hash)
	})

	test('subject is keccak of the lower-cased wallet', () => {
		expect(subjectHash(anchored.facts.address)).toBe(anchored.subject.keccak)
	})

	test('live X-Facts-Hash from vet402.com is the hash of the body it came with', () => {
		expect(commitment(live as any).hash).toBe(liveHeaders['x-facts-hash'])
	})

	test('UTF-8 round trip keeps the look-alike characters the record names', () => {
		const s = 'U⟨U+17B5⟩S⟨U+17B5⟩DG and 💵'
		expect(fromUtf8(utf8(s))).toBe(s)
		expect(Array.from(utf8('⟨'))).toEqual([0xe2, 0x9f, 0xa8])
	})

	test('canonical JSON sorts keys and drops undefined', () => {
		expect(canonicalJson({ b: 1, a: [true, null, 'x'], c: undefined })).toBe('{"a":[true,null,"x"],"b":1}')
	})
})

describe('chain side', () => {
	test('decodes the Anchored log of tx 0x15f9…5c7f', () => {
		const logs = anchoredLogs(receipt as any)
		expect(logs).toHaveLength(1)
		expect(logs[0]).toEqual({
			address: '0x1955137e7773f2459eb75fb88842026c6517c22d',
			subject: anchored.subject.keccak,
			factsHash: anchored.facts_hash,
			anchoredBy: anchored.anchored_by.toLowerCase(),
			methodVersion: 3,
			asOf: anchored.as_of.unix,
		})
	})

	test('RwaAnchor runtime code is the pinned build', () => {
		expect(chain().codeKeccak).toBe(RWA_ANCHOR_RUNTIME_KECCAK)
		expect(chain().blockNumber).toBe(76177721)
	})
})

describe('verdict', () => {
	test('MATCH for the anchored record', () => {
		const v = compare(summarizeRecord(anchored), chain())
		expect(v.match).toBe(true)
		expect(v.reasons).toBe(0)
		expect(v.rows.every((r) => r.ok)).toBe(true)
		expect(renderVerdict(v, summarizeRecord(anchored), '0x15f9', 'x')).toContain('RESULT: MATCH')
	})

	test('MATCH for the bare facts JSON with the operator given', () => {
		const v = compare(summarizeRecord(anchored.facts), chain(), { operator: anchored.anchored_by })
		expect(v.match).toBe(true)
	})

	test('MISMATCH when one character of the record changes', () => {
		const r = clone(anchored) as any
		r.facts.tokens.find((t: any) => t.symbol === 'QQQ').realized_usd = '-170.58'
		const v = compare(summarizeRecord(r), chain())
		expect(v.match).toBe(false)
		// the token line is bound only through the whole-JSON keccak (material v2)
		expect(v.reasons).toBe(Reason.FACTS_HASH | Reason.RECORD_FACTS_HASH)
		expect(reasonList(v.reasons)).toEqual([
			'record hash differs from the anchored factsHash',
			'facts_hash written in the record differs from its own content',
		])
		expect(v.anchoredFactsHash).toBe(anchored.facts_hash)
		expect(v.recomputedFactsHash).not.toBe(anchored.facts_hash)
	})

	test('MISMATCH for the live record: newer than the anchor', () => {
		const v = compare(summarizeRecord(live), chain(), { operator: anchored.anchored_by })
		expect(v.match).toBe(false)
		expect(v.reasons & Reason.AS_OF).toBeTruthy()
		expect(v.reasons & Reason.FACTS_HASH).toBeTruthy()
		expect(v.reasons & Reason.SUBJECT).toBe(0)
	})

	test('MISMATCH when the anchor was written by someone else', () => {
		const v = compare(summarizeRecord(anchored.facts), chain(), { operator: '0x0000000000000000000000000000000000000001' })
		expect(v.reasons).toBe(Reason.ANCHORED_BY)
	})

	test('a look-alike contract emitting the same log does not pass', () => {
		const r = clone(receipt) as any
		r.logs[0].address = '0x1955137e7773f2459eb75fb88842026c6517c22e'
		const v = compare(summarizeRecord(anchored), summarizeChain('0x1237', r, code.code))
		expect(v.match).toBe(false)
		expect(v.reasons & Reason.NO_ANCHOR_LOG).toBeTruthy()
	})

	test('wrong chain, failed tx and swapped code are each named', () => {
		const r = clone(receipt) as any
		r.status = '0x0'
		const v = compare(summarizeRecord(anchored), summarizeChain('0x1', r, '0x6000'))
		expect(v.reasons & Reason.WRONG_CHAIN).toBeTruthy()
		expect(v.reasons & Reason.TX_FAILED).toBeTruthy()
		expect(v.reasons & Reason.CONTRACT_CODE).toBeTruthy()
	})

	test('missing receipt and unreadable record give MISMATCH, not a crash', () => {
		const v = compare(summarizeRecord({ nope: 1 }), summarizeChain('0x1237', null, '0x'))
		expect(v.match).toBe(false)
		expect(v.reasons & Reason.TX_FAILED).toBeTruthy()
		expect(v.reasons & Reason.RECORD_UNREADABLE).toBeTruthy()
	})

	test('unknown method_version is named', () => {
		const r = clone(anchored) as any
		r.facts.method_version = 'rwa-recon-9.9'
		const s = summarizeRecord(r)
		expect(s.readable).toBe(false)
		expect(s.error).toContain('unknown method_version')
	})
})
