#!/usr/bin/env node
// Rewrite the two marked blocks of README.md from the saved walk and the saved recheck.
//
//   node scripts/readme-numbers.mjs
//
// <!-- LEDGER:BEGIN --> … <!-- LEDGER:END -->   the numbers of docs/ledger.json
// <!-- VERIFY:BEGIN --> … <!-- VERIFY:END -->   docs/verify/verify-output.txt
// No number in the README is typed by hand, so a new walk cannot leave an old one behind.
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const REPO = join(dirname(fileURLToPath(import.meta.url)), '..')
const read = (p) => readFileSync(join(REPO, p), 'utf8')
const L = JSON.parse(read('docs/ledger.json'))
const anchor = existsSync(join(REPO, 'docs/walk/anchor.json')) ? JSON.parse(read('docs/walk/anchor.json')) : null
const t = L.totals
const when = (s) => `${s.slice(0, 16).replace('T', ' ')} UTC`
const short = (h) => `${h.slice(0, 10)}…${h.slice(-6)}`
const o = t.other_tokens
const g = t.copy_guard
const b = t.blind_copy
const z = t.same_size
const c = t.by_cohort
const w = L.context.window
const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`
const otherLine = b.in_other_tokens.count
	? `${b.in_other_tokens.count} in ${plural(b.in_other_tokens.tokens, 'token', 'tokens')} the issuer did not list`
	: 'none in a token the issuer did not list'
const otherValue = (x) => (x.count === 0 ? 'none' : `${x.measured} valued at a pool: ${x.result_measured_usd ?? 'n/a'} USD. ${x.not_measured} not measured, in no sum`)
const mandateLine = {
	sample: '**This walk used the SAMPLE mandate.** Its principal is a testnet-only key that stands in for the real principal `0x973c…6227`, whose signature on `mandate/mandate.json` is still to come. After that signature the walk is run again.',
	signed_by_principal: `The mandate \`mandate/mandate.json\` is signed by its principal \`${L.mandate.principal.slice(0, 6)}…${L.mandate.principal.slice(-4)}\`, and every decision carries that signature.`,
	not_signed: 'The mandate was not signed when this walk ran, so rule M1 made every decision NONE.',
}[L.mandate.status]

const ledger = `Walked ${when(L.decided_at)}, marked at Robinhood Chain block ${L.mark_block}. Moves from ${when(t.first_move_time)} to ${when(t.last_move_time)}.

**Which wallets.** ${plural(t.wallets_by_cohort.top_buyers, 'wallet', 'wallets')}: the largest buyers of Stock Tokens between ${w.from_time.slice(0, 10)} and ${w.to_time.slice(0, 10)} (blocks ${w.from_block} to ${w.to_block}), picked by one rule that code can repeat ([\`docs/walk/SELECTION.md\`](docs/walk/SELECTION.md)). ${plural(t.wallets_by_cohort.watched, 'wallet', 'wallets')} this agent was first pointed at. ${plural(t.wallets_by_cohort.same_ticker_buyers, 'wallet', 'wallets')} chosen because they bought one token that uses the ticker ${o.tickers.includes('SPY') ? 'SPY' : (o.tickers[0] ?? '?')}: an observation, counted apart, not a sample. vet402 could build no record for ${plural(t.wallets_without_record, 'wallet', 'wallets')}. They stay in the ledger: ${plural(t.decisions_without_record, 'decision', 'decisions')}, each opening nothing for that reason.

**What the two policies did with the same ${t.decisions} moves.**

| | copy-guard | Ticker copy |
|---|---|---|
| Practice positions opened | ${g.opened} (FULL ${t.full}, REDUCED ${t.reduced}) | ${b.opened} |
| Of them in a token the issuer did not list | 0 | ${b.in_other_tokens.count}${b.in_other_tokens.count ? ` (${plural(b.in_other_tokens.tokens, 'token', 'tokens')})` : ''} |
| Moves declined, each with a reason | ${t.none} | none: it has no rule |
| What a position rests on | a purchase the wallet signed and paid for, on an official venue, priced by a Chainlink feed | a ticker arriving in the wallet |

Different tokens under a listed ticker were part of ${plural(o.moves, 'move', 'moves')}, in ${plural(o.tokens, 'token', 'tokens')} (${o.list.map((x) => `${x.ticker}${x.name && x.name !== x.ticker ? ` "${x.name}"` : ''} at \`${x.token.slice(0, 6)}…${x.token.slice(-4)}\`: ${x.moves}`).join('; ')}). How they came, from the transactions: ${o.sent_to_the_wallet} sent to the wallet by someone else, ${o.bought_by_the_wallet} bought by the wallet itself, ${o.received_unpaid} received in a transaction it signed without paying, ${o.logged_as_sent_by_the_wallet} logged as sent by the wallet. copy-guard named each one by address and opened nothing. This is a record that a ticker is not unique on this chain. It does not call anyone's token a fraud.

Per group of wallets:

| Group | Wallets | Decisions | copy-guard opened | Ticker copy opened | of them in a token the issuer did not list |
|---|---|---|---|---|---|
| Largest buyers | ${c.top_buyers.wallets} | ${c.top_buyers.decisions} | ${c.top_buyers.copy_guard_opened} | ${c.top_buyers.ticker_copy_opened} | ${c.top_buyers.ticker_copy_in_other_tokens} |
| Watched wallet | ${c.watched.wallets} | ${c.watched.decisions} | ${c.watched.copy_guard_opened} | ${c.watched.ticker_copy_opened} | ${c.watched.ticker_copy_in_other_tokens} |
| Bought the ${o.tickers.includes('SPY') ? 'SPY' : ''}-ticker token (chosen for it) | ${c.same_ticker_buyers.wallets} | ${c.same_ticker_buyers.decisions} | ${c.same_ticker_buyers.copy_guard_opened} | ${c.same_ticker_buyers.ticker_copy_opened} | ${c.same_ticker_buyers.ticker_copy_in_other_tokens} |

The purchases copy-guard followed were the wallets' own: ${g.followed_purchases_usd.count} purchases, median ${g.followed_purchases_usd.median} USD, from ${g.followed_purchases_usd.min} to ${g.followed_purchases_usd.max} USD, ${g.followed_purchases_usd.sum} USD in all.

**Money, second.** This is practice money on past moves. It is not a forecast and not a result anyone had. Size alone can make two books differ, so the second table puts every position of both books at one size.

| As each policy sizes | copy-guard | Ticker copy |
|---|---|---|
| Practice money put in | ${g.put_in_usd} USD | ${b.in_stock_tokens.put_in_usd} USD in Stock Tokens, ${b.in_other_tokens.put_in_usd} USD in other tokens |
| Closed / still open at the mark | ${g.closed} / ${g.open} | ${b.closed} / ${b.open} |
| Result in Stock Tokens, at the Chainlink feed | ${g.result_usd} USD | ${b.in_stock_tokens.result_usd} USD |
| Result in other tokens | none opened | ${otherValue(b.in_other_tokens)} |

| Every position at ${z.size_usd} USD | Positions | Result |
|---|---|---|
| Opened by both policies | ${z.opened_by_both.count} | ${z.opened_by_both.result_usd} USD for each policy: the same positions, so the same result |
| Stock Token positions only the ticker copy opened | ${z.opened_by_ticker_copy_only_stock.count} | ${z.opened_by_ticker_copy_only_stock.result_usd} USD |
| Positions in other tokens, only the ticker copy | ${z.opened_by_ticker_copy_only_other.count} | ${otherValue(z.opened_by_ticker_copy_only_other)} |

A position in a token without a Chainlink feed is valued only where the wallet bought it in a Uniswap v4 pool: the pool's price in that swap against the pool's last swap before the mark, both public logs. That value is in the pool's other asset, and it does not say a position of that size could have been sold. Nothing is assumed to be worth zero.

No position, by leading reason: ${t.none_by_reason.map((r) => `${r.reason} (${r.count})`).join(', ')}.

The Merkle root of all ${t.decisions} decisions is \`${L.root}\`.${anchor?.ledger_tx ? ` It is in one \`LedgerAnchored\` event on Robinhood Testnet: [\`${short(anchor.ledger_tx)}\`](https://explorer.testnet.chain.robinhood.com/tx/${anchor.ledger_tx}?tab=logs).` : ' This walk was simulated only, so the root is not onchain.'}

${mandateLine}`

const verify = existsSync(join(REPO, 'docs/verify/verify-output.txt')) ? read('docs/verify/verify-output.txt').trimEnd() : '(run `node verify.mjs` to see it)'
const swap = (text, name, body) => {
	const a = `<!-- ${name}:BEGIN -->`
	const b = `<!-- ${name}:END -->`
	if (!text.includes(a) || !text.includes(b)) throw new Error(`README.md has no ${name} block`)
	return `${text.slice(0, text.indexOf(a) + a.length)}\n${body}\n${text.slice(text.indexOf(b))}`
}
let readme = read('README.md')
readme = swap(readme, 'LEDGER', ledger)
readme = swap(readme, 'VERIFY', `\`\`\`\n${verify}\n\`\`\``)
writeFileSync(join(REPO, 'README.md'), readme)
console.log('README.md: ledger and verify blocks rewritten')
