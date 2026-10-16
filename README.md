# vet402 copy-guard

copy-guard is the RWA rule set of vet402. vet402 buys what x402 APIs sell with real USDC, re-reads settlement on-chain and publishes every attempt: 8,000+ paid calls on Base since Aug 14, 2026, plus Solana, Tempo, XRPL, Arc and Celo ([export](https://vet402.com/api/v1/observatory/export.csv)).

Anyone can deploy a token called NVDA. copy-guard is an agent that checks which token really moved before it would copy a wallet, and it leaves a record that anyone can recheck.

<!-- JUMP:BEGIN -->
| If you are judging | Start here |
|---|---|
| **Anyone** | [Verify it yourself in 20 seconds, 4 steps](#verify-it-yourself-in-20-seconds) |
| **Chainlink**, Best workflow with CRE | [Chainlink: Best workflow with CRE](#chainlink-best-workflow-with-cre). The one `cre workflow simulate` line, the bounty text line by line, the CRE code guide |
| **RYO-CHAN**, Autonomous Agents | [RYO-CHAN: Autonomous Agents](#ryo-chan-autonomous-agents). The bounty text phrase by phrase, the practice trade ledger, one sentence turned into limits |
| **BLI**, LegalTech and RegTech | [BLI: LegalTech and RegTech](#bli-legaltech-and-regtech). Who the agent acts for, two questions from BLI's own stage, the regulators' words |
| Any of them | [Details](#details), [What it does not claim](#what-it-does-not-claim) |
<!-- JUMP:END -->

> "$600 out the window in seconds"
> @DCA_Sean, a Robinhood Chain user, after a coin that Protos reports appeared in the sell screen of the wallet app. Quoted by [Protos, 2026-07-10](https://protos.com/robinhood-chain-scams-are-already-costing-users-dearly/).

> "I was asleep when the losses accumulated."
> crypto_chris, writing about an AI agent that was left to trade alone. [BlockEden forum, 2026-02-06](https://blockeden.xyz/forum/t/my-ai-agent-lost-12k-in-a-weekend-a-cautionary-tale-about-autonomous-defi/368).

<!-- STORY:BEGIN -->
Those two people wrote about tokens and agents in general. The same gap is open for stock tokens, because a ticker is not unique on a chain where anyone can deploy a token. What follows is my own observation, and I have found no account of anyone losing money this way. On 2026-09-27 at 12:52 UTC, 25 tokens that a block explorer lists as NVDA arrived in a wallet that trades Robinhood Stock Tokens. The wallet did not sign that transaction. A copier that goes by the ticker sees 25 NVDA arrive in that wallet. This record accuses no one. It shows that a ticker is not unique.
<!-- STORY:END -->

copy-guard is an autonomous agent that checks a move before it would copy it. It looks at which contract moved, who signed the transaction, where the token came from and what the wallet's record says. Then it sizes a practice trade by how strong that evidence is (full, reduced or none) and writes every reason in plain sentences. The rules are fixed and no language model decides, so the same inputs always give the same decision. The person it acts for sets the limits, and a mandate names that person by address. Chainlink CRE workflows check the token and the record before the agent acts, and they put the hash of its reasoning onchain.

Nobody has to take my word for this, or the agent's, or a server's. One command with no key, no account and nothing to install rechecks the payment, the records, every decision and the whole practice ledger against two public chains. Without a terminal, [`docs/index.html`](docs/index.html) shows the same ledger as one page.

<!-- FACTS:BEGIN -->
**The walk of 2026-10-16, practice only.** copy-guard looked at 8396 moves of 51 wallets. 136 of them were in 67 tokens that carry the ticker of a Stock Token or of USDG at an address the issuer did not list, and each of those tokens is [named by address](#tokens-that-share-a-ticker). How they reached the wallet: 75 sent to a wallet that did not sign, 22 bought by the wallet itself at an official venue, 2 bought by the wallet outside the official venues, 37 logged with the wallet as the sender. copy-guard opened no position in any of them. The ticker copy opened 24. 20 of the 51 wallets are in the walk because they bought such a token, so these counts are not a rate. The practice positions copy-guard did open come from 2 groups, counted apart. 212 follow purchases of 5.75 to 144,454.24 USD by the selected wallets. 24 follow purchases of 0.22 to 0.48 USD by the wallets observed buying the other SPY. In all it opened 236, each at the reduced size the user's limits give for weaker evidence, and declined 8160, each with a reason in plain sentences. In the wallets the walk follows (the 30 that official Uniswap venues sent the most Stock Tokens in 30 days, a choice that favors liquidity providers), 214 of the 223 arrivals of 100,000 USD or more that the wallet signed were liquidity operations, not purchases.
<!-- FACTS:END -->

<!-- VERIFY_HEAD:BEGIN -->
## Verify it yourself in 20 seconds
<!-- VERIFY_HEAD:END -->

Step 1 needs Node 20 or newer and a copy of this repo. Steps 2 to 4 need only a browser. Every date and time in this README is UTC.

**1. Run the recheck** from the root of the repo.

<!-- VERIFY_RUN:BEGIN -->
```bash
git clone https://github.com/kzmttkc/vet402-copy-guard && cd vet402-copy-guard
node verify.mjs --quick
```

`--quick` rechecks the payment, the anchors, the CRE verdicts, the first five cards of the page and the ledger's root against both chains, in 11 to 13 s (5 saved runs of 2026-10-16). Its last two lines:

```
RESULT: MATCH
To check every decision, the selection, the page and the gate: node verify.mjs (about 3 minutes)
```

The whole ledger, every decision and every rule, is one more line, 128 to 148 s in 5 saved runs of 2026-10-16. Most of that time is local computation: `node verify.mjs --offline`, which reads no RPC, took 165 s on the author's laptop on 2026-10-15.

```bash
node verify.mjs
```
<!-- VERIFY_RUN:END -->

`node verify.mjs` recomputes every hash from the files in this repo with its own code, reruns every rule, replays the practice ledger and compares the results with what Robinhood Chain and Robinhood Testnet hold. The last two lines of its last saved run:

<!-- VERIFY_TAIL:BEGIN -->
```
69 OK, 0 FAIL, 0 not checked
RESULT: MATCH
```
<!-- VERIFY_TAIL:END -->

<details>
<summary>The whole output of that run, line by line</summary>

<!-- VERIFY:BEGIN -->
```
vet402 copy-guard: recheck with no key, no account and no install
  chains  Robinhood Chain 4663 at rpc.mainnet.chain.robinhood.com, Robinhood Testnet 46630 at rpc.testnet.chain.robinhood.com
  OK    keccak256       the built-in hash gives the published test values
1. The record the agent bought
  OK    evidence        docs/agent/first-paid-run holds the record, the 402 exchange and 3 trails about wallet 0xe9b0…c25f
  OK    record hash     docs/agent/first-paid-run/record.json hashes to 0x13271095…0d6adc, the X-Facts-Hash vet402 sent with it, which all 3 trails name
2. The record vet402 anchored, against RwaAnchor on Robinhood Chain
  OK    record file     rwa-verify/fixtures/anchored-record.json hashes to 0x9d0e83d9…f721ee, the hash written in it
  OK    anchor tx       0x15f9ed8a…585c7f succeeded in block 76177721 on Robinhood Chain
  OK    anchor contract RwaAnchor 0x1955…c22d runs the pinned build: no owner, no upgrade path
  OK    anchored hash   onchain 0x9d0e83d9…f721ee = recomputed; wallet 0xe9b0…c25f, written by 0x973c…6227, as of 2026-09-30T03:00:07.000Z
  OK    CRE verdict     the CRE workflow wrote MATCH for anchor 0x15f9ed8a…585c7f in 0xc90411c0…4b6cbb on Robinhood Testnet
3. The x402 payment
  OK    settlement tx   0x65c314bd…87af61 succeeded in block 83662617 on Robinhood Chain
  OK    USDG moved      0.01 USDG from 0xc380…ed94 (the agent) to 0x973c…6227 (vet402), the only USDG transfer in the tx
4. The three decisions
  OK    rules file      agent/rules.ts hashes to 0x2abeff7f…e93b12, the rules every trail names
  trail-68837431-0eac7685.json: the wallet's move in block 68837431
  OK    trail hash      the trail hashes to 0x26fa5a0f…67b420, as the file says
  OK    rules           13 rules rerun give DO_NOT_COPY (failed: C3 C4), 11 pass, every row as the trail has it
  OK    record fields   what the rules read is what docs/agent/first-paid-run/record.json holds
  OK    move on chain   0x0eac7685…6a13f8 in block 68837431: 4 transfers of the wallet, as the trail lists
  OK    trail onchain   DecisionRecorded in 0x02239201…778e92 on Robinhood Testnet has this hash, DO_NOT_COPY, the same record, move and payment
  trail-73953009-1b838f40.json: the wallet's move in block 73953009
  OK    trail hash      the trail hashes to 0x925ab3b6…38e8aa, as the file says
  OK    rules           13 rules rerun give DO_NOT_COPY (failed: C1 C2 C3 C4 C5), 8 pass, every row as the trail has it
  OK    record fields   what the rules read is what docs/agent/first-paid-run/record.json holds
  OK    move on chain   0x1b838f40…77b51b in block 73953009: 1 transfer of the wallet, as the trail lists
  OK    trail onchain   DecisionRecorded in 0x36dead3c…7fca7b on Robinhood Testnet has this hash, DO_NOT_COPY, the same record, move and payment
  trail-81262132-f7cb51a2.json: the wallet's move in block 81262132
  OK    trail hash      the trail hashes to 0x527e16e2…cc1801, as the file says
  OK    rules           13 rules rerun give DO_NOT_COPY (failed: C1 C2 C3 C4 C5), 8 pass, every row as the trail has it
  OK    record fields   what the rules read is what docs/agent/first-paid-run/record.json holds
  OK    move on chain   0xf7cb51a2…478717 in block 81262132: 1 transfer of the wallet, as the trail lists
  OK    trail onchain   DecisionRecorded in 0xfd3df929…563199 on Robinhood Testnet has this hash, DO_NOT_COPY, the same record, move and payment
5. The practice ledger: a walk through every decision, copy-guard next to a ticker copy
  OK    gzipped         trails.jsonl.gz and chain.json.gz unpack to the bytes whose sha256 docs/verify/compressed.json recorded before they were gzipped (109.2 MB and 26.0 MB)
  OK    decisions       8396 decisions rerun, 18 rules each: FULL 0, REDUCED 236, NONE 8160. Every row, card, mandate and limits hash is the one its inputs give
  OK    selection       docs/walk/selection.json went through the top 262 addresses by what official venues sent them, directly or through 3 listed routers, in blocks 62420751 to 87977834 (2026-09-14 to 2026-10-14): 181 routers or other contracts passed over without asking, 81 asked, 30 selected, 51 with no record, each with its saved answer. Stopped because 30 addresses were selected: 262 places of the ranking gone through, 181 of them routers or other contracts (not asked), 81 addresses asked, 30 selected, 51 with no record. Observations apart: 1 watched wallet and 20 buyers of one token with the ticker SPY
  OK    records         50 records in docs/walk/records hash to the X-Facts-Hash vet402 sent with them and give the fields every decision read. For 1 wallets vet402 gave no record, and their decisions say so. Every moved token is named as the issuer's list (195 Stock Tokens, taken 2026-09-28), the CRE token-check results 0xe2fcacc3…535975 and the record give it
  OK    prices          7252 decisions read a price, each the last Chainlink feed value at or before the block of the move, out of 31908 values of 26 feeds saved in docs/walk/feeds.json
  OK    ledger          docs/ledger.json is what the walk gives: 8396 decisions about 51 wallets (FULL 0, REDUCED 236, NONE 8160). Incoming Stock Tokens by kind: purchase 1184, purchase_off_venue 565, rotation 3, liquidity 2217, swapped_unpaid 5, received 263, out 4029. copy-guard opened 236 practice positions, every one on a purchase (an official swap the wallet itself paid for, median 2680.11 USD), and none in a token the issuer did not list. A ticker copy opened 1565: 1541 in Stock Tokens and 24 in 4 other tokens under a listed ticker. Different tokens under a listed ticker were part of 136 moves (67 tokens: FLY, GME, IBM, NET, NVDA, SPY, USDG, WMETA, WTSM): 75 sent to the wallet, 22 bought by it, 0 received unpaid, 37 logged as sent by it. At one size (25.00 USD each): the 236 both opened 19.76 USD, the 1305 Stock Token positions only the ticker copy opened 34.90 USD, and its 24 in other tokens: 21 valued at a pool (-480.89 USD), 3 not measured and in no sum
  OK    groups          copy-guard per group, recomputed: selected: 30 wallets, 8093 decisions, copy-guard opened 212 and declined 7881, followed purchases median 3295.74 USD (sum 2508214.48), at 25.00 USD each 23.05 USD, 81 of 212 from 0x30ce…6576; observed_other_token_buyers: 20 wallets, 210 decisions, copy-guard opened 24 and declined 186, followed purchases median 0.40 USD (sum 9.12), at 25.00 USD each -3.29 USD, 4 of 24 from 0xa634…05fd; demo: 1 wallets, 93 decisions, copy-guard opened 0 and declined 93, followed purchases median 0.00 USD (sum 0.00), at 25.00 USD each 0.00 USD
  OK    page            docs/index.html carries the totals, both books with every position, the 5 cards at the top as full rows and 1677 decisions in short form (every one that opened a position, moved a different token under a listed ticker or was not NONE), all as docs/ledger.json has them. The other decisions are in 51 files of docs/rows, one per wallet, which hold the 8396 rows exactly and give the page's counts per wallet
  OK    limits          limits.json hashes to 0x1e762486…72c2cf, the limits every decision and the mandate name: full 100.00 USD, reduced 25.00 USD, 300.00 USD per day, a wallet at a loss opens nothing
  OK    rules files     agent/rules.ts hashes to 0x2abeff7f…e93b12, the file the paid run's trails name, and agent/rules-v2.ts to 0x051a62db…14cf18, as every decision and the mandate say
  OK    mandate         mandate/mandate.json hashes to 0xe8bfafb6…9bbc1e, and the signature in every decision recovers to its principal 0x502b…b8e6: practice only, payment key 0xc380…ed94, valid 2026-10-14T00:00:00Z to 2026-12-31T23:59:59Z
  OK    root onchain    LedgerAnchored in 0x62986233…04b386 on Robinhood Testnet has the Merkle root 0x4cf309f5…910664 of all 8396 decisions, the same mandate, limits and rules, and the same counts
  OK    CRE verdict     the CRE workflow wrote MATCH for anchor 0x15f9ed8a…585c7f in 0x8764f151…40f71b on Robinhood Testnet
  OK    pool mark       the last swap of Uniswap v4 pool 0x04263541…9cce27 at or before block 89796552 is in 0x0848299c…01257b (block 89796498), the price 1 ticker-copy position is marked at
  OK    pool mark       the last swap of Uniswap v4 pool 0x9f0f44d4…87ef34 at or before block 89796552 is in 0x15899c21…cd45c3 (block 88776704), the price 20 ticker-copy positions are marked at
  21 of the 8396 decisions against Robinhood Chain (--deep checks every one)
  OK    decision 1      0x3b146d42…4e2f14 in block 11167202 (2026-07-16T09:58:34.000Z): 2 transfers as listed, signed by 0x6ce9…8571, not the wallet, purchase_off_venue, venue other, feed value 209.6849 USD from round 337
  OK    decision 2      0x7412e5f2…01c341 in block 11168196 (2026-07-16T10:00:12.000Z): 1 transfer as listed, signed by the wallet, out (ModifyLiquidity), venue uniswap-v4-pool-manager, feed value 209.6849 USD from round 337
  OK    decision 3      0xa74397df…695f1e in block 12770989 (2026-07-18T06:37:49.000Z): 2 transfers as listed, signed by 0x6ce9…8571, not the wallet, purchase_off_venue, venue other, feed value 202.7962 USD from round 378
  OK    decision 5      0x11844df2…353a25 in block 12783716 (2026-07-18T06:59:06.000Z): 4 transfers as listed, signed by the wallet, a purchase: an official swap, paid 125.14426 USDG by the wallet, venue uniswap-v4-pool-manager, feed value 124.0070 USD from round 1223
  OK    decision 9      0x500227c3…0c7f91 in block 12809556 (2026-07-18T07:42:21.000Z): 2 transfers as listed, signed by the wallet, a purchase: an official swap, paid 500 USDG by the wallet, venue uniswap-v4-pool-manager, feed value 124.0070 USD from round 1223
  OK    decision 14     0x2d73712c…53f2de in block 13060285 (2026-07-18T14:42:21.000Z): 2 transfers as listed, signed by the wallet, a purchase: an official swap, paid 3,490.422606 USDG by the wallet, venue uniswap-v4-pool-manager, feed value 346.6150 USD from round 301
  OK    decision 23     0xd8b131e0…739299 in block 13191848 (2026-07-18T18:22:17.000Z): 1 transfer as listed, signed by 0x8c94…ec08, not the wallet, received
  OK    decision 28     0xafe7fc3b…2b815a in block 14537500 (2026-07-20T07:54:42.000Z): 2 transfers as listed, signed by 0xc912…c247, not the wallet, a purchase: an official swap, paid 76,078.26808 USDG by the wallet, venue uniswap-v4-pool-manager and other, feed value 203.3700 USD from round 381
  OK    decision 49     0x187c204e…887acf in block 15692344 (2026-07-21T16:04:13.000Z): 4 transfers as listed, signed by the wallet, a purchase: an official swap, paid 6,516.246932 USDG by the wallet, venue uniswap-v4-pool-manager, feed value 128.3950 USD from round 1294
  OK    decision 51     0xd4f6c2ee…4226c6 in block 15717987 (2026-07-21T16:47:02.000Z): 4 transfers as listed, signed by the wallet, a purchase: an official swap, paid 6,501.03772 USDG by the wallet, venue uniswap-v4-pool-manager, feed value 127.6700 USD from round 1295
  OK    decision 54     0x019cb449…c5de00 in block 15759014 (2026-07-21T17:55:33.000Z): 4 transfers as listed, signed by the wallet, a purchase: an official swap, paid 6,503.891896 USDG by the wallet, venue uniswap-v4-pool-manager, feed value 127.7150 USD from round 1297
  OK    decision 71     0xb54aa589…d58ca6 in block 16301693 (2026-07-22T09:01:53.000Z): 4 transfers as listed, signed by the wallet, a purchase: an official swap, paid 25,312.906162 USDG by the wallet, venue uniswap-v4-pool-manager, feed value 124.2686 USD from round 1315
  OK    decision 128    0xf51d11d7…c59360 in block 17949785 (2026-07-24T06:55:26.000Z): 4 transfers as listed, signed by the wallet, a purchase: an official swap, paid 21,000 USDG by the wallet, venue uniswap-v3-pool and uniswap-v4-pool-manager and uniswap-v3-pool and other, feed value 21.2900 USD from round 258
  OK    decision 138    0x1c3f73da…06e35e in block 18422461 (2026-07-24T20:05:23.000Z): 2 transfers as listed, signed by the wallet, a purchase: an official swap, paid 500 USDG by the wallet, venue uniswap-v3-pool, feed value 21.1650 USD from round 263
  OK    decision 490    0x4775909a…b5bb22 in block 43749967 (2026-08-23T05:22:43.000Z): 1 transfer as listed, signed by the wallet, a purchase: an official swap, paid 16.807827 ETH by the wallet
  OK    decision 638    0xf17d92f8…6aebd2 in block 48284781 (2026-08-28T12:04:21.000Z): 2 transfers as listed, signed by the wallet, a purchase: an official swap, paid 100 USDG by the wallet
  OK    decision 1168   0x12a76b78…b47804 in block 53079256 (2026-09-03T02:51:34.000Z): 2 transfers as listed, signed by the wallet, rotation, venue uniswap-v4-pool-manager, feed value 763.4914 USD from round 117
  OK    decision 4836   0x0eac7685…6a13f8 in block 68837431 (2026-09-21T13:36:17.000Z): 4 transfers as listed, signed by the wallet, a purchase: an official swap, paid 5,000 USDG by the wallet, venue uniswap-v4-pool-manager and uniswap-v3-pool, feed value 726.9600 USD from round 361
  OK    decision 6000   0x1b838f40…77b51b in block 73953009 (2026-09-27T12:52:47.000Z): 1 transfer as listed, signed by 0x3433…abd0, not the wallet, received
  OK    decision 7351   0xf7cb51a2…478717 in block 81262132 (2026-10-06T01:57:36.000Z): 1 transfer as listed, signed by 0x5739…dc19, not the wallet, out
  OK    decision 8345   0x1bd25c5e…86cce4 in block 87803686 (2026-10-13T20:39:01.000Z): 1 transfer as listed, signed by the wallet, a purchase: an official swap, paid 0.000059 ETH by the wallet
6. The x402 gate in front of the CRE workflow: the saved dry run, then the one paid call
  OK    gate 402        the gate answered 402 for /v1/workflows/rwa-verify: exact, eip155:4663, 0.01 USDG to 0x973c…6227 (vet402), Permit2
  OK    payment built   the payment the agent built and did not sign hashes to 0xe08bf1dc…e39735: 0.01 USDG, spender the x402 Permit2 proxy, recipient pinned to 0x973c…6227, valid 120 s
  OK    agent card      agent.json and SKILL.md offer the workflow rwa-verify under the same terms: 0.01 USDG on eip155:4663 to 0x973c…6227
  OK    paid gate       docs/agent/paid-gate-run names the paid gate call 0x7d8d9384…c1eb6c, settled, from 0xc380…ed94
  OK    settlement tx   0x7d8d9384…c1eb6c succeeded in block 89694056 on Robinhood Chain
  OK    USDG moved      0.01 USDG from 0xc380…ed94 (the agent) to 0x973c…6227 (vet402), the only USDG transfer in the tx
  OK    self-paid       the 0.01 USDG came from the payee 0x973c…6227 in 0x6edc973b…e4afc5 (block 89692865): both wallets are the author's, so this is a self-paid test, not revenue

69 OK, 0 FAIL, 0 not checked
RESULT: MATCH
```
<!-- VERIFY:END -->

</details>

The exit code is 0 for MATCH and 1 for MISMATCH. To see it fail, change one digit of the record the agent bought and run it again. The third line puts the file back.

```bash
sed -i.bak 's/"realized_usd": "-170.59"/"realized_usd": "-170.58"/' docs/agent/first-paid-run/record.json
node verify.mjs --only paid-run | grep -v '  OK'
mv docs/agent/first-paid-run/record.json.bak docs/agent/first-paid-run/record.json
```

<details>
<summary>When an RPC is down, and the other ways to run it</summary>

A public RPC that is busy is asked again up to five times, and the line then ends with a note such as `(after 2 retries)`. When no RPC answers even then, the line starts with `----`, the last line reads `RESULT: NOT CHECKED` and the exit code is 3. An outage is never reported as a pass, and never as a failure.

`node verify.mjs --deep` checks every decision of the ledger against the chain instead of a sample. `--only paid-run`, `--only ledger` and `--only gate` run one part. `node verify.mjs 73953009` rechecks one decision of the paid run by the block of the move.

</details>

**2. Open the ledger's root** (Robinhood Testnet). One `LedgerAnchored` event carries the Merkle root of every decision. Its link is under [the practice ledger](#the-practice-ledger). The Contract tab of [`LedgerRootReceiver` `0xe3f0…F0C9`](https://explorer.testnet.chain.robinhood.com/address/0xe3f0cA4f474E15364017eE3f6fc0D0949e5aF0C9) shows its verified source: no owner, no storage, no upgrade path.

**3. Open the payment** (Robinhood Chain). [`0x65c314bd…87af61`](https://robinhoodchain.blockscout.com/tx/0x65c314bd758a59dfc79c78d8da76e557450fa1144726ddc4bfc77e183287af61): 0.01 USDG from `0xc3…ED94`, the agent's wallet, to `0x97…6227`, vet402's wallet, on 2026-10-08. The method is `settle` on `x402ExactPermit2Proxy`.

**4. Open the anchor** (Robinhood Chain). [`0x15f9ed8a…585c7f`](https://robinhoodchain.blockscout.com/tx/0x15f9ed8ae5dd466c2f35021c9f1291e7a624abbb52c8ac26b54d47442f585c7f?tab=logs): one `Anchored` log from `RwaAnchor` with `factsHash` `0x9d0e83d9…f721ee`, the value step 1 recomputes from `rwa-verify/fixtures/anchored-record.json`.

**What this shows and what it leaves open.** There are two payments so far, both self-paid tests: 0.01 USDG on 2026-10-08 ([`0x65c314bd…87af61`](https://robinhoodchain.blockscout.com/tx/0x65c314bd758a59dfc79c78d8da76e557450fa1144726ddc4bfc77e183287af61)) and the paid gate call on 2026-10-16 ([`0x7d8d9384…eb6c`](https://robinhoodchain.blockscout.com/tx/0x7d8d9384d5a529781ad65f1246fc5002c289396137c22950604bc50b13c1eb6c)). I own both the payer and the payee. Neither is revenue. Every trade in the ledger is a practice (paper) trade. The ledger is a replay of past public moves, and it says nothing about whether copying any wallet makes money.

## Chainlink: Best workflow with CRE

CRE is the layer the agent's decision passes through. A CRE workflow checks the record the agent relies on before it acts, another reads from the chain whether a moved token is the issuer's Stock Token, and the reasoning the agent ends with goes onchain through a third. One line reproduces each run. It needs the CRE CLI (v1.37.0) and `cre login` once.

<!-- CRE_SIMULATE:BEGIN -->
Both lines run from the root of the repo, after `cre login` and `bun install` in the workflow's folder. No key is needed. The time at the start of each saved log line is the machine's local clock printed with a `Z` (row 3 of the notes below), so the excerpts leave it out.

**token-check**, many tokens at one block. This payload holds the token of [the card](#the-practice-ledger) below among 12 tokens.

```bash
cre workflow simulate token-check --target local-simulation --non-interactive --trigger-index 0 --http-payload docs/token-check/batch/batch-7.payload.json
```

From [`docs/token-check/batch/batch-7.cre.txt`](docs/token-check/batch/batch-7.cre.txt), the saved output of the same payload run with `--broadcast`. Without `--broadcast` the write at the end is a dry run.

```
[USER LOG] token check, batch (Robinhood Chain 4663, read over JSON-RPC, no vet402 API)
[USER LOG] tokens  12
[USER LOG] state   robinhood-rpc.publicnode.com   logs rpc.mainnet.chain.robinhood.com
[USER LOG] head    88225092 (median of the nodes), checking at block 88225072
[USER LOG] block   88225072  hash 0x1241df11…194821 (the same from both RPCs)
[USER LOG] ISSUER_TOKEN      0x58ffe4a9…09e7aa  "TSM"  updates 2  IN_ISSUER_LIST CODE_HASH_MATCHES BEACON_MATCHES FACTORY_LOG_NAMES_TOKEN TICKER_MATCHES_LIST MULTIPLIER_NOT_ONE
[USER LOG] NOT_ISSUER_TOKEN  0x5c283587…20b282  "U[U+17B5]S[U+17B5]DG"  updates 0  NOT_IN_ISSUER_LIST CODE_HASH_DIFFERS BEACON_DIFFERS TICKER_OR_NAME_READS_AS_USDG INVISIBLE_CHARACTERS
[USER LOG] NOT_ISSUER_TOKEN  0x5dd716fe…8e3539  "NVDA"  updates 0  NOT_IN_ISSUER_LIST CODE_HASH_DIFFERS BEACON_DIFFERS TICKER_SAME_AS_ISSUER_TOKEN NAME_SAME_AS_ISSUER_TOKEN NAME_ENDS_LIKE_ISSUER_TOKEN
[USER LOG] NOT_ISSUER_TOKEN  0x5fc5360d…f1d168  "USDG"  updates 0  USDG_ADDRESS
… 8 more rows of the same form
[USER LOG] RESULT: 12 tokens at block 88225072, 3 the issuer's, 9 not
[USER LOG] batch hash 0x2add686a…288d94 (keccak256 of the canonical JSON of the rows)
[USER LOG] batch hash written to 0xF49b4F21…016550 on robinhood-testnet, tx 0xf580989891b9050e23fff002fab8090a627d287f0fba8d3162ef613b10b439f2
```

The write is [`0xf5809898…b439f2`](https://explorer.testnet.chain.robinhood.com/tx/0xf580989891b9050e23fff002fab8090a627d287f0fba8d3162ef613b10b439f2?tab=logs) on Robinhood Testnet.

**rwa-verify**, the record the agent bought against its anchor on Robinhood Chain.

```bash
cre workflow simulate rwa-verify --target local-simulation --non-interactive --trigger-index 0 --http-payload rwa-verify/payloads/match.json
```

From [`docs/simulate-match.txt`](docs/simulate-match.txt), saved 2026-10-08. The all-zero transaction at the end is the dry run: nothing was broadcast.

```
[USER LOG] live /rwa record: HTTP 200, as_of 2026-10-08T11:37:31.000Z, X-Facts-Hash matches the body
[USER LOG] record under test: 0xe9b08727…6ec25f rwa-recon-0.3 as_of 2026-09-30T03:00:07.000Z, recomputed factsHash 0x9d0e83d9…f721ee
[USER LOG] OK    chain              chain id 4663
[USER LOG] OK    tx status          success in block 76177721
[USER LOG] OK    contract           Anchored log from 0x1955137e…17c22d (RwaAnchor)
[USER LOG] OK    contract code      runtime equals the build of RwaAnchor.sol: no owner, no upgrade path
[USER LOG] OK    anchoredBy         0x973cd8a9…4f6227
[USER LOG] OK    subject            0xa158baaf…d3bfc5 = keccak(0xe9b08727…6ec25f)
[USER LOG] OK    factsHash          0x9d0e83d9…f721ee = recomputed 0x9d0e83d9…f721ee (material v2, binds the whole JSON)
[USER LOG] OK    record facts_hash  record says 0x9d0e83d9…f721ee
[USER LOG] OK    methodVersion      3 = rwa-recon-0.3
[USER LOG] OK    asOf               1790737207 = 2026-09-30T03:00:07.000Z
[USER LOG] RESULT: MATCH. The JSON is the record that was anchored.
[USER LOG] verdict written to 0x00000000…00dEaD on robinhood-testnet, tx 0x00000000…000000
```
<!-- CRE_SIMULATE:END -->

<!-- CRE_NUMBERS:BEGIN -->
**What `token-check` has checked so far.** 143 tokens that moved in the walk, in 15 CRE runs, the last at Robinhood Chain block 88226518.

| What | Count |
|---|---|
| the issuer's Stock Tokens, every mark confirmed from the chain (the list, the code hash, the beacon, the factory's log) | 51 |
| of them with a share multiplier update logged | 16 |
| USDG itself | 1 |
| at an address outside the list with the ticker or name of a listed Stock Token or of USDG | 67 |
| at an address outside the list with no mark of a listed Stock Token or of USDG | 24 |

Each run wrote the hash of its rows in a `TokenBatchChecked` event ([run 1](https://explorer.testnet.chain.robinhood.com/tx/0xda1a216baab1af12ccc41a92be94d7c6558a8abd1396b7aa06ea77d9fc9b1929?tab=logs), [run 2](https://explorer.testnet.chain.robinhood.com/tx/0x1b629f69f76bfc82ee050d90990c2bd55a7ba3c866a28d4e1a0eddc46b7719c3?tab=logs), [run 3](https://explorer.testnet.chain.robinhood.com/tx/0x5a056b974b3648747c236dfe58f5fd6c849d955d70e86431d028093346f8f373?tab=logs), [run 4](https://explorer.testnet.chain.robinhood.com/tx/0xbcc95f7cb393854cc5e5b0562466dc778d3cf92d4d9eeb896b6177f3baa58d25?tab=logs), [run 5](https://explorer.testnet.chain.robinhood.com/tx/0x189e0eb9900d602c71adec6a0a8d1ac52fe92bc6d5e14c2de632f9e745c1abf3?tab=logs), [run 6](https://explorer.testnet.chain.robinhood.com/tx/0x021ae09aadf4517a3d880dd55e69648e68c4edfa21cc8242c198a9070a8cb546?tab=logs), [run 7](https://explorer.testnet.chain.robinhood.com/tx/0xf580989891b9050e23fff002fab8090a627d287f0fba8d3162ef613b10b439f2?tab=logs), [run 8](https://explorer.testnet.chain.robinhood.com/tx/0xc9ba3818f454796da12a5b6efd1074f1c3470dcd50cb52671014993ece89d616?tab=logs), [run 9](https://explorer.testnet.chain.robinhood.com/tx/0x83b8ed7206c3359d489b9359937876fb6e8dcbe3682263c680549204bf83adf9?tab=logs), [run 10](https://explorer.testnet.chain.robinhood.com/tx/0xaae6dad2b49ceda82c1bf4ff797ab8b7743f14ef2922f7d491d67ca6ccc84c2b?tab=logs), [run 11](https://explorer.testnet.chain.robinhood.com/tx/0xe46ea6a7a70441c60f6d837caa88171f77fc949ff7487de64f9962df71a04298?tab=logs), [run 12](https://explorer.testnet.chain.robinhood.com/tx/0x694ddb03aeb9b49ef4d8b99c358d3173fa661527de8748f7aef12ac09039c49e?tab=logs), [run 13](https://explorer.testnet.chain.robinhood.com/tx/0x977bb55a90a6257287d4e99de3a2c3ee6ff77ec3cff84755b921be4ccbc39994?tab=logs), [run 14](https://explorer.testnet.chain.robinhood.com/tx/0xae8bb10664177f9ea48a9e3a523a6628a9d32cccc5267c64eba52755d4664a5b?tab=logs), [run 15](https://explorer.testnet.chain.robinhood.com/tx/0xb5a2fb15bb5a9a4314535de154fad69f0400472e6d7811743c25d731eb11abe2?tab=logs)). One more run read those receipts back over the EVM capability and wrote `keccak256(results.json)` = `0xe2fcacc3…535975` in [`0x2328a939…1225af`](https://explorer.testnet.chain.robinhood.com/tx/0x2328a9398ddf7ad80aa7a1149bc4417cfb57783c57be6e095d44f0df311225af?tab=logs), to `TokenCheckReceiver` on Robinhood Testnet. Every decision of the walk names that file by the same hash. `node token-check/recheck.mjs` reads every row again over plain JSON-RPC, with no CRE and no code shared with the workflow. Its last line: `RECHECK: 143 of 143 rows agree, 0 differ; state read at the checked block for 143, as it is now for 0; 0 problems with the onchain trail; 1001 RPC requests`. The codes say what was read. None of them says who made a token or why.
<!-- CRE_NUMBERS:END -->

### The bounty text, line by line

The four examples in the bounty text, in its order.

| Example in the bounty text | What this repo does | Evidence |
|---|---|---|
| "AI agents consuming CRE workflows with x402 payments" | A gate answers 402 in front of the workflow `rwa-verify`, takes 0.01 USDG on Robinhood Chain and then runs the workflow. `SKILL.md` and `agent.json` let an agent find it and learn the terms | `agent/gate/`, `docs/agent/gate-dry-run/`. So far a dry run: the agent read the 402 and built the payment without signing it. The one settled payment (2026-10-08) bought the record that the workflow verifies |
| "Tokenized asset servicing and lifecycle management" | The workflow `token-check` reads each Stock Token's share multiplier, which changes with a corporate action, straight from Robinhood Chain, and counts the multiplier updates each token has logged | `token-check/`, `docs/token-check/`, [what it has checked so far](#chainlink-best-workflow-with-cre) |
| "Automated risk monitoring" | `token-check` tells the issuer's Stock Token from a different token under the same ticker by the issuer's own marks on chain: the list, the code hash, the beacon, the factory's log. It checks many tokens at one block, writes the hash of its rows, and a second program rechecks every row without CRE. It does not ask vet402. `rwa-verify` checks a record against its anchor, and `trail-anchor` refuses a decision that the rules do not give | `token-check/`, `rwa-verify/`, `trail-anchor/`, `docs/token-check/` |
| "Real-time reserve health checks" | Not attempted | |

The two requirements in the bounty text.

| Requirement | Here |
|---|---|
| "Build, simulate, or deploy a CRE Workflow that's used as an orchestration layer within your project." | Three workflows, all run with `cre workflow simulate`. Rule A4 of the agent reads the verdict of `rwa-verify`, every decision of the walk reads which token is the issuer's from the results of `token-check` and names that file by hash, and a walk's Merkle root is written by `trail-anchor` |
| "Integrate at least one blockchain with an external API, system, data source, LLM, or AI agent and demonstrate a successful simulation (via the CRE CLI) or a live deployment on the CRE network." | Robinhood Chain and Robinhood Testnet, the vet402 API and the agent. Simulation logs are in `docs/` and `docs/token-check/`. A live deployment: not attempted |

### CRE code guide

<!-- CRE_GUIDE:BEGIN -->
Where CRE is used, for a reader with thirty seconds. `scripts/readme-numbers.mjs` finds each line number in the file as it is now.

| Workflow | Handler | Trigger | HTTP capability: what it reads | Consensus | EVM capability |
|---|---|---|---|---|---|
| `rwa-verify` | [`rwa-verify/workflow.ts`](rwa-verify/workflow.ts) L185 | HTTP trigger, L261 | L194 the live record from vet402, L207 the record under test, L213 Robinhood Chain JSON-RPC: chain id, the anchor's receipt, `eth_getCode` of RwaAnchor | `consensusIdenticalAggregation` on each read | **write**, L232 report, L234 `writeReport` to `RwaVerdictReceiver` on Robinhood Testnet |
| `token-check`, one transaction | [`token-check/workflow.ts`](token-check/workflow.ts) L605 (`onTransaction`), dispatched from L597 | HTTP trigger, L637 | L614 Robinhood Chain JSON-RPC: the move's Transfer logs, each token's code, its EIP-1967 beacon slot, `symbol()`, `name()` and share multiplier (`readChain`, L199) | `consensusIdenticalAggregation`, L614 | none. It returns `allow` and reason bits |
| `token-check`, many tokens | L482 (`onBatch`) | the same trigger, L637 | L495 the head of the chain (`readHead`, L329). L505 for every token `EXTCODEHASH`, the beacon slot, `symbol()`, `name()`, `uiMultiplier()` at one pinned block from a second RPC operator, and from Robinhood's RPC the factory log and every `UIMultiplierUpdated` log (`readBatch`, L346) | `consensusMedianAggregation` on the head, L495. `consensusIdenticalAggregation` on the rest, L505 | **write**, L474 to L475: the hash of the rows to `TokenCheckReceiver` |
| `token-check`, anchor | L540 (`onAnchor`) | the same trigger, L637 | none | the report, L474 | **read**, L571: `getTransactionReceipt` of every run the file names, on Robinhood Testnet. **write**, L474 to L475: the hash of the file |
| `trail-anchor` | [`trail-anchor/workflow.ts`](trail-anchor/workflow.ts) L172 | HTTP trigger, L223 | L189 Robinhood Chain JSON-RPC: the move's Transfer logs and, for a paid decision, the settlement receipt | `consensusIdenticalAggregation`, L189 | **write**, L203 to L204 one decision to `ReasoningTrailReceiver`. L164 to L165 the Merkle root of a walk to `LedgerRootReceiver` |

One EVM read: before `token-check` anchors a results file it reads the receipt of each run on Robinhood Testnet and looks for the event it expects. Robinhood Chain mainnet is not on CRE's supported network list, so every mainnet read goes through the HTTP capability as plain JSON-RPC. `agent/cre.ts` starts the workflows, `scripts/token-check-batch.ts` starts `token-check` for a list of tokens, and `agent/gate/server.ts` starts `rwa-verify` after an x402 payment. Capabilities in use across the three workflows: HTTP trigger, HTTP action, EVM read, EVM write, and consensus of two kinds (identical, median).
<!-- CRE_GUIDE:END -->

### What changes

<!-- CHANGES:BEGIN -->
The last column holds only times read from saved runs on this machine: the simulate logs (from the trigger to the write, the compile not counted) and five runs of the recheck.

| Before | Here | What changes | Measured |
|---|---|---|---|
| A person opens a block explorer and compares a token's contract with the issuer's list by eye, if they think of it | `token-check` reads the code hash, the beacon and the official list from the chain | the check runs before the agent acts and returns a reason code a machine can read | 6 s for 12 tokens at one block ([`batch-7.cre.txt`](docs/token-check/batch/batch-7.cre.txt)) |
| A reader trusts the site that shows a wallet's record | `rwa-verify` recomputes the record's hash and reads its anchor | MATCH or MISMATCH with one bit per failed check, as an event | 3 s ([`docs/simulate-match.txt`](docs/simulate-match.txt)) |
| An agent's operator keeps its own log | every decision is hashed, and one event carries the Merkle root of the walk | a third party rechecks every decision of a walk without trusting the operator | 11 to 13 s for `node verify.mjs --quick`, 128 to 148 s for `node verify.mjs` on this walk, 5 runs back to back on 2026-10-16, each RESULT: MATCH ([`docs/verify/verify-five-runs.txt`](docs/verify/verify-five-runs.txt)). Most of it is local computation, not the network: `node verify.mjs --offline` reads no RPC and still took 165 s on the author's laptop on 2026-10-15 |
<!-- CHANGES:END -->

### Why CRE

The question behind any automation is who runs it and why anyone should trust it. If these checks ran only on my server, a reader would have to trust my server. Written as CRE workflows, they are code that a decentralized oracle network can run, with consensus declared on every HTTP read and the result delivered to a contract that has no owner. Trust in the operator is replaced by verification.

That is the design, and today only part of it is true. The workflows run under `cre workflow simulate`. No DON has run them, so no event here is a DON attestation. A simulated write goes through CRE's simulation forwarder, which accepts reports from anyone, so a testnet event fixes a hash and a time and nothing more. Until the workflows are deployed, `node verify.mjs` does the verifying: it reruns everything the workflows did with separate code.

What this gives the people Chainlink's own video for this hackathon speaks to: an automated compliance check that runs before an agent acts, and visibility into what it checked. A person can read the result on one page.

### What I learned using CRE

Notes for the CRE team, each with what I did, what I expected, what happened and what I did about it. CLI v1.37.0, TypeScript SDK, macOS.

<!-- CRE_FEEDBACK:BEGIN -->
| # | Steps | Expected | Actual | Workaround |
|---|---|---|---|---|
| 1 | `cre workflow simulate rwa-verify … --http-payload @rwa-verify/payloads/match.json` | the file is read, as with `curl -d @file` | `failed to parse HTTP trigger payload: invalid JSON input: @rwa-verify/payloads/match.json` (2026-10-14) | pass the path without `@`. A hint in the error would help |
| 2 | a payload schema with `z.string().url()` and a valid `https://raw.githubusercontent.com/…` URL | accepted, as under Bun | rejected inside `cre workflow simulate` (2026-10-09). The same schema passes in `bun test` | a plain pattern, `rwa-verify/workflow.ts` L74 to L79 |
| 3 | read the start of any line of a simulate log | UTC, since the time ends in `Z` | the machine's local clock with a `Z`. My logs read 8 hours ahead on a UTC+8 clock and 7 hours ahead on a UTC+7 clock | I state it next to the saved logs and use block times |
| 4 | `getNetwork` for Robinhood Chain mainnet (4663) | an EVM read, since Robinhood Testnet is supported | mainnet is not on the supported list | JSON-RPC over the HTTP capability with `consensusIdenticalAggregation`. A full receipt can be large, so the workflows ask `eth_getLogs` by topic instead |
| 5 | `evm.writeReport` in a simulation without `--broadcast`, to a receiver address with no code (`0x…dEaD`) | a result that says nothing was sent | `TxStatus.SUCCESS` with an all-zero tx hash (`docs/simulate-match.txt`) | `agent/cre.ts` treats a zero hash as "not written". A distinct status for a dry run would be clearer |
| 6 | `cre workflow simulate` on a fresh machine | a local run with no account | it asks for `cre login` first | log in once. Worth a line in the README of the templates, since judges reproduce on fresh machines |
| 7 | several JSON-RPC calls in one node-mode function against a public RPC | all answered | HTTP 429 from the RPC when the calls follow each other at once | space the calls with the runtime's host `sleep`, `token-check/workflow.ts` L144 |
| 8 | read many tokens' state and logs over the HTTP capability in one execution | the 15 calls per execution are enough | one listed token needs up to 9 log queries, and the public RPC answers 429 to a whole batch above what the caller's address has left of its rate (requests of 10 items passed on a quiet line. with another reader on the same address, 3 did not), so at 10 items per request the call limit is reached at about 9 listed tokens | plan the run before reading (`plannedHttpCalls` in `token-check/batch.ts`), refuse a payload that cannot fit, and let the caller split the list. A per-execution budget the workflow can ask for at run time would remove the guesswork |
| 9 | have every node read the same block of a chain CRE does not list | a way to pin "the block" across nodes | each node's `eth_blockNumber` can differ, so an answer read at "latest" would not be identical across nodes (not observed: a simulation is one node) | two rounds: median on the head, then every read pinned to head minus 20 with identical aggregation (`token-check/workflow.ts` L495, L505). Worth a template: it is the general recipe for reading an unlisted chain over HTTP |
| 10 | `eth_getCode` for many unknown tokens in one HTTP answer | fits in 250 kb | a contract can be 24 kb, 49 kb as hex, so six tokens can pass the limit | an `eth_call` without `to` whose init code returns `EXTCODEHASH` (`extcodehashCall`, L326): 32 bytes per token |
| 11 | `evm.getTransactionReceipt` in a simulation, for a transaction a run of a minute earlier wrote with `--broadcast` | the receipt | the receipt, with logs, on Robinhood Testnet. It worked the first time | none needed. It let the workflow check its own earlier writes before anchoring |
| 12 | test `getTransactionReceipt` with `EvmMock` | a documented shape for the mocked receipt | the JSON form wants base64 for `address`, `topics`, `data` and a string for `status`. I found it in the generated types | `token-check/batch-workflow.test.ts`, `b64hex` |

What worked well: the HTTP trigger plus `--http-payload` made each workflow a function I could call from the agent, from a gate and from a shell script with the same payload. The same `token-check` handler took three payloads, so the agent, a shell script and the anchor all call one workflow. `consensusMedianAggregation` and `consensusIdenticalAggregation` could be used in one execution, each on its own HTTP read. Running the same TypeScript in `bun test` and in the WASM runtime let the workflows share the rule code with the agent.
<!-- CRE_FEEDBACK:END -->

## RYO-CHAN: Autonomous Agents

RYO-CHAN protects investors with an anti-rug scanner. copy-guard does a neighbouring job for stock tokens: before anything copies a move, it says in everyday language which token moved and whether it is the issuer's. The place to start is the page, [`docs/index.html`](docs/index.html), which is written for a person who is not a developer. It opens with three steps (it saw, it checked, it did). Each card starts with a score, the number of checks that passed, and a mark for each group of checks. A check that did not pass is listed as a red flag, and the card ends with a suggested action.

### The bounty text, phrase by phrase

| The bounty text | Here |
|---|---|
| "interpret market evidence" | a wallet's onchain move, its vet402 record, the venue the token came from and the Chainlink feed |
| "record the practice trades they would make" | [the practice ledger](#the-practice-ledger) below: every decision, the position it opened or did not open, with entry, size and exit |
| "show cause and effect" | every card: what happened, why, and the action that follows. Every decision: one row per rule with the value it read |
| "preserve a repeatable reasoning trail" | no language model. The same inputs and the same limits give the same trail, and `verify.mjs` repeats it with separate code |
| "Explain selected and rejected candidates" | rejected moves stay in the ledger, each with its reasons |
| "entry, sizing, and exit as one decision" | one position object: the feed's value at the block, the size from the limits, the exit rule |
| Whale Movement Tracker, "notable wallet activity" to "a final market verdict" | see the sentence under this table for how the wallets were chosen and how large their purchases were |
| Multi-KOL Narrative Agent (the spotlight) | Not attempted. There is no X, Discord or Telegram input |

<!-- WALLETS:BEGIN -->
The walk follows 51 wallets in 3 groups, and every count is kept per group. The 30 selected wallets were ranked by what they received of Stock Tokens from the official venues, directly or through one of 3 routers (Uniswap SwapRouter02, Uniswap UniversalRouter and a router measured on the chain), largest first, over 30 days, and picked by that rule, not by hand. 10 of the transfers counted came through a router. 20 more are observed apart: the first buyers of a token with the ticker SPY at an address the issuer did not list. One demo wallet is in the walk too, the only one vet402 has anchored a record for. The rule, the window and every purchase counted are in [`docs/walk/selection.json`](docs/walk/selection.json). copy-guard opened 212 positions following the selected wallets, on purchases of 5.75 to 144,454.24 USD (median 3,295.74 USD) and 24 positions following the wallets observed buying the other SPY, on purchases of 0.22 to 0.48 USD (median 0.40 USD).
<!-- WALLETS:END -->

### The practice ledger

`bun agent/walk.ts` reads each wallet's vet402 /rwa record once from the free route and walks through every move that record lists, in the order the moves happened. Two books run side by side.

- **copy-guard** opens what its rules, its mandate and the user's limits allow.
- **Ticker copy** is a baseline I defined. It opens a position on every move in which a token with a stock ticker arrives in the wallet. It buys no record and applies no rule or limit.

Both enter a Stock Token at the Chainlink feed's value at the block of the move and leave by the same exit rules: the copied wallet sells or sends the token, the feed crosses the stop loss or the take profit, or the time limit passes. Whatever is still open is marked at the feed's last value.

<!-- LEDGER:BEGIN -->
Walked 2026-10-16 04:31 UTC, marked at Robinhood Chain block 89796552. Moves from 2026-07-16 09:58 UTC to 2026-10-14 03:51 UTC.

**What each book did with the same 8396 moves**

| | copy-guard | Ticker copy |
|---|---|---|
| Practice positions opened | 236 (full size 0, reduced size 236) | 1565 |
| Of them in a token under a listed ticker at an address the issuer did not list | 0 | 24, in 4 tokens |
| Declined, each with a reason | 8160 | 0. It has no rule to decline by |
| Closed / still open at the mark | 230 / 6 | 1529 / 36 |

**The same moves by group of wallets.** The groups were chosen in different ways, so each is shown apart and the totals above are only their sum.

| Group | Wallets | Moves | copy-guard opened | Declined | Most in one wallet | Purchases it followed | Ticker copy opened | Of them in other tokens |
|---|---|---|---|---|---|---|---|---|
| Selected: the largest buyers | 30 | 8093 | 212 | 7881 | 81 of 212 (38%) | 5.75 to 144,454.24 USD, median 3,295.74 USD | 1433 | 4 |
| Observed: buyers of the other SPY | 20 | 210 | 24 | 186 | 4 of 24 (17%) | 0.22 to 0.48 USD, median 0.40 USD | 76 | 20 |
| Demo wallet | 1 | 93 | 0 | 93 | none | none | 56 | 0 |

Of the 212 positions copy-guard opened for the selected wallets, the busiest wallet, 0x30ce…6576, has 81 (38%). Of the 24 positions copy-guard opened for the wallets observed buying the other SPY, the busiest wallet, 0xa634…05fd, has 4 (17%).

**The same positions at one size, 25.00 USD each**, so that size cannot make the difference.

| | Positions | Put in | Result at the exit or the mark |
|---|---|---|---|
| Opened by both books, following the selected wallets | 212 | 5300.00 USD | 23.05 USD |
| Opened by both books, following the wallets observed buying the other SPY | 24 | 600.00 USD | -3.29 USD |
| Opened by both books, all groups | 236 | 5900.00 USD | 19.76 USD, the same in both books |
| Opened by the ticker copy only, in Stock Tokens | 1305 | 32625.00 USD | 34.90 USD |
| Opened by the ticker copy only, in other tokens under a listed ticker | 24 | 600.00 USD | 21 positions measured at the pool's own price: -480.89 USD. 3 positions not measured |

**How each token reached the wallet.** Every move is one of these kinds, read from the transaction alone ([`docs/walk/SELECTION.md`](docs/walk/SELECTION.md), section 2). Stock Tokens are counted per incoming token, the books per decision.

| How it arrived | What that means | Incoming Stock Tokens | Moves in other tokens under a listed ticker | copy-guard opened | Ticker copy opened |
|---|---|---|---|---|---|
| bought at an official venue | The wallet paid, and the Uniswap v4 PoolManager or an official v3 pool put the token out. | 1184 | 22 | 236 | 1019 |
| bought outside the official venues | The wallet paid for it, and no official venue put it out. copy-guard does not follow this, because rule V1 asks for an official venue. A ticker copy follows it. | 565 | 2 | 0 | 546 |
| swapped for another Stock Token | Another Stock Token left the wallet in the same transaction. | 3 | 0 | 0 | 0 |
| part of a liquidity operation | A liquidity log is in the transaction. | 2217 | 0 | 0 | 0 |
| swapped in, not paid by the wallet | An official venue put it out, and the payment did not leave this wallet. | 5 | 0 | 0 | 0 |
| sent to the wallet | No official venue put it out and the wallet paid nothing for it: a transfer, an airdrop or a bridge delivery. | 263 | 75 | 0 | 0 |
| left the wallet | A sale or a transfer out. | 4029 | 37 | 0 | 0 |

These are practice (paper) positions on past public moves. The tables are not a forecast and not a track record. A position in a token that is not the issuer's is valued only where the price of its own pool could be read from public logs. Otherwise it is listed as not measured and left out of every sum. Nothing is assumed to be worth zero. A pool value compares the pool's last swap with the swap the wallet bought in. It leaves out the move of the pool's other asset in USD, and it does not say that a position of that size could have been sold there.

No move reached the full size in this walk. No position, by leading reason: a sale or a transfer out, not a purchase (3983), a liquidity operation, not a purchase (2213), wallet not in profit (603), bought outside the official Uniswap pools (565), sent to the wallet, not bought by it (254), no Chainlink price at the block (187), position limit reached (148), not USDG, a different token with the same ticker (93), a moved token the agent cannot name (58), not the Stock Token SPY, a different token with the same ticker (20), daily limit reached (10), not the Stock Token NVDA, a different token with the same ticker (10), not the Stock Token WTSM, a different token with the same ticker (6), one Stock Token exchanged for another, not a purchase (3), not the Stock Token NET, a different token with the same ticker (2), not the Stock Token WMETA, a different token with the same ticker (2), not the Stock Token FLY, a different token with the same ticker (1), not the Stock Token GME, a different token with the same ticker (1), not the Stock Token IBM, a different token with the same ticker (1).

The Merkle root of all 8396 decisions is `0x4cf309f5af3ea7ba456ae8e60a1e6741e09cb61fe6f1564fe2cbe36e47910664`. It is in one `LedgerAnchored` event on Robinhood Testnet: [`0x62986233…04b386`](https://explorer.testnet.chain.robinhood.com/tx/0x6298623367c61505efd7a7b5f9e3c9c9c2f3b506dbe70147b55f1081cc04b386?tab=logs).
<!-- LEDGER:END -->

Each decision is one line of [`docs/walk/trails.jsonl.gz`](docs/walk/trails.jsonl.gz) (gzipped. `gunzip -k` gives `trails.jsonl`, and [`docs/verify/compressed.json`](docs/verify/compressed.json) keeps its sha256 from before it was gzipped): everything the rules read, every rule row, the size, the practice position with its exit, and a card. [`docs/ledger.json`](docs/ledger.json) holds the rows, both books and the totals. [`docs/index.html`](docs/index.html) carries the totals, both books and every decision that opened a position, and loads the other decisions from [`docs/rows/`](docs/rows/), one file per wallet, when they are asked for. `verify.mjs` rebuilds the ledger from the trails and the saved feed values, and checks that the page and `docs/rows/` hold exactly its rows.

A card reads like this. Every sentence is a fixed template filled with values from the trail.

<!-- CARD:BEGIN -->
> **No position: not the Stock Token NVDA, a different token with the same ticker**
> *What happened.* 0x3433…abd0 sent this wallet 25 tokens with the ticker NVDA (named "NVIDIA Robinhood Coin"). No official swap put the token out in the transaction. The wallet did not sign the transaction (0x3433…abd0 did).
> *What a ticker copy sees.* A bot that goes by the ticker sees 25 NVDA arrive in this wallet.
> *Why.* This is not the Robinhood Stock Token NVDA. It is a different token at 0x5dd7…3539 with the same ticker, at an address the issuer did not list. The Stock Token NVDA is at 0xd060…9eec. The Chainlink CRE token-check workflow read it from the chain (NOT_IN_ISSUER_LIST, CODE_HASH_DIFFERS, BEACON_DIFFERS, TICKER_SAME_AS_ISSUER_TOKEN, NAME_SAME_AS_ISSUER_TOKEN, NAME_ENDS_LIKE_ISSUER_TOKEN). This says what the token is not. It says nothing about who made it or why.
> *Suggested action.* copy-guard opened no position. No real trade was placed.
>
> Decision 6000 of the walk, move [`0x1b838f40…77b51b`](https://robinhoodchain.blockscout.com/tx/0x1b838f40a43d54b7ce3364f08f723516170be2d03fdbcd6ab801c79f7f77b51b) on 2026-09-27 12:52 UTC. 11 of 18 checks passed.
<!-- CARD:END -->

### One sentence, two values

RYO-CHAN's own example of an instruction to its AI Companion ends with "buy each for $50, and set a stop-loss at 15%" ([RYO-CHAN GitBook](https://ryo-chan.gitbook.io/ryo-chan/ryo-chan/what-is-ryo-scan/the-ai-companion)). A person who says that to copy-guard changes two lines of `limits.json`:

```json
"size": { "full_usd": "50.00", … },
"exit": { "stop_loss_pct": "15", … }
```

The file is edited by hand, and there is no parser for the sentence. Every later decision names the new file by hash, and the mandate has to be signed again, because new limits need the principal's consent. The limits in force are [listed below](#the-users-limits).

## BLI: LegalTech and RegTech

I am not a lawyer. Nothing in this section is legal advice or investment advice, and nothing in it says what any rule requires or what a court would accept. It puts words that BLI, its speakers and regulators have used next to the material this build leaves behind. All of it can be read without a terminal on the page, [`docs/index.html`](docs/index.html), under "Who set the limits, and who the agent acts for".

### Who the agent acts for

The three headings below are the words the Blockchain Legal Institute uses for its planned [AI Agent Registration Tool](https://bli.tools/legal-compliance-tech-tools/).

| BLI's words | What this repo keeps for it | Where |
|---|---|---|
| **Programmatic provenance** | every decision names the rules by the hash of two source files, the record by its hash, the move by its transaction and the feed value by the transaction that published it | `docs/walk/trails.jsonl`, the `LedgerAnchored` event |
| **Human principal attribution** | a mandate names the principal and the agent's payment key, each by address. The principal signs one readable line that carries the mandate's hash. Rule M1 opens nothing unless the signature recovers to the principal the mandate names | `mandate/mandate.json`, `mandate/mandate.sig`, row M1 of every decision |
| **Cryptographically verifiable operational boundaries** | the limits are named by hash in the mandate and in every decision. The payment key can pay one address, and the signed Permit2 message pins the recipient | `limits.json`, `agent/x402.ts`, rows L1 and L2 |

The principal is an address. It is not a legal identity: nothing here ties that address to a named person or company, and nothing here is a registration.

<!-- MANDATE:BEGIN -->
**Mandate: signed by the principal.** `mandate/mandate.json` is signed by `0x502B…b8e6`, and every decision of this walk carries that signature.
<!-- MANDATE:END -->

What the mandate allows and forbids, in its own words (`scope` in `mandate/mandate.json`):

- may: "read public chain data and vet402 /rwa records"
- may: "pay for evidence over x402 in USDG on Robinhood Chain, within the limits named below"
- may: "record practice trades and write the hash of each reasoning trail onchain"
- may not: "place a real trade"
- may not: "pay any address other than 0x973cD8a91A771C2C04C6036888F8175D6b4F6227"
- may not: "move any asset other than the USDG it pays for evidence"
- may not: "act on a move when a rule of group A, B or M fails, except rule A4 when the record has no anchor yet, in which case the user's limits grade the size down"

[`mandate/README.md`](mandate/README.md) has the one command the principal signs with.

### Two questions from BLI's own stage

| Asked | By | What the mandate and the trail hold |
|---|---|---|
| "Did I authorize this? What was the scope of that authorization?" | Carole House, [BLI Bootcamp](https://www.youtube.com/watch?v=1bYQiYAWvGk) (video published 2026-08-02) | Authorized: the signature over the mandate's hash is inside every decision, and anyone can recover the signer. Scope: practice trades only, these rules, these limits, this payment key, one payee, these dates |
| "at what point did it exceed its authority?", and charges that "accumulate unnoticed" | James R. Holbein and Justin Holbein, [BLI article on x402, 2025-12-14](https://bli.tools/usa-beyond-activating-http-402-the-x402-protocol/) | Rule M1 and rows L1 and L2 mark the exact decision at which a boundary would be crossed, and that decision opens nothing. Payments are capped per decision and in total, and each one is written to a ledger before it is sent |

In the same talk House set what was asked for beside what actually happened. Here the mandate is the first of those and each decision's trail is the second, and both are named by hash.

Could this be done without a chain? The rules and the cards could. What a chain adds is one thing: a third party can check, without trusting me, that the records were not changed afterwards.

A 2025 judge of this hackathon, Bourn Collier, has described a framework for "tethering AI agents to accountable legal entities" ([DARA announcement, 2026-06-23](https://pr.taosnews.com/article/DARA-to-Convene-International-Regulatory-Task-Forces-and-AI-Regulation-Sessions-in-the-US/6a3ac373564d536c69a53661)). The mandate links an agent to an address that signed for it. Linking that address to a legal entity is outside this build.

### The questions regulators are asking, and what this keeps

Each row reads the same way: a rule maker or regulator has asked in these words, and this build keeps this material.

| Source | Their words | What this build keeps |
|---|---|---|
| [U.S. Federal Rule of Evidence 902(14)](https://www.law.cornell.edu/rules/fre/rule_902) | data copied from an electronic file, "authenticated by a process of digital identification" | every record and decision is named by a keccak256 hash that anyone can recompute. Comparing hash values is the kind of check the rule's committee note describes. The rule also asks for a qualified person's certification, which a script does not replace |
| [Rule 902(13)](https://www.law.cornell.edu/rules/fre/rule_902) | a record "generated by an electronic process or system that produces an accurate result" | fixed rules, no language model. Anyone can rerun them on the saved inputs and compare |
| [FINRA 2026 oversight report, GenAI](https://www.finra.org/rules-guidance/guidance/reports/2026-finra-annual-regulatory-oversight-report/gen-ai) | agent reasoning that is "difficult to trace or explain", and "how to track agent actions and decisions" | one row per rule with the value it read, a card in plain sentences, guardrails set by the user. FINRA's concern is agents that act without predefined rules. This agent's rules are predefined |
| [Letter from eight House members to the SEC, 2026-06-24](https://foster.house.gov/media/press-releases/foster-sherman-seek-regulatory-clarity-agentic-ai-trading) | the "legal responsibilities of broker-dealers, AI developers, and AI agents themselves" | an open question, which this build does not answer. It keeps what an answer may need: who the agent acted for, under which limits, on what evidence |
| [SEC staff statement on tokenized securities, 2026-01-28](https://www.sec.gov/newsroom/speeches-statements/corp-fin-statement-tokenized-securities-012826) | a third party's token "may or may not confer" rights in the underlying security | the staff's question is what a given token carries. The agent answers a narrower one first: which contract moved. A different token under the same ticker is not issued by the Stock Token's issuer, and the agent names it by address |
| [Robinhood's description of Stock Tokens](https://docs.robinhood.com/chain/stock-tokens/) | no "legal or beneficial rights" in the underlying security | the page identifies each token by its ticker. A ticker is not unique on a permissionless chain. The agent identifies tokens by contract address |
| [BLI, Legal Compliance Tech Tools](https://bli.tools/legal-compliance-tech-tools/) | "evidentiary standards", "audit readiness", "tamper-evident" | an auditor can recheck every number here from public data with one command and no account |

### Privacy

- The per-wallet pages exist so a reader can recheck the practice decisions. They are not ratings of people.
- Only public chain data is shown (addresses, transactions, blocks). No names, no off-chain data.
- The owner of a wallet can ask support@vet402.com to remove its page. It is removed within 7 days and the ledger keeps only the hash.

## What vet402 already has behind this

- [adctx](https://adctx.com/posts/what-an-agent-purchase-costs/): "vet402's purchase from t.adctx.com on Oct 13, 2026 was adctx's first payment from outside the company, and adctx then added the output schema declaration that vet402's public row showed was missing."
- Goldsky: "vet402 paid 11 Goldsky Edge endpoints through Circle Gateway on Arc on Sept 28, 2026. The public record counts all 11 as charged and all 11 as delivered."
- probe402's report MCRI-002 cites vet402's numbers.
- ETHOnline 2026: Bazantic prize.
- Outside reaction to copy-guard itself so far: none. The paid run of the gate is a test I paid to myself.

## Details

### Tokens that share a ticker

On a permissionless chain anyone can give a token any ticker. This table lists every token in the walk that carries the ticker of a Robinhood Stock Token or of USDG at an address the issuer did not list. It is a record that tickers are not unique. It names each token by address only, and it says nothing about who made a token or why. Of the 143 tokens in [`docs/token-check/results.json`](docs/token-check/results.json), 51 are the issuer's Stock Tokens, 1 is USDG itself, 67 carry a listed Stock Token or USDG ticker or name at an address outside the list, and 24 carry neither.

The table separates things that a ticker-only view mixes up. A token can be sent to a wallet in a transaction the wallet never signed. A wallet can also buy such a token itself and pay for it, at an official venue or outside the official venues. Only the first can be planted by a stranger. A purchase outside the official venues is counted apart from both: copy-guard does not follow it, because rule V1 asks for an official venue, and a ticker copy does.

<!-- OTHER_TOKENS:BEGIN -->
| Ticker it carries | Contract | Name it carries | Moves in this walk | How it reached the wallet |
|---|---|---|---|---|
| SPY | [`0x69e7…6219`](https://robinhoodchain.blockscout.com/address/0x69e7778d46713e17572d610bdaca3943aa4e6219) | "Spy Chip" | 20 | bought by the wallet, which signed and paid |
| USDG | [`0xec90…4a3e`](https://robinhoodchain.blockscout.com/address/0xec90adc7157d68d9213a88627b66956950374a3e) | "United States Global Dollars Gold" | 8 | sent to the wallet, which did not sign |
| WTSM | [`0x17ca…0c06`](https://robinhoodchain.blockscout.com/address/0x17ca67ae8a0f0efe55b58721114f908903a40c06) | "Wrapped Taiwan Semiconductor Manufacturing • Robinhood Token" | 6 | bought by the wallet outside the official venues (1), a log names the wallet as the sender, and the wallet did not sign (5) |
| USDG | [`0x2ce3…77af`](https://robinhoodchain.blockscout.com/address/0x2ce3e396e069ac9fa62046f423267072e06e77af) | "Global Dollar" | 5 | sent to the wallet, which did not sign |
| USDG | [`0x1383…b1ca`](https://robinhoodchain.blockscout.com/address/0x1383b43aed527485f191b60060f5b5471f71b1ca) | "Global Dollar" | 4 | sent to the wallet, which did not sign |
| USDG | [`0x650b…6eb0`](https://robinhoodchain.blockscout.com/address/0x650bf9154edfb41ad65e316be31fe489ccc76eb0) | "United States Global Dollars Gold" | 4 | sent to the wallet, which did not sign |
| NVDA | [`0xa328…0f2c`](https://robinhoodchain.blockscout.com/address/0xa3284897ad7c8fed700b04f573cf64e4f6c10f2c) | "NVIDIA Robinhood Token" | 4 | sent to the wallet, which did not sign |
| USDG | [`0xc641…ad13`](https://robinhoodchain.blockscout.com/address/0xc6417224f693a0d8bf612bc6d7dcbbc268d5ad13) | "Global Dolar" | 4 | sent to the wallet, which did not sign |
| USDG | [`0xd6b8…a7e5`](https://robinhoodchain.blockscout.com/address/0xd6b8cecde770507fc46cde7ea82dde383ed7a7e5) | "Global Dollar" | 4 | sent to the wallet, which did not sign |
| USDG | [`0x2504…150c`](https://robinhoodchain.blockscout.com/address/0x2504cc3b84585a5cdf88f4c4f50b2afe9181150c) | "Global Dollar United Only" | 3 | sent to the wallet, which did not sign |
| USDG | [`0x5411…56a2`](https://robinhoodchain.blockscout.com/address/0x5411257cedf60bc40f4bead410bf8d02079056a2) | "United States Global Dollar" | 3 | sent to the wallet, which did not sign |
| USDG | [`0x6236…86e0`](https://robinhoodchain.blockscout.com/address/0x623613c0e9211a7215b4fd4ab80656fcbd1186e0) | "Global Dollar" | 3 | sent to the wallet, which did not sign |
| NVDA | [`0x22a6…1a51`](https://robinhoodchain.blockscout.com/address/0x22a68ae074150397c42d968ec050cd1ff3501a51) | "NVIDIA Robinhood Token" | 2 | sent to the wallet, which did not sign |
| USDG | [`0x4190…a416`](https://robinhoodchain.blockscout.com/address/0x4190ee598c2a69d35bef53c83d152ae0f25ea416) | "U⟨U+17B5⟩S⟨U+17B5⟩DG" | 2 | a log names the wallet as the sender, and the wallet did not sign |
| USDG | [`0x4431…74af`](https://robinhoodchain.blockscout.com/address/0x44318785554bf11ffd164a6f98d9a453e2fa74af) | "United States Global Dollars" | 2 | sent to the wallet, which did not sign |
| USDG | [`0x4ff7…b792`](https://robinhoodchain.blockscout.com/address/0x4ff7f19a6c4c7ebcba25248610dbe642bbd0b792) | "Global Dollar" | 2 | sent to the wallet, which did not sign |
| NVDA | [`0x5dd7…3539`](https://robinhoodchain.blockscout.com/address/0x5dd716fe12275b69f04b26beeca343843c8e3539) | "NVIDIA Robinhood Coin" | 2 | sent to the wallet, which did not sign |
| USDG | [`0x6425…7936`](https://robinhoodchain.blockscout.com/address/0x642565e604cf64ca49098505e2b9d2fffec77936) | "Global Dollars" | 2 | sent to the wallet, which did not sign |
| USDG | [`0x67f4…b8b2`](https://robinhoodchain.blockscout.com/address/0x67f438bd18131f152b6387083628e8eeaa5fb8b2) | "Global Dollar" | 2 | sent to the wallet, which did not sign |
| USDG | [`0x88a3…f83e`](https://robinhoodchain.blockscout.com/address/0x88a3443d54bffb1f221bcdfb5561c023533df83e) | "U⟨U+206F⟩S⟨U+206F⟩DG" | 2 | a log names the wallet as the sender, and the wallet did not sign |
| USDG | [`0x9909…0a3e`](https://robinhoodchain.blockscout.com/address/0x9909c4e8cae5ada810c7297943ae767f87d00a3e) | "Global Dollar" | 2 | sent to the wallet, which did not sign |
| USDG | [`0xa581…7d82`](https://robinhoodchain.blockscout.com/address/0xa581f3c3c071215f60494c6cef072b001c1d7d82) | "U⟨U+17B5⟩S⟨U+17B5⟩DG" | 2 | a log names the wallet as the sender, and the wallet did not sign |
| WMETA | [`0xc9d2…c17f`](https://robinhoodchain.blockscout.com/address/0xc9d244ae176436f96279159b2d91d3e4f830c17f) | "Wrapped Meta Platforms • Robinhood Token" | 2 | bought by the wallet outside the official venues (1), a log names the wallet as the sender, and the wallet did not sign (1) |
| NET | [`0xca9c…0edf`](https://robinhoodchain.blockscout.com/address/0xca9c78dd337a67f6e0077f65f5e9218719d30edf) | "NetNet" | 2 | bought by the wallet, which signed and paid |
| USDG | [`0xcb07…92e0`](https://robinhoodchain.blockscout.com/address/0xcb071fc69e4aebd512387316578752e5c20b92e0) | "U⟨U+206F⟩S⟨U+206F⟩DG" | 2 | a log names the wallet as the sender, and the wallet did not sign |
| USDG | [`0x0c95…b1f7`](https://robinhoodchain.blockscout.com/address/0x0c95df78d9f692beb3feaeceb2ef1e614513b1f7) | "United States Global Dollar" | 1 | sent to the wallet, which did not sign |
| USDG | [`0x0d74…4c23`](https://robinhoodchain.blockscout.com/address/0x0d74c7103c690d861efd539916fde2db6d604c23) | "U⟨U+206F⟩S⟨U+206F⟩DG" | 1 | a log names the wallet as the sender, and the wallet did not sign |
| USDG | [`0x0ef3…09c0`](https://robinhoodchain.blockscout.com/address/0x0ef3fccbc4c73be8bb14411cfe801df141e309c0) | "Global Dollar" | 1 | sent to the wallet, which did not sign |
| USDG | [`0x10dd…acdb`](https://robinhoodchain.blockscout.com/address/0x10dd80c6f962eb071beed8433c7f3e68906eacdb) | "U⟨U+17B5⟩S⟨U+17B5⟩DG" | 1 | a log names the wallet as the sender, and the wallet did not sign |
| GME | [`0x1c8a…80f4`](https://robinhoodchain.blockscout.com/address/0x1c8a973a8788c4a57371bed1611830a83fd580f4) | "GameStop • Robinhood Token" | 1 | sent to the wallet, which did not sign |
| USDG | [`0x22b1…d8d7`](https://robinhoodchain.blockscout.com/address/0x22b1137c0637bf8f7ac7fbcfa857604e4b89d8d7) | "U⟨U+17B5⟩S⟨U+17B5⟩DG" | 1 | a log names the wallet as the sender, and the wallet did not sign |
| USDG | [`0x275f…1220`](https://robinhoodchain.blockscout.com/address/0x275fe81e2e5a8908f5cb7b5fa84d5b52680a1220) | "U⟨U+206F⟩S⟨U+206F⟩DG" | 1 | a log names the wallet as the sender, and the wallet did not sign |
| USDG | [`0x2775…7a58`](https://robinhoodchain.blockscout.com/address/0x2775c597f2500619993f5cdec034dff2dfe47a58) | "U⟨U+17B5⟩S⟨U+17B5⟩DG" | 1 | a log names the wallet as the sender, and the wallet did not sign |
| FLY | [`0x2fc7…b3d3`](https://robinhoodchain.blockscout.com/address/0x2fc7f9e2911f20b2c4660d2aef808aa91bddb3d3) | "Fly Trader" | 1 | sent to the wallet, which did not sign |
| USDG | [`0x318f…b1a3`](https://robinhoodchain.blockscout.com/address/0x318f563dceddbe58625400d9f7ee27eecef5b1a3) | "U⟨U+17B5⟩S⟨U+17B5⟩DG" | 1 | a log names the wallet as the sender, and the wallet did not sign |
| USDG | [`0x38eb…1885`](https://robinhoodchain.blockscout.com/address/0x38ebf2ab30cbff745e2db10aa17b6aaaad001885) | "U⟨U+17B5⟩S⟨U+17B5⟩DG" | 1 | a log names the wallet as the sender, and the wallet did not sign |
| USDG | [`0x3d1f…8b6e`](https://robinhoodchain.blockscout.com/address/0x3d1fef40fa8a20de967484436c8c527db9c78b6e) | "Global Dollar" | 1 | a log names the wallet as the sender, and the wallet did not sign |
| USDG | [`0x42b4…53c2`](https://robinhoodchain.blockscout.com/address/0x42b4fa90438ecb1a0c2676ff25a9f27355dd53c2) | "global dollar" | 1 | sent to the wallet, which did not sign |
| USDG | [`0x480b…d607`](https://robinhoodchain.blockscout.com/address/0x480be87734e52fbf56c089e1a4ddba6e5b39d607) | "U⟨U+17B5⟩S⟨U+17B5⟩DG" | 1 | a log names the wallet as the sender, and the wallet did not sign |
| USDG | [`0x56cb…19f5`](https://robinhoodchain.blockscout.com/address/0x56cb52174592a72c570bd9980e3879fd768519f5) | "Gelobal Dollar" | 1 | sent to the wallet, which did not sign |
| USDG | [`0x5c28…b282`](https://robinhoodchain.blockscout.com/address/0x5c283587a8a10fc14b0f4b3212ef4de97520b282) | "U⟨U+17B5⟩S⟨U+17B5⟩DG" | 1 | a log names the wallet as the sender, and the wallet did not sign |
| USDG | [`0x5ead…89d6`](https://robinhoodchain.blockscout.com/address/0x5eadcaa49e6cc1b7157d9983e62f5ccee0de89d6) | "Global Dollar" | 1 | sent to the wallet, which did not sign |
| IBM | [`0x6cfe…c10b`](https://robinhoodchain.blockscout.com/address/0x6cfe8050d64b02a21cf6cf2ef2a408489c86c10b) | "I Buy Memes" | 1 | sent to the wallet, which did not sign |
| USDG | [`0x7116…78f1`](https://robinhoodchain.blockscout.com/address/0x711681d447e8f53ac228f20afad1e179ab5e78f1) | "UStates of Dollars Globals" | 1 | sent to the wallet, which did not sign |
| NVDA | [`0x72ea…9d37`](https://robinhoodchain.blockscout.com/address/0x72ead0c700f07b645a8f91badd82be5c545b9d37) | "NVIDIA Robinhood Coin" | 1 | sent to the wallet, which did not sign |
| USDG | [`0x73ac…c183`](https://robinhoodchain.blockscout.com/address/0x73acfc8352b6a9f0baacd02a266e58fde4b1c183) | "Global Dollar" | 1 | sent to the wallet, which did not sign |
| NVDA | [`0x794a…0aea`](https://robinhoodchain.blockscout.com/address/0x794a9a5975da82745a7165a5b91d2d27e9820aea) | "N⟨U+17B5⟩V⟨U+17B5⟩DA" | 1 | a log names the wallet as the sender, and the wallet did not sign |
| USDG | [`0x7fa6…08ac`](https://robinhoodchain.blockscout.com/address/0x7fa63d892faa245a91104873de0e79452cd208ac) | "U⟨U+17B5⟩S⟨U+17B5⟩DG" | 1 | a log names the wallet as the sender, and the wallet did not sign |
| USDG | [`0x8372…c3bc`](https://robinhoodchain.blockscout.com/address/0x83726b15b25013e95b56357c4795b848ab32c3bc) | "U⟨U+17B5⟩S⟨U+17B5⟩DG" | 1 | a log names the wallet as the sender, and the wallet did not sign |
| USDG | [`0x9128…38d3`](https://robinhoodchain.blockscout.com/address/0x91280d9474cc18931ff3d52a7cea9b0db52f38d3) | "U⟨U+206F⟩S⟨U+206F⟩DG" | 1 | a log names the wallet as the sender, and the wallet did not sign |
| USDG | [`0x94ed…1270`](https://robinhoodchain.blockscout.com/address/0x94ed49222ae2e604e0a4683fe08b92381b081270) | "U⟨U+17B5⟩S⟨U+17B5⟩DG" | 1 | a log names the wallet as the sender, and the wallet did not sign |
| USDG | [`0xa913…85c0`](https://robinhoodchain.blockscout.com/address/0xa913c4c2f28aa7b0b15a7c6008a6e19ff8bf85c0) | "Global Dollar" | 1 | sent to the wallet, which did not sign |
| USDG | [`0xac13…51b1`](https://robinhoodchain.blockscout.com/address/0xac13348444e9fc0584eace3831970af2011951b1) | "Global Dollar" | 1 | sent to the wallet, which did not sign |
| USDG | [`0xb4a2…d5ac`](https://robinhoodchain.blockscout.com/address/0xb4a2e4d7c9493a394ab8e48217d49e1808f7d5ac) | "U⟨U+17B5⟩S⟨U+17B5⟩DG" | 1 | a log names the wallet as the sender, and the wallet did not sign |
| USDG | [`0xbce7…8452`](https://robinhoodchain.blockscout.com/address/0xbce7482902952cf32807afa29928b00477948452) | "U⟨U+17B5⟩S⟨U+17B5⟩DG" | 1 | a log names the wallet as the sender, and the wallet did not sign |
| USDG | [`0xc237…52e0`](https://robinhoodchain.blockscout.com/address/0xc2378f126167c55b42ba4f49e012d0d9dcdf52e0) | "Global Dollar" | 1 | sent to the wallet, which did not sign |
| USDG | [`0xc4f8…b4a3`](https://robinhoodchain.blockscout.com/address/0xc4f85cebec3fe6c77df0f71f3a3e139d43bbb4a3) | "U⟨U+17B5⟩S⟨U+17B5⟩DG" | 1 | a log names the wallet as the sender, and the wallet did not sign |
| USDG | [`0xd303…0ea2`](https://robinhoodchain.blockscout.com/address/0xd3033b5b57b255c66035a62237a9f9486ed10ea2) | "Global Dollar" | 1 | sent to the wallet, which did not sign |
| USDG | [`0xd5f0…2e03`](https://robinhoodchain.blockscout.com/address/0xd5f018a09081d7f75b06b4a3f2afd9bcadc42e03) | "Global Dollars" | 1 | sent to the wallet, which did not sign |
| USDG | [`0xdb81…66ef`](https://robinhoodchain.blockscout.com/address/0xdb81a12de6c0aebeddf2d85d531dd50cac7366ef) | "Globals Dollars" | 1 | sent to the wallet, which did not sign |
| USDG | [`0xdfd0…9a53`](https://robinhoodchain.blockscout.com/address/0xdfd0e854387aef36022bcfc8972e68d8e1bd9a53) | "U⟨U+17B5⟩S⟨U+17B5⟩DG" | 1 | a log names the wallet as the sender, and the wallet did not sign |
| USDG | [`0xe3c5…6ff6`](https://robinhoodchain.blockscout.com/address/0xe3c500e3e183ea5ca2f0b0a7f8fc55ef914e6ff6) | "Global Dollar" | 1 | sent to the wallet, which did not sign |
| USDG | [`0xe739…f288`](https://robinhoodchain.blockscout.com/address/0xe7391e4047c7e5d48f31cd2b87004c10e875f288) | "U⟨U+206F⟩S⟨U+206F⟩DG" | 1 | a log names the wallet as the sender, and the wallet did not sign |
| USDG | [`0xed3f…6de0`](https://robinhoodchain.blockscout.com/address/0xed3fd1025aa318b8e66ca25aa2ddc83096086de0) | "US GLOBAL DOLAR" | 1 | sent to the wallet, which did not sign |
| USDG | [`0xf2b7…14f1`](https://robinhoodchain.blockscout.com/address/0xf2b7ffb610269bdaec42ad983c401635e59814f1) | "U⟨U+206F⟩S⟨U+206F⟩DG" | 1 | a log names the wallet as the sender, and the wallet did not sign |
| USDG | [`0xf73e…4a15`](https://robinhoodchain.blockscout.com/address/0xf73eea2bf2f1bf06d676652700132d61feb74a15) | "U⟨U+17B5⟩S⟨U+17B5⟩DG" | 1 | a log names the wallet as the sender, and the wallet did not sign |
| USDG | [`0xfdbb…962a`](https://robinhoodchain.blockscout.com/address/0xfdbbdaa4d2d6cc9b6c2b8201acadf9371f91962a) | "U⟨U+206F⟩S⟨U+206F⟩DG" | 1 | a log names the wallet as the sender, and the wallet did not sign |

67 tokens, 136 moves. The marks ⟨U+…⟩ stand for invisible characters in a name.
<!-- OTHER_TOKENS:END -->

A note on labels. The vet402 record and the frozen v1 rule file call such a token `fake` or a look-alike, and `token-check` returns `LOOKALIKE`. Those labels are statements about an address and the issuer's list.

### The rules

`agent/rules-v2.ts`, copy-guard v2. One decision ends in a size. A failed row either makes the size none, or, for the rows about the wallet's record, does what the user's limits say.

| Row | Rule | When it fails |
|---|---|---|
| A1 | the x402 terms are the published ones: `exact`, `eip155:4663`, USDG, at most 0.01, paid to the vet402 wallet | NONE |
| A2 | `X-Facts-Hash` sent with the record equals the hash recomputed from its body | NONE |
| A3 | the record is about the watched wallet on chain 4663 | NONE |
| A4 | the CRE workflow re-verified the wallet's newest vet402 anchor: MATCH | no anchor yet: the user's choice, default REDUCED. A mismatch: NONE |
| A5 | the record replays to its own balances | NONE |
| A6 | every token under a listed ticker at another address is left out of the record's figures, and none waits for review | NONE |
| B1 | the record was built at or after the move's block | NONE |
| B2 | every moved token is classified: a Stock Token, USDG, or a different token under a listed ticker | NONE |
| C1 | no moved token carries a listed ticker at an address the issuer did not list | NONE |
| C2 | the move moves a Robinhood Stock Token | NONE |
| C3 | the wallet's history is complete | the user's choice, default REDUCED |
| C4 | the wallet has a realized profit | result unknown: default REDUCED. A loss: default NONE |
| M1 | a mandate signed by the principal covers the decision: signer, practice only, these rules, these limits, this payment key, these dates | NONE |
| V1 | the Stock Token came from an official venue: the Uniswap v4 PoolManager or a pool of the official Uniswap v3 factory | NONE |
| D1 | the wallet itself bought: it received the token in a transaction it signed and paid in | NONE. A sale closes a practice position copied from that wallet |
| P1 | a Chainlink feed gives the token's price at the block of the move, no older than the user allows | NONE |
| L1 | the user's daily limit leaves room | NONE |
| L2 | fewer practice positions are open than the user allows | NONE |

FULL means every row passed. REDUCED means the token, the venue, the buyer and the price hold and only graded rows failed. Rows A1 to C4 carry over from v1. `agent/rules.ts` is not edited, so the three trails of the paid run still name its hash. v1's C5 (a price from the record) is replaced by P1 (a price from the feed).

### The user's limits

`limits.json`. The person the agent acts for writes this file. The agent names it by hash in every decision, and the mandate names the same hash.

<!-- LIMITS:BEGIN -->
| Setting | Value | Meaning |
|---|---|---|
| `practice_only` | `true` | this build has no code path that places a trade |
| `size.full_usd` | `100.00` | a practice position when every rule passes, in USD |
| `size.reduced_usd` | `25.00` | a practice position on weaker evidence about the wallet, in USD |
| `size.max_usd_per_day` | `300.00` | all positions opened on one UTC day, in USD |
| `size.max_open_positions` | `10` | open at once |
| `evidence.record_not_anchored` | `reduced` | vet402 has not anchored the wallet's record |
| `evidence.history_partial` | `reduced` | the wallet's history is only partly rebuilt |
| `evidence.wallet_result_unknown` | `reduced` | the record gives no realized result |
| `evidence.wallet_at_a_loss` | `none` | the wallet's closed trades add up to a loss |
| `evidence.max_price_age_hours` | `96` | the oldest feed value used as an entry price, in hours |
| `exit.when_wallet_sells` | `true` | leave when the copied wallet sells or sends the token |
| `exit.stop_loss_pct` | `10` | leave when the feed is this many percent under the entry |
| `exit.take_profit_pct` | `20` | leave when the feed is this many percent over the entry |
| `exit.max_holding_days` | `30` | leave after this many days whatever the price |
| `payments.max_usdg_per_decision` | `0.01` | the most the agent may pay for evidence for one decision, in USDG |
| `payments.max_usdg_total` | `1.00` | the most it may pay in total, in USDG. The code never goes above 1 |

keccak256 of `limits.json`: `0x1e7624863e095cbdb3475e8f01b8e6befbe53ed24389a2b51c3dcb479d72c2cf`. Every decision of the walk names this hash, and so does the mandate.
<!-- LIMITS:END -->

Each `evidence` grade is `reduced` or `none`. Setting all four to `none` gives the cautious policy of v1.

### How it fits together

[`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) has the diagram: who pays whom, where each check happens, and what stays on which chain. [`docs/FIRST-RUN.md`](docs/FIRST-RUN.md) is the detailed record of the first build: the `rwa-verify` workflow, its simulation logs, the paid run of 2026-10-08 and the dry run before it.

| Path | What |
|---|---|
| `verify.mjs` | the recheck. One file, no dependency, no code shared with the agent |
| `docs/index.html`, `docs/rows/` | the ledger as one static page, and its decisions one file per wallet, loaded when asked. `scripts/build-page.mjs` builds both |
| `limits.json`, `mandate/` | the user's limits and the mandate the principal signs |
| `agent/rules.ts`, `agent/rules-v2.ts` | the rules. v1 is frozen, v2 adds the mandate, the venue, the buyer, the feed price and the limits |
| `agent/card.ts`, `agent/ledger.ts`, `agent/walk.ts` | the decision card, the two practice books and the walk |
| `agent/main.ts`, `agent/pay.ts`, `agent/x402.ts` | the live agent and its paying path: dry run by default, a 1 USDG cap, a ledger and a lock |
| `agent/gate/` | the x402 gate in front of `rwa-verify`, and the agent's client for it |
| `SKILL.md`, `agent.json` | how another agent finds the gate and learns its terms |
| `rwa-verify/` | CRE workflow: a vet402 record against its anchor on Robinhood Chain |
| `token-check/` | CRE workflow: the issuer's Stock Token or a different token under its ticker, and the share multiplier, read from the chain. `token-check/recheck.mjs` rechecks its results without CRE |
| `scripts/token-check-batch.sh`, `docs/token-check/` | every token of the walk through `token-check`, the results file the walk reads, its anchor and the recheck |
| `trail-anchor/` | CRE workflow: reruns the rules of one decision, or recomputes the Merkle root of a walk, and writes the hash |
| `contracts/` | the four receivers on Robinhood Testnet, `TokenCheckReceiver` among them. No owner, no storage, no upgrade path |
| `docs/walk/` | the walk: records as read, feed values, one trail per decision, the anchor. The two largest files are gzipped (`trails.jsonl.gz`, `chain.json.gz`) |
| `docs/agent/first-paid-run/` | the paid run of 2026-10-08: the record, the 402 exchange and settlement, three v1 trails |
| `docs/agent/gate-dry-run/` | the 402 exchange with the gate and the payment the agent built and did not sign |
| `docs/agent/copy-search/` | the search of 2026-10-14 described below |

### The paid run (2026-10-08, 22:24 UTC)

The agent replayed three moves of the demo wallet with `--pay` under the v1 rules. It paid 0.01 USDG in [`0x65c314bd…87af61`](https://robinhoodchain.blockscout.com/tx/0x65c314bd758a59dfc79c78d8da76e557450fa1144726ddc4bfc77e183287af61), the CRE workflow wrote MATCH in [`0xc90411c0…4b6cbb`](https://explorer.testnet.chain.robinhood.com/tx/0xc90411c03d66f5c5aa4f2bde8eba68d135822ac5fceffca76b205b08914b6cbb), and each decision's hash is in a `DecisionRecorded` event of [`ReasoningTrailReceiver` `0x9913…a0B3`](https://explorer.testnet.chain.robinhood.com/address/0x991311C2ECA78B83dA3593C7500804af6FEEa0B3?tab=logs).

| Move | What a copier that goes by the ticker sees | v1 conclusion | Trail on Robinhood Testnet |
|---|---|---|---|
| [`0x0eac7685…13f8`](https://robinhoodchain.blockscout.com/tx/0x0eac7685c6c57c3929d053bea9b5fa4b9879e2afc798848ee2b8ccf0e56a13f8) | a QQQ buy for 5,000 USDG | DO_NOT_COPY: partial track record, realized loss | [`0x02239201…778e92`](https://explorer.testnet.chain.robinhood.com/tx/0x022392017a8803f9a19c0ef0fba3ac495437584cb3d31f0372b0363ffb778e92) |
| [`0x1b838f40…b51b`](https://robinhoodchain.blockscout.com/tx/0x1b838f40a43d54b7ce3364f08f723516170be2d03fdbcd6ab801c79f7f77b51b) | 25 NVDA arrive | DO_NOT_COPY: not the Robinhood Stock Token, same ticker NVDA. The wallet did not sign | [`0x36dead3c…7fca7b`](https://explorer.testnet.chain.robinhood.com/tx/0x36dead3cf93da183f8b25b5b8f87c6fb36083e52ff11c61a23eda9c8d37fca7b) |
| [`0xf7cb51a2…8717`](https://robinhoodchain.blockscout.com/tx/0xf7cb51a25f62bfbe63760404055b36d380eed0d47c68f99cdccaa17e9c478717) | 20,000 USDG sent | DO_NOT_COPY: not USDG, a different token whose name reads USDG with invisible characters in it. The wallet did not sign | [`0xfd3df929…563199`](https://explorer.testnet.chain.robinhood.com/tx/0xfd3df9297c75c65df6651251485c355b31d44ae692db652ced3c1e68c9563199) |

These trails and events are unchanged. The same three moves are in the v2 ledger too, decided again under the v2 rules.

### The paid gate run (2026-10-16, 01:38 UTC)

The agent paid the gate in front of the CRE workflow once, under the mandate signed by the principal. vet402's SpendGuard allowed the payment ([`docs/agent/paid-gate-run/spendguard.txt`](docs/agent/paid-gate-run/spendguard.txt) says what shows this, since this run did not yet print the guard's decision), and the agent paid 0.01 USDG in [`0x7d8d9384…eb6c`](https://robinhoodchain.blockscout.com/tx/0x7d8d9384d5a529781ad65f1246fc5002c289396137c22950604bc50b13c1eb6c), settled. The gate then ran `rwa-verify` (simulated), and the answer was MATCH. This is a self-paid demonstration: the payer `0xc380…ED94` and the payee `0x973c…6227` are both my own wallets, and the 0.01 USDG came from `0x973c…6227` in [`0x6edc973b…afc5`](https://robinhoodchain.blockscout.com/tx/0x6edc973bdb4eb9ea6aa90ef466f71b0e1e71ad1a800e3abc807aa88ca8e4afc5). It is not revenue and not a payment from anyone else. The run is saved in [`docs/agent/paid-gate-run/`](docs/agent/paid-gate-run/).

### Paying, and the cap

- The default is a dry run. Only `--pay` signs a payment. `--approve` (only with `--pay`) sends `approve(Permit2, …)` once, which is the one step that needs a little ETH on Robinhood Chain.
- `MAX_SPEND_ATOMIC` in `agent/x402.ts` is fixed at 1 USDG. `limits.json` can lower the cap and cannot raise it. One decision may cost at most `payments.max_usdg_per_decision`.
- The paying path (`agent/pay.ts`) runs under an exclusive lock file, so two runs cannot both pass the cap. Every payment is written to a ledger at a fixed path before it is sent. A payment whose outcome is unknown counts as spent.
- Before anything is signed, the agent asks vet402's SpendGuard (`@vet402/sdk` 0.7.1, `agent/spend-guard.ts`). It refuses any payment above the user's limit for one decision, and any payment that would take the day's total past the cap in force. One guard is made per process and reused, so its daily counter adds up every payment it allows in that process in a UTC day. An allowed payment whose outcome is unknown stays counted. One the payee answers with a 402 and no transaction is given back to the day's budget. Every other outcome, including a stop before signing, stays counted. A refusal stops the payment before the pending entry is written. Across processes the total stays under the cap through the locked ledger and the chain floor. vet402's payee verdict (ALLOW, WARN or BLOCK) does not cover Robinhood Chain yet, so the guard runs with `trustPolicy: "custom"` and does not look up the payee. `payOrRefuse`, which pays on Base and Solana, is not used here.
- The chain is a floor under the ledger: spent is the larger of the ledger and what Robinhood Chain shows. If the ledger is gone while the chain shows spending, the agent stops.
- The agent refuses terms above 0.01 USDG, another payee, another chain, another token or another transfer method before anything is signed. A signature is valid for at most 120 seconds.
- `--gate URL` pays the gate in front of the CRE workflow through the same functions and the same guards. The gate checks the signature, asks the facilitator to verify, runs the workflow and settles only after the workflow has answered.
- The payment wallet is `0xc380D9F41D90765A4820429B9Da151889E8bED94`. Its key lives outside this repo.

### An earlier search for a wallet that passes every rule

<details>
<summary>The search of 2026-10-14, kept as it was run</summary>

The full size needs a record vet402 has anchored. On 2026-10-14 `RwaAnchor` held anchors for one wallet, the demo wallet, whose closed trades are at a loss. I looked for another wallet with a complete history and a realized profit that still held a priced Stock Token (`scripts/find-copy-candidate.ts`, output in `docs/agent/copy-search/`):

| Pass | Searched | Result |
|---|---|---|
| 1 | the 12 quietest of the 33 Stock Tokens with a Chainlink feed, 3,000,000 blocks: 1,926 wallets seen, 101 with a buy, a sell and a balance, 40 records read from vet402's free route | 0 complete histories. 34 records came back, all partial. In 27 of them every event was parsed, and the one I opened was partial because some lots had no known cost |
| 2 | the 22 quietest, 3,000,000 blocks: 13,730 wallets seen, 217 plain accounts trading only through official pools | 6 paid and were paid in USDG in every move. 0 of them sold above cost with a balance left. No record read |
| 3 | every feed token that could be scanned (the busiest ones exceed the RPC's log limit), 500,000 blocks: 10,944 wallets seen, 144 plain accounts on official pools | 13 traded in USDG only. 0 fit. No record read |

Anchoring another wallet's record needs vet402's operator key and is not part of this build.

</details>

### Who would use it, and how it continues

- **A person who lets an agent act for them** reads the page: what the agent saw, what it checked, what it did, in sentences, with the limits they set.
- **A lawyer, an auditor or a compliance officer** asked what an agent relied on runs one command and gets every hash, rule and number rechecked from public data.
- **A developer of a copy-trading or portfolio agent** calls the gate, or `token-check`, before acting on a stock-token move.

I build this alone. copy-guard sits on vet402 /rwa, a product that already runs: it rebuilds a wallet's Stock Token record from public chain data and anchors it. The paid route copy-guard buys from is that product's own. I intend to keep the walk running after the event.

### Run it

Tools: [CRE CLI](https://docs.chain.link/cre/getting-started/cli-installation) v1.37.0, Bun 1.4.2, Foundry.

```bash
cd agent && bun install && bun test && cd ..
cd trail-anchor && bun install && bun test && cd ..
cd rwa-verify && bun install && bun test && cd ..
cd token-check && bun install && bun test && cd ..
cd contracts && forge install foundry-rs/forge-std --no-git && forge test && cd ..

# the whole practice ledger: walk, anchor the root on Robinhood Testnet, build the page, recheck
./scripts/walk.sh

# watch one wallet's newest blocks (dry run, CRE simulated, nothing written onchain)
bun agent/main.ts --mandate mandate/sample

# the x402 gate in front of the CRE workflow, and a dry run against it
bun agent/gate/server.ts &
bun agent/main.ts --mandate mandate/sample --gate http://127.0.0.1:4021/v1/workflows/rwa-verify
```

## What it does not claim

- Practice (paper) trades only. No real trade was placed. Nothing here says that copying any wallet makes money. The two books compare two policies on past moves. That comparison is not a forecast, not a track record and not advice.
- The record says which contract moved and whether its address is on the issuer's list. A token is named as look-alike only when it carries a listed Stock Token or USDG ticker or name at an address the issuer did not list.
- The principal is an address. Nothing here ties it to a legal identity, and nothing here is a registration.
- token-check read 143 of the 144 tokens the walk names. It ran on 2026-10-14 08:33 UTC over the tokens the walk named at that time, and the final walk names one more: `0xf51f…606a` ("NVDA 3x Long", symbol NVDAx3L). That token was never sent to token-check, so it has no row. Its runtime code is a beacon proxy (beacon `0x50e1…de5f`), and its address is not on the issuer's list.
- The walk is a replay. Each wallet's record was read once, after the moves, so the rules judge a wallet with what is known now.
- Feed values arrive a few times a day. An entry price can be hours older than the move, within the age limit the user set.
- The ticker copy is a baseline I defined, stated in the ledger. A real copier may be less naive.
- "Sent to the wallet" and "bought outside the official venues" are different kinds of arrival and are never added together. The first is a token the wallet paid nothing for. In the second the wallet paid, somewhere other than the Uniswap v4 PoolManager or an official v3 pool. copy-guard follows neither. A ticker copy follows the second.
- The groups of wallets were chosen in different ways, so their counts are shown apart and are not a sample of the chain. A group whose positions all follow one wallet says how the rules treat that wallet.
- There are two payments so far, both self-paid tests: 0.01 USDG on 2026-10-08 ([`0x65c314bd…87af61`](https://robinhoodchain.blockscout.com/tx/0x65c314bd758a59dfc79c78d8da76e557450fa1144726ddc4bfc77e183287af61)) and the paid gate call on 2026-10-16 ([`0x7d8d9384…eb6c`](https://robinhoodchain.blockscout.com/tx/0x7d8d9384d5a529781ad65f1246fc5002c289396137c22950604bc50b13c1eb6c)). I own both the payer and the payee. Neither is revenue.
- Nothing is deployed to a DON. All testnet receivers trust CRE's simulation forwarder, as described above.
- The rules are a policy. Anyone can read, rerun or disagree with every row.
- This is not legal advice and not investment advice. vet402 reports what public chain data shows and is not affiliated with Robinhood, Chainlink, RYO or any token issuer.

A ticker is a string that anyone can reuse. This record says which contract moved, who signed for it and who allowed the agent to act. Don't take my word for it. Run it.
