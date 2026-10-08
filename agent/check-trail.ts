// Recheck a copy-guard decision without a key, an account or the agent.
//
//   bun agent/check-trail.ts <trail.json> [--record record.json] [--onchain]
//
// 1. Hash the trail (canonical JSON, keccak256) and compare with the file's trail_hash.
// 2. Run the rules on the trail's own inputs and compare every row and the conclusion.
// 3. With --record: rebuild the record fields the rules read from the saved record
//    JSON, and its vet402 factsHash, and compare with the trail.
// 4. With --onchain: read public RPCs. The movement tx on Robinhood Chain must hold
//    the listed transfers. The trail tx on Robinhood Testnet must carry a
//    DecisionRecorded event with this hash. The CRE verdict tx must carry a
//    RecordChecked event for the same anchor. A paid trail's settlement tx must show
//    the USDG payment.
// Exit code 0 only when every check passes.
import { readFileSync } from 'node:fs'
import { canonicalJson } from '../rwa-verify/verify'
import { httpRpc, movements } from './chain'
import { TRANSFER_TOPIC } from './movement'
import { recordInputs } from './record'
import { CONCLUSION_CODE, PAY_TO, USDG } from './rules'
import { recheckTrail, type Trail, trailHash, trailReportFields } from './trail'

const TESTNET_RPC = 'https://rpc.testnet.chain.robinhood.com'
/** keccak256("DecisionRecorded(bytes32,bytes32,uint8,bytes32,bytes32,bytes32,bytes32,uint16,bytes32,bytes10,address)") */
export const DECISION_TOPIC = '0xa0958bed2f31527c6c1d6834de58dbcb8c0680fd741708883e36eaee717e1f09'
/** keccak256("RecordChecked(bytes32,bytes32,bool,uint32,bytes32,bytes32,uint64,uint64,bytes32,bytes10,address)") */
export const RECORD_CHECKED_TOPIC = '0xd4c3e2f5744cc48d8bd2d35c78c2f893372b9b370d456461dedea1f6ec44827d'

export type Check = { name: string; ok: boolean; detail: string }

export function offlineChecks(file: any, recordJson?: any): Check[] {
	const trail: Trail = file.trail ?? file
	const checks: Check[] = []
	const h = trailHash(trail)
	if (file.trail && file.trail_hash !== undefined) checks.push({ name: 'trail hash', ok: h === file.trail_hash, detail: `${h}${h === file.trail_hash ? '' : ` != file says ${file.trail_hash}`}` })
	else checks.push({ name: 'trail hash', ok: true, detail: h })
	const re = recheckTrail(trail)
	checks.push({
		name: 'rules',
		ok: re.ok,
		detail: re.ok
			? `${trail.rules.id} v${trail.rules.version} give ${re.recomputed.conclusion} (${re.recomputed.rule_results.filter((r) => r.ok).length}/${re.recomputed.rule_results.length} rows pass), same as the trail`
			: re.problems.join('; '),
	})
	if (recordJson) {
		const rebuilt = recordInputs(recordJson, { source_url: trail.inputs.record.source_url, x_facts_hash: trail.inputs.record.x_facts_hash })
		const same = canonicalJson(rebuilt) === canonicalJson(trail.inputs.record)
		checks.push({
			name: 'record',
			ok: same,
			detail: same
				? `saved record gives factsHash ${rebuilt.recomputed_facts_hash} and the same fields`
				: `saved record gives factsHash ${rebuilt.recomputed_facts_hash}; fields differ from the trail`,
		})
	}
	return checks
}

async function onchainChecks(file: any): Promise<Check[]> {
	const trail: Trail = file.trail ?? file
	const checks: Check[] = []
	const main = httpRpc()
	const test = httpRpc(TESTNET_RPC)
	const mv = trail.inputs.movement
	const onchain = (await movements(main, trail.inputs.wallet, mv.block, mv.block)).find((m) => m.tx === mv.tx.toLowerCase())
	const mvOk = Boolean(onchain) && canonicalJson(onchain) === canonicalJson(mv)
	checks.push({ name: 'movement', ok: mvOk, detail: `${mv.tx} on 4663: ${mvOk ? 'transfers as listed' : 'differs from the trail'}` })

	if (trail.purchase.mode === 'paid') {
		const p = await main('eth_getTransactionReceipt', [trail.purchase.payment_tx])
		const hit = (p?.logs ?? []).some(
			(l: any) =>
				l.address.toLowerCase() === USDG &&
				l.topics[0] === TRANSFER_TOPIC &&
				`0x${l.topics[1].slice(-40)}` === trail.purchase.payer.toLowerCase() &&
				`0x${l.topics[2].slice(-40)}` === PAY_TO &&
				BigInt(l.data) === BigInt(trail.inputs.terms.amount),
		)
		checks.push({ name: 'payment', ok: p?.status === '0x1' && hit, detail: `${trail.purchase.payment_tx}: ${hit ? 'USDG moved payer -> vet402' : 'no matching USDG transfer'}` })
	} else {
		checks.push({ name: 'payment', ok: true, detail: 'dry run, nothing was paid (the trail says so)' })
	}

	const cre = trail.inputs.cre
	if (cre.verdict_tx) {
		const v = await test('eth_getTransactionReceipt', [cre.verdict_tx])
		const log = (v?.logs ?? []).find((l: any) => l.address.toLowerCase() === cre.receiver.toLowerCase() && l.topics[0] === RECORD_CHECKED_TOPIC)
		const ok =
			Boolean(log) &&
			log.topics[1] === cre.anchor_tx.toLowerCase() &&
			BigInt(log.topics[3]) === (cre.verdict === 'MATCH' ? 1n : 0n) &&
			Number(BigInt(`0x${log.data.slice(2, 66)}`)) === cre.reason_bits
		checks.push({ name: 'CRE verdict', ok, detail: `${cre.verdict_tx} on 46630: ${ok ? `RecordChecked ${cre.verdict} for anchor ${cre.anchor_tx}` : 'no matching RecordChecked'}` })
	} else {
		checks.push({ name: 'CRE verdict', ok: true, detail: 'simulated only, no verdict tx to read' })
	}

	if (file.trail_tx) {
		const t = await test('eth_getTransactionReceipt', [file.trail_tx])
		const f = trailReportFields(trail)
		const log = (t?.logs ?? []).find((l: any) => l.address.toLowerCase() === String(file.trail_receiver).toLowerCase() && l.topics[0] === DECISION_TOPIC)
		const ok =
			Boolean(log) &&
			log.topics[1] === f.trailHash &&
			log.topics[2] === f.subject &&
			Number(BigInt(log.topics[3])) === CONCLUSION_CODE[trail.decision.conclusion]
		checks.push({ name: 'trail onchain', ok, detail: `${file.trail_tx} on 46630: ${ok ? `DecisionRecorded ${f.trailHash} ${trail.decision.conclusion}` : 'no matching DecisionRecorded'}` })
	} else {
		checks.push({ name: 'trail onchain', ok: false, detail: 'the file names no trail tx' })
	}
	return checks
}

if (import.meta.main) {
	const argv = process.argv.slice(2)
	const path = argv.find((a) => !a.startsWith('--') && argv[argv.indexOf(a) - 1] !== '--record')
	if (!path) {
		console.error('usage: bun agent/check-trail.ts <trail.json> [--record record.json] [--onchain]')
		process.exit(2)
	}
	const file = JSON.parse(readFileSync(path, 'utf8'))
	const ri = argv.indexOf('--record')
	const record = ri >= 0 ? JSON.parse(readFileSync(argv[ri + 1], 'utf8')) : undefined
	const checks = offlineChecks(file, record)
	if (argv.includes('--onchain')) checks.push(...(await onchainChecks(file)))
	const trail: Trail = file.trail ?? file
	console.log(`copy-guard trail check (no key)  ${path}`)
	console.log(`  movement  ${trail.inputs.movement.tx}  conclusion ${trail.decision.conclusion}`)
	for (const c of checks) console.log(`  ${c.ok ? 'OK  ' : 'FAIL'}  ${c.name.padEnd(14)} ${c.detail}`)
	const ok = checks.every((c) => c.ok)
	console.log(ok ? `RESULT: the trail holds. ${trail.decision.conclusion} follows from its inputs.` : 'RESULT: the trail does not hold.')
	process.exit(ok ? 0 : 1)
}
