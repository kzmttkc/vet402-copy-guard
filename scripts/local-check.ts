// Runs the same steps as the CRE workflow with plain fetch, outside CRE, against
// the live endpoints. Use it to see the verdict without a CRE login; the CRE
// simulation itself is scripts/simulate.sh.
//
//   bun scripts/local-check.ts rwa-verify/payloads/match.json
import { readFileSync } from 'node:fs'
import config from '../rwa-verify/config.json'
import {
	commitment,
	compare,
	RWA_ANCHOR_ADDRESS,
	reasonList,
	renderVerdict,
	summarizeChain,
	summarizeRecord,
} from '../rwa-verify/verify'

const payload = JSON.parse(readFileSync(process.argv[2] ?? 'rwa-verify/payloads/match.json', 'utf8'))
const tx: string = (payload.tx ?? config.anchorTx).toLowerCase()

async function rpc(method: string, params: unknown[]) {
	const res = await fetch(config.robinhoodRpc, {
		method: 'POST',
		headers: { 'content-type': 'application/json' },
		body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
	})
	const body = (await res.json()) as { result?: unknown; error?: { message: string } }
	if (body.error) throw new Error(body.error.message)
	return body.result
}

const liveRes = await fetch(config.factsApi.replace('<address>', config.wallet))
const liveBody = await liveRes.json()
const header = (liveRes.headers.get('x-facts-hash') ?? '').toLowerCase()
console.log(
	`live /rwa record: HTTP ${liveRes.status}, as_of ${liveBody.as_of}, X-Facts-Hash ${header === commitment(liveBody).hash ? 'matches' : 'does NOT match'} the body`,
)

let source: string
let record: unknown
if (payload.record) {
	source = 'record passed in the trigger payload'
	record = payload.record
} else {
	source = payload.recordUrl ?? config.recordUrl
	record = await (await fetch(source)).json()
}
const rec = summarizeRecord(record)
const [chainId, receipt, code] = await Promise.all([
	rpc('eth_chainId', []),
	rpc('eth_getTransactionReceipt', [tx]),
	rpc('eth_getCode', [RWA_ANCHOR_ADDRESS, 'latest']),
])
const chain = summarizeChain(chainId as string, receipt as any, code as string)
const verdict = compare(rec, chain, { operator: rec.recordAnchoredBy ? undefined : config.operator })
console.log(renderVerdict(verdict, rec, tx, source))
console.log(`reason bits ${verdict.reasons}${verdict.reasons ? ` (${reasonList(verdict.reasons).join('; ')})` : ''}`)
process.exit(verdict.match ? 0 : 1)
