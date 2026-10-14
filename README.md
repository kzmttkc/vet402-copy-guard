# vet402 copy-guard: an agent that checks a stock-token move before it would copy it, and a record anyone can recheck

> "$600 out the window in seconds"
> @DCA_Sean, a Robinhood Chain user, after a scam coin appeared in his wallet's sell screen. Quoted by [Protos, 2026-07-10](https://protos.com/robinhood-chain-scams-are-already-costing-users-dearly/).

> "I was asleep when the losses accumulated."
> crypto_chris, on an AI agent he let trade for him. [BlockEden forum, 2026-02-06](https://blockeden.xyz/forum/t/my-ai-agent-lost-12k-in-a-weekend-a-cautionary-tale-about-autonomous-defi/368).

The same trick has reached stock tokens. This is my own observation, and I have found no victim's account of it: on 2026-09-27 at 12:52 UTC, 25 tokens that a block explorer lists as NVDA arrived in a wallet that trades real Robinhood Stock Tokens. Anyone who copies that wallet sees a purchase of Nvidia. Fake tickers are a consumer-harm problem before they are a technical one.

copy-guard is an autonomous agent that checks a move before it would copy it. It reads the evidence, sizes a practice trade by how strong that evidence is (full, reduced or none), and writes every reason in plain sentences. It decides by 18 fixed rules and uses no language model, so the same inputs always give the same decision. A person signs a mandate that says who the agent acts for, and sets the limits it must stay inside. Chainlink CRE workflows check the record and the token before the agent acts, and put the hash of the reasoning onchain.

Nobody has to take my word, the agent's or a server's for any of it. One command, with no key, no account and nothing to install, rechecks the payment, the records, every decision and the whole practice ledger against two public chains. Without a terminal, [`docs/index.html`](docs/index.html) shows the same ledger as one static page.

## Verify it yourself in 60 seconds

Step 1 needs Node 20 or newer and a copy of this repo. Steps 2 to 4 need only a browser. Every date and time in this README is UTC.

**1. Run the recheck** from the root of the repo.

```bash
git clone <REPO_URL> vet402-bli && cd vet402-bli
node verify.mjs
```

It recomputes every hash from the files in this repo with its own code, reruns every rule, replays the practice ledger and compares the results with what Robinhood Chain and Robinhood Testnet hold. This is the last saved run:

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

The exit code is 0 for MATCH and 1 for MISMATCH. A public RPC that is busy is asked again up to five times, and the line then ends with a note such as `(after 2 retries)`. When no RPC answers even then, the line starts with `----`, the last line reads `RESULT: NOT CHECKED` and the exit code is 3. An outage is never reported as a pass, and never as a failure.

To see it fail, change one digit of the record the agent bought and run it again. The third line puts the file back.

```bash
sed -i.bak 's/"realized_usd": "-170.59"/"realized_usd": "-170.58"/' docs/agent/first-paid-run/record.json
node verify.mjs --only paid-run | grep -v '  OK'
mv docs/agent/first-paid-run/record.json.bak docs/agent/first-paid-run/record.json
```

`node verify.mjs --deep` checks every decision of the ledger against the chain instead of a sample. `--only paid-run`, `--only ledger` and `--only gate` run one part. `node verify.mjs 73953009` rechecks one decision of the paid run by the block of the move.

**2. Open the ledger's root** (Robinhood Testnet). The `LedgerAnchored` event linked in the next section carries the Merkle root of every decision. The Contract tab of [`LedgerRootReceiver` `0xe3f0…F0C9`](https://explorer.testnet.chain.robinhood.com/address/0xe3f0cA4f474E15364017eE3f6fc0D0949e5aF0C9) shows its verified source: no owner, no storage, no upgrade path.

**3. Open the payment** (Robinhood Chain). [`0x65c314bd…87af61`](https://robinhoodchain.blockscout.com/tx/0x65c314bd758a59dfc79c78d8da76e557450fa1144726ddc4bfc77e183287af61): 0.01 USDG from `0xc3…ED94`, the agent's wallet, to `0x97…6227`, vet402's wallet, on 2026-10-08. The method is `settle` on `x402ExactPermit2Proxy`.

**4. Open the anchor** (Robinhood Chain). [`0x15f9ed8a…585c7f`](https://robinhoodchain.blockscout.com/tx/0x15f9ed8ae5dd466c2f35021c9f1291e7a624abbb52c8ac26b54d47442f585c7f?tab=logs): one `Anchored` log from `RwaAnchor` with `factsHash` `0x9d0e83d9…f721ee`, the value step 1 recomputes from `rwa-verify/fixtures/anchored-record.json`.

**What this shows and what it leaves open.** The one payment so far is my own test. The agent's wallet and the wallet that received the 0.01 USDG are both mine. Every trade in the ledger is a practice (paper) trade. The ledger is a replay of past public moves, and it says nothing about whether copying any wallet makes money.

## Chainlink CRE code guide

Where CRE is used, for a reader with thirty seconds. Line numbers are those of the commit that added this table.

| Workflow | Handler | Trigger | HTTP capability: what it reads | Consensus | EVM capability: what it writes |
|---|---|---|---|---|---|
| `rwa-verify` | [`rwa-verify/workflow.ts`](rwa-verify/workflow.ts) L185 | HTTP trigger, L261 | L194 the live record from vet402, L207 the record under test, L213 Robinhood Chain JSON-RPC: chain id, the anchor's receipt, `eth_getCode` of RwaAnchor | `consensusIdenticalAggregation` on each read | L232 report, L234 `writeReport` to `RwaVerdictReceiver` on Robinhood Testnet |
| `token-check` | [`token-check/workflow.ts`](token-check/workflow.ts) L252 | HTTP trigger, L286 | L263 Robinhood Chain JSON-RPC: the move's Transfer logs, each token's code, its EIP-1967 beacon slot, `symbol()`, `name()` and share multiplier | `consensusIdenticalAggregation`, L263 | none. It returns `allow` and reason bits and writes nothing |
| `trail-anchor` | [`trail-anchor/workflow.ts`](trail-anchor/workflow.ts) L172 | HTTP trigger, L223 | L189 Robinhood Chain JSON-RPC: the move's Transfer logs and, for a paid decision, the settlement receipt | `consensusIdenticalAggregation`, L189 | L203 to L204 one decision to `ReasoningTrailReceiver`. L164 to L165 the Merkle root of a walk to `LedgerRootReceiver` |

There is no EVM read. Robinhood Chain mainnet is not on CRE's supported network list, so every mainnet read goes through the HTTP capability as plain JSON-RPC. `agent/cre.ts` starts the workflows, and `agent/gate/server.ts` starts `rwa-verify` after an x402 payment.

### What changes

Only times I measured are in the last column (this machine, 2026-10-14).

| Before | Here | What changes | Measured |
|---|---|---|---|
| A person opens a block explorer and compares a token's contract with the issuer's list by eye, if they think of it | `token-check` reads the code hash, the beacon and the official list from the chain | the check runs before the agent acts and returns a reason code a machine can read | 11 s for one `cre workflow simulate token-check` |
| A reader trusts the site that shows a wallet's record | `rwa-verify` recomputes the record's hash and reads its anchor | MATCH or MISMATCH with one bit per failed check, as an event | 11 s for one `cre workflow simulate rwa-verify` |
| An agent's operator keeps its own log | every decision is hashed, and one event carries the Merkle root of the walk | a third party rechecks 493 decisions without trusting the operator | 19 to 22 s for `node verify.mjs`, five runs back to back |

### Why CRE

The question behind any automation is who runs it and why anyone should trust it. If these checks ran only on my server, a reader would have to trust my server. Written as CRE workflows, they are code a decentralized oracle network can run, with consensus declared on every HTTP read and the result delivered to a contract that has no owner. Trust in the operator is replaced by verification.

That is the design, and today only part of it is true. The workflows run under `cre workflow simulate`. No DON has run them, so no event here is a DON attestation. Until they are deployed, `node verify.mjs` does the verifying: it reruns everything the workflows did with separate code.

## The practice ledger

`bun agent/walk.ts` takes a list of wallets, reads each wallet's vet402 /rwa record once from the free route, and walks through every move that record lists, in the order the moves happened. Two books run side by side.

- **copy-guard** opens what its rules, its mandate and the user's limits allow.
- **Blind copy** opens the full size on every move in which something that looks like a Stock Token arrives. It buys no record and applies no rule or limit.

Both enter at the Chainlink feed's value at the block of the move and leave by the same exit rules: the copied wallet sells or sends the token, the feed crosses the stop loss or the take profit, or the time limit passes. Whatever is still open is marked at the feed's last value. A look-alike has no feed and gives no claim on the share whose ticker it copies, so the blind book writes it off at once.

<!-- LEDGER:BEGIN -->
Walked 2026-10-14 05:09 UTC, marked at Robinhood Chain block 88105125. Moves from 2026-08-07 02:02 UTC to 2026-10-14 03:51 UTC.

**Which wallets.** Notable wallets whose record can be checked ([`docs/walk/SELECTION.md`](docs/walk/SELECTION.md)): every address was ranked by what official Uniswap venues sent it of the Stock Tokens with a Chainlink feed between 2026-09-14 and 2026-10-14 (blocks 62420751 to 87977834), and vet402 was asked about the top 100. It built a record for 19, and they are walked. For 81 it could not (HTTP 422 wallet_too_large; 68 of them are contracts), so nothing was opened for them. Apart from those, as observations and not as notable wallets: 1 wallet this agent was first pointed at, and the first 20 buyers of one token that uses the ticker SPY, counted apart.

How each incoming Stock Token came, from its transaction: purchase 263, rotation 0, liquidity 2872, swapped unpaid 0, received 283, out 718. Only a purchase (an official swap the wallet itself paid USDG, WETH or ETH for, with no liquidity operation and no other Stock Token given) can open a position, in either book.

**What the two policies did with the same 4200 moves.**

| | copy-guard | Ticker copy |
|---|---|---|
| Practice positions opened | 54 (FULL 0, REDUCED 54) | 230 |
| Of them in a token the issuer did not list | 0 | 20 (1 token) |
| Moves declined, each with a reason | 4146 | none: it has no rule |
| What a position rests on | a purchase the wallet signed and paid for, on an official venue, priced by a Chainlink feed | a ticker arriving in the wallet |

Different tokens under a listed ticker were part of 64 moves, in 34 tokens (SPY at `0x69e7…6219`: 20; USDG "Global Dollar" at `0x2ce3…77af`: 3; USDG "Global Dollar" at `0x0ef3…09c0`: 2; USDG "Global Dollar" at `0x36f4…4be2`: 2; USDG "global dollar" at `0x42b4…53c2`: 2; USDG "Global Dollar" at `0x42e1…f160`: 2; USDG "United States Global Dollar" at `0x5411…56a2`: 2; NVDA "NVIDIA Robinhood Coin" at `0x5dd7…3539`: 2; USDG "Global Dollar" at `0xa913…85c0`: 2; USDG "Global Dolar " at `0xc641…ad13`: 2; USDG "Global Dollar" at `0xd6b8…a7e5`: 2; USDG "United States Global Dollar" at `0x0c95…b1f7`: 1; USDG "United States Global Dollar" at `0x1dc8…9eb3`: 1; USDG "US Global Dollar" at `0x1ee1…1458`: 1; USDG "U⟨U+17B5⟩S⟨U+17B5⟩DG" at `0x22b1…d8d7`: 1; USDG "Global Dollar United Only" at `0x2504…150c`: 1; USDG "U⟨U+17B5⟩S⟨U+17B5⟩DG" at `0x318f…b1a3`: 1; USDG "U⟨U+17B5⟩S⟨U+17B5⟩DG" at `0x38eb…1885`: 1; USDG "U⟨U+17B5⟩S⟨U+17B5⟩DG" at `0x4190…a416`: 1; USDG "Global Dollar" at `0x4ff7…b792`: 1; USDG "Global Dollar" at `0x6236…86e0`: 1; USDG "Global Dollar" at `0x65ab…c0d5`: 1; USDG "Global Dollar " at `0x67f4…b8b2`: 1; USDG "UStates of Dollars Globals" at `0x7116…78f1`: 1; NVDA "NVIDIA Robinhood Coin" at `0x72ea…9d37`: 1; USDG "Global Dollar" at `0x73ac…c183`: 1; USDG "U⟨U+17B5⟩S⟨U+17B5⟩DG" at `0x8372…c3bc`: 1; USDG "Global Dollar" at `0x9909…0a3e`: 1; USDG "U⟨U+17B5⟩S⟨U+17B5⟩DG" at `0xc4f8…b4a3`: 1; USDG "U⟨U+206F⟩S⟨U+206F⟩DG" at `0xcb07…92e0`: 1; USDG "United Stables Digital Gold" at `0xd9c6…2cf0`: 1; USDG "Globals Dollars" at `0xdb81…66ef`: 1; USDG "U⟨U+206F⟩S⟨U+206F⟩DG" at `0xe739…f288`: 1; USDG "United States Global Dollars Gold" at `0xec90…4a3e`: 1). How they came, from the transactions: 36 sent to the wallet by someone else, 20 bought by the wallet itself, 0 received in a transaction it signed without paying, 8 logged as sent by the wallet. copy-guard named each one by address and opened nothing. This is a record that a ticker is not unique on this chain. It does not call anyone's token a fraud.

Per group of wallets:

| Group | Wallets | Decisions | copy-guard opened | Ticker copy opened | of them in a token the issuer did not list |
|---|---|---|---|---|---|
| Largest buyers | 19 | 3897 | 18 | 107 | 0 |
| Watched wallet | 1 | 93 | 0 | 47 | 0 |
| Bought the SPY-ticker token (chosen for it) | 20 | 210 | 36 | 76 | 20 |

The purchases copy-guard followed were the wallets' own: 54 purchases, median 0.45 USD, from 0.21 to 446442.61 USD, 1255468.54 USD in all.

**Money, second.** This is practice money on past moves. It is not a forecast and not a result anyone had. Size alone can make two books differ, so the second table puts every position of both books at one size.

| As each policy sizes | copy-guard | Ticker copy |
|---|---|---|
| Practice money put in | 1350.00 USD | 21000.00 USD in Stock Tokens, 2000.00 USD in other tokens |
| Closed / still open at the mark | 53 / 1 | 204 / 26 |
| Result in Stock Tokens, at the Chainlink feed | 6.04 USD | 121.77 USD |
| Result in other tokens | none opened | 20 valued at a pool: -1842.54 USD. 0 not measured, in no sum |

| Every position at 25.00 USD | Positions | Result |
|---|---|---|
| Opened by both policies | 54 | 6.04 USD for each policy: the same positions, so the same result |
| Stock Token positions only the ticker copy opened | 156 | 24.43 USD |
| Positions in other tokens, only the ticker copy | 20 | 20 valued at a pool: -460.61 USD. 0 not measured, in no sum |

A position in a token without a Chainlink feed is valued only where the wallet bought it in a Uniswap v4 pool: the pool's price in that swap against the pool's last swap before the mark, both public logs. That value is in the pool's other asset, and it does not say a position of that size could have been sold. Nothing is assumed to be worth zero.

No position, by leading reason: a liquidity operation, not a purchase (2216), a sale or a transfer out, not a purchase (716), a moved token the agent cannot name (659), sent to the wallet, not bought by it (282), wallet not in profit (121), no Chainlink price at the block (53), not USDG, a different token with the same ticker (41), daily limit reached (21), not the Stock Token SPY, a different token with the same ticker (20), position limit reached (14), not the Stock Token NVDA, a different token with the same ticker (3).

The Merkle root of all 4200 decisions is `0x08050cbff7c889dd21d0864ce242a479040035d892275e919f684b0a6cfb4040`. It is in one `LedgerAnchored` event on Robinhood Testnet: [`0x109ada37…e201d0`](https://explorer.testnet.chain.robinhood.com/tx/0x109ada373e1c23c912dfea0d7ba3a47725e469b22f5fad4be9bdb3b68ce201d0?tab=logs).

**This walk used the SAMPLE mandate.** Its principal is a testnet-only key that stands in for the real principal `0x973c…6227`, whose signature on `mandate/mandate.json` is still to come. After that signature the walk is run again.
<!-- LEDGER:END -->

The wallets are in [`docs/walk/wallets.json`](docs/walk/wallets.json): the demo wallet, the only one vet402 has anchored a record for, and 28 plain accounts from the first pass of the search described below, each with at most 31 moves in its record. Six busier accounts from that pass were left out to keep the recheck short.

Each decision is one line of [`docs/walk/trails.jsonl`](docs/walk/trails.jsonl): everything the rules read, every rule row, the size, the practice position with its exit, and a card. [`docs/ledger.json`](docs/ledger.json) holds the rows, both books and the totals. [`docs/index.html`](docs/index.html) carries the same ledger and builds its cards and tables from it. `verify.mjs` rebuilds all three from the trails and the saved feed values.

A card reads like this. Every sentence is a fixed template filled with values from the trail.

> **No position: fake NVDA**
> *What happened.* 0x3433…abd0 sent this wallet 25 tokens that a block explorer lists as NVDA, under the name "NVIDIA Robinhood Coin". The wallet did not sign the transaction (0x3433…abd0 did). It did not buy them.
> *What a blind bot sees.* A bot that trusts tickers sees this wallet receive 25 NVDA.
> *Why.* The token is not NVDA. It is a look-alike at 0x5dd7…3539 that copies the ticker. The real NVDA is the token at 0xd060…9eec.
> *So.* So copy-guard opened no position. No real trade was placed.

## The rules (`agent/rules-v2.ts`, copy-guard v2)

One decision ends in a size. A failed row either makes the size none, or, for three rows about the wallet's record, does what the user's limits say.

| Row | Rule | When it fails |
|---|---|---|
| A1 | the x402 terms are the published ones: `exact`, `eip155:4663`, USDG, at most 0.01, paid to the vet402 wallet | NONE |
| A2 | `X-Facts-Hash` sent with the record equals the hash recomputed from its body | NONE |
| A3 | the record is about the watched wallet on chain 4663 | NONE |
| A4 | the CRE workflow re-verified the wallet's newest vet402 anchor: MATCH | no anchor yet: the user's choice, default REDUCED. A mismatch: NONE |
| A5 | the record replays to its own balances | NONE |
| A6 | every look-alike token is left out of the figures and none waits for review | NONE |
| B1 | the record was built at or after the move's block | NONE |
| B2 | the record says what every moved token is | NONE |
| C1 | no moved token is a look-alike the record names as fake | NONE |
| C2 | the move moves a Robinhood Stock Token | NONE |
| C3 | the wallet's history is complete | the user's choice, default REDUCED |
| C4 | the wallet has a realized profit | result unknown: default REDUCED. A loss: default NONE |
| M1 | a mandate signed by the principal covers the decision: signer, practice only, these rules, these limits, this payment key, these dates | NONE |
| V1 | the Stock Token came from an official venue: the Uniswap v4 PoolManager or a pool of the official Uniswap v3 factory | NONE |
| D1 | the wallet itself bought: it received the token in a transaction it signed | NONE. A sale closes a practice position copied from that wallet |
| P1 | a Chainlink feed gives the token's price at the block of the move, no older than the user allows | NONE |
| L1 | the user's daily limit leaves room | NONE |
| L2 | fewer practice positions are open than the user allows | NONE |

FULL means every row passed. REDUCED means the token, the venue, the buyer and the price hold and only graded rows failed. Rows A1 to C4 are the rules of v1, word for word. `agent/rules.ts` is not edited, so the three trails of the paid run still name its hash. v1's C5 (a price from the record) is replaced by P1 (a price from the feed).

### The user's limits (`limits.json`)

The person the agent acts for writes this file. The agent names it by hash in every decision, and the mandate names the same hash.

| Setting | Default | Meaning |
|---|---|---|
| `practice_only` | `true` | this build has no code path that trades |
| `size.full_usd` / `size.reduced_usd` | 100.00 / 25.00 | the two sizes of a practice position |
| `size.max_usd_per_day` | 300.00 | all positions opened on one UTC day |
| `size.max_open_positions` | 10 | open at once |
| `evidence.record_not_anchored` | `reduced` | vet402 has not anchored the wallet's record |
| `evidence.history_partial` | `reduced` | the wallet's history is only partly rebuilt |
| `evidence.wallet_result_unknown` | `reduced` | the record gives no realized result |
| `evidence.wallet_at_a_loss` | `none` | the wallet's closed trades add up to a loss |
| `evidence.max_price_age_hours` | 96 | the oldest feed value used as an entry |
| `exit.when_wallet_sells` | `true` | leave when the copied wallet sells or sends the token |
| `exit.stop_loss_pct` / `exit.take_profit_pct` | 10 / 20 | leave when the feed crosses either |
| `exit.max_holding_days` | 30 | leave after this long whatever the price |
| `payments.max_usdg_per_decision` / `max_usdg_total` | 0.01 / 1.00 | what the agent may pay for evidence. The code never goes above 1 USDG |

Each grade is `reduced` or `none`. Setting all four to `none` gives the cautious policy of v1.

One sentence, two values. A person who says "put at most $50 on one stock and stop the loss at 15%" changes two lines of this file:

```json
"size": { "full_usd": "50.00", … },
"exit": { "stop_loss_pct": "15", … }
```

The file is edited by hand, and there is no parser for the sentence. Every later decision names the new file by hash, and the mandate has to be signed again, because new limits need the principal's consent.

## Who the agent acts for

The three headings below are the words the Blockchain Legal Institute uses for its planned [AI Agent Registration Tool](https://bli.tools/legal-compliance-tech-tools/).

| BLI's words | What this repo keeps for it | Where |
|---|---|---|
| **Programmatic provenance** | every decision names the rules by the hash of two source files, the record by its hash, the move by its transaction and the feed value by the transaction that published it | `docs/walk/trails.jsonl`, the `LedgerAnchored` event |
| **Human principal attribution** | a mandate names the principal `0x973c…6227` and the agent's payment key `0xc380…ED94`. The principal signs one readable line that carries the mandate's hash. Rule M1 opens nothing unless the signature recovers to the principal | `mandate/mandate.json`, `mandate/mandate.sig`, row M1 of every decision |
| **Cryptographically verifiable operational boundaries** | the limits are named by hash in the mandate and in every decision. The payment key can pay one address, and the signed Permit2 message pins the recipient | `limits.json`, `agent/x402.ts`, rows L1 and L2 |

Two questions asked on BLI's own stage, and what the mandate answers.

| Asked | By | The mandate's answer |
|---|---|---|
| "Did I authorize this? What was the scope of that authorization?" | Carole House, BLI Bootcamp (video published 2026-08-02) | Authorized: the principal's signature over the mandate's hash is inside every decision, and anyone can recover the signer. Scope: practice trades only, these rules, these limits, this payment key, one payee, these dates |
| "at what point did it exceed its authority?", and charges that "accumulate unnoticed" | James R. Holbein and Justin Holbein, [BLI article on x402, 2025-12-14](https://bli.tools/usa-beyond-activating-http-402-the-x402-protocol/) | Rule M1 and rows L1 and L2 mark the exact decision at which a boundary would be crossed, and that decision opens nothing. Payments are capped at 0.01 USDG per decision and 1 USDG in total, and each one is written to a ledger before it is sent |

Could this be done without a chain? The rules and the cards could. What a chain adds is one thing: a third party can check, without trusting me, that the records were not changed afterwards.

A 2025 judge of this hackathon, Bourn Collier, has described a framework for "tethering AI agents to accountable legal entities" (DARA announcement, 2026-06-23). The mandate is one small, checkable form of that link. [`mandate/README.md`](mandate/README.md) has the one command the principal signs with.

## Chainlink: a compliance check before the agent acts

CRE is the layer the agent's decision passes through. The x402 payment is one part of it.

| Example in the bounty text | What this repo does | Evidence |
|---|---|---|
| "AI agents consuming CRE workflows with x402 payments" | A gate answers 402 in front of the workflow `rwa-verify`, takes 0.01 USDG on Robinhood Chain and then runs the workflow. `SKILL.md` and `agent.json` let an agent find it and learn the terms | `agent/gate/`, `docs/agent/gate-dry-run/`. So far a dry run: the agent read the 402 and built the payment without signing. The one settled payment (2026-10-08) bought the record the workflow verifies |
| "Tokenized asset servicing and lifecycle management" | The workflow `token-check` reads each Stock Token's share multiplier, which changes with a corporate action, straight from Robinhood Chain | `token-check/`, `docs/token-check/` |
| "Automated risk monitoring" | `token-check` tells a real Stock Token from a look-alike by the issuer's own marks on chain: the code hash, the beacon and the official list. It does not ask vet402. `rwa-verify` checks a record against its anchor, and `trail-anchor` refuses a decision the rules do not give | `token-check/`, `rwa-verify/`, `trail-anchor/` |
| "Real-time reserve health checks" | Not attempted | |

The bounty asks for a CRE workflow used as an orchestration layer, one blockchain integrated with an external API or an agent, and a successful simulation with the CRE CLI. All workflows here run under `cre workflow simulate` (CLI v1.37.0). Robinhood Chain mainnet is not on CRE's supported network list, so the workflows read it over the HTTP capability and write to Robinhood Testnet over the EVM capability.

Two limits, stated plainly. Nothing is deployed to a DON. A simulated write goes through CRE's simulation forwarder, which accepts reports from anyone, so a testnet event fixes a hash and a time and is not a DON attestation. That is why the recheck exists.

What this gives the people Chainlink's own video for this hackathon speaks to: an automated compliance check that runs before an agent acts, and visibility into what it checked. A person can read the result on one page.

## RYO-CHAN: anti-rug for stock tokens

RYO-CHAN protects investors with an anti-rug scanner. copy-guard does the same job one step earlier and for a different asset: it names a look-alike of a stock token before anything copies it, in words a person can read.

The page is written for a person who is not a developer. It opens with three steps (it saw, it checked, it did). Each card starts with a score, how many of the 18 checks passed, and a mark for each group of checks. A check that did not pass is listed as a red flag, and the card ends with a suggested action in everyday language.

| The bounty text | Here |
|---|---|
| "interpret market evidence" | a wallet's onchain move, its vet402 record, the venue and the Chainlink feed. This is the Whale Movement Tracker direction: from wallet activity to a verdict |
| "record the practice trades they would make" | the practice ledger above: every decision, the position it opened or did not open, with entry, size and exit |
| "show cause and effect" | every card: what happened, why, so what. Every decision: one row per rule with the value it read |
| "preserve a repeatable reasoning trail" | no language model. The same inputs and the same limits give the same trail, and `verify.mjs` repeats it with separate code |
| "transparent signal rules and user-defined risk limits" | 18 rules in two files, and `limits.json` |
| "Explain selected and rejected candidates" | rejected moves stay in the ledger with their reasons |
| "entry, sizing, and exit as one decision" | one position object: the feed's value at the block, the size from the limits, the exit rule |
| Multi-KOL Narrative Agent (the spotlight) | Not attempted. There is no X, Discord or Telegram input |

## The questions regulators are asking, and what this keeps

I am not a lawyer and this is not legal advice. The table does not say what any rule requires or what a court would accept. It lists words that rule makers and regulators have used, next to the material this build leaves behind.

| Source | Their words | What this build keeps |
|---|---|---|
| [U.S. Federal Rule of Evidence 902(14)](https://www.law.cornell.edu/rules/fre/rule_902) | data copied from an electronic file, "authenticated by a process of digital identification" | every record and decision is named by a keccak256 hash that anyone can recompute. This is the kind of check the rule has in mind. The rule also asks for a qualified person's certification, which a script does not replace |
| [Rule 902(13)](https://www.law.cornell.edu/rules/fre/rule_902) | a record "generated by an electronic process or system that produces an accurate result" | fixed rules, no language model. Anyone can rerun them on the saved inputs and compare |
| [FINRA 2026 oversight report, GenAI](https://www.finra.org/rules-guidance/guidance/reports/2026-finra-annual-regulatory-oversight-report/gen-ai) | agent reasoning that is "difficult to trace or explain", and "how to track agent actions and decisions" | one row per rule with the value it read, a card in plain sentences, guardrails set by the user. FINRA's concern is agents that act without predefined rules. This agent's rules are predefined |
| [Letter from eight House members to the SEC, 2026-06-24](https://foster.house.gov/media/press-releases/foster-sherman-seek-regulatory-clarity-agentic-ai-trading) | the "legal responsibilities of broker-dealers, AI developers, and AI agents themselves" | an open question, which this build does not answer. It keeps what an answer will need: who the agent acted for, under which limits, on what evidence |
| [SEC staff statement on tokenized securities, 2026-01-28](https://www.sec.gov/newsroom/speeches-statements/corp-fin-statement-tokenized-securities-012826) | a third party's token "may or may not confer" rights in the underlying security | even a real token's rights depend on its structure. A look-alike confers nothing, and the agent names it by address |
| [Robinhood's description of Stock Tokens](https://docs.robinhood.com/chain/stock-tokens/) | no "legal or beneficial rights" in the underlying security | the page identifies each token by its ticker. A ticker is not unique on a permissionless chain. The agent identifies tokens by contract address |
| [BLI, Legal Compliance Tech Tools](https://bli.tools/legal-compliance-tech-tools/) | "evidentiary standards", "audit readiness", "tamper-evident" | an auditor can recheck every number here from public data with one command and no account |

## The search for a wallet that passes every rule

No real move reached FULL. FULL needs a record vet402 has anchored, and `RwaAnchor` holds anchors for one wallet, the demo wallet, whose closed trades are at a loss. I looked for another wallet with a complete history and a realized profit that still holds a priced Stock Token (`scripts/find-copy-candidate.ts`, output in `docs/agent/copy-search/`, 2026-10-14):

| Pass | Searched | Result |
|---|---|---|
| 1 | the 12 quietest of the 33 Stock Tokens with a Chainlink feed, 3,000,000 blocks: 1,926 wallets seen, 101 with a buy, a sell and a balance, 40 records read from vet402's free route | 0 complete histories. 34 records came back, all partial. In 27 of them every event was parsed, and the one I opened was partial because some lots had no known cost |
| 2 | the 22 quietest, 3,000,000 blocks: 13,730 wallets seen, 217 plain accounts trading only through official pools | 6 paid and were paid in USDG in every move. 0 of them sold above cost with a balance left. No record read |
| 3 | every feed token that could be scanned (the busiest ones exceed the RPC's log limit), 500,000 blocks: 10,944 wallets seen, 144 plain accounts on official pools | 13 traded in USDG only. 0 fit. No record read |

So the ledger's positions are REDUCED ones, on wallets whose records are partial and not anchored, and the README says so wherever it matters. Anchoring another wallet's record needs vet402's operator key and is not part of this build.

## How it fits together

[`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) has the diagram: who pays whom, where each check happens, and what stays on which chain. [`docs/FIRST-RUN.md`](docs/FIRST-RUN.md) is the detailed record of the first build: the `rwa-verify` workflow, its simulation logs, the paid run of 2026-10-08 and the dry run before it.

| Path | What |
|---|---|
| `verify.mjs` | the recheck. One file, no dependency, no code shared with the agent |
| `docs/index.html` | the ledger as one static page. `scripts/build-page.mjs` builds it |
| `limits.json`, `mandate/` | the user's limits and the mandate the principal signs |
| `agent/rules.ts`, `agent/rules-v2.ts` | the rules. v1 is frozen, v2 adds the mandate, the venue, the buyer, the feed price and the limits |
| `agent/card.ts`, `agent/ledger.ts`, `agent/walk.ts` | the decision card, the two practice books and the walk |
| `agent/main.ts`, `agent/pay.ts`, `agent/x402.ts` | the live agent and its paying path: dry run by default, a 1 USDG cap, a ledger and a lock |
| `agent/gate/` | the x402 gate in front of `rwa-verify`, and the agent's client for it |
| `SKILL.md`, `agent.json` | how another agent finds the gate and learns its terms |
| `rwa-verify/` | CRE workflow: a vet402 record against its anchor on Robinhood Chain |
| `token-check/` | CRE workflow: real Stock Token or look-alike, and the share multiplier, read from the chain |
| `trail-anchor/` | CRE workflow: reruns the rules of one decision, or recomputes the Merkle root of a walk, and writes the hash |
| `contracts/` | the three receivers on Robinhood Testnet. No owner, no storage, no upgrade path |
| `docs/walk/` | the walk: records as read, feed values, one trail per decision, the anchor |
| `docs/agent/first-paid-run/` | the paid run of 2026-10-08: the record, the 402 exchange and settlement, three v1 trails |
| `docs/agent/gate-dry-run/` | the 402 exchange with the gate and the payment the agent built and did not sign |
| `docs/agent/copy-search/` | the three search passes above |

## The paid run (2026-10-08, 22:24 UTC)

The agent replayed three real moves of the demo wallet with `--pay` under the v1 rules. It paid 0.01 USDG in [`0x65c314bd…87af61`](https://robinhoodchain.blockscout.com/tx/0x65c314bd758a59dfc79c78d8da76e557450fa1144726ddc4bfc77e183287af61), the CRE workflow wrote MATCH in [`0xc90411c0…4b6cbb`](https://explorer.testnet.chain.robinhood.com/tx/0xc90411c03d66f5c5aa4f2bde8eba68d135822ac5fceffca76b205b08914b6cbb), and each decision's hash is in a `DecisionRecorded` event of [`ReasoningTrailReceiver` `0x9913…a0B3`](https://explorer.testnet.chain.robinhood.com/address/0x991311C2ECA78B83dA3593C7500804af6FEEa0B3?tab=logs).

| Move | What a naive bot sees | v1 conclusion | Trail on Robinhood Testnet |
|---|---|---|---|
| [`0x0eac7685…13f8`](https://robinhoodchain.blockscout.com/tx/0x0eac7685c6c57c3929d053bea9b5fa4b9879e2afc798848ee2b8ccf0e56a13f8) | a QQQ buy for 5,000 USDG | DO_NOT_COPY: partial track record, realized loss | [`0x02239201…778e92`](https://explorer.testnet.chain.robinhood.com/tx/0x022392017a8803f9a19c0ef0fba3ac495437584cb3d31f0372b0363ffb778e92) |
| [`0x1b838f40…b51b`](https://robinhoodchain.blockscout.com/tx/0x1b838f40a43d54b7ce3364f08f723516170be2d03fdbcd6ab801c79f7f77b51b) | 25 NVDA received | DO_NOT_COPY: the token is a fake imitating NVDA | [`0x36dead3c…7fca7b`](https://explorer.testnet.chain.robinhood.com/tx/0x36dead3cf93da183f8b25b5b8f87c6fb36083e52ff11c61a23eda9c8d37fca7b) |
| [`0xf7cb51a2…8717`](https://robinhoodchain.blockscout.com/tx/0xf7cb51a25f62bfbe63760404055b36d380eed0d47c68f99cdccaa17e9c478717) | 20,000 USDG sent | DO_NOT_COPY: the token is a fake imitating USDG | [`0xfd3df929…563199`](https://explorer.testnet.chain.robinhood.com/tx/0xfd3df9297c75c65df6651251485c355b31d44ae692db652ced3c1e68c9563199) |

These trails and events are unchanged. The same three moves are in the v2 ledger too, decided again under the v2 rules.

## Paying, and the cap

- The default is a dry run. Only `--pay` signs a payment. `--approve` (only with `--pay`) sends `approve(Permit2, …)` once, which is the one step that needs a little ETH on Robinhood Chain.
- `MAX_SPEND_ATOMIC` in `agent/x402.ts` is fixed at 1 USDG. `limits.json` can lower the cap and cannot raise it. One decision may cost at most `payments.max_usdg_per_decision`.
- The paying path (`agent/pay.ts`) runs under an exclusive lock file, so two runs cannot both pass the cap. Every payment is written to a ledger at a fixed path before it is sent. A payment whose outcome is unknown counts as spent.
- The chain is a floor under the ledger: spent is the larger of the ledger and what Robinhood Chain shows. If the ledger is gone while the chain shows spending, the agent stops.
- The agent refuses terms above 0.01 USDG, another payee, another chain, another token or another transfer method before anything is signed. A signature is valid for at most 120 seconds.
- `--gate URL` pays the gate in front of the CRE workflow through the same functions and the same guards. The gate checks the signature, asks the facilitator to verify, runs the workflow and settles only after the workflow has answered.
- The payment wallet is `0xc380D9F41D90765A4820429B9Da151889E8bED94`. Its key lives outside this repo.

## What I learned using CRE

Notes for the CRE team, each with what I did, what I expected, what happened and what I did about it. CLI v1.37.0, TypeScript SDK, macOS.

| # | Steps | Expected | Actual | Workaround |
|---|---|---|---|---|
| 1 | `cre workflow simulate rwa-verify … --http-payload @rwa-verify/payloads/match.json` | the file is read, as with `curl -d @file` | `failed to parse HTTP trigger payload: invalid JSON input: @rwa-verify/payloads/match.json` (2026-10-14) | pass the path without `@`. A hint in the error would help |
| 2 | a payload schema with `z.string().url()` and a valid `https://raw.githubusercontent.com/…` URL | accepted, as under Bun | rejected inside `cre workflow simulate` (2026-10-09). The same schema passes in `bun test` | a plain pattern, `rwa-verify/workflow.ts` L74 to L79 |
| 3 | read the start of any line of a simulate log | UTC, since the time ends in `Z` | the machine's local clock with a `Z`. My logs read 8 hours ahead on a UTC+8 clock and 7 hours ahead on a UTC+7 clock | I state it next to the saved logs and use block times |
| 4 | `getNetwork` for Robinhood Chain mainnet (4663) | an EVM read, since Robinhood Testnet is supported | mainnet is not on the supported list | JSON-RPC over the HTTP capability with `consensusIdenticalAggregation`. A full receipt can be large, so the workflows ask `eth_getLogs` by topic instead |
| 5 | `evm.writeReport` in a simulation without `--broadcast`, to a receiver address with no code (`0x…dEaD`) | a result that says nothing was sent | `TxStatus.SUCCESS` with an all-zero tx hash (`docs/simulate-match.txt`) | `agent/cre.ts` treats a zero hash as "not written". A distinct status for a dry run would be clearer |
| 6 | `cre workflow simulate` on a fresh machine | a local run with no account | it asks for `cre login` first | log in once. Worth a line in the README of the templates, since judges reproduce on fresh machines |
| 7 | several JSON-RPC calls in one node-mode function against a public RPC | all answered | HTTP 429 from the RPC when the calls follow each other at once | space the calls with the runtime's host `sleep`, `token-check/workflow.ts` L98 |

What worked well: the HTTP trigger plus `--http-payload` made each workflow a function I could call from the agent, from a gate and from a shell script with the same payload. Running the same TypeScript in `bun test` and in the WASM runtime let the workflows share the rule code with the agent.

## Who would use it, and how it continues

- **A person who lets an agent act for them** reads the page: what the agent saw, what it checked, what it did, in sentences, with the limits they set.
- **A lawyer, an auditor or a compliance officer** asked what an agent relied on runs one command and gets every hash, rule and number rechecked from public data.
- **A developer of a copy-trading or portfolio agent** calls the gate, or `token-check`, before acting on a stock-token move.

I build this alone. copy-guard sits on vet402 /rwa, a product that already runs: it rebuilds a wallet's Stock Token record from public chain data and anchors it. The paid route copy-guard buys from is that product's own. I intend to keep the walk running after the event and to sign the mandate with the operator's wallet before the submission is final.

## What it does not claim

- Practice (paper) trades only. No real trade was placed. Nothing here says that copying any wallet makes money, and the two columns of the ledger are a comparison of two policies on past moves. It is not a forecast and not advice.
- The walk is a replay. Each wallet's record was read once, after the moves, so the rules judge a wallet with what is known now.
- Feed values arrive a few times a day. An entry price can be hours older than the move, within the age limit the user set.
- The blind copy is a baseline I defined, stated in the ledger. A real bot may be less naive.
- The one payment so far is my own test. I own the agent's wallet and the wallet that was paid. The gate has not been paid.
- No real move reached FULL, for the reason given above.
- The rules are a policy. Anyone can read, rerun or disagree with every row.
- All testnet receivers trust CRE's simulation forwarder, as described above.
- vet402 reports what public chain data shows. It gives no legal or investment advice and is not affiliated with Robinhood, Chainlink or any token issuer.

## Run it

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
