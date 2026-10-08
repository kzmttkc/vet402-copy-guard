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

vet402 /rwa reports what public chain data shows. It does not give legal or investment advice.
