// The seller side of x402 v2 for the gate: what it asks for, and how it checks what it is sent.
//
// Same terms as vet402's own paid route: scheme `exact`, Robinhood Chain (eip155:4663),
// 0.01 USDG, paid to the vet402 wallet, transfer method Permit2 (USDG has no EIP-3009).
// The payer signs a Permit2 witness transfer whose spender is the canonical
// x402ExactPermit2Proxy and whose witness pins `to` to the vet402 wallet. A facilitator
// (Dexter) checks the signature and sends the settlement. The gate holds no key.
import { getAddress, isAddress, verifyTypedData, type Hex } from 'viem'
import { MAX_PRICE_ATOMIC, PAY_TO, USDG, X402_NETWORK } from '../rules'
import { CHAIN_ID, PERMIT2, PERMIT2_TYPES, X402_PERMIT2_PROXY } from '../x402'

export const FACILITATOR_URL = 'https://x402.dexter.cash'
export const PRICE_ATOMIC = MAX_PRICE_ATOMIC
/** A signature must stay valid at least this long, so it cannot run out between verify and settle. */
const MIN_VALIDITY_SECONDS = 45
export const MAX_TIMEOUT_SECONDS = 120
const FACILITATOR_TIMEOUT_MS = 15_000

export function paymentRequirements() {
	return {
		scheme: 'exact' as const,
		network: X402_NETWORK,
		amount: PRICE_ATOMIC,
		asset: getAddress(USDG),
		payTo: getAddress(PAY_TO),
		maxTimeoutSeconds: MAX_TIMEOUT_SECONDS,
		extra: { name: 'Global Dollar', version: '1', assetTransferMethod: 'permit2' as const },
	}
}

export function paymentRequired(resourceUrl: string, error?: string) {
	return {
		x402Version: 2 as const,
		...(error ? { error } : {}),
		resource: {
			url: resourceUrl,
			description: "One run of the Chainlink CRE workflow vet402-rwa-verify: re-verify a wallet's anchored vet402 /rwa record against RwaAnchor on Robinhood Chain and return MATCH or MISMATCH",
			mimeType: 'application/json',
		},
		accepts: [paymentRequirements()],
	}
}

export const b64json = (v: unknown) => Buffer.from(JSON.stringify(v), 'utf8').toString('base64')

export class BadPayment extends Error {
	constructor(readonly reason: string) {
		super(reason)
	}
}

type Permit2Authorization = {
	permitted: { token: string; amount: string }
	from: string
	spender: string
	nonce: string
	deadline: string
	witness: { to: string; validAfter: string }
}
export type PaymentPayload = { x402Version: 2; accepted: Record<string, unknown>; payload: { signature: Hex; permit2Authorization: Permit2Authorization }; resource?: unknown }

const same = (x: unknown, y: string) => typeof x === 'string' && x.toLowerCase() === y.toLowerCase()
const isUint = (x: unknown): x is string => typeof x === 'string' && /^\d+$/.test(x)

/** Decode PAYMENT-SIGNATURE and refuse anything that is not exactly what the gate asked for. */
export function parsePaymentHeader(header: string, nowSec: number = Math.floor(Date.now() / 1000)): PaymentPayload {
	let p: PaymentPayload
	try {
		p = JSON.parse(Buffer.from(header, 'base64').toString('utf8'))
	} catch {
		throw new BadPayment('payment_header_not_base64_json')
	}
	if (!p || p.x402Version !== 2 || typeof p.accepted !== 'object' || typeof p.payload !== 'object' || !p.accepted || !p.payload) throw new BadPayment('payment_payload_shape')
	const a = p.accepted
	const want = paymentRequirements()
	if (a.scheme !== want.scheme || a.network !== want.network) throw new BadPayment('wrong_scheme_or_network')
	if (!same(a.asset, want.asset)) throw new BadPayment('wrong_asset')
	if (!same(a.payTo, want.payTo)) throw new BadPayment('wrong_pay_to')
	if (String(a.amount) !== want.amount) throw new BadPayment('amount_is_not_the_price')
	const auth = p.payload.permit2Authorization
	if (!auth || typeof p.payload.signature !== 'string' || !/^0x[0-9a-fA-F]+$/.test(p.payload.signature)) throw new BadPayment('permit2_authorization_required')
	if (!same(auth.witness?.to, want.payTo)) throw new BadPayment('witness_to_is_not_pay_to')
	if (!same(auth.permitted?.token, want.asset)) throw new BadPayment('permitted_token_is_not_usdg')
	if (auth.permitted?.amount !== want.amount) throw new BadPayment('permitted_amount_is_not_the_price')
	if (!same(auth.spender, X402_PERMIT2_PROXY)) throw new BadPayment('spender_is_not_the_x402_proxy')
	if (typeof auth.from !== 'string' || !isAddress(auth.from)) throw new BadPayment('from_is_not_an_address')
	if (!isUint(auth.nonce) || !isUint(auth.deadline) || !isUint(auth.witness?.validAfter)) throw new BadPayment('permit2_fields_not_uint')
	if (BigInt(auth.deadline) < BigInt(nowSec + MIN_VALIDITY_SECONDS)) throw new BadPayment('deadline_too_soon')
	if (BigInt(auth.witness.validAfter) > BigInt(nowSec)) throw new BadPayment('not_valid_yet')
	return p
}

/** Recover the Permit2 witness signature here, so a forged header never reaches the facilitator. EOA signatures only. */
export async function checkSignature(p: PaymentPayload): Promise<boolean> {
	const auth = p.payload.permit2Authorization
	try {
		return await verifyTypedData({
			address: getAddress(auth.from),
			domain: { name: 'Permit2', chainId: CHAIN_ID, verifyingContract: PERMIT2 },
			types: PERMIT2_TYPES,
			primaryType: 'PermitWitnessTransferFrom',
			message: {
				permitted: { token: getAddress(auth.permitted.token), amount: BigInt(auth.permitted.amount) },
				spender: getAddress(auth.spender),
				nonce: BigInt(auth.nonce),
				deadline: BigInt(auth.deadline),
				witness: { to: getAddress(auth.witness.to), validAfter: BigInt(auth.witness.validAfter) },
			},
			signature: p.payload.signature,
		})
	} catch {
		return false
	}
}

export type SettleResult = { success: boolean; errorReason?: string; transaction: string; network?: string; payer?: string; amount?: string }
export type SettleOutcome = { kind: 'settled'; result: SettleResult } | { kind: 'failed'; result: SettleResult } | { kind: 'unknown'; detail: string }

async function facilitator<T>(path: '/verify' | '/settle', payment: PaymentPayload, fetchImpl: typeof fetch): Promise<{ ok: boolean; status: number; body: T | null }> {
	const res = await fetchImpl(`${FACILITATOR_URL}${path}`, {
		method: 'POST',
		headers: { 'content-type': 'application/json' },
		body: JSON.stringify({ x402Version: 2, paymentPayload: payment, paymentRequirements: paymentRequirements() }),
		signal: AbortSignal.timeout(FACILITATOR_TIMEOUT_MS),
	})
	let body: T | null = null
	try {
		body = JSON.parse(await res.text()) as T
	} catch {
		body = null
	}
	return { ok: res.ok, status: res.status, body }
}

/** Valid only on a 2xx whose body says `isValid: true`. No boolean `isValid` is an outage and throws. */
export async function verifyPayment(p: PaymentPayload, fetchImpl: typeof fetch = fetch): Promise<{ isValid: boolean; invalidReason?: string; payer?: string }> {
	const r = await facilitator<{ isValid: boolean; invalidReason?: string; payer?: string }>('/verify', p, fetchImpl)
	if (!r.body || typeof r.body.isValid !== 'boolean') throw new Error(`facilitator /verify ${r.status}`)
	return { ...r.body, isValid: r.ok && r.body.isValid === true }
}

/**
 * Only a 2xx with `success: false` and no tx is a clean "nothing moved". A 2xx with
 * `success: true` and a tx hash is settled. Anything else is unknown: the money may have
 * moved, so the caller still gets the answer it paid for.
 */
export async function settlePayment(p: PaymentPayload, fetchImpl: typeof fetch = fetch): Promise<SettleOutcome> {
	let r: { ok: boolean; status: number; body: SettleResult | null }
	try {
		r = await facilitator<SettleResult>('/settle', p, fetchImpl)
	} catch (err) {
		return { kind: 'unknown', detail: err instanceof Error ? err.name : 'error' }
	}
	const b = r.body
	const hasTx = !!b && typeof b.transaction === 'string' && /^0x[0-9a-fA-F]{64}$/.test(b.transaction)
	if (r.ok && b && b.success === true && hasTx) return { kind: 'settled', result: b }
	if (r.ok && b && b.success === false && !hasTx) return { kind: 'failed', result: b }
	return { kind: 'unknown', detail: `status ${r.status}` }
}
