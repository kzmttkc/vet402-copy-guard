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
import { canonicalJson, keccak256 } from '../verify.mjs'

const REPO = join(dirname(fileURLToPath(import.meta.url)), '..')
const read = (p) => readFileSync(join(REPO, p), 'utf8')
const L = JSON.parse(read('docs/ledger.json'))
const anchor = existsSync(join(REPO, 'docs/walk/anchor.json')) ? JSON.parse(read('docs/walk/anchor.json')) : null
const sample = existsSync(join(REPO, 'mandate/sample/mandate.json')) && keccak256(canonicalJson(JSON.parse(read('mandate/sample/mandate.json')))) === L.mandate.keccak
const t = L.totals
const when = (s) => `${s.slice(0, 16).replace('T', ' ')} UTC`
const moves = L.rows.map((r) => r.move_time).sort()
const short = (h) => `${h.slice(0, 10)}…${h.slice(-6)}`
const reasons = {}
for (const r of L.rows) if (r.tier === 'NONE') reasons[r.card.headline.replace('No position: ', '')] = (reasons[r.card.headline.replace('No position: ', '')] ?? 0) + 1
const top = Object.entries(reasons).sort((a, b) => b[1] - a[1])

const ledger = `Walked ${when(L.decided_at)}, marked at Robinhood Chain block ${L.mark_block}. Moves from ${when(moves[0])} to ${when(moves[moves.length - 1])}.

| | copy-guard | Blind copy |
|---|---|---|
| Decisions | ${t.decisions} about ${t.wallets} wallets | the same ${t.decisions} moves |
| Practice positions opened | ${t.copy_guard.opened} (FULL ${t.full}, REDUCED ${t.reduced}) | ${t.blind_copy.opened} |
| Of them in look-alike tokens | 0 | ${t.blind_copy.fakes} |
| Look-alikes named and refused | ${t.fakes_named} | 0 |
| Practice money put in | ${t.copy_guard.put_in_usd} USD | ${t.blind_copy.put_in_usd} USD |
| Closed / still open at the mark | ${t.copy_guard.closed} / ${t.copy_guard.open} | ${t.blind_copy.closed} / ${t.blind_copy.open} |
| Result at the exit or the mark | ${t.copy_guard.result_usd} USD | ${t.blind_copy.result_usd} USD |

In one sentence: a blind copy would have opened ${t.blind_copy.opened} positions, ${t.blind_copy.fakes} of them in look-alike tokens. copy-guard opened ${t.copy_guard.opened}, each sized by the evidence, and named ${t.fakes_named} look-alikes by address.

No position, by leading reason: ${top.map(([k, n]) => `${k} (${n})`).join(', ')}.

The Merkle root of all ${t.decisions} decisions is \`${L.root}\`.${anchor?.ledger_tx ? ` It is in one \`LedgerAnchored\` event on Robinhood Testnet: [\`${short(anchor.ledger_tx)}\`](https://explorer.testnet.chain.robinhood.com/tx/${anchor.ledger_tx}?tab=logs).` : ' This walk was simulated only, so the root is not onchain.'}

${L.mandate.signed_by_principal ? (sample ? '**This walk used the SAMPLE mandate.** Its principal is a testnet-only key that stands in for the real principal `0x973c…6227`, whose signature on `mandate/mandate.json` is still to come. After that signature the walk is run again.' : 'The mandate `mandate/mandate.json` is signed by its principal `0x973c…6227`, and every decision carries that signature.') : 'The mandate was not signed when this walk ran, so rule M1 made every decision NONE.'}`

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
