#!/usr/bin/env node
// Proposed replacement for scripts/readme-numbers.mjs, written by the docs side (C) for A.
//
//   node docs/handoff/readme-numbers.C.mjs                              (works from here)
//   cp docs/handoff/readme-numbers.C.mjs scripts/readme-numbers.mjs     (works from scripts/ too)
//
// It fills every marked block of README.md from the saved walk, so no number in the README
// is typed by hand. What each block means is in docs/handoff/C-to-A.md.
//
//   VERIFY         docs/verify/verify-output.txt, whole                    (kept, same name)
//   VERIFY_TAIL    its last two lines
//   FACTS          the walk in one paragraph: counts and names, no money
//   CARD           one decision card, the first card of the page
//   LEDGER         the two books side by side, then both at one size       (kept, new body)
//   OTHER_TOKENS   every token under a listed ticker at another address, by address
//   LIMITS         limits.json as a table
//   MANDATE        which mandate the walk used, and whether the principal has signed
//   WALLETS        how the wallets were chosen, and how large the followed purchases were
//
// It reads ledger_version 3 (agent/ledger.ts after A's change) and still reads version 2.
// Where a field is missing the block says "not measured" or leaves the sentence out.
// It never fills in a guess.
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

let REPO = dirname(fileURLToPath(import.meta.url))
while (!existsSync(join(REPO, 'verify.mjs'))) {
	if (dirname(REPO) === REPO) throw new Error('verify.mjs not found above this script')
	REPO = dirname(REPO)
}
const { canonicalJson, keccak256 } = await import(pathToFileURL(join(REPO, 'verify.mjs')).href)

const has = (p) => existsSync(join(REPO, p))
const read = (p) => readFileSync(join(REPO, p), 'utf8')
const json = (p) => JSON.parse(read(p))
const maybe = (p) => (has(p) ? json(p) : null)

const L = json('docs/ledger.json')
const limits = json('limits.json')
const anchor = maybe('docs/walk/anchor.json')
const selection = maybe('docs/walk/selection.json')
const realMandate = maybe('mandate/mandate.json')
const sampleMandate = maybe('mandate/sample/mandate.json')
const trails = has('docs/walk/trails.jsonl') ? read('docs/walk/trails.jsonl').split('\n').filter(Boolean).map((l) => JSON.parse(l)) : []

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
	received_unpaid: 'came in a transaction the wallet signed, and the wallet paid nothing in it',
	received_unsigned: 'sent to the wallet, which did not sign',
	in_signed: 'came in a transaction the wallet signed',
	out_unsigned: 'a log names the wallet as the sender, and the wallet did not sign',
	out: 'a log names the wallet as the sender',
}
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
		const how = tr?.direction === 'out' ? (signed ? 'out' : 'out_unsigned') : given && HOW[given] ? given : signed ? 'in_signed' : 'received_unsigned'
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
const howSentence = o
	? [
			[o.sent_to_the_wallet, 'sent to a wallet that did not sign'],
			[o.bought_by_the_wallet, 'bought by the wallet itself (it signed and paid)'],
			[o.received_unpaid, 'received in a transaction the wallet signed without paying'],
			[o.logged_as_sent_by_the_wallet, 'logged with the wallet as the sender'],
		]
			.filter(([n]) => n > 0)
			.map(([n, s]) => `${n} ${s}`)
			.join(', ')
	: ''

const chosenForIt = t.wallets_by_cohort?.same_ticker_buyers ?? 0
const notARate = chosenForIt ? ` ${chosenForIt} of the ${t.wallets} wallets are in the walk because they bought such a token, so these counts are not a rate.` : ''

const facts = `**The walk of ${day(L.decided_at)}, practice only.** copy-guard looked at ${t.decisions} moves of ${t.wallets} wallets. It opened ${plural(opened, 'practice position', 'practice positions')}, ${sizes}. It declined ${t.none}, each with a reason in plain sentences. ${otherMoves} of the moves were in ${otherTokens ? plural(otherTokens, 'token', 'tokens') : 'tokens'} that carry the ticker of a Stock Token or of USDG at an address the issuer did not list.${howSentence ? ` How they reached the wallet: ${howSentence}.` : ''} Each token is [named by address](#tokens-that-share-a-ticker).${notARate}`

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
| Opened by both books | ${s.opened_by_both.count} | ${s.opened_by_both.put_in_usd} USD | ${s.opened_by_both.result_usd} USD, the same in both books |
| Opened by the ticker copy only, in Stock Tokens | ${s.opened_by_ticker_copy_only_stock.count} | ${s.opened_by_ticker_copy_only_stock.put_in_usd} USD | ${s.opened_by_ticker_copy_only_stock.result_usd} USD |
| Opened by the ticker copy only, in other tokens under a listed ticker | ${s.opened_by_ticker_copy_only_other.count} | ${s.opened_by_ticker_copy_only_other.put_in_usd} USD | ${otherResult(s.opened_by_ticker_copy_only_other)} |`
	: `**At one size.** copy-guard's positions in this walk are ${limits.size.reduced_usd} USD each. At that size the ticker copy would have put in ${usd(t.blind_copy.opened * Number(limits.size.reduced_usd))} USD. What its ${blindOther} positions in other tokens were worth afterwards is not measured in this walk, so no result in USD is compared here.`

const COHORT = { top_buyers: 'The largest buyers of Stock Tokens', same_ticker_buyers: 'Wallets chosen because they bought a token under a listed ticker at another address', watched: 'The demo wallet' }
const bc = t.by_cohort
const byCohort = bc
	? `

**The same counts by group of wallets**, because one group was chosen for what it bought.

| Group | Wallets | Moves | copy-guard opened | Ticker copy opened | Of them in other tokens |
|---|---|---|---|---|---|
${Object.keys(COHORT).filter((k) => bc[k]?.wallets).map((k) => `| ${COHORT[k]} | ${bc[k].wallets} | ${bc[k].decisions} | ${bc[k].copy_guard_opened} | ${bc[k].ticker_copy_opened} | ${bc[k].ticker_copy_in_other_tokens} |`).join('\n')}`
	: ''

const ledger = `Walked ${when(L.decided_at)}, marked at Robinhood Chain block ${L.mark_block}. Moves from ${when(firstMove)} to ${when(lastMove)}.

**What each book did with the same ${t.decisions} moves**

| | copy-guard | Ticker copy |
|---|---|---|
| Practice positions opened | ${opened} (full size ${t.full}, reduced size ${t.reduced}) | ${t.blind_copy.opened} |
| Of them in a token under a listed ticker at an address the issuer did not list | 0 | ${blindOther}${blindOtherTokens ? `, in ${plural(blindOtherTokens, 'token', 'tokens')}` : ''} |
| Declined, each with a reason | ${t.none} | 0. It has no rule to decline by |
| Closed / still open at the mark | ${t.copy_guard.closed} / ${t.copy_guard.open} | ${t.blind_copy.closed} / ${t.blind_copy.open} |${byCohort}

${sameSize}

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
const days = selection?.window?.days
const list = (xs) => (xs.length < 2 ? xs.join('') : `${xs.slice(0, -1).join(', ')} and ${xs[xs.length - 1]}`)
const cohorts = c
	? list(
			[
				[c.top_buyers, `picked by one rule and not by hand (the largest buyers of Stock Tokens${days ? ` over ${days} days` : ''}, largest first)`],
				[c.same_ticker_buyers, 'that bought a token under a listed ticker at an address the issuer did not list'],
				[c.watched, c.watched === 1 ? 'demo wallet, the only one vet402 has anchored a record for' : 'watched by hand'],
			]
				.filter(([n]) => n > 0)
				.map(([n, why]) => `${n} ${why}`),
		)
	: ''
const wallets = [
	c ? `The walk follows ${t.wallets} wallets: ${cohorts}.` : `The walk follows the ${t.wallets} wallets listed in [\`docs/walk/wallets.json\`](docs/walk/wallets.json). Each entry says why the wallet is there.`,
	selection ? 'The rule, the window and every purchase counted are in [`docs/walk/selection.json`](docs/walk/selection.json).' : '',
	f?.count ? `The ${plural(f.count, 'purchase', 'purchases')} copy-guard followed with a practice position were worth between ${f.min} and ${f.max} USD each, with a median of ${f.median} USD.` : '',
]
	.filter(Boolean)
	.join(' ')

const verifyOut = has('docs/verify/verify-output.txt') ? read('docs/verify/verify-output.txt').trimEnd() : null
const fence = (body) => `\`\`\`\n${body}\n\`\`\``

const swap = (text, name, body) => {
	const a = `<!-- ${name}:BEGIN -->`
	const b = `<!-- ${name}:END -->`
	if (!text.includes(a) || !text.includes(b)) throw new Error(`README.md has no ${name} block`)
	return `${text.slice(0, text.indexOf(a) + a.length)}\n${body}\n${text.slice(text.indexOf(b))}`
}
const blocks = [
	['VERIFY', fence(verifyOut ?? '(run `node verify.mjs` to see it)')],
	['VERIFY_TAIL', fence(verifyOut ? verifyOut.split('\n').slice(-2).join('\n') : '(run `node verify.mjs` to see it)')],
	['FACTS', facts],
	['CARD', card],
	['LEDGER', ledger],
	['OTHER_TOKENS', otherTable],
	['LIMITS', limitsTable],
	['MANDATE', mandate],
	['WALLETS', wallets],
]
let readme = read('README.md')
for (const [name, body] of blocks) readme = swap(readme, name, body)
writeFileSync(join(REPO, 'README.md'), readme)
console.log(`README.md: ${blocks.length} blocks rewritten (${blocks.map(([n]) => n).join(', ')}), ledger_version ${L.ledger_version}`)
