# vet402 /rwa record check on Chainlink CRE

Anyone can re-check a vet402 /rwa record without a key, an account or trusting vet402's server. The answer is MATCH or MISMATCH, with the reason.

What it does:

1. [vet402 /rwa](https://vet402.com/rwa) rebuilds a Robinhood Chain wallet's Stock Token record from public chain data, names the fake look-alike tokens and anchors the record's hash onchain in `RwaAnchor` ([`0x1955…c22d`](https://robinhoodchain.blockscout.com/address/0x1955137e7773f2459eb75fb88842026c6517c22d)).
2. This Chainlink CRE workflow takes a record, recomputes its hash the same way vet402's one-file checker [`verify-record.mjs`](https://github.com/kzmttkc/vet402/blob/main/packages/rwa/scripts/verify-record.mjs) does, and reads the anchor from Robinhood Chain over a public RPC.
3. It writes the verdict (MATCH or MISMATCH plus one bit per failed check) to a small receiver contract, so a lawyer, an auditor or an AI agent can point to it.

A changed character anywhere in the record gives MISMATCH. So does an anchor from another contract, another operator, another wallet or another date.

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
| `agent/` | copy-guard, the agent that buys the record over x402 before it would copy a wallet (see below) |
| `trail-anchor/` | The second CRE workflow. It reruns the agent's rules on a trail and writes the trail's hash |
| `contracts/src/ReasoningTrailReceiver.sol` | Receives that report and emits `DecisionRecorded`. Same shape as `RwaVerdictReceiver` |
| `scripts/deploy-trail-receiver.sh` | Deploys and verifies `ReasoningTrailReceiver` on Robinhood Testnet |
| `docs/agent/` | The agent's dry run on 2026-10-09: console output, the record it read, the trails, the CRE logs, the checker's output |

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

### The dry run on 2026-10-09

The payment wallet holds nothing yet, so the agent ran in its default dry run. It read the real 402, checked the terms and built the exact Permit2 message it would sign (digest in `x402-dry-run.json`). It signed nothing and sent nothing, and read the same JSON from the free route. Everything after that step is real: the CRE verdict and the three trails were written to Robinhood Testnet.

`bun agent/main.ts --blocks 68837431,73953009,81262132 --broadcast --out docs/agent/replay-dry-run` replays three real moves of the demo wallet:

| Move | What a naive bot sees | Conclusion | Failed rules | Trail on Robinhood Testnet |
|---|---|---|---|---|
| [`0x0eac7685…13f8`](https://robinhoodchain.blockscout.com/tx/0x0eac7685c6c57c3929d053bea9b5fa4b9879e2afc798848ee2b8ccf0e56a13f8) | a QQQ buy for 5,000 USDG | DO_NOT_COPY | C3 partial track record, C4 realized -273.01 | [`0x41823517…2a46e1`](https://explorer.testnet.chain.robinhood.com/tx/0x418235176be8d19d4619fd054a1e98d44d282b5facb0a40041e7cc2f1e2a46e1) |
| [`0x1b838f40…b51b`](https://robinhoodchain.blockscout.com/tx/0x1b838f40a43d54b7ce3364f08f723516170be2d03fdbcd6ab801c79f7f77b51b) | 25 NVDA received | DO_NOT_COPY | C1 the token is a fake imitating NVDA, then C2 to C5 | [`0xa4bc09a5…70452f`](https://explorer.testnet.chain.robinhood.com/tx/0xa4bc09a5f80028057f6a0934f015b5d8a6c6d058435edc11e0d61232c770452f) |
| [`0xf7cb51a2…8717`](https://robinhoodchain.blockscout.com/tx/0xf7cb51a25f62bfbe63760404055b36d380eed0d47c68f99cdccaa17e9c478717) | 20,000 USDG sent | DO_NOT_COPY | C1 the token is a fake imitating USDG, then C2 to C5 | [`0x339123b0…7e8cc5`](https://explorer.testnet.chain.robinhood.com/tx/0x339123b04782cc88216fb456ee253d148b173ec1472ea4c750047b40627e8cc5) |

All three passed every A and B rule. The CRE re-verification of the newest anchor (`0x15f9…5c7f`) said MATCH in [`0x6b85468c…d39e47`](https://explorer.testnet.chain.robinhood.com/tx/0x6b85468c2549ae1ff225c506b71c028711dcc4b594a420eb99d2680d84d39e47). The COPY path is covered by the tests: the same QQQ buy on a record with a complete, profitable history gives a paper buy of 0.133023 QQQ at 751.7499 USD.

The trail receiver is [`ReasoningTrailReceiver` `0x9913…a0B3`](https://explorer.testnet.chain.robinhood.com/address/0x991311c2eca78b83da3593c7500804af6feea0b3) (verified source, deploy tx [`0x87de029c…a0ed063`](https://explorer.testnet.chain.robinhood.com/tx/0x87de029cf74486bd00983484b84c738c6d1517826d60574e5d00ad9daa0ed063)).

### Recheck a decision without a key

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
- `MAX_SPEND_ATOMIC` in `agent/x402.ts` is fixed at 1 USDG. Every payment is written to a ledger (`~/.vet402/bli-agent-spend.json`) before it is sent, and the ledger is read again right before signing. A payment whose outcome is unknown counts as spent. The approval is also exactly 1 USDG, so Permit2 itself cannot pull more.
- The agent refuses terms above 0.01 USDG, another payee, another chain, another token or another transfer method before anything is signed.
- One purchase per run. Every move judged in that run reads the same bytes, and the trail names them by hash.
- The payment wallet is `0xc380D9F41D90765A4820429B9Da151889E8bED94`. Its key lives outside this repo.

### What it does not claim

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
