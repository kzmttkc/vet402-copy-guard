# vet402 copy-guard

Anyone can deploy a token called NVDA. copy-guard is an agent that checks which token really moved before it would copy a wallet, and it leaves a record that anyone can recheck.

| If you are judging | Start here |
|---|---|
| **Chainlink**, Best workflow with CRE | [Chainlink: Best workflow with CRE](#chainlink-best-workflow-with-cre). The one `cre workflow simulate` line, the bounty text line by line, the CRE code guide |
| **RYO-CHAN**, Autonomous Agents | [RYO-CHAN: Autonomous Agents](#ryo-chan-autonomous-agents). The bounty text phrase by phrase, the practice trade ledger, one sentence turned into limits |
| **BLI**, LegalTech and RegTech | [BLI: LegalTech and RegTech](#bli-legaltech-and-regtech). Who the agent acts for, two questions from BLI's own stage, the regulators' words |
| Any of them | [Verify it yourself in 60 seconds](#verify-it-yourself-in-60-seconds), [Details](#details), [What it does not claim](#what-it-does-not-claim) |

> "$600 out the window in seconds"
> @DCA_Sean, a Robinhood Chain user, after a coin that Protos reports as a scam appeared in the sell screen of the wallet app. Quoted by [Protos, 2026-07-10](https://protos.com/robinhood-chain-scams-are-already-costing-users-dearly/).

> "I was asleep when the losses accumulated."
> crypto_chris, writing about an AI agent that was left to trade alone. [BlockEden forum, 2026-02-06](https://blockeden.xyz/forum/t/my-ai-agent-lost-12k-in-a-weekend-a-cautionary-tale-about-autonomous-defi/368).

<!-- STORY:BEGIN -->
Those two people wrote about tokens and agents in general. The same gap is open for stock tokens, because a ticker is not unique on a chain where anyone can deploy a token. What follows is my own observation, and I have found no account of anyone losing money this way. On 2026-09-27 at 12:52 UTC, 25 tokens that a block explorer lists as NVDA arrived in a wallet that trades Robinhood Stock Tokens. The wallet did not sign that transaction. A copier that goes by the ticker sees 25 NVDA arrive in that wallet. This record accuses no one. It shows that a ticker is not unique.
<!-- STORY:END -->

copy-guard is an autonomous agent that checks a move before it would copy it. It looks at which contract moved, who signed the transaction, where the token came from and what the wallet's record says. Then it sizes a practice trade by how strong that evidence is (full, reduced or none) and writes every reason in plain sentences. The rules are fixed and no language model decides, so the same inputs always give the same decision. The person it acts for sets the limits, and a mandate names that person by address. Chainlink CRE workflows check the token and the record before the agent acts, and they put the hash of its reasoning onchain.

Nobody has to take my word for this, or the agent's, or a server's. One command with no key, no account and nothing to install rechecks the payment, the records, every decision and the whole practice ledger against two public chains. Without a terminal, [`docs/index.html`](docs/index.html) shows the same ledger as one page.

<!-- FACTS:BEGIN -->
**The walk of 2026-10-14, practice only.** copy-guard looked at 4200 moves of 40 wallets. It opened 54 practice positions, each at the reduced size the user's limits give for weaker evidence. It declined 4146, each with a reason in plain sentences. 64 of the moves were in 34 tokens that carry the ticker of a Stock Token or of USDG at an address the issuer did not list. How they reached the wallet: 36 sent to a wallet that did not sign, 20 bought by the wallet itself (it signed and paid), 8 logged with the wallet as the sender. Each token is [named by address](#tokens-that-share-a-ticker). 20 of the 40 wallets are in the walk because they bought such a token, so these counts are not a rate.
<!-- FACTS:END -->

## Verify it yourself in 60 seconds

Step 1 needs Node 20 or newer and a copy of this repo. Steps 2 to 4 need only a browser. Every date and time in this README is UTC.

**1. Run the recheck** from the root of the repo.

```bash
git clone https://github.com/kzmttkc/vet402-copy-guard && cd vet402-copy-guard
node verify.mjs
```

It recomputes every hash from the files in this repo with its own code, reruns every rule, replays the practice ledger and compares the results with what Robinhood Chain and Robinhood Testnet hold. The last two lines of the last saved run:

<!-- VERIFY_TAIL:BEGIN -->
```
59 OK, 0 FAIL, 0 not checked
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
  OK    decisions       4200 decisions rerun, 18 rules each: FULL 0, REDUCED 54, NONE 4146. Every row, card, mandate and limits hash is the one its inputs give
  OK    selection       docs/walk/selection.json asked vet402 about the top 100 addresses by what official venues sent them in blocks 62420751 to 87977834 (2026-09-14 to 2026-10-14): 19 selected, 81 with no record, each with its saved answer. Stopped because 100 addresses had been asked: 100 addresses asked from the top of the ranking, 19 selected, 81 with no record. Observations apart: 1 watched wallet and 20 buyers of one token with the ticker SPY
  OK    records         39 records in docs/walk/records hash to the X-Facts-Hash vet402 sent with them and give the fields every decision read. For 1 wallets vet402 gave no record, and their decisions say so. Every moved token is named as the issuer's list (195 Stock Tokens, taken 2026-09-28), the CRE token-check results 0x7d0ef983…ba0e41 and the record give it
  OK    prices          3590 decisions read a price, each the last Chainlink feed value at or before the block of the move, out of 10294 values of 22 feeds saved in docs/walk/feeds.json
  OK    ledger          docs/ledger.json is what the walk gives: 4200 decisions about 40 wallets (FULL 0, REDUCED 54, NONE 4146). Incoming Stock Tokens by kind: purchase 263, rotation 0, liquidity 2872, swapped_unpaid 0, received 283, out 718. copy-guard opened 54 practice positions, every one on a purchase (an official swap the wallet itself paid for, median 0.45 USD), and none in a token the issuer did not list. A ticker copy opened 230: 210 in Stock Tokens and 20 in 1 other token under a listed ticker. Different tokens under a listed ticker were part of 64 moves (34 tokens: NVDA, SPY, USDG): 36 sent to the wallet, 20 bought by it, 0 received unpaid, 8 logged as sent by it. At one size (25.00 USD each): the 54 both opened 6.04 USD, the 156 Stock Token positions only the ticker copy opened 24.43 USD, and its 20 in other tokens: 20 valued at a pool (-460.61 USD), 0 not measured and in no sum
  OK    page            docs/index.html carries this ledger, and builds its cards and its tables from it in the browser
  OK    limits          limits.json hashes to 0x1e762486…72c2cf, the limits every decision and the mandate name: full 100.00 USD, reduced 25.00 USD, 300.00 USD per day, a wallet at a loss opens nothing
  OK    rules files     agent/rules.ts hashes to 0x2abeff7f…e93b12, the file the paid run's trails name, and agent/rules-v2.ts to 0x83cdfcf1…0ecf08, as every decision and the mandate say
  OK    mandate         SAMPLE mandate mandate/sample/mandate.json (0x39388673…e42229): the signature in every decision recovers to its principal 0xbb62…f48d, a testnet-only key that stands in for the principal. The real mandate, mandate/mandate.json, is not signed yet
  OK    root onchain    LedgerAnchored in 0x109ada37…e201d0 on Robinhood Testnet has the Merkle root 0x08050cbf…fb4040 of all 4200 decisions, the same mandate, limits and rules, and the same counts
  OK    CRE verdict     the CRE workflow wrote MATCH for anchor 0x15f9ed8a…585c7f in 0x6fbe85b1…e877ad on Robinhood Testnet
  OK    pool mark       the last swap of Uniswap v4 pool 0x9f0f44d4…87ef34 at or before block 88105125 is in 0x602fda94…004144 (block 87883602), the price 20 ticker-copy positions are marked at
  18 of the 4200 decisions against Robinhood Chain (--deep checks every one)
  OK    decision 1      0xa93f4763…814075 in block 29836458 (2026-08-07T02:02:04.000Z): 4 transfers as listed, signed by 0x75ee…354f, not the wallet, liquidity (IncreaseLiquidity, Mint), venue other, feed value 218.7800 USD from round 693
  OK    decision 24     0xb28b59cf…b41de3 in block 34170399 (2026-08-12T02:33:43.000Z): 1 transfer as listed, signed by 0x8c94…ec08, not the wallet, received
  OK    decision 545    0xc3d9f6d3…1458f7 in block 49828337 (2026-08-30T07:23:15.000Z): 2 transfers as listed, signed by the wallet, a purchase: an official swap, paid 50,000 USDG by the wallet, venue other and other and uniswap-v4-pool-manager and uniswap-v3-pool and uniswap-v3-pool and other, feed value 770.2651 USD from round 112
  OK    decision 546    0xd3368718…6eae21 in block 49828712 (2026-08-30T07:23:54.000Z): 2 transfers as listed, signed by the wallet, a purchase: an official swap, paid 50,000 USDG by the wallet, venue other and other and uniswap-v4-pool-manager and uniswap-v3-pool and uniswap-v3-pool and other, feed value 770.2651 USD from round 112
  OK    decision 548    0xed13cf12…1d8ba3 in block 49831612 (2026-08-30T07:28:46.000Z): 2 transfers as listed, signed by the wallet, a purchase: an official swap, paid 450,000 USDG by the wallet, venue uniswap-v3-pool and uniswap-v4-pool-manager and uniswap-v3-pool and other, feed value 218.1555 USD from round 930
  OK    decision 549    0xff34e6d3…24404d in block 49833837 (2026-08-30T07:32:31.000Z): 2 transfers as listed, signed by the wallet, a purchase: an official swap, paid 100,000 USDG by the wallet, venue uniswap-v3-pool and uniswap-v4-pool-manager and uniswap-v3-pool and other, feed value 218.1555 USD from round 930
  OK    decision 574    0x845302ca…669e96 in block 50356044 (2026-08-30T22:13:39.000Z): 2 transfers as listed, signed by the wallet, a purchase: an official swap, paid 50,000 USDG by the wallet, venue uniswap-v3-pool and uniswap-v4-pool-manager and uniswap-v3-pool and other, feed value 715.9000 USD from round 315
  OK    decision 595    0xd1186eaa…8aeeac in block 50659273 (2026-08-31T06:43:56.000Z): 2 transfers as listed, signed by the wallet, a purchase: an official swap, paid 100,000 USDG by the wallet, venue uniswap-v4-pool-manager and uniswap-v3-pool and uniswap-v3-pool and other, feed value 715.3700 USD from round 317
  OK    decision 596    0xc9f3af96…e0c0ce in block 50659790 (2026-08-31T06:44:48.000Z): 2 transfers as listed, signed by the wallet, a purchase: an official swap, paid 100,000 USDG by the wallet, venue other and other and uniswap-v4-pool-manager and uniswap-v3-pool and uniswap-v3-pool and other, feed value 766.1400 USD from round 113
  OK    decision 597    0xb011d6f8…62d103 in block 50660122 (2026-08-31T06:45:23.000Z): 2 transfers as listed, signed by the wallet, a purchase: an official swap, paid 100,000 USDG by the wallet, venue other and other and uniswap-v4-pool-manager and uniswap-v3-pool and uniswap-v3-pool and other, feed value 766.1400 USD from round 113
  OK    decision 600    0x78cd2cb6…666ad6 in block 50661554 (2026-08-31T06:47:46.000Z): 2 transfers as listed, signed by the wallet, a purchase: an official swap, paid 67,000 USDG by the wallet, venue other and other and other and uniswap-v4-pool-manager and uniswap-v3-pool and uniswap-v3-pool and other, feed value 766.1400 USD from round 113
  OK    decision 624    0xac825156…abc239 in block 50936792 (2026-08-31T14:29:58.000Z): 2 transfers as listed, signed by the wallet, a purchase: an official swap, paid 4,000 USDG by the wallet, venue uniswap-v4-pool-manager and other, feed value 260.6950 USD from round 685
  OK    decision 2210   0x0eac7685…6a13f8 in block 68837431 (2026-09-21T13:36:17.000Z): 4 transfers as listed, signed by the wallet, a purchase: an official swap, paid 5,000 USDG by the wallet, venue uniswap-v4-pool-manager and uniswap-v3-pool, feed value 726.9600 USD from round 361
  OK    decision 2494   0x1b838f40…77b51b in block 73953009 (2026-09-27T12:52:47.000Z): 1 transfer as listed, signed by 0x3433…abd0, not the wallet, received
  OK    decision 2495   0x1b838f40…77b51b in block 73953009 (2026-09-27T12:52:47.000Z): 1 transfer as listed, signed by 0x3433…abd0, not the wallet, received
  OK    decision 4140   0x1bd25c5e…86cce4 in block 87803686 (2026-10-13T20:39:01.000Z): 1 transfer as listed, signed by the wallet, a purchase: an official swap, paid 0.000059 ETH by the wallet
  OK    decision 4141   0xefd5b267…df42a9 in block 87803697 (2026-10-13T20:39:02.000Z): 1 transfer as listed, signed by the wallet, a purchase: an official swap, paid 0.016393 ETH by the wallet
  OK    decision 4142   0xccd25929…50c753 in block 87803732 (2026-10-13T20:39:06.000Z): 1 transfer as listed, signed by the wallet, a purchase: an official swap, paid 0.024834 ETH by the wallet
6. The x402 gate in front of the CRE workflow (a dry run: nothing signed, nothing paid)
  OK    gate 402        the gate answered 402 for /v1/workflows/rwa-verify: exact, eip155:4663, 0.01 USDG to 0x973c…6227 (vet402), Permit2
  OK    payment built   the payment the agent built and did not sign hashes to 0xe08bf1dc…e39735: 0.01 USDG, spender the x402 Permit2 proxy, recipient pinned to 0x973c…6227, valid 120 s
  OK    agent card      agent.json and SKILL.md offer the workflow rwa-verify under the same terms: 0.01 USDG on eip155:4663 to 0x973c…6227

59 OK, 0 FAIL, 0 not checked
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

**What this shows and what it leaves open.** The one payment so far is my own test. The agent's wallet and the wallet that received the 0.01 USDG are both mine. Every trade in the ledger is a practice (paper) trade. The ledger is a replay of past public moves, and it says nothing about whether copying any wallet makes money.

## Chainlink: Best workflow with CRE

CRE is the layer the agent's decision passes through. A CRE workflow checks the record the agent relies on before it acts, another reads from the chain whether a moved token is the issuer's Stock Token, and the reasoning the agent ends with goes onchain through a third. One line reproduces each run. It needs the CRE CLI (v1.37.0) and `cre login` once.

<!-- CRE_SIMULATE:BEGIN -->
Both lines run from the root of the repo, after `cre login` and `bun install` in the workflow's folder. No key is needed. The time at the start of each saved log line is the machine's local clock printed with a `Z` (row 3 of the notes below), so the excerpts leave it out.

**token-check**, many tokens at one block. This payload holds the token of [the card](#the-practice-ledger) below among 12 tokens.

```bash
cre workflow simulate token-check --target local-simulation --non-interactive --trigger-index 0 --http-payload docs/token-check/batch/batch-4.payload.json
```

From [`docs/token-check/batch/batch-4.cre.txt`](docs/token-check/batch/batch-4.cre.txt), the saved output of the same payload run with `--broadcast`. Without `--broadcast` the write at the end is a dry run.

```
[USER LOG] token check, batch (Robinhood Chain 4663, read over JSON-RPC, no vet402 API)
[USER LOG] tokens  12
[USER LOG] state   robinhood-rpc.publicnode.com   logs rpc.mainnet.chain.robinhood.com
[USER LOG] head    88095635 (median of the nodes), checking at block 88095615
[USER LOG] block   88095615  hash 0x0d7b3cdd…fe21dc (the same from both RPCs)
[USER LOG] NOT_ISSUER_TOKEN  0x5dd716fe…8e3539  "NVDA"  updates 0  NOT_IN_ISSUER_LIST CODE_HASH_DIFFERS BEACON_DIFFERS TICKER_SAME_AS_ISSUER_TOKEN NAME_SAME_AS_ISSUER_TOKEN NAME_ENDS_LIKE_ISSUER_TOKEN
[USER LOG] ISSUER_TOKEN      0x5e812136…459786  "TTWO"  updates 0  IN_ISSUER_LIST CODE_HASH_MATCHES BEACON_MATCHES FACTORY_LOG_NAMES_TOKEN TICKER_MATCHES_LIST
[USER LOG] NOT_ISSUER_TOKEN  0x5fc5360d…f1d168  "USDG"  updates 0  USDG_ADDRESS
[USER LOG] NOT_ISSUER_TOKEN  0x623613c0…1186e0  "USDG"  updates 0  NOT_IN_ISSUER_LIST CODE_HASH_DIFFERS BEACON_DIFFERS TICKER_OR_NAME_READS_AS_USDG
… 8 more rows of the same form
[USER LOG] RESULT: 12 tokens at block 88095615, 3 the issuer's, 9 not
[USER LOG] batch hash 0xb0322a58…41c97d (keccak256 of the canonical JSON of the rows)
[USER LOG] batch hash written to 0xF49b4F21…016550 on robinhood-testnet, tx 0x1aaea557aad9af3d2a8129523ff0ca0aca62532bb254d2be19b2b13ed08f9842
```

The write is [`0x1aaea557…8f9842`](https://explorer.testnet.chain.robinhood.com/tx/0x1aaea557aad9af3d2a8129523ff0ca0aca62532bb254d2be19b2b13ed08f9842?tab=logs) on Robinhood Testnet.

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
**What `token-check` has checked so far.** 82 tokens that moved in the walk, in 9 CRE runs, the last at Robinhood Chain block 88102077.

| What | Count |
|---|---|
| the issuer's Stock Tokens, every mark confirmed from the chain (the list, the code hash, the beacon, the factory's log) | 42 |
| of them with a share multiplier update logged | 16 |
| not the issuer's | 40 |
| of them USDG itself | 1 |
| of them at an address outside the list with the ticker or the name of a listed Stock Token | 3 |
| of them at an address outside the list whose ticker or name reads as USDG (8 with invisible characters) | 31 |
| of them at an address outside the list with no mark of a listed token | 5 |

Each run wrote the hash of its rows in a `TokenBatchChecked` event ([run 1](https://explorer.testnet.chain.robinhood.com/tx/0xfa386a44268705425cc52115bf63badd8106e3e39ffc3b14c63eee71095eb77d?tab=logs), [run 2](https://explorer.testnet.chain.robinhood.com/tx/0xdbef8b0aeca1820e4a191c2f90edac9ccaf3be2d78ea28c711107fd96c518336?tab=logs), [run 3](https://explorer.testnet.chain.robinhood.com/tx/0x6cd511c78b0045af18171246be1d7ca8b92d2ec5e41b5aaf817e2c820fe3357e?tab=logs), [run 4](https://explorer.testnet.chain.robinhood.com/tx/0x1aaea557aad9af3d2a8129523ff0ca0aca62532bb254d2be19b2b13ed08f9842?tab=logs), [run 5](https://explorer.testnet.chain.robinhood.com/tx/0xf7b7484378d166b7b9d4b2ffbe97708fa3ddb1545c4e7d5c053b7cb2ef15fcb6?tab=logs), [run 6](https://explorer.testnet.chain.robinhood.com/tx/0xf04a9faefa83c3be99e70e902178e005a101fe50f471d795f5294c4a5609b320?tab=logs), [run 7](https://explorer.testnet.chain.robinhood.com/tx/0x3868b8e9d9bda1c340ce37c74eba35acbcee1ba00d2d55ce73f65db2446f4ae4?tab=logs), [run 8](https://explorer.testnet.chain.robinhood.com/tx/0x2b10033e7bf929064879346b65fd2dde82b45f429838375c3146eb64722eebb3?tab=logs), [run 9](https://explorer.testnet.chain.robinhood.com/tx/0x14338fa3c55cdf79c8238bcea3621a0828c59b3a1983d86d546b87e3bf9e2bea?tab=logs)). One more run read those receipts back over the EVM capability and wrote `keccak256(results.json)` = `0x7d0ef983…ba0e41` in [`0x175bf12a…3fdb08`](https://explorer.testnet.chain.robinhood.com/tx/0x175bf12ad77fd67d73490333b04ad1cc4c0c66d1ea7844836219f504a33fdb08?tab=logs), to `TokenCheckReceiver` on Robinhood Testnet. Every decision of the walk names that file by the same hash. `node token-check/recheck.mjs` reads every row again over plain JSON-RPC, with no CRE and no code shared with the workflow. Its last line: `RECHECK: 82 of 82 rows agree, 0 differ; state read at the checked block for 0, as it is now for 82; 0 problems with the onchain trail; 712 RPC requests`. The codes say what was read. None of them says who made a token or why.
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
| A person opens a block explorer and compares a token's contract with the issuer's list by eye, if they think of it | `token-check` reads the code hash, the beacon and the official list from the chain | the check runs before the agent acts and returns a reason code a machine can read | 8 s for 12 tokens at one block ([`batch-4.cre.txt`](docs/token-check/batch/batch-4.cre.txt)) |
| A reader trusts the site that shows a wallet's record | `rwa-verify` recomputes the record's hash and reads its anchor | MATCH or MISMATCH with one bit per failed check, as an event | 3 s ([`docs/simulate-match.txt`](docs/simulate-match.txt)) |
| An agent's operator keeps its own log | every decision is hashed, and one event carries the Merkle root of the walk | a third party rechecks every decision of a walk without trusting the operator | not measured |
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
| 8 | read many tokens' state and logs over the HTTP capability in one execution | the 15 calls per execution are enough | one listed token needs up to 9 log queries, and the public RPC answers 429 to a whole batch above what the caller's address has left of its rate (requests of 10 items passed on a quiet line; with another reader on the same address, 3 did not), so at 10 items per request the call limit is reached at about 9 listed tokens | plan the run before reading (`plannedHttpCalls` in `token-check/batch.ts`), refuse a payload that cannot fit, and let the caller split the list. A per-execution budget the workflow can ask for at run time would remove the guesswork |
| 9 | have every node read the same block of a chain CRE does not list | a way to pin "the block" across nodes | each node's `eth_blockNumber` can differ, so an answer read at "latest" would not be identical across nodes (not observed: a simulation is one node) | two rounds: median on the head, then every read pinned to head minus 20 with identical aggregation (`token-check/workflow.ts` L495, L505). Worth a template: it is the general recipe for reading an unlisted chain over HTTP |
| 10 | `eth_getCode` for many unknown tokens in one HTTP answer | fits in 250 kb | a contract can be 24 kb, 49 kb as hex, so six tokens can pass the limit | an `eth_call` without `to` whose init code returns `EXTCODEHASH` (`extcodehashCall`, L326): 32 bytes per token |
| 11 | `evm.getTransactionReceipt` in a simulation, for a transaction a run of a minute earlier wrote with `--broadcast` | the receipt | the receipt, with logs, on Robinhood Testnet. It worked the first time | none needed. It let the workflow check its own earlier writes before anchoring |
| 12 | test `getTransactionReceipt` with `EvmMock` | a documented shape for the mocked receipt | the JSON form wants base64 for `address`, `topics`, `data` and a string for `status`; I found it in the generated types | `token-check/batch-workflow.test.ts`, `b64hex` |

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
| "transparent signal rules and user-defined risk limits" | [the rules](#the-rules) in two files, and [`limits.json`](#the-users-limits), which the user writes |
| "Explain selected and rejected candidates" | rejected moves stay in the ledger, each with its reasons |
| "entry, sizing, and exit as one decision" | one position object: the feed's value at the block, the size from the limits, the exit rule |
| Whale Movement Tracker, "notable wallet activity" to "a final market verdict" | see the sentence under this table for how the wallets were chosen and how large their purchases were |
| Multi-KOL Narrative Agent (the spotlight) | Not attempted. There is no X, Discord or Telegram input |

<!-- WALLETS:BEGIN -->
The walk follows 40 wallets: 19 picked by one rule and not by hand (the largest buyers of Stock Tokens over 30 days, largest first), 20 that bought a token under a listed ticker at an address the issuer did not list and 1 demo wallet, the only one vet402 has anchored a record for. The rule, the window and every purchase counted are in [`docs/walk/selection.json`](docs/walk/selection.json). The 54 purchases copy-guard followed with a practice position were worth between 0.21 and 446442.61 USD each, with a median of 0.45 USD.
<!-- WALLETS:END -->

### The practice ledger

`bun agent/walk.ts` reads each wallet's vet402 /rwa record once from the free route and walks through every move that record lists, in the order the moves happened. Two books run side by side.

- **copy-guard** opens what its rules, its mandate and the user's limits allow.
- **Ticker copy** is a baseline I defined. It opens a position on every move in which a token with a stock ticker arrives in the wallet. It buys no record and applies no rule or limit.

Both enter a Stock Token at the Chainlink feed's value at the block of the move and leave by the same exit rules: the copied wallet sells or sends the token, the feed crosses the stop loss or the take profit, or the time limit passes. Whatever is still open is marked at the feed's last value.

<!-- LEDGER:BEGIN -->
Walked 2026-10-14 05:09 UTC, marked at Robinhood Chain block 88105125. Moves from 2026-08-07 02:02 UTC to 2026-10-14 03:51 UTC.

**What each book did with the same 4200 moves**

| | copy-guard | Ticker copy |
|---|---|---|
| Practice positions opened | 54 (full size 0, reduced size 54) | 230 |
| Of them in a token under a listed ticker at an address the issuer did not list | 0 | 20, in 1 token |
| Declined, each with a reason | 4146 | 0. It has no rule to decline by |
| Closed / still open at the mark | 53 / 1 | 204 / 26 |

**The same counts by group of wallets**, because one group was chosen for what it bought.

| Group | Wallets | Moves | copy-guard opened | Ticker copy opened | Of them in other tokens |
|---|---|---|---|---|---|
| The largest buyers of Stock Tokens | 19 | 3897 | 18 | 107 | 0 |
| Wallets chosen because they bought a token under a listed ticker at another address | 20 | 210 | 36 | 76 | 20 |
| The demo wallet | 1 | 93 | 0 | 47 | 0 |

**The same positions at one size, 25.00 USD each**, so that size cannot make the difference.

| | Positions | Put in | Result at the exit or the mark |
|---|---|---|---|
| Opened by both books | 54 | 1350.00 USD | 6.04 USD, the same in both books |
| Opened by the ticker copy only, in Stock Tokens | 156 | 3900.00 USD | 24.43 USD |
| Opened by the ticker copy only, in other tokens under a listed ticker | 20 | 500.00 USD | 20 positions measured at the pool's own price: -460.61 USD |

These are practice (paper) positions on past public moves. The tables are not a forecast and not a track record. A position in a token that is not the issuer's is valued only where the price of its own pool could be read from public logs. Otherwise it is listed as not measured and left out of every sum. Nothing is assumed to be worth zero. A pool value compares the pool's last swap with the swap the wallet bought in. It leaves out the move of the pool's other asset in USD, and it does not say that a position of that size could have been sold there.

No move reached the full size in this walk. No position, by leading reason: a liquidity operation, not a purchase (2216), a sale or a transfer out, not a purchase (716), a moved token the agent cannot name (659), sent to the wallet, not bought by it (282), wallet not in profit (121), no Chainlink price at the block (53), not USDG, a different token with the same ticker (41), daily limit reached (21), not the Stock Token SPY, a different token with the same ticker (20), position limit reached (14), not the Stock Token NVDA, a different token with the same ticker (3).

The Merkle root of all 4200 decisions is `0x08050cbff7c889dd21d0864ce242a479040035d892275e919f684b0a6cfb4040`. It is in one `LedgerAnchored` event on Robinhood Testnet: [`0x109ada37…e201d0`](https://explorer.testnet.chain.robinhood.com/tx/0x109ada373e1c23c912dfea0d7ba3a47725e469b22f5fad4be9bdb3b68ce201d0?tab=logs).
<!-- LEDGER:END -->

Each decision is one line of [`docs/walk/trails.jsonl.gz`](docs/walk/trails.jsonl.gz) (gzipped; `gunzip -k` gives `trails.jsonl`, and [`docs/verify/compressed.json`](docs/verify/compressed.json) keeps its sha256 from before it was gzipped): everything the rules read, every rule row, the size, the practice position with its exit, and a card. [`docs/ledger.json`](docs/ledger.json) holds the rows, both books and the totals. [`docs/index.html`](docs/index.html) carries the totals, both books and every decision that opened a position, and loads the other decisions from [`docs/rows/`](docs/rows/), one file per wallet, when they are asked for. `verify.mjs` rebuilds the ledger from the trails and the saved feed values, and checks that the page and `docs/rows/` hold exactly its rows.

A card reads like this. Every sentence is a fixed template filled with values from the trail.

<!-- CARD:BEGIN -->
> **No position: not the Stock Token NVDA, a different token with the same ticker**
> *What happened.* 0x3433…abd0 sent this wallet 25 tokens with the ticker NVDA (named "NVIDIA Robinhood Coin"). No official swap put the token out in the transaction. The wallet did not sign the transaction (0x3433…abd0 did).
> *What a ticker copy sees.* A bot that goes by the ticker sees 25 NVDA arrive in this wallet.
> *Why.* This is not the Robinhood Stock Token NVDA. It is a different token at 0x5dd7…3539 with the same ticker, at an address the issuer did not list. The Stock Token NVDA is at 0xd060…9eec. The Chainlink CRE token-check workflow read it from the chain (NOT_IN_ISSUER_LIST, CODE_HASH_DIFFERS, BEACON_DIFFERS, TICKER_SAME_AS_ISSUER_TOKEN, NAME_SAME_AS_ISSUER_TOKEN, NAME_ENDS_LIKE_ISSUER_TOKEN). This says what the token is not. It says nothing about who made it or why.
> *Suggested action.* copy-guard opened no position. No real trade was placed.
>
> Decision 2494 of the walk, move [`0x1b838f40…77b51b`](https://robinhoodchain.blockscout.com/tx/0x1b838f40a43d54b7ce3364f08f723516170be2d03fdbcd6ab801c79f7f77b51b) on 2026-09-27 12:52 UTC. 10 of 18 checks passed.
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
**Mandate: sample, not yet signed by the principal.** This walk used `mandate/sample/mandate.json`. Its principal `0xbb62…f48d` is a testnet-only key that stands in for the principal. The mandate meant for signing, `mandate/mandate.json`, names `0x973c…6227` and has no signature yet, so no decision in this walk carries the principal's own signature. After that signature the walk is run again.
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

## Details

### Tokens that share a ticker

On a permissionless chain anyone can give a token any ticker. This table lists every token in the walk that carries the ticker of a Robinhood Stock Token or of USDG at an address the issuer did not list. It is a record that tickers are not unique. It does not call any of these tokens, or the people behind them, a scam, and it says nothing about who made a token or why.

The table separates two things that a ticker-only view mixes up. A token can be sent to a wallet in a transaction the wallet never signed. A wallet can also buy such a token itself, by signing and paying. Only the first can be planted by a stranger.

<!-- OTHER_TOKENS:BEGIN -->
| Ticker it carries | Contract | Name it carries | Moves in this walk | How it reached the wallet |
|---|---|---|---|---|
| SPY | [`0x69e7…6219`](https://robinhoodchain.blockscout.com/address/0x69e7778d46713e17572d610bdaca3943aa4e6219) | "" | 20 | bought by the wallet, which signed and paid |
| USDG | [`0x2ce3…77af`](https://robinhoodchain.blockscout.com/address/0x2ce3e396e069ac9fa62046f423267072e06e77af) | "Global Dollar" | 3 | sent to the wallet, which did not sign |
| USDG | [`0x0ef3…09c0`](https://robinhoodchain.blockscout.com/address/0x0ef3fccbc4c73be8bb14411cfe801df141e309c0) | "Global Dollar" | 2 | sent to the wallet, which did not sign |
| USDG | [`0x36f4…4be2`](https://robinhoodchain.blockscout.com/address/0x36f4d7f0fa5c7348416282e04380ddff30ca4be2) | "Global Dollar" | 2 | sent to the wallet, which did not sign |
| USDG | [`0x42b4…53c2`](https://robinhoodchain.blockscout.com/address/0x42b4fa90438ecb1a0c2676ff25a9f27355dd53c2) | "global dollar" | 2 | sent to the wallet, which did not sign |
| USDG | [`0x42e1…f160`](https://robinhoodchain.blockscout.com/address/0x42e140c4b439c42dc01aa29be1fce2bc64d7f160) | "Global Dollar" | 2 | sent to the wallet, which did not sign |
| USDG | [`0x5411…56a2`](https://robinhoodchain.blockscout.com/address/0x5411257cedf60bc40f4bead410bf8d02079056a2) | "United States Global Dollar" | 2 | sent to the wallet, which did not sign |
| NVDA | [`0x5dd7…3539`](https://robinhoodchain.blockscout.com/address/0x5dd716fe12275b69f04b26beeca343843c8e3539) | "NVIDIA Robinhood Coin" | 2 | sent to the wallet, which did not sign |
| USDG | [`0xa913…85c0`](https://robinhoodchain.blockscout.com/address/0xa913c4c2f28aa7b0b15a7c6008a6e19ff8bf85c0) | "Global Dollar" | 2 | sent to the wallet, which did not sign |
| USDG | [`0xc641…ad13`](https://robinhoodchain.blockscout.com/address/0xc6417224f693a0d8bf612bc6d7dcbbc268d5ad13) | "Global Dolar " | 2 | sent to the wallet, which did not sign |
| USDG | [`0xd6b8…a7e5`](https://robinhoodchain.blockscout.com/address/0xd6b8cecde770507fc46cde7ea82dde383ed7a7e5) | "Global Dollar" | 2 | sent to the wallet, which did not sign |
| USDG | [`0x0c95…b1f7`](https://robinhoodchain.blockscout.com/address/0x0c95df78d9f692beb3feaeceb2ef1e614513b1f7) | "United States Global Dollar" | 1 | sent to the wallet, which did not sign |
| USDG | [`0x1dc8…9eb3`](https://robinhoodchain.blockscout.com/address/0x1dc878194328a96680c23b8d3c1186637b199eb3) | "United States Global Dollar" | 1 | sent to the wallet, which did not sign |
| USDG | [`0x1ee1…1458`](https://robinhoodchain.blockscout.com/address/0x1ee1a8fcc194a4fcdbce10f958aea8a18e831458) | "US Global Dollar" | 1 | sent to the wallet, which did not sign |
| USDG | [`0x22b1…d8d7`](https://robinhoodchain.blockscout.com/address/0x22b1137c0637bf8f7ac7fbcfa857604e4b89d8d7) | "U⟨U+17B5⟩S⟨U+17B5⟩DG" | 1 | a log names the wallet as the sender, and the wallet did not sign |
| USDG | [`0x2504…150c`](https://robinhoodchain.blockscout.com/address/0x2504cc3b84585a5cdf88f4c4f50b2afe9181150c) | "Global Dollar United Only" | 1 | sent to the wallet, which did not sign |
| USDG | [`0x318f…b1a3`](https://robinhoodchain.blockscout.com/address/0x318f563dceddbe58625400d9f7ee27eecef5b1a3) | "U⟨U+17B5⟩S⟨U+17B5⟩DG" | 1 | a log names the wallet as the sender, and the wallet did not sign |
| USDG | [`0x38eb…1885`](https://robinhoodchain.blockscout.com/address/0x38ebf2ab30cbff745e2db10aa17b6aaaad001885) | "U⟨U+17B5⟩S⟨U+17B5⟩DG" | 1 | a log names the wallet as the sender, and the wallet did not sign |
| USDG | [`0x4190…a416`](https://robinhoodchain.blockscout.com/address/0x4190ee598c2a69d35bef53c83d152ae0f25ea416) | "U⟨U+17B5⟩S⟨U+17B5⟩DG" | 1 | a log names the wallet as the sender, and the wallet did not sign |
| USDG | [`0x4ff7…b792`](https://robinhoodchain.blockscout.com/address/0x4ff7f19a6c4c7ebcba25248610dbe642bbd0b792) | "Global Dollar" | 1 | sent to the wallet, which did not sign |
| USDG | [`0x6236…86e0`](https://robinhoodchain.blockscout.com/address/0x623613c0e9211a7215b4fd4ab80656fcbd1186e0) | "Global Dollar" | 1 | sent to the wallet, which did not sign |
| USDG | [`0x65ab…c0d5`](https://robinhoodchain.blockscout.com/address/0x65abeb15f2fed8cccf979c9429f517f937bdc0d5) | "Global Dollar" | 1 | sent to the wallet, which did not sign |
| USDG | [`0x67f4…b8b2`](https://robinhoodchain.blockscout.com/address/0x67f438bd18131f152b6387083628e8eeaa5fb8b2) | "Global Dollar " | 1 | sent to the wallet, which did not sign |
| USDG | [`0x7116…78f1`](https://robinhoodchain.blockscout.com/address/0x711681d447e8f53ac228f20afad1e179ab5e78f1) | "UStates of Dollars Globals" | 1 | sent to the wallet, which did not sign |
| NVDA | [`0x72ea…9d37`](https://robinhoodchain.blockscout.com/address/0x72ead0c700f07b645a8f91badd82be5c545b9d37) | "NVIDIA Robinhood Coin" | 1 | sent to the wallet, which did not sign |
| USDG | [`0x73ac…c183`](https://robinhoodchain.blockscout.com/address/0x73acfc8352b6a9f0baacd02a266e58fde4b1c183) | "Global Dollar" | 1 | sent to the wallet, which did not sign |
| USDG | [`0x8372…c3bc`](https://robinhoodchain.blockscout.com/address/0x83726b15b25013e95b56357c4795b848ab32c3bc) | "U⟨U+17B5⟩S⟨U+17B5⟩DG" | 1 | a log names the wallet as the sender, and the wallet did not sign |
| USDG | [`0x9909…0a3e`](https://robinhoodchain.blockscout.com/address/0x9909c4e8cae5ada810c7297943ae767f87d00a3e) | "Global Dollar" | 1 | sent to the wallet, which did not sign |
| USDG | [`0xc4f8…b4a3`](https://robinhoodchain.blockscout.com/address/0xc4f85cebec3fe6c77df0f71f3a3e139d43bbb4a3) | "U⟨U+17B5⟩S⟨U+17B5⟩DG" | 1 | a log names the wallet as the sender, and the wallet did not sign |
| USDG | [`0xcb07…92e0`](https://robinhoodchain.blockscout.com/address/0xcb071fc69e4aebd512387316578752e5c20b92e0) | "U⟨U+206F⟩S⟨U+206F⟩DG" | 1 | a log names the wallet as the sender, and the wallet did not sign |
| USDG | [`0xd9c6…2cf0`](https://robinhoodchain.blockscout.com/address/0xd9c6ee31275554006ca30abcde7b48188c4e2cf0) | "United Stables Digital Gold" | 1 | sent to the wallet, which did not sign |
| USDG | [`0xdb81…66ef`](https://robinhoodchain.blockscout.com/address/0xdb81a12de6c0aebeddf2d85d531dd50cac7366ef) | "Globals Dollars" | 1 | sent to the wallet, which did not sign |
| USDG | [`0xe739…f288`](https://robinhoodchain.blockscout.com/address/0xe7391e4047c7e5d48f31cd2b87004c10e875f288) | "U⟨U+206F⟩S⟨U+206F⟩DG" | 1 | a log names the wallet as the sender, and the wallet did not sign |
| USDG | [`0xec90…4a3e`](https://robinhoodchain.blockscout.com/address/0xec90adc7157d68d9213a88627b66956950374a3e) | "United States Global Dollars Gold" | 1 | sent to the wallet, which did not sign |

34 tokens, 64 moves. The marks ⟨U+…⟩ stand for invisible characters in a name.
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

### Paying, and the cap

- The default is a dry run. Only `--pay` signs a payment. `--approve` (only with `--pay`) sends `approve(Permit2, …)` once, which is the one step that needs a little ETH on Robinhood Chain.
- `MAX_SPEND_ATOMIC` in `agent/x402.ts` is fixed at 1 USDG. `limits.json` can lower the cap and cannot raise it. One decision may cost at most `payments.max_usdg_per_decision`.
- The paying path (`agent/pay.ts`) runs under an exclusive lock file, so two runs cannot both pass the cap. Every payment is written to a ledger at a fixed path before it is sent. A payment whose outcome is unknown counts as spent.
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
- No token and no person is called a scam here. The record says which contract moved and that its address is not the one the issuer listed.
- The principal is an address. Nothing here ties it to a legal identity, and nothing here is a registration.
- The walk is a replay. Each wallet's record was read once, after the moves, so the rules judge a wallet with what is known now.
- Feed values arrive a few times a day. An entry price can be hours older than the move, within the age limit the user set.
- The ticker copy is a baseline I defined, stated in the ledger. A real copier may be less naive.
- The one payment so far is my own test. I own the agent's wallet and the wallet that was paid. The gate has not been paid.
- Nothing is deployed to a DON. All testnet receivers trust CRE's simulation forwarder, as described above.
- The rules are a policy. Anyone can read, rerun or disagree with every row.
- This is not legal advice and not investment advice. vet402 reports what public chain data shows and is not affiliated with Robinhood, Chainlink, RYO or any token issuer.

A ticker is a string that anyone can reuse. This record says which contract moved, who signed for it and who allowed the agent to act. Don't take my word for it. Run it.
