// The gate: an x402 paywall in front of the Chainlink CRE workflow `rwa-verify`.
//
//   bun agent/gate/server.ts [--port 4021] [--broadcast]
//
//   POST /v1/workflows/rwa-verify      no payment: 402 with PAYMENT-REQUIRED
//                                      with PAYMENT-SIGNATURE: check it, run the workflow,
//                                      settle, answer 200 with the verdict
//   GET  /.well-known/agent.json       the agent card: what this is, what it costs
//   GET  /SKILL.md                     the same for an agent that reads Skill.md files
//   GET  /v1/catalog[/rwa-verify]      name, price, input and output schema
//
// The shape is the one Chainlink's own x402 demo uses (smartcontractkit/x402-cre-price-alerts):
// a small server takes the payment, then starts the CRE workflow. Here the server starts
// `cre workflow simulate` itself, as a child process. Nothing is deployed to a DON.
//
// Order, so nobody pays for nothing: check the payment header and the signature here,
// ask the facilitator to verify, run the workflow, and settle only when the workflow has
// answered. A request that fails before that is never charged. The gate holds no key:
// the facilitator (Dexter) sends the settlement and pays its gas, and the money goes
// straight from the payer to the vet402 wallet.
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { REPO, simulate } from '../cre'
import { PAY_TO, USDG, X402_NETWORK } from '../rules'
import { b64json, BadPayment, checkSignature, FACILITATOR_URL, parsePaymentHeader, paymentRequired, PRICE_ATOMIC, settlePayment, verifyPayment } from './x402'

export const WORKFLOW = 'rwa-verify'
const MAX_BODY_BYTES = 256 * 1024

export type WorkflowRun = { result: unknown; tx: string | null }
export type GateDeps = {
	/** Runs the CRE workflow. The default starts `cre workflow simulate rwa-verify`. */
	runWorkflow: (payload: unknown, broadcast: boolean) => WorkflowRun
	fetchImpl: typeof fetch
	broadcast: boolean
	publicUrl?: string
	now?: () => number
}

const json = (status: number, body: unknown, headers: Record<string, string> = {}) =>
	new Response(`${JSON.stringify(body, null, 2)}\n`, { status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store', ...headers } })

/** The workflow's input: the same four optional fields rwa-verify/workflow.ts accepts, and nothing else. */
export function checkInput(v: unknown): string | null {
	if (!v || typeof v !== 'object' || Array.isArray(v)) return 'the body must be a JSON object'
	const o = v as Record<string, unknown>
	for (const k of Object.keys(o)) if (!['tx', 'recordUrl', 'record', 'operator'].includes(k)) return `unknown field ${k}`
	if (o.tx !== undefined && !(typeof o.tx === 'string' && /^0x[0-9a-fA-F]{64}$/.test(o.tx))) return 'tx must be a transaction hash'
	if (o.recordUrl !== undefined && !(typeof o.recordUrl === 'string' && /^https:\/\/[^\s/]+\/\S*$/.test(o.recordUrl))) return 'recordUrl must be an https URL'
	if (o.record !== undefined && (typeof o.record !== 'object' || o.record === null || Array.isArray(o.record))) return 'record must be an object'
	if (o.operator !== undefined && !(typeof o.operator === 'string' && /^0x[0-9a-fA-F]{40}$/.test(o.operator))) return 'operator must be an address'
	return null
}

const receiver = () => JSON.parse(readFileSync(join(REPO, 'rwa-verify/config.json'), 'utf8')).receiverAddress as string

export function catalogEntry(base: string, broadcast: boolean) {
	return {
		name: WORKFLOW,
		title: 'Re-verify a vet402 /rwa record against its onchain anchor',
		description:
			"A Chainlink CRE workflow. It reads a wallet's anchored vet402 /rwa record, recomputes its hash, reads the anchor from RwaAnchor on Robinhood Chain (4663) and answers MATCH or MISMATCH with one reason bit per failed check. A compliance check an agent can run before it acts on the record.",
		endpoint: { method: 'POST', url: `${base}/v1/workflows/${WORKFLOW}` },
		price: {
			amount: '0.01',
			asset: 'USDG',
			asset_address: USDG,
			atomic: PRICE_ATOMIC,
			network: X402_NETWORK,
			pay_to: PAY_TO,
			protocol: 'x402 v2',
			scheme: 'exact',
			transfer_method: 'permit2',
			facilitator: FACILITATOR_URL,
		},
		input_schema: {
			type: 'object',
			additionalProperties: false,
			properties: {
				tx: { type: 'string', pattern: '^0x[0-9a-fA-F]{64}$', description: 'The anchor transaction on Robinhood Chain. Default: the anchor of the demo wallet.' },
				recordUrl: { type: 'string', description: 'https URL of the anchored record JSON under test.' },
				record: { type: 'object', description: 'The record under test, inline, instead of recordUrl.' },
				operator: { type: 'string', pattern: '^0x[0-9a-fA-F]{40}$', description: 'The operator whose anchor is accepted when the record names none.' },
			},
		},
		output_schema: {
			type: 'object',
			properties: {
				result: { type: 'object', description: 'verdict (MATCH or MISMATCH), reasons, reasonBits, anchorTx, recomputedFactsHash, anchoredFactsHash' },
				verdict_tx: { type: ['string', 'null'], description: 'The RecordChecked transaction on Robinhood Testnet when the gate runs with --broadcast, otherwise null.' },
				payment: { type: 'object', description: 'status, transaction (the settlement on Robinhood Chain), payer' },
			},
		},
		execution: {
			engine: 'Chainlink CRE',
			how: 'cre workflow simulate, started by this gate after the payment is verified',
			mode: broadcast ? 'broadcast' : 'simulate',
			writes_to: { chain: 'Robinhood Testnet', chain_id: 46630, receiver: receiver() },
			attestation: "None. A simulation writes through CRE's simulation forwarder, which accepts reports from anyone. The answer is not a DON attestation. It can be rechecked with `node verify.mjs`.",
		},
		source: 'rwa-verify/workflow.ts',
	}
}

export function makeHandler(deps: GateDeps): (req: Request) => Promise<Response> {
	let busy = false
	const used = new Set<string>()
	return async (req) => {
		const url = new URL(req.url)
		const base = (deps.publicUrl ?? url.origin).replace(/\/+$/, '')
		const path = url.pathname.replace(/\/+$/, '') || '/'
		if (req.method === 'GET' && path === '/healthz') return json(200, { ok: true })
		if (req.method === 'GET' && path === '/.well-known/agent.json') {
			const card = JSON.parse(readFileSync(join(REPO, 'agent.json'), 'utf8'))
			return json(200, { ...card, url: base })
		}
		if (req.method === 'GET' && path === '/SKILL.md') return new Response(readFileSync(join(REPO, 'SKILL.md'), 'utf8'), { status: 200, headers: { 'content-type': 'text/markdown; charset=utf-8' } })
		if (req.method === 'GET' && path === '/v1/catalog') return json(200, { workflows: [{ name: WORKFLOW, title: catalogEntry(base, deps.broadcast).title, price: '0.01 USDG', detail: `${base}/v1/catalog/${WORKFLOW}` }] })
		if (req.method === 'GET' && path === `/v1/catalog/${WORKFLOW}`) return json(200, catalogEntry(base, deps.broadcast))
		if (path !== `/v1/workflows/${WORKFLOW}`) return json(404, { error: 'not_found' })
		if (req.method !== 'POST') return json(405, { error: 'use_post' })

		const resource = `${base}/v1/workflows/${WORKFLOW}`
		const required = (error?: string) => {
			const body = paymentRequired(resource, error)
			return json(402, body, { 'PAYMENT-REQUIRED': b64json(body) })
		}
		const header = req.headers.get('PAYMENT-SIGNATURE')
		if (!header) return required()

		// From here on a payment was offered. Nothing is settled until the workflow has answered.
		const raw = await req.text()
		if (raw.length > MAX_BODY_BYTES) return json(413, { error: 'body_too_large', charged: false })
		let input: unknown
		try {
			input = raw.trim() ? JSON.parse(raw) : {}
		} catch {
			return json(400, { error: 'body_is_not_json', charged: false })
		}
		const problem = checkInput(input)
		if (problem) return json(400, { error: 'bad_input', detail: problem, charged: false })

		let payment: ReturnType<typeof parsePaymentHeader>
		try {
			payment = parsePaymentHeader(header, Math.floor((deps.now?.() ?? Date.now()) / 1000))
		} catch (e) {
			if (e instanceof BadPayment) return required(e.reason)
			throw e
		}
		if (!(await checkSignature(payment))) return required('bad_signature')
		const auth = payment.payload.permit2Authorization
		const once = `${auth.from.toLowerCase()}:${auth.nonce}`
		if (used.has(once)) return required('payment_already_used')
		let verified: Awaited<ReturnType<typeof verifyPayment>>
		try {
			verified = await verifyPayment(payment, deps.fetchImpl)
		} catch {
			return json(502, { error: 'facilitator_unreachable', charged: false })
		}
		if (!verified.isValid) return required(verified.invalidReason ?? 'payment_not_valid')
		if (busy) return json(503, { error: 'busy', detail: 'one workflow run at a time', charged: false })
		busy = true
		try {
			used.add(once)
			let run: WorkflowRun
			try {
				run = deps.runWorkflow(input, deps.broadcast)
			} catch (e) {
				used.delete(once)
				return json(502, { error: 'workflow_failed', detail: String(e instanceof Error ? e.message : e).slice(0, 300), charged: false })
			}
			const settled = await settlePayment(payment, deps.fetchImpl)
			if (settled.kind === 'failed') return required(`settlement_failed: ${settled.result.errorReason ?? 'no reason given'}`)
			const paymentOut =
				settled.kind === 'settled'
					? { status: 'settled', transaction: settled.result.transaction, payer: settled.result.payer ?? auth.from, network: X402_NETWORK }
					: { status: 'unknown', transaction: null, payer: auth.from, network: X402_NETWORK, detail: settled.detail }
			return json(
				200,
				{
					workflow: 'vet402-rwa-verify',
					mode: deps.broadcast ? 'broadcast' : 'simulate',
					result: run.result,
					verdict_tx: run.tx,
					receiver: receiver(),
					written_through: "CRE's simulation forwarder (MockKeystoneForwarder). Not a DON attestation.",
					payment: paymentOut,
				},
				{ 'PAYMENT-RESPONSE': b64json(settled.kind === 'settled' ? settled.result : { success: null, transaction: '', network: X402_NETWORK }), 'X-Payment-Status': settled.kind },
			)
		} finally {
			busy = false
		}
	}
}

if (import.meta.main) {
	const argv = process.argv.slice(2)
	const port = Number(argv[argv.indexOf('--port') + 1] && argv.includes('--port') ? argv[argv.indexOf('--port') + 1] : 4021)
	const broadcast = argv.includes('--broadcast')
	let n = 0
	const handler = makeHandler({
		broadcast,
		fetchImpl: fetch,
		publicUrl: process.env.GATE_PUBLIC_URL,
		runWorkflow: (payload, b) => {
			const run = simulate<unknown>(WORKFLOW, payload, { broadcast: b, workDir: join(REPO, 'agent/state/gate'), label: `gate-${Date.now()}-${++n}` })
			return { result: run.result, tx: run.tx }
		},
	})
	// @ts-expect-error Bun is the runtime
	const server = Bun.serve({ port, hostname: '127.0.0.1', fetch: handler })
	console.log(`vet402 copy-guard gate on http://127.0.0.1:${server.port}  POST /v1/workflows/${WORKFLOW}  0.01 USDG over x402  CRE ${broadcast ? 'simulate --broadcast' : 'simulate'}`)
}
