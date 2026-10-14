// The mandate: who the agent acts for, and what it may do.
//
// One JSON document names the principal (a person's address), the agent's payment key,
// the rules and the limits by hash, the dates it is valid, and "practice only". The
// principal signs one line of text that carries the document's keccak256 (EIP-191,
// the personal_sign every wallet offers). Every trail carries the document, the
// signature and the address the signature recovers to. Rule M1 gives HOLD unless that
// address is the principal.
//
// Pure and synchronous: the signature is recovered with BigInt arithmetic written for
// this file, so the CRE workflow (WASM) and the agent run the same check. verify.mjs
// has its own, separate writing of it.
import { hexToBytes, keccak256 } from 'viem'
import { canonicalJson, keccakText, utf8 } from '../rwa-verify/verify'

export type Mandate = {
	mandate_version: 1
	title: string
	/** The person the agent acts for. The signature must recover to this address. */
	principal: string
	agent: { name: string; payment_key: string }
	scope: { practice_only: boolean; may: string[]; may_not: string[] }
	rules: { id: string; version: number; source_keccak: string; limits_rules_keccak: string }
	limits_keccak: string
	chain_id: number
	valid_from: string
	valid_until: string
}

/** What a trail carries: the document, its hash, the signature and who it recovers to. */
export type MandateRef = { document: Mandate; keccak: string; signature: string | null; signer: string | null }

export function mandateKeccak(m: Mandate): string {
	return keccakText(canonicalJson(m))
}

/** The one line the principal signs. It can be read before signing, and it binds the whole document by hash. */
export function mandateMessage(m: Mandate): string {
	return `vet402 copy-guard mandate v${m.mandate_version}: I, ${m.principal}, authorize the agent whose payment key is ${m.agent.payment_key} to act for me under the mandate with keccak256 ${mandateKeccak(m)}. Practice trades only: ${m.scope.practice_only ? 'yes' : 'no'}. Valid from ${m.valid_from} until ${m.valid_until}.`
}

// ---------------------------------------------------------------- secp256k1 public key recovery
// The curve y^2 = x^3 + 7 over the prime field P, as in SEC 2 (https://www.secg.org/sec2-v2.pdf,
// section 2.4.1), and public key recovery as in SEC 1 section 4.1.6. Jacobian coordinates.

const P = 2n ** 256n - 2n ** 32n - 977n
const N = 0xfffffffffffffffffffffffffffffffebaaedce6af48a03bbfd25e8cd0364141n
const G: Point = [0x79be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798n, 0x483ada7726a3c4655da4fbfc0e1108a8fd17b448a68554199c47d08ffb10d4b8n, 1n]
type Point = [bigint, bigint, bigint]

const mod = (a: bigint, m: bigint) => ((a % m) + m) % m
function powMod(b: bigint, e: bigint, m: bigint): bigint {
	let r = 1n
	let x = mod(b, m)
	for (let k = e; k > 0n; k >>= 1n) {
		if (k & 1n) r = (r * x) % m
		x = (x * x) % m
	}
	return r
}
const inv = (a: bigint, m: bigint) => powMod(a, m - 2n, m)

function double([x, y, z]: Point): Point {
	if (y === 0n) return [0n, 1n, 0n]
	const s = mod(4n * x * y * y, P)
	const m = mod(3n * x * x, P)
	const x2 = mod(m * m - 2n * s, P)
	return [x2, mod(m * (s - x2) - 8n * y * y * y * y, P), mod(2n * y * z, P)]
}
function add(a: Point, b: Point): Point {
	if (a[2] === 0n) return b
	if (b[2] === 0n) return a
	const z1z1 = mod(a[2] * a[2], P)
	const z2z2 = mod(b[2] * b[2], P)
	const u1 = mod(a[0] * z2z2, P)
	const u2 = mod(b[0] * z1z1, P)
	const s1 = mod(a[1] * b[2] * z2z2, P)
	const s2 = mod(b[1] * a[2] * z1z1, P)
	if (u1 === u2) return s1 === s2 ? double(a) : [0n, 1n, 0n]
	const h = mod(u2 - u1, P)
	const r = mod(s2 - s1, P)
	const h2 = mod(h * h, P)
	const h3 = mod(h * h2, P)
	const x3 = mod(r * r - h3 - 2n * u1 * h2, P)
	return [x3, mod(r * (u1 * h2 - x3) - s1 * h3, P), mod(h * a[2] * b[2], P)]
}
function mul(k: bigint, p: Point): Point {
	let r: Point = [0n, 1n, 0n]
	let q = p
	for (let e = mod(k, N); e > 0n; e >>= 1n) {
		if (e & 1n) r = add(r, q)
		q = double(q)
	}
	return r
}

const hex32 = (n: bigint) => n.toString(16).padStart(64, '0')

/** The address whose key made this 65-byte signature (r, s, v) over a 32-byte hash, or null when there is none. */
export function recoverAddress(hash: string, signature: string): string | null {
	if (!/^0x[0-9a-fA-F]{64}$/.test(hash) || !/^0x[0-9a-fA-F]{130}$/.test(signature)) return null
	const r = BigInt(`0x${signature.slice(2, 66)}`)
	const s = BigInt(`0x${signature.slice(66, 130)}`)
	let v = Number.parseInt(signature.slice(130, 132), 16)
	if (v >= 27) v -= 27
	if ((v !== 0 && v !== 1) || r <= 0n || r >= N || s <= 0n || s >= N) return null
	const y2 = mod(r * r * r + 7n, P)
	let y = powMod(y2, (P + 1n) / 4n, P)
	if (mod(y * y, P) !== y2) return null
	if (Number(y & 1n) !== v) y = P - y
	const z = BigInt(hash)
	const rInv = inv(r, N)
	const q = add(mul(mod(-z * rInv, N), G), mul(mod(s * rInv, N), [r, y, 1n]))
	if (q[2] === 0n) return null
	const zi = inv(q[2], P)
	const zi2 = mod(zi * zi, P)
	const x = mod(q[0] * zi2, P)
	const yy = mod(q[1] * zi2 * zi, P)
	return `0x${keccak256(hexToBytes(`0x${hex32(x)}${hex32(yy)}`)).slice(-40)}`
}

/** EIP-191: keccak256("\x19Ethereum Signed Message:\n" + byte length + message). */
export function personalHash(message: string): string {
	const bytes = utf8(message)
	const prefix = utf8(`\x19Ethereum Signed Message:\n${bytes.length}`)
	const all = new Uint8Array(prefix.length + bytes.length)
	all.set(prefix)
	all.set(bytes, prefix.length)
	return keccak256(all)
}

/** Who signed this mandate, lower-cased, or null. */
export function mandateSigner(m: Mandate, signature: string | null): string | null {
	if (!signature) return null
	return recoverAddress(personalHash(mandateMessage(m)), signature.trim())
}

export function mandateRef(m: Mandate, signature: string | null): MandateRef {
	const sig = signature ? signature.trim() : null
	return { document: m, keccak: mandateKeccak(m), signature: sig, signer: mandateSigner(m, sig) }
}

const ADDRESS = /^0x[0-9a-fA-F]{40}$/
const HASH = /^0x[0-9a-f]{64}$/
export const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{3})?Z$/

export function parseMandate(v: unknown): Mandate {
	const m = v as Mandate
	const bad = (what: string): never => {
		throw new Error(`mandate.json: ${what}`)
	}
	if (!m || typeof m !== 'object') bad('not an object')
	if (m.mandate_version !== 1) bad('mandate_version must be 1')
	if (!ADDRESS.test(m.principal ?? '')) bad('principal must be an address')
	if (!ADDRESS.test(m.agent?.payment_key ?? '')) bad('agent.payment_key must be an address')
	if (typeof m.scope?.practice_only !== 'boolean') bad('scope.practice_only must be true or false')
	if (!HASH.test(m.rules?.source_keccak ?? '') || !HASH.test(m.rules?.limits_rules_keccak ?? '') || !HASH.test(m.limits_keccak ?? '')) bad('rules and limits must be named by keccak256')
	if (!ISO.test(m.valid_from ?? '') || !ISO.test(m.valid_until ?? '')) bad('valid_from and valid_until must be UTC times such as 2026-10-14T00:00:00Z')
	return m
}
