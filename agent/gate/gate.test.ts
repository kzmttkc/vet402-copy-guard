// The gate, with the facilitator and the CRE run replaced by fakes: it answers 402
// with the published terms, runs the workflow only for a payment that checks out,
// settles only after the workflow has answered, and never charges for a failed run.
import { describe, expect, test } from 'bun:test'
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts'
import { PAY_TO, USDG } from '../rules'
import { decodeRequired, paymentHeader, permit2TypedData, pickAccept } from '../x402'
import { catalogEntry, checkInput, makeHandler, WORKFLOW } from './server'
import { FACILITATOR_URL, paymentRequirements } from './x402'

const URL_ = `http://gate.test/v1/workflows/${WORKFLOW}`
const account = privateKeyToAccount(generatePrivateKey())
const VERDICT = { verdict: 'MATCH', reasonBits: 0, anchorTx: `0x${'15'.repeat(32)}`, recomputedFactsHash: `0x${'9d'.repeat(32)}`, anchoredFactsHash: `0x${'9d'.repeat(32)}` }
const SETTLE_TX = `0x${'65'.repeat(32)}`

type World = { verify: any; settle: any; calls: string[]; runs: unknown[]; fail?: boolean; result?: typeof VERDICT }
function gate(w: World, now = Date.now) {
	return makeHandler({
		broadcast: false,
		now,
		fetchImpl: (async (url: string) => {
			w.calls.push(String(url).replace(FACILITATOR_URL, ''))
			const body = String(url).endsWith('/verify') ? w.verify : w.settle
			return new Response(JSON.stringify(body), { status: 200 })
		}) as unknown as typeof fetch,
		runWorkflow: (payload) => {
			w.runs.push(payload)
			if (w.fail) throw new Error('cre exited 1')
			return { result: w.result ?? VERDICT, tx: null }
		},
	})
}
const world = (): World => ({ verify: { isValid: true, payer: account.address }, settle: { success: true, transaction: SETTLE_TX, network: 'eip155:4663', payer: account.address }, calls: [], runs: [] })
const post = (handler: (r: Request) => Promise<Response>, headers: Record<string, string> = {}, body = '{}') => handler(new Request(URL_, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body }))

async function signed(handler: (r: Request) => Promise<Response>, change: (a: any) => void = () => {}, signer = account) {
	const first = await post(handler)
	const required = decodeRequired(first.headers.get('PAYMENT-REQUIRED') as string)
	const accept = pickAccept(required)
	const built = permit2TypedData(accept, signer.address, Math.floor(Date.now() / 1000), BigInt(Date.now()) * 1000n + BigInt(Math.floor(Math.random() * 1000)))
	const signature = await signer.signTypedData(built.typedData)
	const authorization = structuredClone(built.authorization) as any
	change(authorization)
	return paymentHeader(required, accept, authorization, signature)
}

describe('the gate', () => {
	test('no payment: 402 with exactly the terms the agent signs, and nothing runs', async () => {
		const w = world()
		const res = await post(gate(w))
		expect(res.status).toBe(402)
		const required = decodeRequired(res.headers.get('PAYMENT-REQUIRED') as string)
		expect(required.x402Version).toBe(2)
		const a = pickAccept(required)
		expect([a.scheme, a.network, a.amount, a.asset.toLowerCase(), a.payTo.toLowerCase(), a.extra?.assetTransferMethod]).toEqual(['exact', 'eip155:4663', '10000', USDG, PAY_TO, 'permit2'])
		expect((required.resource as any).url).toBe(URL_)
		expect(w.calls).toEqual([])
		expect(w.runs).toEqual([])
	})

	test('a valid payment: verified, the workflow runs once, then settled, and the verdict comes back with the settlement', async () => {
		const w = world()
		const h = gate(w)
		const payment = await signed(h)
		const res = await post(h, { 'PAYMENT-SIGNATURE': payment }, JSON.stringify({ tx: VERDICT.anchorTx }))
		expect(res.status).toBe(200)
		const body = (await res.json()) as any
		expect(body.result).toEqual(VERDICT)
		expect(body.payment).toMatchObject({ status: 'settled', transaction: SETTLE_TX })
		expect(body.written_through).toContain('Not a DON attestation')
		expect(JSON.parse(Buffer.from(res.headers.get('PAYMENT-RESPONSE') as string, 'base64').toString('utf8')).transaction).toBe(SETTLE_TX)
		expect(w.calls).toEqual(['/verify', '/settle'])
		expect(w.runs).toEqual([{ tx: VERDICT.anchorTx }])
		// the same payment again is refused before anything runs
		const again = await post(h, { 'PAYMENT-SIGNATURE': payment })
		expect(again.status).toBe(402)
		expect(decodeRequired(again.headers.get('PAYMENT-REQUIRED') as string).error).toBe('payment_already_used')
		expect(w.runs).toHaveLength(1)
	})

	test('a payment that does not check out is refused before the facilitator or the workflow is touched', async () => {
		const other = privateKeyToAccount(generatePrivateKey())
		const cases: [string, (a: any) => void][] = [
			['witness_to_is_not_pay_to', (a) => void (a.witness.to = other.address)],
			['permitted_amount_is_not_the_price', (a) => void (a.permitted.amount = '1')],
			['spender_is_not_the_x402_proxy', (a) => void (a.spender = other.address)],
			['deadline_too_soon', (a) => void (a.deadline = '1')],
			['bad_signature', (a) => void (a.nonce = '7')],
			['bad_signature', (a) => void (a.from = other.address)],
		]
		for (const [reason, change] of cases) {
			const w = world()
			const h = gate(w)
			const res = await post(h, { 'PAYMENT-SIGNATURE': await signed(h, change) })
			expect(res.status).toBe(402)
			expect(decodeRequired(res.headers.get('PAYMENT-REQUIRED') as string).error).toBe(reason)
			expect(w.calls).toEqual([])
			expect(w.runs).toEqual([])
		}
		const w = world()
		expect((await post(gate(w), { 'PAYMENT-SIGNATURE': 'not base64 json' })).status).toBe(402)
	})

	test('a CRE answer of MISMATCH is still settled; only a workflow that fails is not', async () => {
		const w = world()
		w.result = { ...VERDICT, verdict: 'MISMATCH', reasonBits: 288 }
		const h = gate(w)
		const res = await post(h, { 'PAYMENT-SIGNATURE': await signed(h) }, JSON.stringify({ tx: VERDICT.anchorTx }))
		expect(res.status).toBe(200)
		const body = (await res.json()) as any
		expect(body.result.verdict).toBe('MISMATCH')
		expect(body.payment).toMatchObject({ status: 'settled', transaction: SETTLE_TX })
		expect(w.calls).toEqual(['/verify', '/settle'])

		const failed = world()
		failed.fail = true
		const h2 = gate(failed)
		const res2 = await post(h2, { 'PAYMENT-SIGNATURE': await signed(h2) })
		expect(res2.status).toBe(502)
		expect(((await res2.json()) as any).charged).toBe(false)
		expect(failed.calls).toEqual(['/verify'])
	})

	test('nobody pays for nothing: a refused verification, a failed workflow or a bad input is never settled', async () => {
		let w = world()
		w.verify = { isValid: false, invalidReason: 'insufficient_funds' }
		let h = gate(w)
		let res = await post(h, { 'PAYMENT-SIGNATURE': await signed(h) })
		expect(res.status).toBe(402)
		expect(w.calls).toEqual(['/verify'])
		expect(w.runs).toEqual([])

		w = world()
		w.fail = true
		h = gate(w)
		res = await post(h, { 'PAYMENT-SIGNATURE': await signed(h) })
		expect(res.status).toBe(502)
		expect(((await res.json()) as any).charged).toBe(false)
		expect(w.calls).toEqual(['/verify'])

		w = world()
		h = gate(w)
		res = await post(h, { 'PAYMENT-SIGNATURE': await signed(h) }, JSON.stringify({ tx: 'nope' }))
		expect(res.status).toBe(400)
		expect(w.calls).toEqual([])
	})

	test('a settlement the facilitator says did not happen gives 402 and no verdict; an unknown one still returns the verdict', async () => {
		let w = world()
		w.settle = { success: false, errorReason: 'nonce_used', transaction: '' }
		let h = gate(w)
		let res = await post(h, { 'PAYMENT-SIGNATURE': await signed(h) })
		expect(res.status).toBe(402)
		w = world()
		w.settle = { oops: true }
		h = gate(w)
		res = await post(h, { 'PAYMENT-SIGNATURE': await signed(h) })
		expect(res.status).toBe(200)
		expect(((await res.json()) as any).payment.status).toBe('unknown')
		expect(res.headers.get('X-Payment-Status')).toBe('unknown')
	})

	test('the same payment sent twice at once runs the workflow once and is settled once', async () => {
		// The facilitator answers /verify only when the test lets it, so both requests are inside the gate together.
		const calls: string[] = []
		const runs: unknown[] = []
		const waiting: (() => void)[] = []
		const h = makeHandler({
			broadcast: false,
			fetchImpl: (async (url: string) => {
				const path = String(url).replace(FACILITATOR_URL, '')
				calls.push(path)
				if (path === '/verify') await new Promise<void>((r) => waiting.push(r))
				return new Response(JSON.stringify(path === '/verify' ? { isValid: true, payer: account.address } : { success: true, transaction: SETTLE_TX, network: 'eip155:4663', payer: account.address }), { status: 200 })
			}) as unknown as typeof fetch,
			runWorkflow: (payload) => {
				runs.push(payload)
				return { result: VERDICT, tx: null }
			},
		})
		const payment = await signed(h)
		const first = post(h, { 'PAYMENT-SIGNATURE': payment })
		const second = post(h, { 'PAYMENT-SIGNATURE': payment })
		// Let the first one go all the way through before the second one's /verify (if it made one) answers.
		while (waiting.length === 0) await new Promise((r) => setTimeout(r, 1))
		waiting.shift()?.()
		const a = await first
		await new Promise((r) => setTimeout(r, 5))
		for (const go of waiting.splice(0)) go()
		const b = await second
		expect([a.status, b.status].sort()).toEqual([200, 402])
		const refused = a.status === 402 ? a : b
		expect(decodeRequired(refused.headers.get('PAYMENT-REQUIRED') as string).error).toBe('payment_in_flight')
		expect(runs).toHaveLength(1)
		expect(calls.filter((c) => c === '/settle')).toHaveLength(1)
		expect(calls.filter((c) => c === '/verify')).toHaveLength(1)
		// and afterwards it is spent for good
		const again = await post(h, { 'PAYMENT-SIGNATURE': payment })
		expect(decodeRequired(again.headers.get('PAYMENT-REQUIRED') as string).error).toBe('payment_already_used')
		expect(runs).toHaveLength(1)
		expect(calls.filter((c) => c === '/settle')).toHaveLength(1)
		// the same nonce written another way ("0…0123" for "123") is the same payment: same signature, same Permit2 nonce
		const p = JSON.parse(Buffer.from(payment, 'base64').toString('utf8'))
		p.payload.permit2Authorization.nonce = `000${p.payload.permit2Authorization.nonce}`
		const padded = await post(h, { 'PAYMENT-SIGNATURE': Buffer.from(JSON.stringify(p), 'utf8').toString('base64') })
		expect(decodeRequired(padded.headers.get('PAYMENT-REQUIRED') as string).error).toBe('payment_already_used')
		expect(runs).toHaveLength(1)
		expect(calls.filter((c) => c === '/settle')).toHaveLength(1)
	})

	test('a payment that was not charged can be sent again: facilitator down, workflow failed, gate busy', async () => {
		// facilitator down at /verify, then back
		let w = world()
		let down = true
		let h = makeHandler({
			broadcast: false,
			fetchImpl: (async (url: string) => {
				w.calls.push(String(url).replace(FACILITATOR_URL, ''))
				if (down) throw new Error('connect ECONNREFUSED')
				return new Response(JSON.stringify(String(url).endsWith('/verify') ? w.verify : w.settle), { status: 200 })
			}) as unknown as typeof fetch,
			runWorkflow: (payload) => {
				w.runs.push(payload)
				return { result: VERDICT, tx: null }
			},
		})
		let payment = await signed(h)
		let res = await post(h, { 'PAYMENT-SIGNATURE': payment })
		expect(res.status).toBe(502)
		expect(((await res.json()) as any).charged).toBe(false)
		down = false
		res = await post(h, { 'PAYMENT-SIGNATURE': payment })
		expect(res.status).toBe(200)
		expect(w.runs).toHaveLength(1)
		expect(w.calls.filter((c) => c === '/settle')).toHaveLength(1)

		// refused by the facilitator, then accepted
		w = world()
		w.verify = { isValid: false, invalidReason: 'insufficient_funds' }
		h = gate(w)
		payment = await signed(h)
		expect((await post(h, { 'PAYMENT-SIGNATURE': payment })).status).toBe(402)
		w.verify = { isValid: true, payer: account.address }
		expect((await post(h, { 'PAYMENT-SIGNATURE': payment })).status).toBe(200)
		expect(w.calls).toEqual(['/verify', '/verify', '/settle'])

		// workflow failed, then worked
		w = world()
		w.fail = true
		h = gate(w)
		payment = await signed(h)
		expect((await post(h, { 'PAYMENT-SIGNATURE': payment })).status).toBe(502)
		w.fail = false
		expect((await post(h, { 'PAYMENT-SIGNATURE': payment })).status).toBe(200)
		expect(w.calls).toEqual(['/verify', '/verify', '/settle'])

		// busy: another payment is being settled. The second payer is told so, is not charged, and can come back.
		w = world()
		let release: () => void = () => {}
		const runs: unknown[] = []
		const calls: string[] = []
		h = makeHandler({
			broadcast: false,
			fetchImpl: (async (url: string) => {
				const path = String(url).replace(FACILITATOR_URL, '')
				calls.push(path)
				if (path === '/settle' && calls.filter((c) => c === '/settle').length === 1) await new Promise<void>((r) => (release = r))
				return new Response(JSON.stringify(path === '/verify' ? w.verify : w.settle), { status: 200 })
			}) as unknown as typeof fetch,
			runWorkflow: (payload) => {
				runs.push(payload)
				return { result: VERDICT, tx: null }
			},
		})
		const one = await signed(h)
		const two = await signed(h)
		const slow = post(h, { 'PAYMENT-SIGNATURE': one })
		while (!calls.includes('/settle')) await new Promise((r) => setTimeout(r, 1))
		res = await post(h, { 'PAYMENT-SIGNATURE': two })
		expect(res.status).toBe(503)
		expect(((await res.json()) as any).charged).toBe(false)
		release()
		expect((await slow).status).toBe(200)
		expect((await post(h, { 'PAYMENT-SIGNATURE': two })).status).toBe(200)
		expect(runs).toHaveLength(2)
		expect(calls.filter((c) => c === '/settle')).toHaveLength(2)
	})

	test('once /settle was asked, the payment stays spent even when the facilitator says nothing moved', async () => {
		const w = world()
		w.settle = { success: false, errorReason: 'nonce_used', transaction: '' }
		const h = gate(w)
		const payment = await signed(h)
		expect((await post(h, { 'PAYMENT-SIGNATURE': payment })).status).toBe(402)
		w.settle = { success: true, transaction: SETTLE_TX, network: 'eip155:4663', payer: account.address }
		const again = await post(h, { 'PAYMENT-SIGNATURE': payment })
		expect(again.status).toBe(402)
		expect(decodeRequired(again.headers.get('PAYMENT-REQUIRED') as string).error).toBe('payment_already_used')
		expect(w.calls).toEqual(['/verify', '/settle'])
		expect(w.runs).toHaveLength(1)
	})

	test('an agent can find it: the agent card, SKILL.md and the catalog name the same workflow and terms', async () => {
		const h = gate(world())
		const get = (p: string) => h(new Request(`http://gate.test${p}`))
		const card = (await (await get('/.well-known/agent.json')).json()) as any
		expect(card.url).toBe('http://gate.test')
		expect(card.payment).toMatchObject({ protocol: 'x402', network: 'eip155:4663', atomic: '10000' })
		expect(card.payment.pay_to.toLowerCase()).toBe(PAY_TO)
		expect(card.skills[0].id).toBe(WORKFLOW)
		const skill = await (await get('/SKILL.md')).text()
		expect(skill).toMatch(/^---\nname: vet402-rwa-verify\ndescription: .+\n---\n/)
		expect(skill).toContain('Do NOT use for')
		const entry = (await (await get(`/v1/catalog/${WORKFLOW}`)).json()) as any
		expect(entry.price.atomic).toBe(paymentRequirements().amount)
		expect(entry.input_schema.additionalProperties).toBe(false)
		expect(entry.execution.attestation).toContain('not a DON attestation')
		expect(catalogEntry('http://x', true).execution.mode).toBe('broadcast')
		expect(((await (await get('/v1/catalog')).json()) as any).workflows).toHaveLength(1)
		expect((await get('/nope')).status).toBe(404)
		expect(checkInput({ recordUrl: 'http://insecure' })).toMatch(/https/)
		expect(checkInput({ extra: 1 })).toMatch(/unknown field/)
		expect(checkInput({})).toBeNull()
	})
})
