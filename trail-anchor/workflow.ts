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
//
// A second payload, { ledger }, anchors a whole walk at once: the workflow recomputes the
// Merkle root from the trail hashes it is given, counts the decisions by size, and writes
// the root with the hashes of the mandate, the limits and the rules to LedgerRootReceiver.
// It does not rerun the rules of every decision in that mode. `node verify.mjs` does.
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
import { merkleRoot } from '../agent/ledger'
import { groupMovements, type Log, TRANSFER_TOPIC } from '../agent/movement'
import { PAY_TO, USDG } from '../agent/rules'
import { recheckTrail, type Trail, trailReportFields } from '../agent/trail'
import { canonicalJson, fromUtf8, keccakText, utf8 } from '../rwa-verify/verify'

export const configSchema = z.object({
	robinhoodRpc: z.string(),
	chainSelectorName: z.string(),
	receiverAddress: z.string(),
	/** LedgerRootReceiver, for the { ledger } payload. */
	ledgerReceiverAddress: z.string().optional(),
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

export const LEDGER_REPORT_ABI = parseAbiParameters(
	'bytes32 root, bytes32 mandateHash, bytes32 limitsHash, bytes32 rulesHash, uint32 decisions, uint32 full, uint32 reduced, uint32 none, uint64 markBlock',
)

export type LedgerPayload = {
	root: string
	/** One per decision, in walk order: the keccak256 of the trail and the size it ended in. */
	leaves: { leaf: string; tier: 'FULL' | 'REDUCED' | 'NONE' }[]
	mandate_keccak: string
	limits_keccak: string
	rules: unknown
	mark_block: number
}

const HASH32 = /^0x[0-9a-f]{64}$/

/** Anchor a whole walk: recompute the root from the leaves, refuse when it differs, write it once. */
function anchorLedger(runtime: Runtime<Config>, ledger: LedgerPayload): string {
	const cfg = runtime.config
	if (!cfg.ledgerReceiverAddress) throw new Error('config has no ledgerReceiverAddress')
	if (!Array.isArray(ledger.leaves) || ledger.leaves.length === 0) throw new Error('ledger has no leaves')
	for (const l of ledger.leaves) if (!HASH32.test(l.leaf) || !['FULL', 'REDUCED', 'NONE'].includes(l.tier)) throw new Error('a leaf is not a hash with a size')
	if (!HASH32.test(ledger.mandate_keccak) || !HASH32.test(ledger.limits_keccak)) throw new Error('the mandate and the limits must be named by hash')
	const root = merkleRoot(ledger.leaves.map((l) => l.leaf))
	if (root !== String(ledger.root).toLowerCase()) throw new Error(`ledger refused: the leaves give root ${root}, the payload says ${ledger.root}`)
	const count = (t: string) => ledger.leaves.filter((l) => l.tier === t).length
	const rulesHash = keccakText(canonicalJson(ledger.rules))
	runtime.log(`ledger: ${ledger.leaves.length} decisions, FULL ${count('FULL')}, REDUCED ${count('REDUCED')}, NONE ${count('NONE')}`)
	runtime.log(`root ${root} recomputed from the leaves`)
	const network = getNetwork({ chainFamily: 'evm', chainSelectorName: cfg.chainSelectorName, isTestnet: true })
	if (!network) throw new Error(`unknown chain ${cfg.chainSelectorName}`)
	const evm = new EVMClient(network.chainSelector.selector)
	const encoded = encodeAbiParameters(LEDGER_REPORT_ABI, [
		root as `0x${string}`,
		ledger.mandate_keccak as `0x${string}`,
		ledger.limits_keccak as `0x${string}`,
		rulesHash as `0x${string}`,
		ledger.leaves.length,
		count('FULL'),
		count('REDUCED'),
		count('NONE'),
		BigInt(ledger.mark_block),
	])
	const report = runtime.report(prepareReportRequest(encoded)).result()
	const write = evm.writeReport(runtime, { receiver: cfg.ledgerReceiverAddress, report, gasConfig: { gasLimit: cfg.gasLimit } }).result()
	if (write.txStatus !== TxStatus.SUCCESS) throw new Error(`writeReport failed: ${write.errorMessage || write.txStatus}`)
	const tx = bytesToHex(write.txHash ?? new Uint8Array(32))
	runtime.log(`ledger root written to ${cfg.ledgerReceiverAddress} on ${cfg.chainSelectorName}, tx ${tx}`)
	return JSON.stringify({ root, decisions: ledger.leaves.length, full: count('FULL'), reduced: count('REDUCED'), none: count('NONE'), rulesHash, ledgerTx: tx })
}

export const onHttpTrigger = (runtime: Runtime<Config>, payload: HTTPPayload): string => {
	const cfg = runtime.config
	const raw = payload.input && payload.input.length > 0 ? fromUtf8(payload.input) : '{}'
	const body = JSON.parse(raw) as { trail?: Trail; ledger?: LedgerPayload }
	if (body.ledger) return anchorLedger(runtime, body.ledger)
	const trail = body.trail
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
