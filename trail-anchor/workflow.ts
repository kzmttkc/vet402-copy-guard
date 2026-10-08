// CRE workflow: notarize one decision of the copy-guard agent.
//
//   HTTP trigger { trail }
//     -> run the copy-guard rules again on the trail's own inputs (agent/rules.ts)
//        and refuse when the rows or the conclusion differ from what the trail says
//     -> HTTP POST Robinhood Chain JSON-RPC: the movement tx must hold exactly the
//        transfers the trail lists; a paid trail's settlement tx must move the price
//        in USDG from the payer to the vet402 wallet
//     -> report keccak256(trail) + a fixed summary, EVM write to ReasoningTrailReceiver
//        on Robinhood Testnet
//
// The agent cannot get a conclusion recorded here that its own rules do not give.
import {
	bytesToHex,
	consensusIdenticalAggregation,
	cre,
	EVMClient,
	getNetwork,
	HTTPCapability,
	type HTTPPayload,
	type HTTPSendRequester,
	hexToBase64,
	prepareReportRequest,
	type Runtime,
	TxStatus,
} from '@chainlink/cre-sdk'
import { encodeAbiParameters, parseAbiParameters } from 'viem'
import { z } from 'zod'
import { groupMovements, type Log, TRANSFER_TOPIC } from '../agent/movement'
import { PAY_TO, USDG } from '../agent/rules'
import { recheckTrail, type Trail, trailReportFields } from '../agent/trail'
import { canonicalJson, fromUtf8, utf8 } from '../rwa-verify/verify'

export const configSchema = z.object({
	robinhoodRpc: z.string(),
	chainSelectorName: z.string(),
	receiverAddress: z.string(),
	gasLimit: z.string(),
})
export type Config = z.infer<typeof configSchema>

export const REPORT_ABI = parseAbiParameters(
	'bytes32 trailHash, bytes32 subject, uint8 conclusion, bytes32 recordFactsHash, bytes32 movementTx, bytes32 verdictTx, bytes32 paymentTx, uint16 rulesVersion',
)

type Receipt = { status?: string; blockNumber?: string; transactionHash?: string; logs?: Log[] } | null

function rpc(sr: HTTPSendRequester, url: string, method: string, params: unknown[]): unknown {
	const body = JSON.stringify({ jsonrpc: '2.0', id: 1, method, params })
	const res = sr
		.sendRequest({ method: 'POST', url, headers: { 'content-type': 'application/json' }, body: hexToBase64(bytesToHex(utf8(body))) })
		.result()
	if (res.statusCode !== 200) throw new Error(`${method}: HTTP ${res.statusCode}`)
	const out = JSON.parse(fromUtf8(res.body)) as { result?: unknown; error?: { message?: string } }
	if (out.error) throw new Error(`${method}: ${out.error.message ?? 'rpc error'}`)
	return out.result
}

export type ChainCheck = { chainId: number; movementOk: boolean; movementDetail: string; paymentOk: boolean; paymentDetail: string }

/** What the chain says about the movement and the payment. Small, so it passes consensus. */
export const checkChain = (sr: HTTPSendRequester, url: string, trailJson: string): ChainCheck => {
	const trail = JSON.parse(trailJson) as Trail
	const chainId = Number(BigInt(rpc(sr, url, 'eth_chainId', []) as string))
	const mv = trail.inputs.movement
	// The wallet's Transfer logs in that block, by topic. A full receipt can be too
	// large (an address-poisoning tx carries hundreds of logs), these two queries are not.
	const w = `0x${'0'.repeat(24)}${trail.inputs.wallet.toLowerCase().slice(2)}`
	const range = { fromBlock: `0x${mv.block.toString(16)}`, toBlock: `0x${mv.block.toString(16)}` }
	const logs = [
		...(rpc(sr, url, 'eth_getLogs', [{ ...range, topics: [TRANSFER_TOPIC, w] }]) as Log[]),
		...(rpc(sr, url, 'eth_getLogs', [{ ...range, topics: [TRANSFER_TOPIC, null, w] }]) as Log[]),
	].filter((l) => l.transactionHash.toLowerCase() === mv.tx.toLowerCase())
	const [onchain] = groupMovements(trail.inputs.wallet, logs)
	const movementOk = Boolean(onchain) && canonicalJson(onchain) === canonicalJson(mv)
	const movementDetail = movementOk
		? `${mv.transfers.length} transfers in block ${mv.block} as listed`
		: `chain has ${onchain ? `${onchain.transfers.length} transfers` : 'no transfer of the wallet'} for this tx in block ${mv.block}, trail lists ${mv.transfers.length}`
	let paymentOk = true
	let paymentDetail = 'dry run, nothing paid'
	if (trail.purchase.mode === 'paid') {
		const pr = rpc(sr, url, 'eth_getTransactionReceipt', [trail.purchase.payment_tx]) as Receipt
		const want = BigInt(trail.inputs.terms.amount)
		const payer = trail.purchase.payer.toLowerCase()
		const hit = (pr?.logs ?? []).find(
			(l) =>
				l.address.toLowerCase() === USDG &&
				l.topics?.[0]?.toLowerCase() === TRANSFER_TOPIC &&
				`0x${l.topics[1].slice(-40)}`.toLowerCase() === payer &&
				`0x${l.topics[2].slice(-40)}`.toLowerCase() === PAY_TO &&
				BigInt(l.data) === want,
		)
		paymentOk = pr?.status === '0x1' && Boolean(hit)
		paymentDetail = paymentOk ? `${want} USDG atomic from ${payer} to ${PAY_TO}` : 'settlement tx does not show the payment'
	}
	return { chainId, movementOk, movementDetail, paymentOk, paymentDetail }
}

export function encodeTrail(trail: Trail): `0x${string}` {
	const f = trailReportFields(trail)
	return encodeAbiParameters(REPORT_ABI, [
		f.trailHash as `0x${string}`,
		f.subject as `0x${string}`,
		f.conclusion,
		f.recordFactsHash as `0x${string}`,
		f.movementTx as `0x${string}`,
		f.verdictTx as `0x${string}`,
		f.paymentTx as `0x${string}`,
		f.rulesVersion,
	])
}

export const onHttpTrigger = (runtime: Runtime<Config>, payload: HTTPPayload): string => {
	const cfg = runtime.config
	const raw = payload.input && payload.input.length > 0 ? fromUtf8(payload.input) : '{}'
	const trail = (JSON.parse(raw) as { trail?: Trail }).trail
	if (!trail) throw new Error('payload has no trail')

	// 1. The rules, again.
	const re = recheckTrail(trail)
	for (const r of re.recomputed.rule_results) runtime.log(`${r.ok ? 'OK  ' : 'FAIL'}  ${r.id}  ${r.detail}`)
	if (!re.ok) throw new Error(`trail refused: ${re.problems.join('; ')}`)
	runtime.log(`rules ${trail.rules.id} v${trail.rules.version} give ${re.recomputed.conclusion}, the trail says ${trail.decision.conclusion}`)

	// 2. The chain.
	const http = new cre.capabilities.HTTPClient()
	const chain = http
		.sendRequest(runtime, checkChain, consensusIdenticalAggregation<ChainCheck>())(cfg.robinhoodRpc, canonicalJson(trail))
		.result()
	runtime.log(`movement ${trail.inputs.movement.tx}: ${chain.movementDetail}`)
	runtime.log(`payment: ${chain.paymentDetail}`)
	if (chain.chainId !== 4663) throw new Error(`RPC is chain ${chain.chainId}, not Robinhood Chain 4663`)
	if (!chain.movementOk) throw new Error('trail refused: the movement is not what the chain shows')
	if (!chain.paymentOk) throw new Error('trail refused: the payment is not what the chain shows')

	// 3. Write.
	const fields = trailReportFields(trail)
	runtime.log(`trail hash ${fields.trailHash}`)
	const network = getNetwork({ chainFamily: 'evm', chainSelectorName: cfg.chainSelectorName, isTestnet: true })
	if (!network) throw new Error(`unknown chain ${cfg.chainSelectorName}`)
	const evm = new EVMClient(network.chainSelector.selector)
	const report = runtime.report(prepareReportRequest(encodeTrail(trail))).result()
	const write = evm.writeReport(runtime, { receiver: cfg.receiverAddress, report, gasConfig: { gasLimit: cfg.gasLimit } }).result()
	if (write.txStatus !== TxStatus.SUCCESS) throw new Error(`writeReport failed: ${write.errorMessage || write.txStatus}`)
	const tx = bytesToHex(write.txHash ?? new Uint8Array(32))
	runtime.log(`trail written to ${cfg.receiverAddress} on ${cfg.chainSelectorName}, tx ${tx}`)

	return JSON.stringify({
		trailHash: fields.trailHash,
		conclusion: trail.decision.conclusion,
		decisive: trail.decision.decisive,
		movementTx: fields.movementTx,
		paymentTx: fields.paymentTx,
		verdictTx: fields.verdictTx,
		rules: `${trail.rules.id} v${trail.rules.version}`,
		trailTx: tx,
	})
}

export function initWorkflow(_config: Config) {
	const http = new HTTPCapability()
	return [cre.handler(http.trigger({}), onHttpTrigger)]
}
