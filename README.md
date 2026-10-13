# vet402 copy-guard: an agent that pays for evidence before it acts, and a record anyone can recheck

A fake "NVDA" token sent to a wallet looks like a real stock purchase to anyone who copies that wallet. People lose money to a look-alike they had no way to tell apart, which makes fake tickers a consumer-harm problem before they are a technical one.

In this repo an AI agent pays 0.01 USDG over x402 for a wallet's vet402 /rwa record, has a Chainlink CRE workflow re-verify that record against its onchain anchor, and then declines to copy any move that involves a fake. It writes down every rule it applied and has a second CRE workflow put the hash of that reasoning trail onchain.

Nobody has to take my word, the agent's or a server's for any of it. One command, with no key, no account and nothing to install, rechecks the payment, the record and all three decisions against two public chains.

## Verify it yourself in 60 seconds

Step 1 needs Node 20 or newer and a copy of this repo. Steps 2 to 4 need only a browser.

**1. Run the recheck** from the root of the repo.

```bash
node verify.mjs
```

It recomputes every hash from the files in this repo with its own code, reruns the agent's 13 rules, and compares the results with what Robinhood Chain and Robinhood Testnet hold. It takes about four seconds. This is the output on 2026-10-14:

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

26 OK, 0 FAIL, 0 not checked
RESULT: MATCH
```

The exit code is 0 for MATCH and 1 for MISMATCH. A public RPC that is busy is asked again up to five times, 0.5 to 8 seconds apart, and the line then ends with a note such as `(after 2 retries)`. When no RPC answers even then, the line starts with `----`, the last line reads `RESULT: NOT CHECKED` and the exit code is 3. An outage is never reported as a pass, and never as a failure.

To see it fail, change one digit of the record the agent bought and run it again. The third line puts the file back.

```bash
sed -i.bak 's/"realized_usd": "-170.59"/"realized_usd": "-170.58"/' docs/agent/first-paid-run/record.json
node verify.mjs | grep -v '  OK'
mv docs/agent/first-paid-run/record.json.bak docs/agent/first-paid-run/record.json
```

```
vet402 copy-guard: recheck with no key, no account and no install
  chains  Robinhood Chain 4663 at rpc.mainnet.chain.robinhood.com, Robinhood Testnet 46630 at rpc.testnet.chain.robinhood.com
1. The record the agent bought
  FAIL  record hash     docs/agent/first-paid-run/record.json hashes to 0x09c7b0888a0c3d94483859326c955a234c3337392224909f5120f523c23fa240, but the X-Facts-Hash the trails name is 0x13271095a747ef27d05c86a5d781a6961b4a35e7fd365708b24612f7b40d6adc
2. The record vet402 anchored, against RwaAnchor on Robinhood Chain
3. The x402 payment
4. The three decisions
  trail-68837431-0eac7685.json: the wallet's move in block 68837431
  FAIL  record fields   the trail's record fields differ from docs/agent/first-paid-run/record.json (it hashes to 0x09c7b0888a0c3d94483859326c955a234c3337392224909f5120f523c23fa240)
  trail-73953009-1b838f40.json: the wallet's move in block 73953009
  FAIL  record fields   the trail's record fields differ from docs/agent/first-paid-run/record.json (it hashes to 0x09c7b0888a0c3d94483859326c955a234c3337392224909f5120f523c23fa240)
  trail-81262132-f7cb51a2.json: the wallet's move in block 81262132
  FAIL  record fields   the trail's record fields differ from docs/agent/first-paid-run/record.json (it hashes to 0x09c7b0888a0c3d94483859326c955a234c3337392224909f5120f523c23fa240)

22 OK, 4 FAIL, 0 not checked
RESULT: MISMATCH
```

`node verify.mjs 73953009` rechecks one decision, named by the block of the wallet's move. `node verify.mjs path/to/trail.json` rechecks any trail file.

**2. Open the contract that received the decisions** (Robinhood Testnet).

https://explorer.testnet.chain.robinhood.com/address/0x991311C2ECA78B83dA3593C7500804af6FEEa0B3?tab=logs

Look at the Logs tab. The three newest `DecisionRecorded` events carry the trail hashes that step 1 printed: `0x527e16e2…cc1801`, `0x925ab3b6…38e8aa` and `0x26fa5a0f…67b420`. Each has `conclusion` 1, which means DO_NOT_COPY, and `paymentTx` `0x65c314bd…87af61`. The Contract tab shows the verified source of `ReasoningTrailReceiver`: no owner, no storage, no upgrade path.

**3. Open the payment** (Robinhood Chain).

https://robinhoodchain.blockscout.com/tx/0x65c314bd758a59dfc79c78d8da76e557450fa1144726ddc4bfc77e183287af61

Look at "Tokens transferred": 0.01 USDG from `0xc3…ED94`, the agent's wallet, to `0x97…6227`, vet402's wallet. The status is Success and the method is `settle` on `x402ExactPermit2Proxy`.

**4. Open the anchor** (Robinhood Chain).

https://robinhoodchain.blockscout.com/tx/0x15f9ed8ae5dd466c2f35021c9f1291e7a624abbb52c8ac26b54d47442f585c7f?tab=logs

Look at the one log, `Anchored`, emitted by `RwaAnchor`. Its `factsHash` is `0x9d0e83d968786570beebf0d322b36e0836dc81ebe896bd186304405ba8f721ee`, the value step 1 recomputed from `rwa-verify/fixtures/anchored-record.json`.

**What this run shows and what it leaves open.** I paid for it myself. The agent's wallet and the wallet that received the 0.01 USDG are both mine. The payment shows that the x402 path settles on Robinhood Chain and that every step leaves evidence a stranger can recheck. It does not show a customer. All three decisions are DO_NOT_COPY because the wallet I watched has an incomplete history and a realized loss, and two of the three moves involve a fake token. The COPY path is covered by the tests.

## How it fits together

The first half of this repo is a Chainlink CRE workflow that re-checks a vet402 /rwa record. The answer is MATCH or MISMATCH, with the reason.

1. [vet402 /rwa](https://vet402.com/rwa) rebuilds a Robinhood Chain wallet's Stock Token record from public chain data, names the fake look-alike tokens and anchors the record's hash onchain in `RwaAnchor` ([`0x1955…c22d`](https://robinhoodchain.blockscout.com/address/0x1955137e7773f2459eb75fb88842026c6517c22d)).
2. The CRE workflow takes a record, recomputes its hash the same way vet402's one-file checker [`verify-record.mjs`](https://github.com/kzmttkc/vet402/blob/main/packages/rwa/scripts/verify-record.mjs) does, and reads the anchor from Robinhood Chain over a public RPC.
3. It writes the verdict (MATCH or MISMATCH plus one bit per failed check) to a small receiver contract, so a lawyer, an auditor or an AI agent can point to it.

A changed character anywhere in the record gives MISMATCH. So does an anchor from another contract, another operator, another wallet or another date.

The second half is copy-guard, the agent that pays for a record, asks that workflow for its verdict and decides. It is described [below](#the-agent-copy-guard).

## Layout

| Path | What |
|---|---|
| `rwa-verify/workflow.ts` | The CRE workflow. HTTP trigger, three HTTP reads, report, EVM write |
| `rwa-verify/verify.ts` | The check itself. Pure functions, shared by the workflow, the tests and the local runner |
| `rwa-verify/fixtures/` | Real data saved on 2026-10-08: the anchored record, the anchor tx receipt, RwaAnchor's code, a live /rwa response |
| `rwa-verify/payloads/` | `match.json` (the anchored record) and `mismatch-one-char.json` (the same record, QQQ `realized_usd` `-170.59` changed to `-170.58`) |
| `contracts/src/RwaVerdictReceiver.sol` | Receives the report and emits `RecordChecked`. No owner, no storage, cannot receive ETH |
| `scripts/simulate.sh` | Runs `cre workflow simulate` for both payloads and saves the output in `docs/` |
| `scripts/local-check.ts` | The same steps with plain `fetch`, outside CRE |
| `verify.mjs` | The recheck above. One file, no dependency, no code shared with the agent |
| `agent/` | copy-guard, the agent that buys the record over x402 before it would copy a wallet (see below) |
| `trail-anchor/` | The second CRE workflow. It reruns the agent's rules on a trail and writes the trail's hash |
| `contracts/src/ReasoningTrailReceiver.sol` | Receives that report and emits `DecisionRecorded`. Same shape as `RwaVerdictReceiver` |
| `scripts/deploy-trail-receiver.sh` | Deploys and verifies `ReasoningTrailReceiver` on Robinhood Testnet |
| `docs/agent/first-paid-run/` | The paid run: the record the agent bought, the 402 exchange and settlement, three trails, the CRE logs |
| `docs/agent/replay-dry-run/` | The dry run before it: console output, the record it read, the trails, the CRE logs, the checker's output |
| `docs/verify/` | Saved output of `node verify.mjs` (one run, five runs back to back, one digit changed, offline, one block) and of the test suites |

## The workflow

```
HTTP trigger { tx?, recordUrl?, record?, operator? }
  1. GET  vet402.com/api/v1/rwa/facts/<wallet>   live record, X-Facts-Hash must equal the hash of the body
  2. GET  recordUrl, or take `record` from the payload   the record under test
  3. POST Robinhood Chain RPC (chain 4663)    eth_chainId, the anchor tx receipt, eth_getCode(RwaAnchor)
  4. compare                                  same rows as verify-record.mjs
  5. report + writeReport                     RwaVerdictReceiver on Robinhood Testnet
```

Robinhood Chain mainnet is not on CRE's supported network list, so the anchor is read with the HTTP capability and plain JSON-RPC. The verdict goes through CRE's EVM capability to Robinhood Testnet, which CRE supports. The default record is the anchored snapshot at a fixed commit of the vet402 repo, so the result does not change while the live site moves on. The live record is newer than that snapshot, and the workflow says so in its log.

The checks, each with its own bit in `reasons`:

| Check | Bit |
|---|---|
| RPC is Robinhood Chain 4663 | 2048 |
| anchor tx exists and succeeded | 1 |
| it has an `Anchored` log from RwaAnchor (a log from a look-alike contract is ignored) | 2 |
| RwaAnchor's code is the pinned build with no owner and no upgrade path | 4 |
| the anchor was written by the operator the record names | 8 |
| subject = keccak of the wallet | 16 |
| factsHash = hash recomputed from the record | 32 |
| methodVersion and asOf | 64, 128 |
| the record's own `facts_hash` field | 256 |
| the record names another anchor contract | 1024 |
| the record cannot be read, or its method_version is unknown | 512 |

## Run it

Tools: [CRE CLI](https://docs.chain.link/cre/getting-started/cli-installation) v1.37.0, Bun 1.4.2, Foundry.

```bash
cd rwa-verify && bun install && bun test && cd ..
cd contracts && forge install foundry-rs/forge-std --no-git && forge test && cd ..

# CRE simulation (needs `cre login` once, no key, nothing is broadcast)
./scripts/simulate.sh

# the same check without CRE
bun scripts/local-check.ts rwa-verify/payloads/match.json
bun scripts/local-check.ts rwa-verify/payloads/mismatch-one-char.json
```

`ROBINHOOD_TESTNET_RPC=https://rpc.testnet.chain.robinhood.com forge test` also runs a fork test that delivers the MATCH report through the real CRE `MockKeystoneForwarder` on Robinhood Testnet, locally.

## Output

`cre workflow simulate` on 2026-10-08 with CRE CLI v1.37.0. Full logs: [`docs/simulate-match.txt`](docs/simulate-match.txt) and [`docs/simulate-mismatch-one-char.txt`](docs/simulate-mismatch-one-char.txt).

The anchored record:

```
[USER LOG] live /rwa record: HTTP 200, as_of 2026-10-08T11:37:31.000Z, X-Facts-Hash matches the body
[USER LOG] OK    tx status          success in block 76177721
[USER LOG] OK    contract           Anchored log from 0x1955137e7773f2459eb75fb88842026c6517c22d (RwaAnchor)
[USER LOG] OK    contract code      runtime equals the build of RwaAnchor.sol: no owner, no upgrade path
[USER LOG] OK    anchoredBy         0x973cd8a91a771c2c04c6036888f8175d6b4f6227
[USER LOG] OK    factsHash          0x9d0e83d9…f721ee = recomputed 0x9d0e83d9…f721ee (material v2, binds the whole JSON)
[USER LOG] RESULT: MATCH. The JSON is the record that was anchored.
[USER LOG] verdict written to 0x000000000000000000000000000000000000dEaD on robinhood-testnet, tx 0x0000000000000000000000000000000000000000000000000000000000000000
✓ Workflow Simulation Result: "{\"verdict\":\"MATCH\",\"reasons\":[],\"reasonBits\":0, ...}"
```

The same record with one character changed:

```
[USER LOG] FAIL  factsHash          0x9d0e83d9…f721ee != recomputed 0x29175278…0e0d99 (material v2, binds the whole JSON)
[USER LOG] FAIL  record facts_hash  record says 0x9d0e83d9…f721ee
[USER LOG] RESULT: MISMATCH. record hash differs from the anchored factsHash; facts_hash written in the record differs from its own content.
✓ Workflow Simulation Result: "{\"verdict\":\"MISMATCH\", ... \"reasonBits\":288, ...}"
```

## Onchain on Robinhood Testnet

`scripts/deploy-and-broadcast.sh` deployed the receiver and ran the same two simulations with `--broadcast` on 2026-10-09. A testnet-only key paid the gas. It is kept outside this repo.

| | |
|---|---|
| RwaVerdictReceiver (verified source) | [`0x8bf4d455d38301e9d330B12144AdE02F16BC2Cb3`](https://explorer.testnet.chain.robinhood.com/address/0x8bf4d455d38301e9d330b12144ade02f16bc2cb3) |
| deploy tx | [`0xa471575b…32766e`](https://explorer.testnet.chain.robinhood.com/tx/0xa471575bfc69881c5e39f9157dda453a0b32933de05f6135429a64211132766e) |
| MATCH verdict | [`0x34ca26b3…b8662d`](https://explorer.testnet.chain.robinhood.com/tx/0x34ca26b37ca844ff857fc297c9c4f9404a7f28111abe5dfa65457b1066b8662d): `isMatch=true`, `reasons=0` |
| MISMATCH verdict | [`0x7c5fd354…ffebeb`](https://explorer.testnet.chain.robinhood.com/tx/0x7c5fd35427be3e1e2531d957f7fd2712adc1c591d6c3ec7937bfca8372ffebeb): `isMatch=false`, `reasons=288`, recomputed `0x29175278…0e0d99` against anchored `0x9d0e83d9…f721ee` |

Logs and decoded `RecordChecked` events: `docs/broadcast-*.txt` and `docs/broadcast-*.receipt.txt`. In both transactions the CRE forwarder's `ReportProcessed` says the delivery succeeded.

The receiver was deployed to trust CRE's simulation forwarder (`MockKeystoneForwarder` `0x0b93…3885`), because that is what `cre workflow simulate --broadcast` writes through. That forwarder is permissionless, and the simulator fills the workflow id, name and owner with fixed test values (`0x1111…`, `0xaaaa…`). A deployed workflow would use a receiver bound to the production `KeystoneForwarder` and filter on its own workflow owner.

`scripts/local-check.ts` prints the same rows without CRE (`docs/local-run-*.txt`).

## The agent: copy-guard

A copy-trading bot copies what a wallet appears to do. On Robinhood Chain a wallet "receives NVDA" whenever anyone sends it a fake NVDA, and a fake USDG log can name the wallet as the sender of a payment it never made. copy-guard is an agent that checks before it would copy, and writes down why, so a person can recheck the decision later without trusting the agent.

For each new move of a watched wallet it:

1. sees the move: every ERC-20 `Transfer` log that names the wallet, over Robinhood Chain's public RPC.
2. buys the wallet's vet402 /rwa record over x402: 0.01 USDG on Robinhood Chain (`exact`, Permit2, settled by the Dexter facilitator, which pays the settlement gas).
3. asks the CRE workflow above to re-verify the wallet's newest vet402 anchor. The verdict lands in `RwaVerdictReceiver`.
4. runs 13 fixed rules on what it read. No LLM, no clock, no randomness. The same inputs always give the same rows and the same conclusion.
5. records the conclusion as a paper trade. It never places a real trade.
6. hands the whole trail to the second CRE workflow, `trail-anchor`. That workflow runs the same rules again, checks the move (and the payment, when there was one) on Robinhood Chain, and refuses to write if anything differs. Then it writes the trail's keccak256 to `ReasoningTrailReceiver` on Robinhood Testnet.

The agent cannot get a conclusion recorded that its own rules do not give.

### The rules (`agent/rules.ts`, copy-guard v1)

| Group | Rule | A failure gives |
|---|---|---|
| A, can the record be trusted | A1 the x402 terms are the published ones: `exact`, `eip155:4663`, USDG, at most 0.01, paid to the vet402 anchor wallet | HOLD |
| | A2 `X-Facts-Hash` sent with the record equals the hash recomputed from its body | HOLD |
| | A3 the record is about the watched wallet on chain 4663 | HOLD |
| | A4 the CRE workflow says MATCH for the wallet's newest anchor | HOLD |
| | A5 the record replays to its own balances (`r1_status` is not `unverified`) | HOLD |
| | A6 every look-alike token is left out of the figures and none waits for review | HOLD |
| B, does the record cover the move | B1 the record was built at or after the move's block | HOLD |
| | B2 the record says what every moved token is: Stock Token, USDG or a named fake | HOLD |
| C, should the move be copied | C1 no moved token is a look-alike the record names as fake | DO_NOT_COPY |
| | C2 the move moves a Robinhood Stock Token | DO_NOT_COPY |
| | C3 the wallet's track record is complete (`r1_status` `reconstructed`) | DO_NOT_COPY |
| | C4 the wallet has a realized profit | DO_NOT_COPY |
| | C5 the moved Stock Token has a USD price, so a paper trade can be sized | DO_NOT_COPY |

HOLD means the evidence is not good enough to judge, so HOLD wins over DO_NOT_COPY. When every rule passes the conclusion is COPY: a paper trade of 100 USD at the record's price, on the same side as the wallet.

### The paid run (2026-10-08, 22:24 UTC)

The agent replayed three real moves of the demo wallet with `--pay`. Everything it saved is in `docs/agent/first-paid-run/`.

1. It read the 402 from `vet402.com/api/v1/rwa/paid/facts/<wallet>`: `exact`, `eip155:4663`, 0.01 USDG to `0x973c…6227`, Permit2. Its wallet held exactly 0.01 USDG and nothing had been spent under the 1 USDG cap (`x402-paid.json`).
2. It approved Permit2 once for 1 USDG, the cap minus what had been spent ([`0x0d6462f9…20e8e8`](https://robinhoodchain.blockscout.com/tx/0x0d6462f945437e2986c67e82271a4c3c41b3740c069686f7ec89937c8d20e8e8)), and signed one Permit2 witness transfer for 0.01 USDG. The Dexter facilitator settled it in 1.5 seconds in [`0x65c314bd…87af61`](https://robinhoodchain.blockscout.com/tx/0x65c314bd758a59dfc79c78d8da76e557450fa1144726ddc4bfc77e183287af61) and paid the gas.
3. The route answered 200 with the record (`record.json`, as of block 83662580) and `X-Facts-Hash` `0x13271095…0d6adc`.
4. The CRE workflow re-verified the wallet's newest anchor and wrote MATCH in [`0xc90411c0…4b6cbb`](https://explorer.testnet.chain.robinhood.com/tx/0xc90411c03d66f5c5aa4f2bde8eba68d135822ac5fceffca76b205b08914b6cbb).
5. The rules gave three decisions, and the second CRE workflow wrote each trail's hash:

| Move | What a naive bot sees | Conclusion | Failed rules | Trail hash | Trail on Robinhood Testnet |
|---|---|---|---|---|---|
| [`0x0eac7685…13f8`](https://robinhoodchain.blockscout.com/tx/0x0eac7685c6c57c3929d053bea9b5fa4b9879e2afc798848ee2b8ccf0e56a13f8) | a QQQ buy for 5,000 USDG | DO_NOT_COPY | C3 partial track record, C4 realized -273.01 | `0x26fa5a0f…67b420` | [`0x02239201…778e92`](https://explorer.testnet.chain.robinhood.com/tx/0x022392017a8803f9a19c0ef0fba3ac495437584cb3d31f0372b0363ffb778e92) |
| [`0x1b838f40…b51b`](https://robinhoodchain.blockscout.com/tx/0x1b838f40a43d54b7ce3364f08f723516170be2d03fdbcd6ab801c79f7f77b51b) | 25 NVDA received | DO_NOT_COPY | C1 the token is a fake imitating NVDA, then C2 to C5 | `0x925ab3b6…38e8aa` | [`0x36dead3c…7fca7b`](https://explorer.testnet.chain.robinhood.com/tx/0x36dead3cf93da183f8b25b5b8f87c6fb36083e52ff11c61a23eda9c8d37fca7b) |
| [`0xf7cb51a2…8717`](https://robinhoodchain.blockscout.com/tx/0xf7cb51a25f62bfbe63760404055b36d380eed0d47c68f99cdccaa17e9c478717) | 20,000 USDG sent | DO_NOT_COPY | C1 the token is a fake imitating USDG, then C2 to C5 | `0x527e16e2…cc1801` | [`0xfd3df929…563199`](https://explorer.testnet.chain.robinhood.com/tx/0xfd3df9297c75c65df6651251485c355b31d44ae692db652ced3c1e68c9563199) |

Each `DecisionRecorded` event names the payment tx, the move, the CRE verdict tx and the hash of the record, so the event alone ties the decision to what was paid for. `node verify.mjs` rechecks all of it.

### The dry run before it (2026-10-08, 22:00 UTC)

The payment wallet held nothing at that point, so the agent ran in its default dry run. It read the real 402, checked the terms and built the exact Permit2 message it would sign (digest in `x402-dry-run.json`). It signed nothing and sent nothing, and read the same JSON from the free route. Everything after that step is real: the CRE verdict and the three trails were written to Robinhood Testnet.

`bun agent/main.ts --blocks 68837431,73953009,81262132 --broadcast --out docs/agent/replay-dry-run` replays three real moves of the demo wallet:

| Move | What a naive bot sees | Conclusion | Failed rules | Trail on Robinhood Testnet |
|---|---|---|---|---|
| [`0x0eac7685…13f8`](https://robinhoodchain.blockscout.com/tx/0x0eac7685c6c57c3929d053bea9b5fa4b9879e2afc798848ee2b8ccf0e56a13f8) | a QQQ buy for 5,000 USDG | DO_NOT_COPY | C3 partial track record, C4 realized -273.01 | [`0x41823517…2a46e1`](https://explorer.testnet.chain.robinhood.com/tx/0x418235176be8d19d4619fd054a1e98d44d282b5facb0a40041e7cc2f1e2a46e1) |
| [`0x1b838f40…b51b`](https://robinhoodchain.blockscout.com/tx/0x1b838f40a43d54b7ce3364f08f723516170be2d03fdbcd6ab801c79f7f77b51b) | 25 NVDA received | DO_NOT_COPY | C1 the token is a fake imitating NVDA, then C2 to C5 | [`0xa4bc09a5…70452f`](https://explorer.testnet.chain.robinhood.com/tx/0xa4bc09a5f80028057f6a0934f015b5d8a6c6d058435edc11e0d61232c770452f) |
| [`0xf7cb51a2…8717`](https://robinhoodchain.blockscout.com/tx/0xf7cb51a25f62bfbe63760404055b36d380eed0d47c68f99cdccaa17e9c478717) | 20,000 USDG sent | DO_NOT_COPY | C1 the token is a fake imitating USDG, then C2 to C5 | [`0x339123b0…7e8cc5`](https://explorer.testnet.chain.robinhood.com/tx/0x339123b04782cc88216fb456ee253d148b173ec1472ea4c750047b40627e8cc5) |

All three passed every A and B rule. The CRE re-verification of the newest anchor (`0x15f9…5c7f`) said MATCH in [`0x6b85468c…d39e47`](https://explorer.testnet.chain.robinhood.com/tx/0x6b85468c2549ae1ff225c506b71c028711dcc4b594a420eb99d2680d84d39e47). The COPY path is covered by the tests: the same QQQ buy on a record with a complete, profitable history gives a paper buy of 0.133023 QQQ at 751.7499 USD.

The trail receiver is [`ReasoningTrailReceiver` `0x9913…a0B3`](https://explorer.testnet.chain.robinhood.com/address/0x991311c2eca78b83da3593c7500804af6feea0b3) (verified source, deploy tx [`0x87de029c…a0ed063`](https://explorer.testnet.chain.robinhood.com/tx/0x87de029cf74486bd00983484b84c738c6d1517826d60574e5d00ad9daa0ed063)).

### Recheck a decision without a key

`node verify.mjs <trail.json>` does this with no install and with code that shares nothing with the agent. `check-trail.ts` is the same recheck run with the agent's own modules, and the tests hold the two against each other.

```bash
cd agent && bun install && cd ..
bun agent/check-trail.ts docs/agent/replay-dry-run/trail-73953009-1b838f40.json \
  --record docs/agent/replay-dry-run/record.json --onchain
```

```
  OK    trail hash     0xe2e6c1657c1650ed2fc9b68a71ec02844883ca7b761410c437716d528647451b
  OK    rules          copy-guard v1 give DO_NOT_COPY (8/13 rows pass), same as the trail
  OK    record         saved record gives factsHash 0x0aaa3ffd…98ca28 and the same fields
  OK    movement       0x1b838f40…b51b on 4663: transfers as listed
  OK    payment        dry run, nothing was paid (the trail says so)
  OK    CRE verdict    0x6b85468c…d39e47 on 46630: RecordChecked MATCH for anchor 0x15f9…5c7f
  OK    trail onchain  0xa4bc09a5…70452f on 46630: DecisionRecorded 0xe2e6c165…47451b DO_NOT_COPY
RESULT: the trail holds. DO_NOT_COPY follows from its inputs.
```

It hashes the trail, reruns the rules on the trail's own inputs, rebuilds the record fields from the saved record and reads the four transactions over public RPCs. Change one character in the trail or in the record and it fails. The full output for all three trails is in `docs/agent/replay-dry-run/check-trail-output.txt`.

### Paying, and the cap

- The default is a dry run. Only `--pay` signs a payment. `--approve` (only with `--pay`) sends `approve(Permit2, 1 USDG)` once, which is the one step that needs a little ETH on Robinhood Chain.
- `MAX_SPEND_ATOMIC` in `agent/x402.ts` is fixed at 1 USDG. The paying path (`agent/pay.ts`) runs under an exclusive lock file, so two runs cannot both pass the cap. A lock left by a process that is gone, or older than ten minutes, is taken over by one run only. If two runs see the same stale lock, the second is refused.
- The paid request is given up on after 60 seconds. A payment whose answer never came is written to the ledger as unknown.
- Every payment is written to the ledger at a fixed path (`~/.vet402/bli-agent-spend.json`) before it is sent, by writing a temp file and renaming it. A payment whose outcome is unknown counts as spent.
- The chain is a floor under the ledger. Spent is the larger of the ledger and what Robinhood Chain shows: every USDG the payer has sent, and the last approval to Permit2 minus the current allowance. If the ledger is gone while the chain shows spending, the agent stops instead of starting again from zero.
- The approval is the cap minus what was already spent, so Permit2 itself cannot pull past 1 USDG. A signature is valid for at most 120 seconds, whatever the 402 asks for.
- The agent refuses terms above 0.01 USDG, another payee, another chain, another token or another transfer method before anything is signed.
- One purchase per run. Every move judged in that run reads the same bytes, and the trail names them by hash.
- The payment wallet is `0xc380D9F41D90765A4820429B9Da151889E8bED94`. Its key lives outside this repo.

### What it does not claim

- The one payment so far is my own test. I own the agent's wallet and the wallet that was paid.
- Paying does not change the verdict. The paid route returns the same JSON as the free one. The payment buys a higher rate limit and a settlement receipt that the trail can name.
- The record the agent buys is usually newer than the newest anchor. A4 shows that vet402's anchoring for this wallet is intact and uses the same hash. A2 binds the exact bytes the agent read. The trail's hash then fixes those bytes onchain.
- The rules are a policy, not advice. They encode one cautious way to decide, and anyone can read, rerun or disagree with every row.
- Both testnet receivers trust CRE's simulation forwarder, as described above.

### Run it

```bash
cd agent && bun install && bun test && cd ..
cd trail-anchor && bun install && bun test && cd ..
cd contracts && forge test && cd ..

# watch the demo wallet's newest blocks (dry run, CRE simulated, nothing written onchain)
bun agent/main.ts
# replay three real moves and write the CRE results to Robinhood Testnet
bun agent/main.ts --blocks 68837431,73953009,81262132 --broadcast
```

vet402 /rwa reports what public chain data shows. It does not give legal or investment advice.
