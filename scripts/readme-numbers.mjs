#!/usr/bin/env node
// Fills every marked block of README.md from the saved walk and the saved CRE runs, so no
// number in the README is typed by hand.
//
//   node scripts/readme-numbers.mjs
//
//
//   VERIFY         docs/verify/verify-output.txt, whole                    (kept, same name)
//   VERIFY_TAIL    its last two lines
//   JUMP           the table for judges at the top, with the link to the recheck's heading
//   VERIFY_HEAD    the recheck's heading: the slowest saved quick run, or "with one command"
//   VERIFY_RUN     step 1 of the recheck: --quick first when verify.mjs has it, then the whole run
//   FACTS          the walk in one paragraph: names and counts first, the groups apart, no money
//   CARD           one decision card, the first card of the page
//   LEDGER         the two books side by side, then both at one size       (kept, new body)
//   OTHER_TOKENS   every token under a listed ticker at another address, by address
//   LIMITS         limits.json as a table
//   MANDATE        which mandate the walk used, and whether the principal has signed
//   WALLETS        how the wallets were chosen, and what copy-guard followed, group by group
//   STORY          the move told at the top, from the card's own row
//   CHANGES        what changes, with times read from the saved logs and docs/verify/verify-five-runs.txt
//   CRE_SIMULATE   the `cre workflow simulate` lines and what they printed      docs/token-check/batch/, docs/simulate-match.txt
//   CRE_NUMBERS    what token-check checked, its runs, the anchor, the recheck  docs/token-check/
//   CRE_GUIDE      the CRE code guide; every line number is found in the file as it is now
//   CRE_FEEDBACK   what I learned using CRE, with line numbers found the same way
//
// It reads ledger_version 3 (agent/ledger.ts after A's change) and still reads version 2.
// Where a field is missing the block says "not measured" or leaves the sentence out.
// It never fills in a guess. What it says about groups, arrivals, the selection and the
// recheck's times comes from scripts/groups.mjs, which the page reads too.
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

let REPO = dirname(fileURLToPath(import.meta.url))
while (!existsSync(join(REPO, 'verify.mjs'))) {
	if (dirname(REPO) === REPO) throw new Error('verify.mjs not found above this script')
	REPO = dirname(REPO)
}
const { canonicalJson, keccak256, readWalkFile } = await import(pathToFileURL(join(REPO, 'verify.mjs')).href)
const { arrivalsOf, concentration, followedSentence, groupsBrief, groupsOf, observedToken, secondsWords, selectionSentence, slug, usdRange, usdWords, verifyTimes } = await import(pathToFileURL(join(REPO, 'scripts/groups.mjs')).href)

const has = (p) => existsSync(join(REPO, p))
const read = (p) => readFileSync(join(REPO, p), 'utf8')
const json = (p) => JSON.parse(read(p))
const maybe = (p) => (has(p) ? json(p) : null)
// trails.jsonl is kept gzipped (trails.jsonl.gz). readWalkFile reads either form.
const walkText = (p) => (has(`${p}.gz`) || has(p) ? readWalkFile(join(REPO, p)).toString('utf8') : '')

const L = json('docs/ledger.json')
const limits = json('limits.json')
const anchor = maybe('docs/walk/anchor.json')
const selection = maybe('docs/walk/selection.json')
const realMandate = maybe('mandate/mandate.json')
const sampleMandate = maybe('mandate/sample/mandate.json')
const trails = walkText('docs/walk/trails.jsonl').split('\n').filter(Boolean).map((l) => JSON.parse(l))

const t = L.totals
const lc = (s) => String(s ?? '').toLowerCase()
const when = (s) => `${s.slice(0, 16).replace('T', ' ')} UTC`
const day = (s) => s.slice(0, 10)
const short = (h) => `${h.slice(0, 10)}…${h.slice(-6)}`
const addr = (a) => `${a.slice(0, 6)}…${a.slice(-4)}`
const usd = (n) => Number(n).toFixed(2)
const plural = (n, one, many) => `${n} ${Number(n) === 1 ? one : many}`

// ---- which mandate ------------------------------------------------------------------
// Version 3 says it in mandate.status. Version 2 is read the way the old script read it.
const isSample = L.mandate.sample ?? (sampleMandate !== null && keccak256(canonicalJson(sampleMandate)) === L.mandate.keccak)
const mandateStatus = { signed_by_principal: 'signed', sample: 'sample', not_signed: 'unsigned' }[L.mandate.status] ?? (!L.mandate.signed_by_principal ? 'unsigned' : isSample ? 'sample' : 'signed')

// ---- tokens under a listed ticker at another address --------------------------------
// The kind is 'same_ticker' in version 3 and was 'fake' in the walk of 2026-10-14.
const OTHER = new Set(['fake', 'same_ticker'])
const HOW = {
	bought: 'bought by the wallet, which signed and paid',
	bought_off_venue: 'bought by the wallet outside the official venues',
	received_unpaid: 'came in a transaction the wallet signed, and the wallet paid nothing in it',
	received_unsigned: 'sent to the wallet, which did not sign',
	in_signed: 'came in a transaction the wallet signed',
	out_unsigned: 'a log names the wallet as the sender, and the wallet did not sign',
	out: 'a log names the wallet as the sender',
}
// Version 3 names how a token came in rows[].main.arrival with the words of FIELDS.md.
const V3_HOW = { purchase: 'bought', purchase_off_venue: 'bought_off_venue', swapped_unpaid: 'received_unpaid', liquidity: 'received_unpaid', rotation: 'received_unpaid' }
const others = new Map()
const note = (token, ticker, name, how) => {
	const e = others.get(token) ?? { token, ticker, name, moves: 0, how: {} }
	e.moves++
	e.how[how] = (e.how[how] ?? 0) + 1
	others.set(token, e)
}
for (const trail of trails) {
	const signed = lc(trail.inputs.move?.signer) === lc(trail.inputs.wallet)
	const row = L.rows.find((r) => r.move_tx === trail.inputs.movement.tx && lc(r.wallet) === lc(trail.inputs.wallet))
	for (const m of trail.inputs.tokens_moved ?? []) {
		if (!OTHER.has(m.kind)) continue
		const tr = trail.inputs.movement.transfers.find((x) => lc(x.token) === lc(m.token))
		const given = row?.main && lc(row.main.token) === lc(m.token) ? row.main.arrival : null
		const givenHow = given ? (HOW[given] ? given : V3_HOW[given]) : null
		const how = tr?.direction === 'out' ? (signed ? 'out' : 'out_unsigned') : (givenHow ?? (signed ? 'in_signed' : 'received_unsigned'))
		note(m.token, m.ticker, m.name, how)
	}
}
const otherList = [...others.values()].sort((a, b) => b.moves - a.moves || (a.token < b.token ? -1 : 1))
const otherMoves = t.other_tokens?.moves ?? t.fakes_named
const otherTokens = t.other_tokens?.tokens ?? (otherList.length || null)

// ---- blocks -------------------------------------------------------------------------
const moveTimes = L.rows.map((r) => r.move_time).sort()
const firstMove = t.first_move_time ?? moveTimes[0]
const lastMove = t.last_move_time ?? moveTimes[moveTimes.length - 1]
const opened = t.copy_guard.opened
const sizes = t.full && t.reduced ? `${t.full} at the full size and ${t.reduced} at the reduced size` : t.full ? 'all at the full size' : "each at the reduced size the user's limits give for weaker evidence"
const o = t.other_tokens
// A ledger that knows purchases outside the official venues counts them apart in by_arrival.
const offVenue = o?.by_arrival && 'purchase_off_venue' in o.by_arrival
const howSentence = o
	? [
			[o.sent_to_the_wallet, 'sent to a wallet that did not sign'],
			[offVenue ? o.by_arrival.purchase : o.bought_by_the_wallet, offVenue ? 'bought by the wallet itself at an official venue' : 'bought by the wallet itself (it signed and paid)'],
			[offVenue ? o.by_arrival.purchase_off_venue : 0, 'bought by the wallet outside the official venues'],
			[o.received_unpaid, 'received in a transaction the wallet signed without paying'],
			[o.logged_as_sent_by_the_wallet, 'logged with the wallet as the sender'],
		]
			.filter(([n]) => n > 0)
			.map(([n, s]) => `${n} ${s}`)
			.join(', ')
	: ''

const chosenForIt = t.wallets_by_cohort?.same_ticker_buyers ?? 0
const notARate = chosenForIt ? ` ${chosenForIt} of the ${t.wallets} wallets are in the walk because they bought such a token, so these counts are not a rate.` : ''

// Names and counts lead. Money stays in the ledger's tables, and copy-guard's positions are told group by group.
const G = groupsOf(L, selection)
const guardInOther = L.copy_guard_positions.filter((p) => p.asset === 'same_ticker' || p.fake === true).length
const blindInOther = t.blind_copy.in_other_tokens?.count ?? t.blind_copy.fakes
const inOther = guardInOther ? `copy-guard opened ${guardInOther} positions in them and the ticker copy opened ${blindInOther}.` : `copy-guard opened no position in any of them. The ticker copy opened ${blindInOther}.`
const LI = L.totals?.large_incoming ?? null
const facts = `**The walk of ${day(L.decided_at)}, practice only.**${LI ? ` In the 30 selected wallets the walk follows, ${LI.signed_by_the_wallet.by_arrival.liquidity} of the ${LI.signed_by_the_wallet.count} arrivals of ${Number(LI.threshold_usd).toLocaleString('en-US')} USD or more that the wallet signed were liquidity operations, not purchases. The 30 were picked by what official Uniswap venues sent them in 30 days, a rule that favors liquidity providers, so this is not a chain-wide rate.` : ''} copy-guard looked at ${t.decisions} moves of ${t.wallets} wallets. ${otherMoves} of them were in ${otherTokens ? plural(otherTokens, 'token', 'tokens') : 'tokens'} that carry the ticker of a Stock Token or of USDG at an address the issuer did not list, and each of those tokens is [named by address](#tokens-that-share-a-ticker).${howSentence ? ` How they reached the wallet: ${howSentence}.` : ''} ${inOther}${notARate} ${groupsBrief(G)} In all it opened ${opened}, ${sizes}, and declined ${t.none}, each with a reason in plain sentences.`.replace(/  +/g, ' ')

const reasons = {}
for (const r of L.rows) if (r.tier === 'NONE') reasons[r.card.headline.replace('No position: ', '')] = (reasons[r.card.headline.replace('No position: ', '')] ?? 0) + 1
const top = t.none_by_reason ? t.none_by_reason.map((x) => [x.reason, x.count]) : Object.entries(reasons).sort((a, b) => b[1] - a[1])

const blindOther = t.blind_copy.in_other_tokens?.count ?? t.blind_copy.fakes
const blindOtherTokens = t.blind_copy.in_other_tokens?.tokens
const s = t.same_size
const otherResult = (x) => [x.measured ? `${plural(x.measured, 'position', 'positions')} measured at the pool's own price: ${x.result_measured_usd} USD` : '', x.not_measured ? `${plural(x.not_measured, 'position', 'positions')} not measured` : ''].filter(Boolean).join('. ') || 'none'
const sameSize = s
	? `**The same positions at one size, ${s.size_usd} USD each**, so that size cannot make the difference.

| | Positions | Put in | Result at the exit or the mark |
|---|---|---|---|
${G.filter((g) => g.same_size).map((g) => `| Opened by both books, following ${g.of} | ${g.same_size.count} | ${g.same_size.put_in_usd} USD | ${g.same_size.result_usd} USD |`).join('\n')}${G.some((g) => g.same_size) ? '\n' : ''}| Opened by both books${G.some((g) => g.same_size) ? ', all groups' : ''} | ${s.opened_by_both.count} | ${s.opened_by_both.put_in_usd} USD | ${s.opened_by_both.result_usd} USD, the same in both books |
| Opened by the ticker copy only, in Stock Tokens | ${s.opened_by_ticker_copy_only_stock.count} | ${s.opened_by_ticker_copy_only_stock.put_in_usd} USD | ${s.opened_by_ticker_copy_only_stock.result_usd} USD |
| Opened by the ticker copy only, in other tokens under a listed ticker | ${s.opened_by_ticker_copy_only_other.count} | ${s.opened_by_ticker_copy_only_other.put_in_usd} USD | ${otherResult(s.opened_by_ticker_copy_only_other)} |`
	: `**At one size.** copy-guard's positions in this walk are ${limits.size.reduced_usd} USD each. At that size the ticker copy would have put in ${usd(t.blind_copy.opened * Number(limits.size.reduced_usd))} USD. What its ${blindOther} positions in other tokens were worth afterwards is not measured in this walk, so no result in USD is compared here.`

const most = (g) => (g.top_wallet ? `${g.top_wallet.opened} of ${g.opened} (${g.top_share_pct}%)` : 'none')
const followedCell = (g) => (!g.followed ? (g.opened ? 'not measured' : 'none') : g.followed.count === 1 ? usdWords(g.followed.median) : `${usdRange(g.followed)}, median ${usdWords(g.followed.median)}`)
const byCohort = G.length
	? `

**The same moves by group of wallets.** The groups were chosen in different ways, so each is shown apart and the totals above are only their sum.

| Group | Wallets | Moves | copy-guard opened | Declined | Most in one wallet | Purchases it followed | Ticker copy opened | Of them in other tokens |
|---|---|---|---|---|---|---|---|---|
${G.map((g) => `| ${g.name} | ${g.wallets} | ${g.decisions} | ${g.opened} | ${g.declined} | ${most(g)} | ${followedCell(g)} | ${g.ticker_copy_opened ?? 'not counted'} | ${g.ticker_copy_in_other_tokens ?? 'not counted'} |`).join('\n')}

${concentration(G)}`.trimEnd()
	: ''

// How each token reached the wallet, with what each book opened on it
const ARR = arrivalsOf(L)
const arrivals = ARR.length
	? `**How each token reached the wallet.** Every move is one of these kinds, read from the transaction alone ([\`docs/walk/SELECTION.md\`](docs/walk/SELECTION.md), section 2). Stock Tokens are counted per incoming token, the books per decision.

| How it arrived | What that means | Incoming Stock Tokens | Moves in other tokens under a listed ticker | copy-guard opened | Ticker copy opened |
|---|---|---|---|---|---|
${ARR.map((a) => `| ${a.label} | ${a.means} | ${a.stock} | ${a.other} | ${a.copy_guard_opened} | ${a.ticker_copy_opened} |`).join('\n')}`
	: ''

const ledger = `Walked ${when(L.decided_at)}, marked at Robinhood Chain block ${L.mark_block}. Moves from ${when(firstMove)} to ${when(lastMove)}.

**What each book did with the same ${t.decisions} moves**

| | copy-guard | Ticker copy |
|---|---|---|
| Practice positions opened | ${opened} (full size ${t.full}, reduced size ${t.reduced}) | ${t.blind_copy.opened} |
| Of them in a token under a listed ticker at an address the issuer did not list | 0 | ${blindOther}${blindOtherTokens ? `, in ${plural(blindOtherTokens, 'token', 'tokens')}` : ''} |
| Declined, each with a reason | ${t.none} | 0. It has no rule to decline by |
| Closed / still open at the mark | ${t.copy_guard.closed} / ${t.copy_guard.open} | ${t.blind_copy.closed} / ${t.blind_copy.open} |${byCohort}

${sameSize}${arrivals ? `\n\n${arrivals}` : ''}

These are practice (paper) positions on past public moves. The tables are not a forecast and not a track record. A position in a token that is not the issuer's is valued only where the price of its own pool could be read from public logs. Otherwise it is listed as not measured and left out of every sum. Nothing is assumed to be worth zero. A pool value compares the pool's last swap with the swap the wallet bought in. It leaves out the move of the pool's other asset in USD, and it does not say that a position of that size could have been sold there.

${t.full === 0 ? 'No move reached the full size in this walk. ' : ''}No position, by leading reason: ${top.map(([k, n]) => `${k} (${n})`).join(', ')}.

The Merkle root of all ${t.decisions} decisions is \`${L.root}\`.${anchor?.ledger_tx ? ` It is in one \`LedgerAnchored\` event on Robinhood Testnet: [\`${short(anchor.ledger_tx)}\`](https://explorer.testnet.chain.robinhood.com/tx/${anchor.ledger_tx}?tab=logs).` : ' This walk was simulated only, so the root is not onchain.'}`

const otherTable = otherList.length
	? `| Ticker it carries | Contract | Name it carries | Moves in this walk | How it reached the wallet |
|---|---|---|---|---|
${otherList.map((e) => `| ${e.ticker} | [\`${addr(e.token)}\`](https://robinhoodchain.blockscout.com/address/${e.token}) | "${e.name}" | ${e.moves} | ${Object.entries(e.how).map(([k, n]) => `${HOW[k]}${Object.keys(e.how).length > 1 ? ` (${n})` : ''}`).join(', ')} |`).join('\n')}

${plural(otherList.length, 'token', 'tokens')}, ${plural(otherList.reduce((sum, e) => sum + e.moves, 0), 'move', 'moves')}.${otherList.some((e) => `${e.name}${e.ticker}`.includes('⟨U+')) ? ' The marks ⟨U+…⟩ stand for invisible characters in a name.' : ''}`
	: 'No move in this walk was in a token that carries a listed ticker at an address the issuer did not list.'

// The card shown in the README is the first card of the page: see "cards" in docs/page.template.html.
const isOther = (r) => (r.main ? OTHER.has(r.main.kind) : r.failed.includes('C1'))
const unsignedIn = (r) => (r.main ? r.main.arrival === 'received_unsigned' : /did not sign/.test(r.card.happened) && !/from this wallet/.test(r.card.happened))
const row = L.rows.find((r) => r.move_tx.startsWith('0x1b838f40')) ?? L.rows.find((r) => isOther(r) && unsignedIn(r)) ?? L.rows.find(isOther) ?? L.rows[0]
const card = `> **${row.card.headline}**
> *What happened.* ${row.card.happened}
> *What a ticker copy sees.* ${row.card.blind_view}
> *Why.* ${row.card.why[0]}
> *Suggested action.* ${row.card.so.replace(/^So copy-guard /, 'copy-guard ')}
>
> Decision ${row.n} of the walk, move [\`${short(row.move_tx)}\`](https://robinhoodchain.blockscout.com/tx/${row.move_tx}) on ${when(row.move_time)}. ${row.checks.passed} of ${row.checks.total} checks passed.`

const MEANING = {
	practice_only: 'this build has no code path that places a trade',
	'size.full_usd': 'a practice position when every rule passes, in USD',
	'size.reduced_usd': 'a practice position on weaker evidence about the wallet, in USD',
	'size.max_usd_per_day': 'all positions opened on one UTC day, in USD',
	'size.max_open_positions': 'open at once',
	'evidence.record_not_anchored': "vet402 has not anchored the wallet's record",
	'evidence.history_partial': "the wallet's history is only partly rebuilt",
	'evidence.wallet_result_unknown': 'the record gives no realized result',
	'evidence.wallet_at_a_loss': "the wallet's closed trades add up to a loss",
	'evidence.max_price_age_hours': 'the oldest feed value used as an entry price, in hours',
	'exit.when_wallet_sells': 'leave when the copied wallet sells or sends the token',
	'exit.stop_loss_pct': 'leave when the feed is this many percent under the entry',
	'exit.take_profit_pct': 'leave when the feed is this many percent over the entry',
	'exit.max_holding_days': 'leave after this many days whatever the price',
	'payments.max_usdg_per_decision': 'the most the agent may pay for evidence for one decision, in USDG',
	'payments.max_usdg_total': 'the most it may pay in total, in USDG. The code never goes above 1',
}
const flat = (obj, pre = '') => Object.entries(obj).flatMap(([k, v]) => (v && typeof v === 'object' ? flat(v, `${pre}${k}.`) : [[`${pre}${k}`, v]]))
const limitsTable = `| Setting | Value | Meaning |
|---|---|---|
${flat(limits).filter(([k]) => k !== 'limits_version').map(([k, v]) => `| \`${k}\` | \`${v}\` | ${MEANING[k] ?? ''} |`).join('\n')}

keccak256 of \`limits.json\`: \`${L.limits_keccak}\`. Every decision of the walk names this hash, and so does the mandate.`

const real = realMandate ? `\`${addr(realMandate.principal)}\`` : 'its principal'
const mandate =
	mandateStatus === 'signed'
		? `**Mandate: signed by the principal.** \`mandate/mandate.json\` is signed by ${real}, and every decision of this walk carries that signature.`
		: mandateStatus === 'sample'
			? `**Mandate: sample, not yet signed by the principal.** This walk used \`mandate/sample/mandate.json\`. Its principal \`${addr(L.mandate.principal)}\` is a testnet-only key that stands in for the principal. The mandate meant for signing, \`mandate/mandate.json\`, names ${real} and has no signature yet, so no decision in this walk carries the principal's own signature. After that signature the walk is run again.`
			: '**Mandate: not signed.** No signature covered this walk, so rule M1 made every decision NONE.'

const c = t.wallets_by_cohort
const f = t.copy_guard.followed_purchases_usd
const gSel = G.find((g) => g.key === 'selected')
const gObs = G.find((g) => g.key === 'observed_other_token_buyers')
const gDemo = G.find((g) => g.key === 'demo')
const wallets = [
	G.length ? `The walk follows ${t.wallets} wallets in ${plural(G.length, 'group', 'groups')}, and every count is kept per group.` : `The walk follows the ${t.wallets} wallets listed in [\`docs/walk/wallets.json\`](docs/walk/wallets.json). Each entry says why the wallet is there.`,
	gSel ? selectionSentence(selection, G) : '',
	gObs ? `${gObs.wallets} more are observed apart: the first buyers of ${observedToken(selection)}.` : '',
	gDemo ? `${gDemo.wallets === 1 ? 'One demo wallet is' : `${gDemo.wallets} demo wallets are`} in the walk too, ${gDemo.wallets === 1 ? 'the only one' : 'the only ones'} vet402 has anchored a record for.` : '',
	selection ? 'The rule, the window and every purchase counted are in [`docs/walk/selection.json`](docs/walk/selection.json).' : '',
	followedSentence(G),
	!G.some((g) => g.followed) && f?.count ? `The ${plural(f.count, 'purchase', 'purchases')} copy-guard followed with a practice position were worth between ${f.min} and ${f.max} USD each.` : '',
]
	.filter(Boolean)
	.join(' ')

const verifyOut = has('docs/verify/verify-output.txt') ? read('docs/verify/verify-output.txt').trimEnd() : null
const fence = (body) => `\`\`\`\n${body}\n\`\`\``

// ---- the recheck: its heading, the judges' table that links to it, and step 1 ------------
const VT = verifyTimes((p) => (has(p) ? read(p) : null), read('verify.mjs'))
const jump = `| If you are judging | Start here |
|---|---|
| **Anyone** | [Verify it yourself in 20 seconds, 4 steps](#${slug(VT.heading)}) |
| **Chainlink**, Best workflow with CRE | [Chainlink: Best workflow with CRE](#chainlink-best-workflow-with-cre). The one \`cre workflow simulate\` line, the bounty text line by line, the CRE code guide |
| **RYO-CHAN**, Autonomous Agents | [RYO-CHAN: Autonomous Agents](#ryo-chan-autonomous-agents). The bounty text phrase by phrase, the practice trade ledger, one sentence turned into limits |
| **BLI**, LegalTech and RegTech | [BLI: LegalTech and RegTech](#bli-legaltech-and-regtech). Who the agent acts for, two questions from BLI's own stage, the regulators' words |
| Any of them | [Details](#details), [What it does not claim](#what-it-does-not-claim) |`
const clone = 'git clone https://github.com/kzmttkc/vet402-copy-guard && cd vet402-copy-guard'
const quickTail = VT.quickOutput ? VT.quickOutput.trimEnd().split('\n').slice(-2).join('\n') : null
const fullTimes = VT.full ? `, ${secondsWords(VT.full)} in ${plural(VT.full.runs, 'saved run', 'saved runs')}${VT.full.day ? ` of ${VT.full.day}` : ''}` : ''
const verifyRun = VT.hasQuick
	? `\`\`\`bash
${clone}
node verify.mjs --quick
\`\`\`

\`--quick\` rechecks the payment, the anchors, the CRE verdicts, the first five cards of the page and the ledger's root against both chains${VT.quick ? `, in ${secondsWords(VT.quick)} (${plural(VT.quick.runs, 'saved run', 'saved runs')}${VT.quick.day ? ` of ${VT.quick.day}` : ''})` : ''}.${quickTail ? ` Its last two lines:\n\n${fence(quickTail)}` : ''}

The whole ledger, every decision and every rule, is one more line${fullTimes}. Most of that time is local computation: \`node verify.mjs --offline\`, which reads no RPC, took 165 s on the author's laptop on 2026-10-15.

\`\`\`bash
node verify.mjs
\`\`\``
	: `\`\`\`bash
${clone}
node verify.mjs
\`\`\``

// ---- CRE: the one line, what it printed, what it checked, where in the code ---------
// Everything below is read from the saved simulate logs, docs/token-check/ and the
// workflow sources as they are now. A line number is found by its text, and a text that
// is no longer in the file stops the script, so a stale number cannot reach the README.
const sources = {}
const lineOf = (file, text, from = 1) => {
	sources[file] ??= read(file).split('\n')
	const i = sources[file].findIndex((l, k) => k + 1 >= from && l.includes(text))
	if (i < 0) throw new Error(`${file}: no line with ${JSON.stringify(text)}`)
	return i + 1
}
const hexShort = (s) => s.replace(/0x[0-9a-fA-F]{40,64}\b/g, (h) => `${h.slice(0, 10)}…${h.slice(-6)}`)
const userLog = (text) => text.split('\n').filter((l) => l.includes('[USER LOG]')).map((l) => l.slice(l.indexOf('[USER LOG]')).trimEnd())

// token-check: the batch run that read the token of the README's card
const tcAnchor = maybe('docs/token-check/anchor.json')
const tcResults = maybe('docs/token-check/results.json')
const tcDetails = maybe('docs/token-check/details.json')
const cardToken = lc(row.main?.token ?? '')
const batchDir = 'docs/token-check/batch'
const batches = has(batchDir) ? readdirSync(join(REPO, batchDir)).filter((f) => /^batch-\d+\.payload\.json$/.test(f)).sort((a, b) => Number(a.match(/\d+/)[0]) - Number(b.match(/\d+/)[0])) : []
const batchFile = batches.find((f) => lc(read(`${batchDir}/${f}`)).includes(cardToken)) ?? batches[0]
let tcSimulate = ''
if (batchFile) {
	const payload = `${batchDir}/${batchFile}`
	const logPath = payload.replace('.payload.json', '.cre.txt')
	const log = read(logPath)
	const ran = log.split('\n').find((l) => l.startsWith('$ cre workflow simulate'))
	if (!ran || !ran.includes(`--http-payload ${payload}`)) throw new Error(`${logPath} does not start with the command for ${payload}`)
	const command = ran.slice(2).replace(/ --broadcast\b/, '')
	const lines = userLog(log)
	const rowsOf = lines.filter((l) => /\] (NOT_)?ISSUER_TOKEN /.test(l))
	const pick = [
		rowsOf.find((l) => lc(l).includes(cardToken)),
		rowsOf.find((l) => /\] ISSUER_TOKEN /.test(l)),
		rowsOf.find((l) => l.includes('USDG_ADDRESS')),
		rowsOf.find((l) => l.includes('TICKER_OR_NAME_READS_AS_USDG')),
	].filter((l, i, a) => l && a.indexOf(l) === i)
	const head = lines.slice(0, lines.indexOf(rowsOf[0]))
	const tail = lines.slice(lines.indexOf(rowsOf[rowsOf.length - 1]) + 1)
	const written = tail.find((l) => / tx 0x[0-9a-f]{64}/.test(l))
	const writtenTx = written?.match(/0x[0-9a-f]{64}/)?.[0]
	const excerpt = [...head, ...rowsOf.filter((l) => pick.includes(l)), `… ${plural(rowsOf.length - pick.length, 'more row', 'more rows')} of the same form`, ...tail].map((l) => (l === written ? l.replace(/0x[0-9a-fA-F]{40}\b/, (h) => `${h.slice(0, 10)}…${h.slice(-6)}`) : hexShort(l)))
	tcSimulate = `**token-check**, many tokens at one block. This payload holds the token of [the card](#the-practice-ledger) below among ${plural(rowsOf.length, 'token', 'tokens')}.

\`\`\`bash
${command}
\`\`\`

From [\`${logPath}\`](${logPath}), the saved output of the same payload run with \`--broadcast\`. Without \`--broadcast\` the write at the end is a dry run.

\`\`\`
${excerpt.join('\n')}
\`\`\`${writtenTx ? `\n\nThe write is [\`${short(writtenTx)}\`](https://explorer.testnet.chain.robinhood.com/tx/${writtenTx}?tab=logs) on Robinhood Testnet.` : ''}`
}

// rwa-verify: the record the agent bought, against its anchor
const rwaLogPath = 'docs/simulate-match.txt'
let rwaSimulate = ''
if (has(rwaLogPath)) {
	const log = read(rwaLogPath)
	const ran = log.split('\n').find((l) => l.startsWith('$ cre workflow simulate'))
	const lines = userLog(log).filter((l) => /\] (OK|FAIL|RESULT|live|record under test|verdict written)/.test(l))
	const day = log.match(/^(\d{4}-\d{2}-\d{2})T/m)?.[1]
	rwaSimulate = `**rwa-verify**, the record the agent bought against its anchor on Robinhood Chain.

\`\`\`bash
${ran.slice(2)}
\`\`\`

From [\`${rwaLogPath}\`](${rwaLogPath})${day ? `, saved ${day}` : ''}. The all-zero transaction at the end is the dry run: nothing was broadcast.

\`\`\`
${lines.map(hexShort).join('\n')}
\`\`\``
}

// ---- the move at the top of the README: the card's own row --------------------------
const seen = row.card.happened.match(/sent this wallet ([\d,.]+) tokens with the ticker (\S+?) /)
if (!seen) throw new Error(`the card of decision ${row.n} does not say how many tokens arrived`)
const signedIt = lc(trails.find((x) => x.inputs.movement.tx === row.move_tx)?.inputs.move?.signer) === lc(row.wallet)
const story = `Those two people wrote about tokens and agents in general. The same gap is open for stock tokens, because a ticker is not unique on a chain where anyone can deploy a token. What follows is my own observation, and I have found no account of anyone losing money this way. On ${day(row.move_time)} at ${row.move_time.slice(11, 16)} UTC, ${seen[1]} tokens that a block explorer lists as ${seen[2]} arrived in a wallet that trades Robinhood Stock Tokens.${signedIt ? '' : ' The wallet did not sign that transaction.'} A copier that goes by the ticker sees ${seen[1]} ${seen[2]} arrive in that wallet. This record accuses no one. It shows that a ticker is not unique.`

// ---- what changes, with the times read from saved logs ------------------------------
const secs = (log, from, to) => {
	const t = (re) => log.split('\n').find((l) => re.test(l))?.match(/^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})Z/)?.[1]
	const a = t(from)
	const b = t(to)
	return a && b ? (Date.parse(`${b}Z`) - Date.parse(`${a}Z`)) / 1000 : null
}
const tcLog = batchFile ? read(`${batchDir}/${batchFile}`.replace('.payload.json', '.cre.txt')) : ''
const tcSecs = tcLog ? secs(tcLog, /Running trigger/, /batch hash written/) : null
const rwaSecs = has(rwaLogPath) ? secs(read(rwaLogPath), /Running trigger/, /verdict written/) : null
const fiveRuns = has('docs/verify/verify-five-runs.txt') ? read('docs/verify/verify-five-runs.txt') : ''
const runTimes = [...fiveRuns.matchAll(/^run \d+ \((\S+)\): exit (\d+), (\d+) s, (.*)$/gm)].map((m) => ({ at: m[1], exit: Number(m[2]), s: Number(m[3]), tail: m[4] }))
const fiveDay = fiveRuns.match(/on (\d{4}-\d{2}-\d{2})/)?.[1]
const allMatch = runTimes.length > 0 && runTimes.every((r) => r.exit === 0 && /RESULT: MATCH/.test(r.tail))
const range = (xs) => (Math.min(...xs) === Math.max(...xs) ? `${xs[0]}` : `${Math.min(...xs)} to ${Math.max(...xs)}`)
const changes = `The last column holds only times read from saved runs on this machine: the simulate logs (from the trigger to the write, the compile not counted) and five runs of the recheck.

| Before | Here | What changes | Measured |
|---|---|---|---|
| A person opens a block explorer and compares a token's contract with the issuer's list by eye, if they think of it | \`token-check\` reads the code hash, the beacon and the official list from the chain | the check runs before the agent acts and returns a reason code a machine can read | ${tcSecs !== null ? `${tcSecs} s for ${plural((tcLog.match(/\] (NOT_)?ISSUER_TOKEN /g) ?? []).length, 'token', 'tokens')} at one block ([\`${batchFile.replace('.payload.json', '.cre.txt')}\`](${batchDir}/${batchFile.replace('.payload.json', '.cre.txt')}))` : 'not measured'} |
| A reader trusts the site that shows a wallet's record | \`rwa-verify\` recomputes the record's hash and reads its anchor | MATCH or MISMATCH with one bit per failed check, as an event | ${rwaSecs !== null ? `${rwaSecs} s ([\`${rwaLogPath}\`](${rwaLogPath}))` : 'not measured'} |
| An agent's operator keeps its own log | every decision is hashed, and one event carries the Merkle root of the walk | a third party rechecks every decision of a walk without trusting the operator | ${VT.quick ? `${secondsWords(VT.quick)} for \`node verify.mjs --quick\`, ` : ''}${runTimes.length ? `${range(runTimes.map((r) => r.s))} s for \`node verify.mjs\` on this walk, ${runTimes.length} runs back to back${fiveDay ? ` on ${fiveDay}` : ''}${allMatch ? ', each RESULT: MATCH' : ''} ([\`docs/verify/verify-five-runs.txt\`](docs/verify/verify-five-runs.txt)). Most of it is local computation, not the network: \`node verify.mjs --offline\` reads no RPC and still took 165 s on the author's laptop on 2026-10-15` : 'not measured'} |`

const creSimulate = [
	'Both lines run from the root of the repo, after `cre login` and `bun install` in the workflow\'s folder. No key is needed. The time at the start of each saved log line is the machine\'s local clock printed with a `Z` (row 3 of the notes below), so the excerpts leave it out.',
	tcSimulate,
	rwaSimulate,
]
	.filter(Boolean)
	.join('\n\n')

// What token-check has checked: docs/token-check/{anchor,results,details}.json and the recheck's last line
let creNumbers = 'No token-check results are saved yet.'
if (tcAnchor && tcResults) {
	const MARKS = ['TICKER_SAME_AS_ISSUER_TOKEN', 'TICKER_SAME_AFTER_FOLDING', 'NAME_SAME_AS_ISSUER_TOKEN', 'NAME_ENDS_LIKE_ISSUER_TOKEN', 'TICKER_OR_NAME_READS_AS_USDG', 'ISSUER_CODE_AT_UNLISTED_ADDRESS']
	const rows = Object.values(tcResults.tokens)
	const issuer = rows.filter((r) => r.issuer_token)
	const not = rows.filter((r) => !r.issuer_token)
	const usdg = not.filter((r) => r.reasons.includes('USDG_ADDRESS'))
	const listedUnconfirmed = not.filter((r) => r.reasons.includes('IN_ISSUER_LIST'))
	const lookalike = not.filter((r) => r.reasons.includes('NOT_IN_ISSUER_LIST') && r.reasons.some((x) => MARKS.includes(x)))
	const plain = not.filter((r) => r.reasons.includes('NOT_IN_ISSUER_LIST') && !r.reasons.some((x) => MARKS.includes(x)))
	const updated = issuer.filter((r) => r.multiplier_updates > 0)
	const recheck = has('docs/token-check/recheck-output.txt') ? read('docs/token-check/recheck-output.txt').trimEnd().split('\n').pop() : null
	const runs = tcDetails?.runs ?? tcResults.cre_runs.map((r, i) => ({ run: i + 1, tx: r.tx }))
	creNumbers = `**What \`token-check\` has checked so far.** ${plural(tcAnchor.tokens, 'token', 'tokens')} that moved in the walk, in ${plural(tcAnchor.runs, 'CRE run', 'CRE runs')}, the last at Robinhood Chain block ${tcAnchor.last_checked_block}.

| What | Count |
|---|---|
| the issuer's Stock Tokens, every mark confirmed from the chain (the list, the code hash, the beacon, the factory's log) | ${issuer.length} |
| of them with a share multiplier update logged | ${updated.length} |
| USDG itself | ${usdg.length} |
| at an address outside the list with the ticker or name of a listed Stock Token or of USDG | ${lookalike.length} |
| at an address outside the list with no mark of a listed Stock Token or of USDG | ${plain.length} |
${listedUnconfirmed.length ? `| of them in the list, with a mark the chain did not confirm | ${listedUnconfirmed.length} |\n` : ''}
Each run wrote the hash of its rows in a \`TokenBatchChecked\` event (${runs.map((r) => `[run ${r.run}](https://explorer.testnet.chain.robinhood.com/tx/${r.tx}?tab=logs)`).join(', ')}). One more run read those receipts back over the EVM capability and wrote \`keccak256(results.json)\` = \`${short(tcAnchor.results_keccak)}\` in [\`${short(tcAnchor.anchor_tx)}\`](https://explorer.testnet.chain.robinhood.com/tx/${tcAnchor.anchor_tx}?tab=logs), to \`TokenCheckReceiver\` on Robinhood Testnet. Every decision of the walk names that file by the same hash. ${recheck ? `\`node token-check/recheck.mjs\` reads every row again over plain JSON-RPC, with no CRE and no code shared with the workflow. Its last line: \`${recheck}\`.` : ''} The codes say what was read. None of them says who made a token or why.`
}

// The code guide, with every line number found in the file as it is now
const TC = 'token-check/workflow.ts'
const RV = 'rwa-verify/workflow.ts'
const TA = 'trail-anchor/workflow.ts'
const L_ = (f, t, from) => `L${lineOf(f, t, from)}`
const span = (f, a, b) => {
	const x = lineOf(f, a)
	return `L${x} to L${lineOf(f, b, x)}`
}
const tcWrite = span(TC, 'const report = runtime.report(prepareReportRequest(encoded))', 't.evm.writeReport(runtime')
const tcTrigger = L_(TC, 'cre.handler(http.trigger(')
const creGuide = `Where CRE is used, for a reader with thirty seconds. \`scripts/readme-numbers.mjs\` finds each line number in the file as it is now.

| Workflow | Handler | Trigger | HTTP capability: what it reads | Consensus | EVM capability |
|---|---|---|---|---|---|
| \`rwa-verify\` | [\`${RV}\`](${RV}) ${L_(RV, 'export const onHttpTrigger')} | HTTP trigger, ${L_(RV, 'cre.handler(http.trigger(')} | ${L_(RV, 'http.sendRequest(runtime, fetchLive')} the live record from vet402, ${L_(RV, 'http.sendRequest(runtime, fetchRecord')} the record under test, ${L_(RV, '.sendRequest(runtime, fetchChain')} Robinhood Chain JSON-RPC: chain id, the anchor's receipt, \`eth_getCode\` of RwaAnchor | \`consensusIdenticalAggregation\` on each read | **write**, ${L_(RV, 'const report = runtime.report(')} report, ${L_(RV, '.writeReport(runtime')} \`writeReport\` to \`RwaVerdictReceiver\` on Robinhood Testnet |
| \`token-check\`, one transaction | [\`${TC}\`](${TC}) ${L_(TC, 'function onTransaction(')} (\`onTransaction\`), dispatched from ${L_(TC, 'export const onHttpTrigger')} | HTTP trigger, ${tcTrigger} | ${L_(TC, 'http.sendRequest(runtime, readChain')} Robinhood Chain JSON-RPC: the move's Transfer logs, each token's code, its EIP-1967 beacon slot, \`symbol()\`, \`name()\` and share multiplier (\`readChain\`, ${L_(TC, 'export const readChain')}) | \`consensusIdenticalAggregation\`, ${L_(TC, 'http.sendRequest(runtime, readChain')} | none. It returns \`allow\` and reason bits |
| \`token-check\`, many tokens | ${L_(TC, 'function onBatch(')} (\`onBatch\`) | the same trigger, ${tcTrigger} | ${L_(TC, 'http.sendRequest(runtime, readHead')} the head of the chain (\`readHead\`, ${L_(TC, 'export const readHead')}). ${L_(TC, 'http.sendRequest(runtime, readBatch')} for every token \`EXTCODEHASH\`, the beacon slot, \`symbol()\`, \`name()\`, \`uiMultiplier()\` at one pinned block from a second RPC operator, and from Robinhood's RPC the factory log and every \`UIMultiplierUpdated\` log (\`readBatch\`, ${L_(TC, 'export const readBatch')}) | \`consensusMedianAggregation\` on the head, ${L_(TC, 'http.sendRequest(runtime, readHead')}. \`consensusIdenticalAggregation\` on the rest, ${L_(TC, 'http.sendRequest(runtime, readBatch')} | **write**, ${tcWrite}: the hash of the rows to \`TokenCheckReceiver\` |
| \`token-check\`, anchor | ${L_(TC, 'function onAnchor(')} (\`onAnchor\`) | the same trigger, ${tcTrigger} | none | the report, ${L_(TC, 'const report = runtime.report(prepareReportRequest(encoded))')} | **read**, ${L_(TC, 'evm.getTransactionReceipt(runtime')}: \`getTransactionReceipt\` of every run the file names, on Robinhood Testnet. **write**, ${tcWrite}: the hash of the file |
| \`trail-anchor\` | [\`${TA}\`](${TA}) ${L_(TA, 'export const onHttpTrigger')} | HTTP trigger, ${L_(TA, 'cre.handler(http.trigger(')} | ${L_(TA, '.sendRequest(runtime, checkChain')} Robinhood Chain JSON-RPC: the move's Transfer logs and, for a paid decision, the settlement receipt | \`consensusIdenticalAggregation\`, ${L_(TA, '.sendRequest(runtime, checkChain')} | **write**, ${span(TA, 'runtime.report(prepareReportRequest(encodeTrail(trail)))', 'evm.writeReport(runtime, { receiver: cfg.receiverAddress')} one decision to \`ReasoningTrailReceiver\`. ${span(TA, 'const report = runtime.report(prepareReportRequest(encoded))', 'receiver: cfg.ledgerReceiverAddress')} the Merkle root of a walk to \`LedgerRootReceiver\` |

One EVM read: before \`token-check\` anchors a results file it reads the receipt of each run on Robinhood Testnet and looks for the event it expects. Robinhood Chain mainnet is not on CRE's supported network list, so every mainnet read goes through the HTTP capability as plain JSON-RPC. \`agent/cre.ts\` starts the workflows, \`scripts/token-check-batch.ts\` starts \`token-check\` for a list of tokens, and \`agent/gate/server.ts\` starts \`rwa-verify\` after an x402 payment. Capabilities in use across the three workflows: HTTP trigger, HTTP action, EVM read, EVM write, and consensus of two kinds (identical, median).`

const creFeedback = `| # | Steps | Expected | Actual | Workaround |
|---|---|---|---|---|
| 1 | \`cre workflow simulate rwa-verify … --http-payload @rwa-verify/payloads/match.json\` | the file is read, as with \`curl -d @file\` | \`failed to parse HTTP trigger payload: invalid JSON input: @rwa-verify/payloads/match.json\` (2026-10-14) | pass the path without \`@\`. A hint in the error would help |
| 2 | a payload schema with \`z.string().url()\` and a valid \`https://raw.githubusercontent.com/…\` URL | accepted, as under Bun | rejected inside \`cre workflow simulate\` (2026-10-09). The same schema passes in \`bun test\` | a plain pattern, \`${RV}\` ${span(RV, "zod's .url() rejected", '.optional(),', )} |
| 3 | read the start of any line of a simulate log | UTC, since the time ends in \`Z\` | the machine's local clock with a \`Z\`. My logs read 8 hours ahead on a UTC+8 clock and 7 hours ahead on a UTC+7 clock | I state it next to the saved logs and use block times |
| 4 | \`getNetwork\` for Robinhood Chain mainnet (4663) | an EVM read, since Robinhood Testnet is supported | mainnet is not on the supported list | JSON-RPC over the HTTP capability with \`consensusIdenticalAggregation\`. A full receipt can be large, so the workflows ask \`eth_getLogs\` by topic instead |
| 5 | \`evm.writeReport\` in a simulation without \`--broadcast\`, to a receiver address with no code (\`0x…dEaD\`) | a result that says nothing was sent | \`TxStatus.SUCCESS\` with an all-zero tx hash (\`docs/simulate-match.txt\`) | \`agent/cre.ts\` treats a zero hash as "not written". A distinct status for a dry run would be clearer |
| 6 | \`cre workflow simulate\` on a fresh machine | a local run with no account | it asks for \`cre login\` first | log in once. Worth a line in the README of the templates, since judges reproduce on fresh machines |
| 7 | several JSON-RPC calls in one node-mode function against a public RPC | all answered | HTTP 429 from the RPC when the calls follow each other at once | space the calls with the runtime's host \`sleep\`, \`${TC}\` ${L_(TC, 'The CRE WASM runtime has a host `sleep`')} |
| 8 | read many tokens' state and logs over the HTTP capability in one execution | the 15 calls per execution are enough | one listed token needs up to 9 log queries, and the public RPC answers 429 to a whole batch above what the caller's address has left of its rate (requests of 10 items passed on a quiet line. With another reader on the same address, 3 did not.), so at 10 items per request the call limit is reached at about 9 listed tokens | plan the run before reading (\`plannedHttpCalls\` in \`token-check/batch.ts\`), refuse a payload that cannot fit, and let the caller split the list. A per-execution budget the workflow can ask for at run time would remove the guesswork |
| 9 | have every node read the same block of a chain CRE does not list | a way to pin "the block" across nodes | each node's \`eth_blockNumber\` can differ, so an answer read at "latest" would not be identical across nodes (not observed: a simulation is one node) | two rounds: median on the head, then every read pinned to head minus 20 with identical aggregation (\`${TC}\` ${L_(TC, 'http.sendRequest(runtime, readHead')}, ${L_(TC, 'http.sendRequest(runtime, readBatch')}). Worth a template: it is the general recipe for reading an unlisted chain over HTTP |
| 10 | \`eth_getCode\` for many unknown tokens in one HTTP answer | fits in 250 kb | a contract can be 24 kb, 49 kb as hex, so six tokens can pass the limit | an \`eth_call\` without \`to\` whose init code returns \`EXTCODEHASH\` (\`extcodehashCall\`, ${L_(TC, 'export const extcodehashCall')}): 32 bytes per token |
| 11 | \`evm.getTransactionReceipt\` in a simulation, for a transaction a run of a minute earlier wrote with \`--broadcast\` | the receipt | the receipt, with logs, on Robinhood Testnet. It worked the first time | none needed. It let the workflow check its own earlier writes before anchoring |
| 12 | test \`getTransactionReceipt\` with \`EvmMock\` | a documented shape for the mocked receipt | the JSON form wants base64 for \`address\`, \`topics\`, \`data\` and a string for \`status\`. I found it in the generated types | \`token-check/batch-workflow.test.ts\`, \`b64hex\` |

What worked well: the HTTP trigger plus \`--http-payload\` made each workflow a function I could call from the agent, from a gate and from a shell script with the same payload. The same \`token-check\` handler took three payloads, so the agent, a shell script and the anchor all call one workflow. \`consensusMedianAggregation\` and \`consensusIdenticalAggregation\` could be used in one execution, each on its own HTTP read. Running the same TypeScript in \`bun test\` and in the WASM runtime let the workflows share the rule code with the agent.`

const swap = (text, name, body) => {
	const a = `<!-- ${name}:BEGIN -->`
	const b = `<!-- ${name}:END -->`
	if (!text.includes(a) || !text.includes(b)) throw new Error(`README.md has no ${name} block`)
	return `${text.slice(0, text.indexOf(a) + a.length)}\n${body}\n${text.slice(text.indexOf(b))}`
}
const blocks = [
	['JUMP', jump],
	['VERIFY_HEAD', `## ${VT.heading}`],
	['VERIFY_RUN', verifyRun],
	['VERIFY', fence(verifyOut ?? '(run `node verify.mjs` to see it)')],
	['VERIFY_TAIL', fence(verifyOut ? verifyOut.split('\n').slice(-2).join('\n') : '(run `node verify.mjs` to see it)')],
	['FACTS', facts],
	['CARD', card],
	['LEDGER', ledger],
	['OTHER_TOKENS', otherTable],
	['LIMITS', limitsTable],
	['MANDATE', mandate],
	['WALLETS', wallets],
	['STORY', story],
	['CHANGES', changes],
	['CRE_SIMULATE', creSimulate],
	['CRE_NUMBERS', creNumbers],
	['CRE_GUIDE', creGuide],
	['CRE_FEEDBACK', creFeedback],
]
let readme = read('README.md')
for (const [name, body] of blocks) readme = swap(readme, name, body)
writeFileSync(join(REPO, 'README.md'), readme)
console.log(`README.md: ${blocks.length} blocks rewritten (${blocks.map(([n]) => n).join(', ')}), ledger_version ${L.ledger_version}`)
