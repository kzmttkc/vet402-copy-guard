// The walk: every readable move of a list of wallets, in the order the moves happened,
// decided by copy-guard v2 and entered in the practice ledger.
//
//   bun agent/walk.ts [--wallets docs/walk/wallets.json] [--mandate mandate] [--limits limits.json]
//                     [--out docs/walk] [--broadcast]
//
// A replay: nothing is paid and nothing is signed. For each wallet the record is read
// once from vet402's free route, and its moves are the transactions that record lists
// as evidence. The 402 terms are read once from the paid route, without paying. Every
// other input is public chain data: the receipts, the block times, the venue each Stock
// Token came from and the Chainlink feed values.
//
// Output, all under --out:
//   records/<wallet>.json   the record as read, with the X-Facts-Hash that came with it
//   feeds.json              every feed value used, with the tx that published it
//   chain.json              the chain answers the decisions rest on (for the tests)
//   trails.jsonl            one version 2 trail per decision, in walk order
//   ../ledger.json          the ledger: rows, both books, totals and the Merkle root
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join, relative } from 'node:path'
import { getAddress } from 'viem'
import { type AnchorRef, httpRpc, newestAnchor, RPC, type Rpc } from './chain'
import { REPO, simulate } from './cre'
import { type FeedSeries, feedSeries, priceAt, venueOf } from './facts'
import { buildLedger, type Feeds, order, PracticeBook, saleOf } from './ledger'
import { paymentCapAtomic } from './limits'
import { loadPolicy } from './main'
import { groupMovements } from './movement'
import { ledgerPath } from './pay'
import { recordInputs } from './record'
import { type CreInputs, type Movement, type RecordInputs, USDG } from './rules'
import { type DecisionInputsV2, movedTokens, stockLegV2, type Venue } from './rules-v2'
import { buildTrailV2, type Purchase, recheckTrailV2, type TrailV2 } from './trail'
import { decodeRequired, loadLedger, MAX_SPEND_ATOMIC, pickAccept, spentAtomic, termsOf } from './x402'

const VET402 = 'https://vet402.com'
const VET402_REPO_RAW = 'https://raw.githubusercontent.com/kzmttkc/vet402/main'
const ZERO32 = `0x${'0'.repeat(64)}`
/** How far before a token's first move the feed is read, so a weekend-old value is still found. */
const FEED_LOOKBACK = 6_000_000

const arg = (name: string, dflt: string) => (process.argv.includes(name) ? process.argv[process.argv.indexOf(name) + 1] : dflt)
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))
const lc = (s: string) => s.toLowerCase()

/** The public RPC, one request at a time with a pause, asked again when it is busy. */
function pacedRpc(): Rpc & { calls: () => number } {
	const inner = httpRpc(RPC)
	let last = 0
	let n = 0
	const f = (async (method: string, params: unknown[]) => {
		for (let attempt = 0; ; attempt++) {
			const wait = last + 300 - Date.now()
			if (wait > 0) await sleep(wait)
			last = Date.now()
			n++
			try {
				return await inner(method, params)
			} catch (e) {
				if (attempt >= 6 || !/429|5\d\d|fetch failed|timeout|Unexpected/i.test(String(e))) throw e
				await sleep(3000 * (attempt + 1))
			}
		}
	}) as Rpc & { calls: () => number }
	f.calls = () => n
	return f
}

type Move = { wallet: string; mv: Movement; time: string; signer: string }

async function main() {
	const out = join(REPO, arg('--out', 'docs/walk'))
	const broadcast = process.argv.includes('--broadcast')
	const walletsFile = join(REPO, arg('--wallets', 'docs/walk/wallets.json'))
	const wallets: { wallet: string; why: string }[] = JSON.parse(readFileSync(walletsFile, 'utf8'))
	mkdirSync(join(out, 'records'), { recursive: true })
	const log: string[] = []
	const say = (s: string) => {
		console.log(s)
		log.push(s)
	}
	const policy = loadPolicy({ limits: arg('--limits', 'limits.json'), mandate: arg('--mandate', 'mandate') })
	const payer = getAddress(readFileSync(process.env.BLI_AGENT_ADDRESS_FILE ?? join(homedir(), '.vet402/bli-agent.address'), 'utf8').trim())
	const rpc = pacedRpc()
	const markBlock = Number(BigInt(await rpc('eth_blockNumber', [])))
	const decidedAt = new Date().toISOString()
	const m = policy.mandate
	const signed = Boolean(m.signer) && lc(m.signer ?? '') === lc(m.document.principal)
	say(`copy-guard v2 walk, ${wallets.length} wallets, decided ${decidedAt}, marked at block ${markBlock}`)
	say(`  mandate  ${m.keccak} principal ${m.document.principal} ${signed ? 'signed by the principal' : 'NOT signed by the principal: every decision will be NONE'} (${policy.mandateDir}/)`)
	say(`  limits   ${policy.limitsKeccak} full ${policy.limits.size.full_usd} USD, reduced ${policy.limits.size.reduced_usd} USD, ${policy.limits.size.max_usd_per_day} USD per day, ${policy.limits.size.max_open_positions} open`)

	// The x402 terms, read once from the paid route. Nothing is paid.
	const first = await fetch(`${VET402}/api/v1/rwa/paid/facts/${getAddress(wallets[0].wallet)}`)
	const header = first.headers.get('PAYMENT-REQUIRED')
	if (first.status !== 402 || !header) throw new Error(`expected 402 with PAYMENT-REQUIRED, got ${first.status}`)
	const terms = termsOf(pickAccept(decodeRequired(header)))
	const spentBefore = spentAtomic(loadLedger(ledgerPath(), payer)).toString()

	// Per wallet: the record (free route, once), the newest anchor and CRE's verdict on it, and the moves.
	const records = new Map<string, { facts: any; record: RecordInputs; cre: CreInputs }>()
	const moves: Move[] = []
	// Chain answers saved by an earlier walk are read from the file. A receipt, a block time, a token's decimals and a pool's factory do not change.
	const chainFile = join(out, 'chain.json')
	const chain: { receipts: Record<string, any>; blocks: Record<string, string>; decimals: Record<string, number>; venues: Record<string, Venue['kind']> } = existsSync(chainFile)
		? JSON.parse(readFileSync(chainFile, 'utf8'))
		: { receipts: {}, blocks: {}, decimals: {}, venues: {} }
	let lastFacts = 0
	let factsCalls = 0
	for (const w of wallets) {
		const wallet = lc(w.wallet)
		const file = join(out, 'records', `${wallet}.json`)
		let saved: { source_url: string; x_facts_hash: string; facts: any }
		if (existsSync(file)) saved = JSON.parse(readFileSync(file, 'utf8'))
		else {
			const wait = lastFacts + 7000 - Date.now()
			if (wait > 0) await sleep(wait)
			lastFacts = Date.now()
			factsCalls++
			const url = `${VET402}/api/v1/rwa/facts/${getAddress(wallet)}?chain=4663`
			const res = await fetch(url, { signal: AbortSignal.timeout(120_000) })
			if (res.status !== 200) {
				say(`  ${wallet} record ${res.status}: left out`)
				continue
			}
			saved = { source_url: url, x_facts_hash: lc(res.headers.get('x-facts-hash') ?? ''), facts: await res.json() }
			writeFileSync(file, `${JSON.stringify(saved, null, 2)}\n`)
		}
		const record = recordInputs(saved.facts, { source_url: saved.source_url, x_facts_hash: saved.x_facts_hash })
		const anchor: AnchorRef | null = await newestAnchor(rpc, wallet, markBlock, VET402_REPO_RAW)
		const receiver = JSON.parse(readFileSync(join(REPO, 'rwa-verify/config.json'), 'utf8')).receiverAddress
		let cre: CreInputs = { workflow: 'vet402-rwa-verify', anchor_tx: '', anchor_record_url: '', verdict: 'NO_ANCHOR', reason_bits: 0, recomputed_facts_hash: '', anchored_facts_hash: '', receiver, mode: broadcast ? 'broadcast' : 'simulate', verdict_tx: null }
		if (anchor) {
			const run = simulate<any>('rwa-verify', { tx: anchor.tx, recordUrl: anchor.recordUrl }, { broadcast, workDir: join(out, 'cre'), label: `cre-verify-${wallet.slice(2, 10)}` })
			cre = { ...cre, anchor_tx: anchor.tx, anchor_record_url: anchor.recordUrl, verdict: run.result.verdict, reason_bits: run.result.reasonBits, recomputed_facts_hash: lc(run.result.recomputedFactsHash), anchored_facts_hash: lc(run.result.anchoredFactsHash), verdict_tx: run.tx }
		}
		records.set(wallet, { facts: saved.facts, record, cre })
		const txs = [...new Set<string>([...(saved.facts.evidence?.txs ?? []), ...(saved.facts.lookalikes ?? []).map((l: any) => l.tx)].filter(Boolean).map((t: string) => lc(t)))]
		let n = 0
		for (const tx of txs) {
			const r = chain.receipts[`${tx}:${wallet}`] ?? (await rpc('eth_getTransactionReceipt', [tx]))
			if (!r || r.status !== '0x1') continue
			const [mv] = groupMovements(wallet, r.logs ?? []).filter((x) => x.tx === tx)
			if (!mv) continue
			if (!chain.blocks[mv.block]) chain.blocks[mv.block] = (await rpc('eth_getBlockByNumber', [`0x${mv.block.toString(16)}`, false])).timestamp
			// Keep only what a checker reads: the Transfer logs that name the wallet.
			const padded = `0x${'0'.repeat(24)}${wallet.slice(2)}`
			const logs = (r.logs ?? []).filter((l: any) => (l.topics ?? []).slice(1, 3).some((t: string) => lc(t) === padded))
			chain.receipts[`${tx}:${wallet}`] = { transactionHash: tx, blockNumber: r.blockNumber, status: r.status, from: lc(r.from), logs }
			moves.push({ wallet, mv, time: new Date(Number(BigInt(chain.blocks[mv.block])) * 1000).toISOString(), signer: lc(r.from) })
			n++
		}
		say(`  ${wallet} record ${record.r1_status}, realized ${record.realized_usd ?? 'unknown'}, ${anchor ? `anchor ${cre.verdict}` : 'no anchor'}, ${n} moves of ${txs.length} listed txs`)
	}

	// Decimals, venues and feeds.
	const venueCache = new Map<string, Venue['kind']>(Object.entries(chain.venues))
	const feeds: Feeds = {}
	const firstBlock = new Map<string, { block: number; symbol: string; feed: string }>()
	for (const mo of moves) {
		const facts = records.get(mo.wallet)?.facts
		for (const t of mo.mv.transfers) {
			const token = lc(t.token)
			if (chain.decimals[token] === undefined) {
				try {
					chain.decimals[token] = Number(BigInt(await rpc('eth_call', [{ to: token, data: '0x313ce567' }, 'latest'])))
				} catch {
					chain.decimals[token] = 18
				}
			}
			const stock = (facts.tokens ?? []).find((k: any) => k.canonical === true && lc(k.token) === token && k.feed)
			if (stock && (!firstBlock.has(token) || (firstBlock.get(token)?.block ?? 0) > mo.mv.block)) firstBlock.set(token, { block: mo.mv.block, symbol: stock.symbol, feed: stock.feed })
		}
	}
	for (const [token, f] of firstBlock) {
		const series: FeedSeries = await feedSeries(rpc, token, f.symbol, f.feed, f.block - FEED_LOOKBACK, markBlock)
		feeds[token] = series
		say(`  feed ${f.symbol} ${series.points.length} values from block ${series.from_block}`)
	}

	// The walk.
	moves.sort((a, b) => a.mv.block - b.mv.block || (a.mv.tx < b.mv.tx ? -1 : a.mv.tx > b.mv.tx ? 1 : a.wallet < b.wallet ? -1 : 1))
	const book = new PracticeBook(feeds, policy.limits)
	const trails: TrailV2[] = []
	for (const mo of moves) {
		const ctx = records.get(mo.wallet) as { facts: any; record: RecordInputs; cre: CreInputs }
		const n = trails.length + 1
		book.advance(mo.mv.block)
		const tokensMoved = movedTokens(ctx.facts, mo.mv.transfers, chain.decimals, USDG)
		const base = { wallet: mo.wallet, movement: mo.mv, move: { time: mo.time, signer: mo.signer }, tokens_moved: tokensMoved } as DecisionInputsV2
		const leg = stockLegV2(base)
		const venue: Venue[] = []
		if (leg) {
			const others = [...new Set(mo.mv.transfers.filter((t) => lc(t.token) === lc(leg.token) && t.direction === leg.direction).map((t) => (leg.direction === 'in' ? t.from : t.to)))]
			for (const a of others) venue.push(await venueOf(rpc, a, venueCache))
		}
		const purchase: Purchase = {
			mode: 'dry-run',
			resource: `${VET402}/api/v1/rwa/paid/facts/${getAddress(mo.wallet)}`,
			payer,
			payment_tx: null,
			settlement: 'not-sent',
			spent_before_atomic: spentBefore,
			cap_atomic: paymentCapAtomic(policy.limits, MAX_SPEND_ATOMIC).toString(),
			permit2_digest: ZERO32,
		}
		const inputs: DecisionInputsV2 = {
			...base,
			terms,
			record: ctx.record,
			cre: ctx.cre,
			decided_at: decidedAt,
			payer: lc(payer),
			rules: policy.rules,
			venue,
			price: leg ? priceAt(feeds[lc(leg.token)], mo.mv.block) : null,
			limits: policy.limits,
			limits_keccak: policy.limitsKeccak,
			mandate: policy.mandate,
			book: { day: '', used_usd_today: '0.00', open_positions: 0 },
		}
		const sold = saleOf(inputs)
		if (sold) book.walletSold(mo.wallet, sold, mo.mv.block, n)
		inputs.book = book.state(mo.time.slice(0, 10))
		const trail = buildTrailV2(inputs, purchase)
		const p = trail.decision.paper_trade
		if (p) book.open(n, inputs, { token: p.token, symbol: p.symbol, tier: p.tier, notional: p.notional_usd, entry: p.price_usd, fake: false })
		const re = recheckTrailV2(trail)
		if (!re.ok) throw new Error(`decision ${n} does not recheck: ${re.problems.join('; ')}`)
		trails.push(trail)
	}
	for (const [a, k] of venueCache) chain.venues[a] = k
	trails.sort(order)
	const ledger = buildLedger(trails, feeds, markBlock)
	ledger.rows.forEach((r, i) => {
		if (JSON.stringify(r.book) !== JSON.stringify(trails[i].inputs.book)) throw new Error(`row ${r.n}: the book the decision read is not the book the ledger walk gives`)
	})

	writeFileSync(join(out, 'trails.jsonl'), `${trails.map((t) => JSON.stringify(t)).join('\n')}\n`)
	writeFileSync(join(out, 'feeds.json'), `${JSON.stringify(feeds, null, 1)}\n`)
	writeFileSync(chainFile, `${JSON.stringify(chain)}\n`)
	writeFileSync(join(REPO, 'docs/ledger.json'), `${JSON.stringify(ledger, null, 1)}\n`)
	// One write for the whole walk: the CRE workflow recomputes the Merkle root from the leaves and delivers it.
	const anchored = simulate<{ root: string; ledgerTx: string }>(
		'trail-anchor',
		{ ledger: { root: ledger.root, leaves: ledger.rows.map((r) => ({ leaf: r.leaf, tier: r.tier })), mandate_keccak: ledger.mandate.keccak, limits_keccak: ledger.limits_keccak, rules: ledger.rules, mark_block: markBlock } },
		{ broadcast, workDir: join(out, 'cre'), label: 'ledger-root' },
	)
	if (anchored.result.root !== ledger.root) throw new Error(`CRE gave root ${anchored.result.root}, the ledger says ${ledger.root}`)
	const receiver = JSON.parse(readFileSync(join(REPO, 'trail-anchor/config.json'), 'utf8')).ledgerReceiverAddress
	writeFileSync(
		join(out, 'anchor.json'),
		`${JSON.stringify({ root: ledger.root, decisions: ledger.totals.decisions, ledger_tx: anchored.tx, receiver, network: anchored.tx ? 'robinhood-testnet (46630)' : 'simulated', written_through: "CRE's simulation forwarder (MockKeystoneForwarder). Not a DON attestation." }, null, 2)}\n`,
	)
	const t = ledger.totals
	say('')
	say(`  CRE       root recomputed from ${ledger.rows.length} leaves${anchored.tx ? `, LedgerAnchored tx ${anchored.tx}` : ' (simulated, not broadcast)'}`)
	say(`  decisions ${t.decisions} about ${t.wallets} wallets: FULL ${t.full}, REDUCED ${t.reduced}, NONE ${t.none}; look-alikes named ${t.fakes_named}`)
	say(`  copy-guard  opened ${t.copy_guard.opened} (${t.copy_guard.put_in_usd} USD of practice money), closed ${t.copy_guard.closed}, open ${t.copy_guard.open}, result ${t.copy_guard.result_usd} USD`)
	say(`  blind copy  opened ${t.blind_copy.opened} (${t.blind_copy.put_in_usd} USD), of which ${t.blind_copy.fakes} look-alikes, closed ${t.blind_copy.closed}, open ${t.blind_copy.open}, result ${t.blind_copy.result_usd} USD`)
	say(`  root      ${ledger.root}`)
	say(`  read      ${factsCalls} records from the free route, ${rpc.calls()} RPC calls`)
	say(`  saved     ${relative(REPO, out)}/ and docs/ledger.json`)
	writeFileSync(join(out, 'walk-output.txt'), `${log.join('\n')}\n`)
}

main().catch((e) => {
	console.error(String(e instanceof Error ? e.message : e).slice(0, 600))
	process.exit(1)
})
