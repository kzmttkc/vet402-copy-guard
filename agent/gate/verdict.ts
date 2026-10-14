// What a gate says the CRE workflow answered is a claim, not a fact. Before the agent uses
// it, the agent reads the RecordChecked event itself, on Robinhood Testnet, and holds the
// gate's answer against it.
//
// What is checked, and against what:
//   - the tx the gate names exists on Robinhood Testnet (chain id 46630) and succeeded;
//   - it carries exactly one RecordChecked event from the receiver in the AGENT'S OWN
//     rwa-verify/config.json. The `receiver` field in the gate's answer is never read;
//   - the event is about the anchor tx the agent asked about and the wallet it watches
//     (both the agent's own values, not the gate's);
//   - verdict, reason bits, anchor tx and both hashes in the gate's answer are the ones
//     in the event;
//   - for MATCH, the anchored hash and the anchor block in the event are the ones the
//     agent read from RwaAnchor on Robinhood Chain itself.
// Anything else (no tx, a simulate-only gate, an unreachable RPC, one field off) and the
// gate's answer is dropped: the agent runs the same CRE workflow itself, as in a dry run.
//
// What this does NOT prove. The testnet receiver trusts CRE's simulation forwarder
// (MockKeystoneForwarder), and that forwarder accepts a report from anyone. So a gate can
// write any verdict it likes into a RecordChecked event. A passing check means "the gate
// fixed this exact verdict in public, where anyone can read it and hold the gate to it",
// and that its answer agrees with what it fixed. It is not a DON attestation, and it does
// not show that the workflow really ran. The event's workflowId, workflowName and
// workflowOwner are placeholders the simulator fills in, so they are decoded and not
// checked. An older event for the same anchor passes too: a verdict on one anchor tx and
// one record hash does not change with time.
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { toEventSelector } from 'viem'
import { subjectHash } from '../../rwa-verify/verify'
import type { Rpc } from '../chain'
import { REPO } from '../cre'

export const TESTNET_RPC = 'https://rpc.testnet.chain.robinhood.com'
export const TESTNET_CHAIN_ID = 46630
/** The event contracts/src/RwaVerdictReceiver.sol emits. Three indexed fields, eight words of data. */
export const RECORD_CHECKED_TOPIC = toEventSelector('RecordChecked(bytes32,bytes32,bool,uint32,bytes32,bytes32,uint64,uint64,bytes32,bytes10,address)').toLowerCase()

/** The receiver this agent's own CRE workflow writes to. */
export const ownReceiver = (): string => JSON.parse(readFileSync(join(REPO, 'rwa-verify/config.json'), 'utf8')).receiverAddress as string

export type RecordChecked = {
	anchorTx: string
	subject: string
	isMatch: boolean
	reasons: number
	recomputedFactsHash: string
	anchoredFactsHash: string
	asOf: string
	anchorBlock: number
	workflowId: string
	workflowName: string
	workflowOwner: string
}

/** The agent's own values. Nothing in here comes from the gate. */
export type VerdictExpect = {
	/** receiverAddress from the agent's rwa-verify/config.json. */
	receiver: string
	/** The anchor tx the agent sent to the gate. */
	anchorTx: string
	/** The wallet the agent watches. */
	wallet: string
	/** The anchored factsHash the agent read from RwaAnchor on Robinhood Chain. Held against a MATCH. */
	anchoredFactsHash?: string
	/** The block of that anchor. Held against a MATCH. */
	anchorBlock?: number
}

export type VerdictCheck = { ok: true; tx: string; event: RecordChecked } | { ok: false; why: string[] }

const HEX32 = /^0x[0-9a-f]{64}$/
const lc = (v: unknown) => (typeof v === 'string' ? v.toLowerCase() : '')
const no = (...why: string[]): VerdictCheck => ({ ok: false, why })

/** Pure: one log into the fields of RecordChecked, or null when it is not a well-formed one. */
export function decodeRecordChecked(log: unknown): RecordChecked | null {
	const l = log as { topics?: unknown; data?: unknown } | null
	if (!l || !Array.isArray(l.topics) || l.topics.length !== 4) return null
	const topics = l.topics.map(lc)
	const data = lc(l.data)
	if (topics[0] !== RECORD_CHECKED_TOPIC || !topics.every((t) => HEX32.test(t)) || !/^0x[0-9a-f]{512}$/.test(data)) return null
	const word = (i: number) => `0x${data.slice(2 + 64 * i, 66 + 64 * i)}`
	const isMatch = BigInt(topics[3])
	const reasons = BigInt(word(0))
	const anchorBlock = BigInt(word(4))
	if (isMatch > 1n || reasons > 0xffffffffn || anchorBlock > BigInt(Number.MAX_SAFE_INTEGER)) return null
	return {
		anchorTx: topics[1],
		subject: topics[2],
		isMatch: isMatch === 1n,
		reasons: Number(reasons),
		recomputedFactsHash: word(1),
		anchoredFactsHash: word(2),
		asOf: BigInt(word(3)).toString(),
		anchorBlock: Number(anchorBlock),
		workflowId: word(5),
		workflowName: `0x${word(6).slice(2, 22)}`,
		workflowOwner: `0x${word(7).slice(-40)}`,
	}
}

/**
 * Pure: hold the gate's answer (`claim`, untrusted, any shape) against the receipt of the
 * tx it names and against the agent's own values. Never throws.
 */
export function checkVerdictReceipt(receipt: unknown, claim: unknown, want: VerdictExpect): VerdictCheck {
	const c = (claim ?? {}) as { result?: Record<string, unknown>; verdict_tx?: unknown }
	const said = c.result && typeof c.result === 'object' ? c.result : {}
	const tx = lc(c.verdict_tx)
	if (!HEX32.test(tx)) return no('the gate names no verdict tx')
	if (said.verdict !== 'MATCH' && said.verdict !== 'MISMATCH') return no(`the gate's verdict is neither MATCH nor MISMATCH`)
	const r = receipt as { status?: unknown; transactionHash?: unknown; logs?: unknown } | null
	if (!r || typeof r !== 'object') return no(`${tx} is not on Robinhood Testnet`)
	if (r.status !== '0x1') return no(`${tx} did not succeed on Robinhood Testnet`)
	if (lc(r.transactionHash) !== tx) return no(`the receipt read is for ${lc(r.transactionHash) || '(no hash)'}, not ${tx}`)
	const logs = (Array.isArray(r.logs) ? r.logs : []).filter((l: any) => lc(l?.address) === lc(want.receiver) && lc(l?.topics?.[0]) === RECORD_CHECKED_TOPIC)
	if (logs.length !== 1) return no(`${logs.length} RecordChecked events from the agent's receiver ${want.receiver} in ${tx}, expected exactly one`)
	const event = decodeRecordChecked(logs[0])
	if (!event) return no(`the RecordChecked event in ${tx} cannot be decoded`)

	const why: string[] = []
	// The event against what the agent itself asked for.
	if (event.anchorTx !== lc(want.anchorTx)) why.push(`the event is about anchor ${event.anchorTx}, the agent asked about ${lc(want.anchorTx)}`)
	if (event.subject !== subjectHash(want.wallet)) why.push('the event is about another wallet')
	// The gate's answer against the event.
	if (lc(said.anchorTx) !== event.anchorTx) why.push(`the gate says anchor ${lc(said.anchorTx) || '(none)'}, the event ${event.anchorTx}`)
	if ((said.verdict === 'MATCH') !== event.isMatch) why.push(`the gate says ${said.verdict}, the event says ${event.isMatch ? 'MATCH' : 'MISMATCH'}`)
	if (said.reasonBits !== event.reasons) why.push(`the gate says reason bits ${String(said.reasonBits)}, the event ${event.reasons}`)
	if (lc(said.recomputedFactsHash) !== event.recomputedFactsHash) why.push('the recomputed hash in the gate answer is not the one in the event')
	if (lc(said.anchoredFactsHash) !== event.anchoredFactsHash) why.push('the anchored hash in the gate answer is not the one in the event')
	// The event against itself, and a MATCH against the agent's own read of the anchor.
	if (event.isMatch !== (event.reasons === 0)) why.push(`the event says ${event.isMatch ? 'MATCH' : 'MISMATCH'} with reason bits ${event.reasons}`)
	if (event.isMatch) {
		if (event.recomputedFactsHash !== event.anchoredFactsHash) why.push('the event says MATCH but its two hashes differ')
		if (want.anchoredFactsHash !== undefined && event.anchoredFactsHash !== lc(want.anchoredFactsHash)) why.push(`the event gives anchored hash ${event.anchoredFactsHash}, the agent read ${lc(want.anchoredFactsHash)} from RwaAnchor`)
		if (want.anchorBlock !== undefined && event.anchorBlock !== want.anchorBlock) why.push(`the event gives anchor block ${event.anchorBlock}, the agent read ${want.anchorBlock}`)
	}
	return why.length ? { ok: false, why } : { ok: true, tx, event }
}

export type ConfirmOpts = {
	/** How often the receipt is asked for when the RPC does not have it yet. */
	tries?: number
	waitMs?: number
	/** Everything together may take this long; after that the gate's answer is not used. */
	timeoutMs?: number
}

/**
 * Read the tx the gate names from Robinhood Testnet through `rpc` and check it. Never
 * throws: an RPC that fails, hangs or serves another chain gives `ok: false`, and the
 * caller falls back to running the workflow itself.
 */
export async function confirmGateVerdict(claim: unknown, want: VerdictExpect, rpc: Rpc, opts: ConfirmOpts = {}): Promise<VerdictCheck> {
	const named = (claim as { verdict_tx?: unknown } | null)?.verdict_tx
	if (named === null || named === undefined) return no('the gate names no verdict tx (it only simulated the workflow)')
	const tx = lc(named)
	if (!HEX32.test(tx)) return no('the verdict tx the gate names is not a transaction hash')
	const tries = opts.tries ?? 3
	const read = async (): Promise<VerdictCheck> => {
		const chainId = await rpc('eth_chainId', [])
		if (typeof chainId !== 'string' || !/^0x[0-9a-fA-F]+$/.test(chainId) || Number(BigInt(chainId)) !== TESTNET_CHAIN_ID) return no(`the RPC is not Robinhood Testnet (chain id ${String(chainId)})`)
		let receipt: unknown = null
		for (let i = 0; i < tries && !receipt; i++) {
			if (i > 0) await new Promise((r) => setTimeout(r, opts.waitMs ?? 1500))
			receipt = await rpc('eth_getTransactionReceipt', [tx])
		}
		return checkVerdictReceipt(receipt, claim, want)
	}
	let timer: ReturnType<typeof setTimeout> | undefined
	try {
		return await Promise.race([read(), new Promise<VerdictCheck>((resolve) => (timer = setTimeout(() => resolve(no('Robinhood Testnet did not answer in time')), opts.timeoutMs ?? 30_000)))])
	} catch (e) {
		return no(`Robinhood Testnet could not be read: ${String(e instanceof Error ? e.message : e).slice(0, 200)}`)
	} finally {
		clearTimeout(timer)
	}
}
