import { describe, expect, test } from 'bun:test'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { recoverTypedDataAddress } from 'viem'
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts'
import { PAYMENT_REQUIRED } from './test-helpers'
import {
	assertUnderCap,
	CapReached,
	decodeRequired,
	type Ledger,
	loadLedger,
	MAX_SPEND_ATOMIC,
	permit2TypedData,
	pickAccept,
	RefusedTerms,
	spentAtomic,
	X402_PERMIT2_PROXY,
} from './x402'

const real = () => structuredClone(PAYMENT_REQUIRED.decoded) as any

describe('terms', () => {
	test('the real 402 from vet402 is accepted', () => {
		const req = decodeRequired(PAYMENT_REQUIRED.payment_required_header)
		const a = pickAccept(req)
		expect(a.amount).toBe('10000')
		expect(a.extra?.assetTransferMethod).toBe('permit2')
	})

	const refuse = (mutate: (a: any) => void) => {
		const r = real()
		mutate(r.accepts[0])
		expect(() => pickAccept(r)).toThrow(RefusedTerms)
	}
	test('more than 0.01 USDG is refused', () => refuse((a) => (a.amount = '10001')))
	test('another payee is refused', () => refuse((a) => (a.payTo = '0x1111111111111111111111111111111111111111')))
	test('another chain is refused', () => refuse((a) => (a.network = 'eip155:8453')))
	test('another token is refused', () => refuse((a) => (a.asset = '0x4190Ee598c2a69D35Bef53c83d152Ae0f25EA416')))
	test('a transfer method other than permit2 is refused', () => refuse((a) => (a.extra.assetTransferMethod = 'eip3009')))
	test('x402 v1 is refused', () => {
		const r = real()
		r.x402Version = 1
		expect(() => pickAccept(r)).toThrow(RefusedTerms)
	})
})

describe('spend cap', () => {
	test('the cap is fixed at 1 USDG', () => {
		expect(MAX_SPEND_ATOMIC).toBe(1_000_000n)
	})

	test('payments up to the cap pass, one atomic unit more stops', () => {
		expect(() => assertUnderCap(0n, 10_000n)).not.toThrow()
		expect(() => assertUnderCap(990_000n, 10_000n)).not.toThrow()
		expect(() => assertUnderCap(990_001n, 10_000n)).toThrow(CapReached)
		expect(() => assertUnderCap(1_000_000n, 1n)).toThrow(CapReached)
		expect(() => assertUnderCap(0n, 0n)).toThrow(CapReached)
	})

	test('100 calls at 0.01 fit, the 101st does not', () => {
		let spent = 0n
		for (let i = 0; i < 100; i++) {
			assertUnderCap(spent, 10_000n)
			spent += 10_000n
		}
		expect(() => assertUnderCap(spent, 10_000n)).toThrow(CapReached)
	})

	test('pending, settled and unknown count as spent, a clean failure does not', () => {
		const l: Ledger = {
			payer: '0xc380D9F41D90765A4820429B9Da151889E8bED94',
			cap_atomic: '1000000',
			entries: [
				{ at: '', resource: '', amount_atomic: '10000', status: 'settled', tx: `0x${'1'.repeat(64)}` },
				{ at: '', resource: '', amount_atomic: '10000', status: 'unknown', tx: null },
				{ at: '', resource: '', amount_atomic: '10000', status: 'pending', tx: null },
				{ at: '', resource: '', amount_atomic: '10000', status: 'failed', tx: null },
			],
		}
		expect(spentAtomic(l)).toBe(30_000n)
	})

	test('a ledger that belongs to another payer is refused', () => {
		const dir = mkdtempSync(join(tmpdir(), 'ledger-'))
		const p = join(dir, 'spend.json')
		writeFileSync(p, JSON.stringify({ payer: '0x1111111111111111111111111111111111111111', cap_atomic: '1000000', entries: [] }))
		expect(() => loadLedger(p, '0xc380D9F41D90765A4820429B9Da151889E8bED94')).toThrow()
		expect(loadLedger(join(dir, 'none.json'), '0xabc').entries).toEqual([])
	})
})

describe('Permit2 payment', () => {
	test('the typed data names the x402 proxy as spender and the vet402 wallet as witness, and a signature recovers to the payer', async () => {
		const account = privateKeyToAccount(generatePrivateKey())
		const a = pickAccept(real())
		const built = permit2TypedData(a, account.address, 1_791_500_000, 42n)
		expect(built.authorization.spender).toBe(X402_PERMIT2_PROXY)
		expect(built.authorization.witness.to).toBe('0x973cD8a91A771C2C04C6036888F8175D6b4F6227')
		expect(built.authorization.permitted.amount).toBe('10000')
		expect(built.authorization.deadline).toBe(String(1_791_500_000 + 120))
		const sig = await account.signTypedData(built.typedData)
		expect(await recoverTypedDataAddress({ ...built.typedData, signature: sig })).toBe(account.address)
	})

	test('the digest depends only on its inputs', () => {
		const a = pickAccept(real())
		const from = '0xc380D9F41D90765A4820429B9Da151889E8bED94'
		expect(permit2TypedData(a, from, 1_791_500_000, 7n).digest).toBe(permit2TypedData(a, from, 1_791_500_000, 7n).digest)
		expect(permit2TypedData(a, from, 1_791_500_000, 7n).digest).not.toBe(permit2TypedData(a, from, 1_791_500_000, 8n).digest)
	})
})
