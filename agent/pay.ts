// The paying path: one lock, one ledger, the chain as a floor under the ledger.
//
// - The ledger lives at a fixed path. Only a test run (NODE_ENV=test) may move it.
// - Every payment runs under an exclusive lock file (O_EXCL). A lock whose
//   process is gone, or that is older than LOCK_STALE_MS, is cleared once.
// - What counts as spent is the larger of the ledger and the chain: every USDG
//   the payer ever sent, and (last approval to Permit2 - current allowance).
// - No ledger but the chain shows spending: stop. Deleting the ledger never
//   resets the cap.
// - The ledger is written to a temp file and renamed over the old one.
import { closeSync, existsSync, openSync, readFileSync, renameSync, unlinkSync, writeSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { pad } from 'viem'
import type { Rpc } from './chain'
import { TRANSFER_TOPIC } from './movement'
import { USDG } from './rules'
import { assertUnderCap, type Ledger, type LedgerEntry, loadLedger, MAX_SPEND_ATOMIC, PERMIT2, spentAtomic } from './x402'

export const FIXED_LEDGER = join(homedir(), '.vet402/bli-agent-spend.json')
export const LOCK_STALE_MS = 10 * 60 * 1000
/** keccak256("Approval(address,address,uint256)") */
export const APPROVAL_TOPIC = '0x8c5be1e5ebec7d5bd14f71427d1e84f3dd0314c0f7b2291e5b200ac8c7c3b925'
/** The agent wallet was created after this block (2026-10-09). */
export const PAYER_FROM_BLOCK = 83_600_000
const ADDRESS_LOG_SPAN = 10_000_000

export class LedgerLocked extends Error {}
export class LedgerMissing extends Error {}

export function ledgerPath(env: Record<string, string | undefined> = process.env): string {
	if (env.NODE_ENV === 'test' && env.BLI_AGENT_LEDGER) return env.BLI_AGENT_LEDGER
	return FIXED_LEDGER
}

// ---------------------------------------------------------------- lock

function alive(pid: number): boolean {
	try {
		process.kill(pid, 0)
		return true
	} catch (e) {
		return (e as NodeJS.ErrnoException).code === 'EPERM'
	}
}

export async function withLedgerLock<T>(ledger: string, fn: () => Promise<T>, nowMs: () => number = Date.now): Promise<T> {
	const lock = `${ledger}.lock`
	const token = `${process.pid} ${nowMs()} ${Math.random().toString(36).slice(2)}`
	for (let attempt = 0; ; attempt++) {
		try {
			const fd = openSync(lock, 'wx', 0o600)
			writeSync(fd, token)
			closeSync(fd)
			break
		} catch (e) {
			if ((e as NodeJS.ErrnoException).code !== 'EEXIST') throw e
			let holder = ''
			try {
				holder = readFileSync(lock, 'utf8')
			} catch {
				holder = ''
			}
			const [pid, at] = holder.split(' ').map(Number)
			const stale = !holder || !Number.isFinite(pid) || !alive(pid) || nowMs() - at > LOCK_STALE_MS
			if (!stale || attempt > 0) throw new LedgerLocked(`the spend ledger is locked by another run (${holder || 'unreadable lock'}); nothing paid`)
			try {
				unlinkSync(lock)
			} catch {
				// someone else cleared it first; the next attempt decides
			}
		}
	}
	try {
		return await fn()
	} finally {
		try {
			if (readFileSync(lock, 'utf8') === token) unlinkSync(lock)
		} catch {
			// already gone
		}
	}
}

/** Write to a temp file in the same directory, then rename: a reader sees the old file or the new one, never half. */
export function writeLedgerAtomic(path: string, l: Ledger) {
	const tmp = `${path}.${process.pid}.${Math.random().toString(36).slice(2)}.tmp`
	const fd = openSync(tmp, 'wx', 0o600)
	try {
		writeSync(fd, `${JSON.stringify(l, null, 2)}\n`)
	} finally {
		closeSync(fd)
	}
	renameSync(tmp, path)
}

// ---------------------------------------------------------------- the chain as a floor

export type ChainSpend = { outflowAtomic: bigint; lastApprovedAtomic: bigint; allowanceAtomic: bigint; spentAtomic: bigint }

/** Pure: what the chain says was spent. */
export function chainSpent(outflow: bigint, lastApproved: bigint, allowance: bigint): bigint {
	const sinceApproval = lastApproved > allowance ? lastApproved - allowance : 0n
	return outflow > sinceApproval ? outflow : sinceApproval
}

export async function readChainSpend(rpc: Rpc, payer: string, latest: number, allowance: bigint): Promise<ChainSpend> {
	const p = pad(payer.toLowerCase() as `0x${string}`, { size: 32 }).toLowerCase()
	let outflow = 0n
	let lastApproved = 0n
	for (let a = PAYER_FROM_BLOCK; a <= latest; a += ADDRESS_LOG_SPAN) {
		const range = { address: USDG, fromBlock: `0x${a.toString(16)}`, toBlock: `0x${Math.min(latest, a + ADDRESS_LOG_SPAN - 1).toString(16)}` }
		const [sent, approvals] = await Promise.all([
			rpc('eth_getLogs', [{ ...range, topics: [TRANSFER_TOPIC, p] }]) as Promise<{ data: string }[]>,
			rpc('eth_getLogs', [{ ...range, topics: [APPROVAL_TOPIC, p, pad(PERMIT2.toLowerCase() as `0x${string}`, { size: 32 })] }]) as Promise<{ data: string }[]>,
		])
		for (const l of sent) outflow += BigInt(l.data)
		if (approvals.length) lastApproved = BigInt(approvals[approvals.length - 1].data)
	}
	return { outflowAtomic: outflow, lastApprovedAtomic: lastApproved, allowanceAtomic: allowance, spentAtomic: chainSpent(outflow, lastApproved, allowance) }
}

/** max(ledger, chain). No ledger file while the chain shows spending is refused. */
export function effectiveSpent(ledgerFile: string, ledger: Ledger, chain: bigint): bigint {
	if (!existsSync(ledgerFile) && chain > 0n) {
		throw new LedgerMissing(`no spend ledger at ${ledgerFile}, but the chain shows ${chain} USDG atomic spent; restore the ledger before paying`)
	}
	const l = spentAtomic(ledger)
	return l > chain ? l : chain
}

// ---------------------------------------------------------------- settlement

export type SettleView = { status: LedgerEntry['status']; tx: string | null }

/** Pure: what one paid request means for the ledger. Only a 402 with no tx is "nothing moved". */
export function settlementOutcome(httpStatus: number, settlement: any): SettleView {
	const tx = typeof settlement?.transaction === 'string' && /^0x[0-9a-fA-F]{64}$/.test(settlement.transaction) ? settlement.transaction : null
	if (httpStatus === 200 && tx && settlement.success !== false) return { status: 'settled', tx }
	if (httpStatus === 402 && !tx) return { status: 'failed', tx: null }
	return { status: 'unknown', tx }
}

// ---------------------------------------------------------------- one payment

export type PayOnceOpts = {
	ledgerFile: string
	payer: string
	amount: bigint
	resource: string
	/** Spent according to the chain (readChainSpend().spentAtomic). */
	chainSpentAtomic: bigint
	allowance: bigint
	/** Set allowance to `remaining` (cap - spent). Without it a short allowance stops the payment. */
	approve?: (remaining: bigint) => Promise<void>
	/** Sign and send. Called once, inside the lock, after the pending entry is on disk. */
	send: () => Promise<{ httpStatus: number; settlement: unknown }>
	cap?: bigint
}

export type PayOnceResult = { spentBefore: bigint; outcome: SettleView; httpStatus: number; settlement: unknown }

export async function payOnce(o: PayOnceOpts): Promise<PayOnceResult> {
	const cap = o.cap ?? MAX_SPEND_ATOMIC
	return withLedgerLock(o.ledgerFile, async () => {
		const ledger = loadLedger(o.ledgerFile, o.payer)
		const spent = effectiveSpent(o.ledgerFile, ledger, o.chainSpentAtomic)
		assertUnderCap(spent, o.amount, cap)
		if (o.allowance < o.amount) {
			if (!o.approve) throw new Error('Permit2 allowance is short; rerun with --pay --approve (needs a little ETH on 4663)')
			await o.approve(cap - spent)
		}
		ledger.entries.push({ at: new Date().toISOString(), resource: o.resource, amount_atomic: o.amount.toString(), status: 'pending', tx: null })
		writeLedgerAtomic(o.ledgerFile, ledger)
		const last = ledger.entries[ledger.entries.length - 1]
		let sent: { httpStatus: number; settlement: unknown }
		try {
			sent = await o.send()
		} catch (e) {
			// The request may have reached the facilitator: count it.
			last.status = 'unknown'
			writeLedgerAtomic(o.ledgerFile, ledger)
			throw e
		}
		const outcome = settlementOutcome(sent.httpStatus, sent.settlement)
		last.status = outcome.status
		last.tx = outcome.tx
		writeLedgerAtomic(o.ledgerFile, ledger)
		return { spentBefore: spent, outcome, ...sent }
	})
}
