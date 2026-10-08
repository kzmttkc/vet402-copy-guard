// Buying a vet402 /rwa record over x402 v2 on Robinhood Chain.
//
// The route answers 402 with PAYMENT-REQUIRED. The terms are `exact` with
// `assetTransferMethod: permit2`, because USDG has no EIP-3009: the payer signs
// a Permit2 witness transfer whose spender is the canonical
// x402ExactPermit2Proxy and whose witness pins `to` = the vet402 wallet. The
// facilitator (Dexter) sends the settle tx and pays its gas. The payer needs
// gas only once, for approve(Permit2) on USDG.
//
// Default is a dry run: read the 402, check the terms, build the exact typed
// data that would be signed, and stop. Nothing is signed or sent. Only `--pay`
// signs, and never past the spend cap below.
import { existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { getAddress, hashTypedData, type Hex } from 'viem'
import { MAX_PRICE_ATOMIC, PAY_TO, type Terms, USDG, X402_NETWORK } from './rules'

/** Hard cap on everything this agent may ever pay, in USDG atomic units (6 decimals): 1 USDG. */
export const MAX_SPEND_ATOMIC = 1_000_000n
export const PERMIT2 = '0x000000000022D473030F116dDEE9F6B43aC78BA3'
export const X402_PERMIT2_PROXY = '0x402085c248EeA27D92E8b30b2C58ed07f9E20001'
export const CHAIN_ID = 4663

export class RefusedTerms extends Error {}
export class CapReached extends Error {}

export type Accept = {
	scheme: string
	network: string
	amount: string
	asset: string
	payTo: string
	maxTimeoutSeconds?: number
	extra?: { name?: string; version?: string; assetTransferMethod?: string }
}

export type PaymentRequired = { x402Version: number; resource?: unknown; accepts: Accept[]; error?: string }

export function decodeRequired(header: string): PaymentRequired {
	return JSON.parse(Buffer.from(header, 'base64').toString('utf8'))
}

export function termsOf(a: Accept): Terms {
	return {
		scheme: a.scheme,
		network: a.network,
		asset: a.asset,
		amount: String(a.amount),
		payTo: a.payTo,
		assetTransferMethod: a.extra?.assetTransferMethod ?? '',
	}
}

/** The only terms this agent signs. Anything else is refused before a signature exists. */
export function pickAccept(req: PaymentRequired): Accept {
	if (req.x402Version !== 2) throw new RefusedTerms(`x402Version ${req.x402Version}`)
	const same = (a: string, b: string) => String(a ?? '').toLowerCase() === b.toLowerCase()
	const a = (req.accepts ?? []).find(
		(x) =>
			x.scheme === 'exact' &&
			x.network === X402_NETWORK &&
			same(x.asset, USDG) &&
			same(x.payTo, PAY_TO) &&
			x.extra?.assetTransferMethod === 'permit2' &&
			/^\d+$/.test(String(x.amount)) &&
			BigInt(x.amount) > 0n &&
			BigInt(x.amount) <= BigInt(MAX_PRICE_ATOMIC),
	)
	if (!a) throw new RefusedTerms(`no acceptable terms in ${JSON.stringify(req.accepts)}`)
	return a
}

// ---------------------------------------------------------------- Permit2

export const PERMIT2_TYPES = {
	PermitWitnessTransferFrom: [
		{ name: 'permitted', type: 'TokenPermissions' },
		{ name: 'spender', type: 'address' },
		{ name: 'nonce', type: 'uint256' },
		{ name: 'deadline', type: 'uint256' },
		{ name: 'witness', type: 'Witness' },
	],
	TokenPermissions: [
		{ name: 'token', type: 'address' },
		{ name: 'amount', type: 'uint256' },
	],
	Witness: [
		{ name: 'to', type: 'address' },
		{ name: 'validAfter', type: 'uint256' },
	],
} as const

export function permit2TypedData(a: Accept, from: string, nowSec: number, nonce: bigint) {
	const deadline = BigInt(nowSec + Number(a.maxTimeoutSeconds ?? 120))
	const validAfter = BigInt(nowSec - 60)
	const message = {
		permitted: { token: getAddress(a.asset), amount: BigInt(a.amount) },
		spender: getAddress(X402_PERMIT2_PROXY),
		nonce,
		deadline,
		witness: { to: getAddress(a.payTo), validAfter },
	}
	const typedData = {
		domain: { name: 'Permit2', chainId: CHAIN_ID, verifyingContract: getAddress(PERMIT2) as Hex },
		types: PERMIT2_TYPES,
		primaryType: 'PermitWitnessTransferFrom' as const,
		message,
	}
	const authorization = {
		permitted: { token: getAddress(a.asset), amount: String(a.amount) },
		from: getAddress(from),
		spender: getAddress(X402_PERMIT2_PROXY),
		nonce: nonce.toString(),
		deadline: deadline.toString(),
		witness: { to: getAddress(a.payTo), validAfter: validAfter.toString() },
	}
	return { typedData, authorization, digest: hashTypedData(typedData) }
}

export function paymentHeader(req: PaymentRequired, a: Accept, authorization: unknown, signature: string): string {
	const payload = { x402Version: 2, resource: req.resource, accepted: a, payload: { signature, permit2Authorization: authorization } }
	return Buffer.from(JSON.stringify(payload), 'utf8').toString('base64')
}

// ---------------------------------------------------------------- spend cap

export type LedgerEntry = {
	at: string
	resource: string
	amount_atomic: string
	/** pending: sent, no answer yet. settled: tx known. unknown: may have moved. failed: facilitator said nothing moved. */
	status: 'pending' | 'settled' | 'unknown' | 'failed'
	tx: string | null
}
export type Ledger = { payer: string; cap_atomic: string; entries: LedgerEntry[] }

export function loadLedger(path: string, payer: string): Ledger {
	if (!existsSync(path)) return { payer, cap_atomic: MAX_SPEND_ATOMIC.toString(), entries: [] }
	const l = JSON.parse(readFileSync(path, 'utf8')) as Ledger
	if (l.payer.toLowerCase() !== payer.toLowerCase()) throw new Error(`spend ledger ${path} belongs to ${l.payer}`)
	return l
}

export function saveLedger(path: string, l: Ledger) {
	const tmp = `${path}.tmp`
	writeFileSync(tmp, `${JSON.stringify(l, null, 2)}\n`, { mode: 0o600 })
	renameSync(tmp, path)
}

/** Everything that may have left the wallet. Only a clean `failed` is not counted. */
export function spentAtomic(l: Ledger): bigint {
	return l.entries.filter((e) => e.status !== 'failed').reduce((s, e) => s + BigInt(e.amount_atomic), 0n)
}

/** Throws before anything is signed when this payment would cross the cap. */
export function assertUnderCap(spent: bigint, amount: bigint, cap: bigint = MAX_SPEND_ATOMIC) {
	if (amount <= 0n) throw new CapReached('amount must be positive')
	if (spent + amount > cap) {
		throw new CapReached(`spend cap reached: spent ${spent} + ${amount} > cap ${cap} (USDG atomic, 6 decimals)`)
	}
}
