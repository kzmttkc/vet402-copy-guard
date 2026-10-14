# token-check

A Chainlink CRE workflow an agent calls before it acts on a token on Robinhood Chain (chain id 4663). It answers one question per token: is this the issuer's Robinhood Stock Token, or does it only carry the same ticker or name?

It takes three payloads on one HTTP trigger:

| Payload | What it does | Writes |
|---|---|---|
| `{ tx, wallet, block? }` | One transaction: every ERC-20 token that moved in or out of the wallet in it is judged. Sections "What it reads" to "Three real transactions" below. | nothing |
| `{ tokens: [address, ...], block?, itemsPerCall? }` | Many tokens at once, as of one block. Section "Many tokens at once". | the hash of its rows, to `TokenCheckReceiver` on Robinhood Testnet |
| `{ results_json, batches }` | Anchors a results file built from runs of the second payload, after reading the receipt of every run the file names. | the hash of the file, to `TokenCheckReceiver` |

It calls no vet402 API. Every input of a decision is read from the chain's public RPC through CRE's HTTP capability, or comes from the asset list bundled with the workflow.

Code: [`token-check/`](../../token-check). The decisions are pure functions in `check.ts` and `batch.ts`. `workflow.ts` reads the chain and hands the answers to them. `recheck.mjs` reads the same things again without CRE and compares.

## What it reads

| Read | Call | Compared with |
|---|---|---|
| Chain | `eth_chainId` | 4663 |
| The wallet's transfers in the tx | `eth_getLogs`, `Transfer` topic, wallet as sender and as receiver, the block of the tx | |
| Token code | `keccak256(eth_getCode)` | `0x6c1fdd40002dcb440c7fff6a84171404d279ccb057803b65826f7546acd65630`, the one Stock Token proxy code |
| Beacon | `eth_getStorageAt`, EIP-1967 beacon slot `0xa3f0ad74…3d50` | `0xe10b6f6B275de231345c20D14Ab812db62151b00` |
| Issuer's deployment | `eth_getLogs` on the factory `0x4783C67b63dE2B358Ac5951a7D41F47A38F3C046`, `TokenDeployed` topic `0xd9b0c6a1…76d6` | the first data word is the token address |
| Ticker and name | `symbol()`, `name()` | the 195 tickers and names of the list, and USDG |
| Corporate actions | `uiMultiplier()` (`0xa60bf13d`) and `UIMultiplierUpdated` logs (topic `0x2205df45…b055`) from the block of the tx on | 1.0, the multiplier a Stock Token starts with |

The list is `token-check/registry-snapshot.json`: token address, ticker, name, Chainlink feed and the block of the factory log, for the 195 Stock Tokens on <https://docs.robinhood.com/chain/contracts> as vet402 froze them on 2026-09-28. The file carries the keccak256 of the vet402 file it was cut from.

Tickers and names are compared after invisible characters are removed and look-alike letters (zero for O, Cyrillic, Greek, full-width) are folded to Latin. The tables are in `check.ts`, so every node folds text the same way.

## Verdicts

| Verdict | Meaning | allow |
|---|---|---|
| `GENUINE_STOCK_TOKEN` | The address is in the list, and the chain confirms the code, the beacon, the factory log and the ticker. | yes |
| `USDG` | The USDG address (`0x5fc5360d0400a0fd4f2af552add042d716f1d168`). Matched by address only. | yes |
| `NOT_A_STOCK_TOKEN` | An ordinary token. It does not use a listed ticker or name. | yes |
| `LOOKALIKE` | It uses a listed ticker or name, USDG's, or the "Robinhood Token" naming, at an address that is not in the list. | no |
| `UNVERIFIED` | A listed address the chain no longer confirms, or the Stock Token code at an unlisted address with a ticker the list does not have. It needs a person. | no |

`allow` is false when any token is `LOOKALIKE` or `UNVERIFIED`, or when a `blocks` reason is set. `LOOKALIKE` is a statement about the address and the list. It does not say who made the token or why.

## Reason codes

One bit per reason. `reasonBits` is the OR of the bits. Each token carries its own `reasonBits` and `reasons`, and the top level carries the OR of all of them.

| Bit | Name | Kind | Meaning |
|---|---|---|---|
| 1 | `WRONG_CHAIN` | blocks | the RPC is not Robinhood Chain (4663) |
| 2 | `TX_NOT_FOUND` | blocks | the transaction is not in a block |
| 4 | `NO_WALLET_TRANSFER` | blocks | no ERC-20 Transfer to or from the wallet in that transaction and block, so nothing was checked |
| 8 | `TOO_MANY_TRANSFERS` | blocks | the transaction has more transfers or tokens of the wallet than one run reads, so some were not checked |
| 16 | `NOT_IN_LIST` | explains | the address is not in Robinhood's asset list (snapshot) |
| 32 | `CODE_HASH_DIFFERS` | explains | the runtime code is not the Stock Token proxy code |
| 64 | `BEACON_DIFFERS` | explains | the EIP-1967 beacon slot does not hold the Stock Token beacon |
| 128 | `FACTORY_LOG_MISSING` | explains | no TokenDeployed log of the Stock Token factory names the address |
| 256 | `LISTED_SYMBOL_DIFFERS` | explains | symbol() does not answer the ticker the list gives for the address |
| 512 | `NO_CONTRACT_CODE` | explains | the address has no contract code now |
| 1024 | `SYMBOL_COPIES_LISTED` | explains | symbol() is a listed ticker, at another address |
| 2048 | `SYMBOL_DISGUISES_LISTED` | explains | symbol() becomes a listed ticker once hidden or look-alike characters are removed |
| 4096 | `NAME_COPIES_LISTED` | explains | name() is a listed company name, at another address |
| 8192 | `NAME_CLAIMS_ROBINHOOD_TOKEN` | explains | name() ends like a Robinhood Stock Token ("Robinhood Token", "Robinhood Coin") |
| 16384 | `IMITATES_USDG` | explains | symbol() or name() reads as USDG or Global Dollar, at another address |
| 32768 | `HIDDEN_CHARACTERS` | explains | symbol() or name() carries invisible characters |
| 65536 | `CONFUSABLE_CHARACTERS` | explains | symbol() or name() uses a digit or a non-Latin letter that looks like a Latin one |
| 131072 | `STOCK_TOKEN_CODE_UNLISTED` | explains | the Stock Token proxy code and beacon at an address outside the list (the list may be older than the token) |
| 262144 | `MULTIPLIER_CHANGED` | notice | uiMultiplier is not 1, the token has had a corporate action |
| 524288 | `MULTIPLIER_CHANGED_AFTER_TX` | notice | uiMultiplier changed after this transaction, the same raw amount shows a different number of shares now |
| 1048576 | `MULTIPLIER_UNREADABLE` | notice | uiMultiplier() did not answer |

`blocks` sets `allow` to false. `explains` says why a token got its verdict. `notice` leaves `allow` as it is.

## Three real transactions

Wallet `0xE9B08727131E34010b34006c660D4c1B436EC25f`, run with `cre workflow simulate` on 2026-10-14 against the public RPC. Full output is next to this file.

| Run | Transaction | Block | Token | Verdict | allow | reasonBits |
|---|---|---|---|---|---|---|
| [qqq-buy](simulate-qqq-buy.txt) | `0x0eac7685…13f8` | 68837431 | QQQ `0xd5f38791…de68` in, USDG out | `GENUINE_STOCK_TOKEN`, `USDG` | true | 786432 |
| [fake-nvda](simulate-fake-nvda.txt) | `0x1b838f40…b51b` | 73953009 | `0x5dd716fe…3539`, 25 units in | `LOOKALIKE` | false | 13424 |
| [fake-usdg](simulate-fake-usdg.txt) | `0xf7cb51a2…8717` | 81262132 | `0xe7391e40…f288`, a Transfer log out of the wallet | `LOOKALIKE` | false | 49264 |

- **qqq-buy.** The wallet paid 5,000 USDG and received QQQ. QQQ passes all five checks. Reasons: `MULTIPLIER_CHANGED`, `MULTIPLIER_CHANGED_AFTER_TX`. `uiMultiplier()` now answers 1.000700791241405425, and the token emitted `UIMultiplierUpdated` (1 to 1.000700791241405425) in block 69210998, after the buy. The raw amount the wallet received shows about 0.07% more shares today than on the day of the buy.
- **fake-nvda.** `symbol()` answers `NVDA` and `name()` answers `NVIDIA Robinhood Coin`. The listed NVDA lives at `0xd0601CE1…9EEC`. Reasons: `NOT_IN_LIST`, `CODE_HASH_DIFFERS`, `BEACON_DIFFERS`, `SYMBOL_COPIES_LISTED`, `NAME_COPIES_LISTED`, `NAME_CLAIMS_ROBINHOOD_TOKEN`.
- **fake-usdg.** `symbol()` answers `U[U+206F]S[U+206F]DG`: the letters of USDG with an invisible character between them, so a screen shows `USDG`. The token emitted a Transfer log that names the wallet as the sender of 20,000 units. Reasons: `NOT_IN_LIST`, `CODE_HASH_DIFFERS`, `BEACON_DIFFERS`, `IMITATES_USDG`, `HIDDEN_CHARACTERS`.

In the output, `symbol` and `name` show every character outside printable ASCII as `[U+XXXX]`.

## Many tokens at once

The walk of the practice ledger meets dozens of tokens. `{ "tokens": ["0x…", …] }` checks up to 60 of them in one run, all as of one block, and returns one row per token:

```json
"0xd5f3879160bc7c32ebb4dc785f8a4f505888de68": {
  "issuer_token": true,
  "ticker": "QQQ",
  "reasons": ["IN_ISSUER_LIST", "CODE_HASH_MATCHES", "BEACON_MATCHES", "FACTORY_LOG_NAMES_TOKEN", "TICKER_MATCHES_LIST", "MULTIPLIER_NOT_ONE"],
  "multiplier_updates": 1,
  "checked_block": 87990000
}
```

`issuer_token` is true only when all five grounds hold: the address is in the list, `EXTCODEHASH` is the Stock Token proxy code hash, the EIP-1967 beacon slot holds the Stock Token beacon, the factory's `TokenDeployed` log names the address, and `symbol()` answers the listed ticker. `multiplier_updates` is the number of `UIMultiplierUpdated` logs the token has emitted from its deployment to `checked_block`. For an address outside the list it is 0 and not read.

### How one run reads

1. **Which block.** Without `block` in the payload, each node reads the head of the chain and the nodes agree on it by median (`consensusMedianAggregation`). The run checks 20 blocks behind that. With `block`, every node reads exactly that block.
2. **State, from a second RPC operator.** `stateRpc` in `config.json` is PublicNode. One request carries, for every token: `EXTCODEHASH` (an `eth_call` without `to` whose init code returns the hash, so the answer is 32 bytes whatever the size of the token's code), the beacon slot, `symbol()`, `name()` and `uiMultiplier()`, all pinned to the one block.
3. **Logs, from Robinhood's own RPC.** For each listed address: the factory log in the block the list names, and the token's `UIMultiplierUpdated` logs in windows of 10,000,000 blocks. PublicNode does not serve old logs.
4. **Both RPCs must give the same hash for the block**, and both must answer chain id 4663. Otherwise the run stops and writes nothing.
5. The nodes agree on everything read, byte for byte (`consensusIdenticalAggregation`), `batch.ts` decides, and the run writes `keccak256` of the canonical JSON of its rows to `TokenCheckReceiver` (`TokenBatchChecked`, with the block number, the block hash, and the counts).

### Reason codes of a row

Each code states something that was read. None says who made a token or why.

| Code | Meaning |
|---|---|
| `IN_ISSUER_LIST` | the address is in the issuer's asset list (snapshot) |
| `NOT_IN_ISSUER_LIST` | the address is not in the issuer's asset list (snapshot) |
| `USDG_ADDRESS` | the address is USDG (matched by address) |
| `CODE_HASH_MATCHES` | EXTCODEHASH of the address is the Stock Token proxy code hash |
| `CODE_HASH_DIFFERS` | EXTCODEHASH of the address is not the Stock Token proxy code hash |
| `NO_CONTRACT_CODE` | the address has no contract code at the checked block |
| `BEACON_MATCHES` | the EIP-1967 beacon slot holds the Stock Token beacon |
| `BEACON_DIFFERS` | the EIP-1967 beacon slot does not hold the Stock Token beacon |
| `FACTORY_LOG_NAMES_TOKEN` | a TokenDeployed log of the Stock Token factory names the address |
| `FACTORY_LOG_MISSING` | no TokenDeployed log of the Stock Token factory names the address |
| `TICKER_MATCHES_LIST` | symbol() answers the ticker the list gives for the address |
| `TICKER_DIFFERS_FROM_LIST` | symbol() does not answer the ticker the list gives for the address |
| `TICKER_SAME_AS_ISSUER_TOKEN` | symbol() is the ticker of a listed token, and the listed token is at another address |
| `TICKER_SAME_AFTER_FOLDING` | symbol() equals a listed ticker once invisible characters are removed and homoglyphs are folded to Latin |
| `NAME_SAME_AS_ISSUER_TOKEN` | name() is the name of a listed token, and the listed token is at another address |
| `NAME_ENDS_LIKE_ISSUER_TOKEN` | name() ends with "Robinhood Token" or a close form of it |
| `TICKER_OR_NAME_READS_AS_USDG` | symbol() reads as USDG or name() as Global Dollar, and USDG is at another address |
| `INVISIBLE_CHARACTERS` | symbol() or name() carries characters that render as nothing |
| `HOMOGLYPH_CHARACTERS` | symbol() or name() uses a digit or a non-Latin letter that renders like a Latin one |
| `ISSUER_CODE_AT_UNLISTED_ADDRESS` | the Stock Token proxy code and beacon are at an address outside the list (the list may be older than the token) |
| `MULTIPLIER_NOT_ONE` | uiMultiplier() is not 1 at the checked block |
| `MULTIPLIER_UNREADABLE` | uiMultiplier() did not answer |

A consumer that wants one test for "this address is not the listed token, and it carries a listed token's mark" can look for any of: `TICKER_SAME_AS_ISSUER_TOKEN`, `TICKER_SAME_AFTER_FOLDING`, `NAME_SAME_AS_ISSUER_TOKEN`, `NAME_ENDS_LIKE_ISSUER_TOKEN`, `TICKER_OR_NAME_READS_AS_USDG`, `ISSUER_CODE_AT_UNLISTED_ADDRESS` (exported as `SHARES_A_LISTED_MARK` in `batch.ts`).

### What fits in one run

CRE allows 15 HTTP requests per execution, 250 kb per answer and 25 kb for what the nodes agree on. A listed token costs one factory query and one log query per 10,000,000 blocks since its deployment (9 today for the oldest). Robinhood's RPC answers 429 to a whole batch that is larger than what the caller's address has left of its rate, so a request to it carries at most 10 items. That gives about 9 listed tokens per run. Addresses outside the list cost state reads only, and 60 fit. `planRuns` in `batch.ts` splits a list accordingly, and the workflow refuses a payload that would need more than 14 requests before it reads anything.

### The results file, and its anchor

`scripts/token-check-batch.sh [tokens.json]` runs the whole thing:

1. It measures how many items Robinhood's RPC lets through in one request right now, plans the runs, and starts `cre workflow simulate token-check --broadcast` for each. The output of every run is saved under `batch/`.
2. It writes [`results.json`](results.json): `{ generated_at, cre_runs: [{ tx, simulate_log }], tokens: { "<address>": row } }`. Nothing else is in that file. [`details.json`](details.json) holds what stands behind each row (the code hash, the beacon, the multiplier, the text `symbol()` and `name()` answered) and which run checked which token.
3. One more CRE run anchors the file. The workflow refuses a file that is not in that exact shape or that carries a reason code it does not define. Then it reads, through CRE's EVM capability, the receipt of every run the file names, and requires in each the `TokenBatchChecked` log whose hash it recomputes from the file's rows. Only then it writes `keccak256(results.json)` (`TokenCheckResultsAnchored`). The transaction is in [`anchor.json`](anchor.json).
4. `node token-check/recheck.mjs` reads every token again over plain JSON-RPC from Robinhood's own RPC, one request at a time, with no CRE and none of the workflow's code: `eth_getCode` hashed locally, the beacon slot, `symbol()`, `uiMultiplier()`, the factory log, every multiplier log. It derives `issuer_token`, `ticker`, `multiplier_updates` and the reasons that follow from those reads, compares them with each row, and checks both events onchain. The result is [`recheck.json`](recheck.json) and [`recheck-output.txt`](recheck-output.txt).

`TokenCheckReceiver` on Robinhood Testnet (46630): `0xF49b4F2110E6E0dAbd1f3B532EFd64E10a016550`, verified on the explorer. Like the other receivers it has no owner, no storage and no upgrade path, and only the forwarder fixed at deployment may call it. That forwarder is CRE's simulation forwarder, which accepts reports from anyone. The events are not DON attestations.

## Run it

```sh
cd token-check && bun install && bun test     # 130 tests, no network
./token-check/simulate.sh                     # the three single-transaction runs above, needs `cre login`
./scripts/token-check-batch.sh                # every token of the walk: results.json, anchor.json, recheck.json
```

One run by hand, from the repository root:

```sh
cre workflow simulate token-check --target local-simulation --non-interactive \
  --trigger-index 0 --http-payload token-check/payloads/fake-nvda.json
```

The payload is `{ "tx": "0x…", "wallet": "0x…" }`. An optional `"block": 73953009` skips the lookup of the transaction object. The result is JSON: `{ tx, wallet, block, allow, reasonBits, reasons, tokens: [{ token, verdict, reasons, reasonBits, symbol, name, ticker, direction, amountInRaw, amountOutRaw, multiplier, multiplierChanged, multiplierChangedAfterTx, multiplierUpdates }], list }`.

`token-check/fixtures/` holds the raw RPC answers of the three runs (recorded by `record-fixtures.ts`). The tests replay them through the CRE SDK's test runtime.

## Limits

- **Simulation only.** These are `cre workflow simulate` runs on one machine. No DON ran the workflow, and the result carries no DON signature. I have no deploy access.
- **A pinned block needs an RPC that still has it.** PublicNode keeps state for fewer than 128 blocks (about 12 seconds), Robinhood's RPC for more than 5,000 and fewer than 50,000 (measured 2026-10-14). So the batch check reads a block 20 behind the head, and the recheck must run within minutes to read the same block. Later it reads the state as it is now and says so. In a DON, pass `block` and point `stateRpc` at an RPC that keeps it.
- **The batch check trusts two RPC operators to agree, not one to be right.** A token's state comes from PublicNode and its logs from Robinhood. The recheck reads the state from Robinhood as well.
- **`latest` state in the one-transaction check.** The public RPC keeps no historical state. Code, beacon slot, `symbol()`, `name()` and `uiMultiplier()` are read as they are now, which can differ from what they were in the block of the transaction. The transfer logs and the multiplier logs are historical.
- **The list is a snapshot** of 2026-09-28. A Stock Token listed later is not in it. Such a token comes out as `UNVERIFIED`, and the run does not allow it. A token delisted later still passes while the chain confirms it.
- **A ticker match is enough for `LOOKALIKE`.** An unrelated token that happens to share a listed ticker gets the same verdict.
- **USDG is matched by address.** Its code is not pinned.
- **Caps of the one-transaction check.** One run reads at most 8 tokens and 32 transfer logs of the wallet, and looks at multiplier logs over at most 40,000,000 blocks from the transaction on. Past a cap the run says so (`TOO_MANY_TRANSFERS`, or `multiplierChangedAfterTx: null`) and does not guess.
- **Large transactions.** Without `block` in the payload the workflow fetches the transaction object to find its block. CRE limits an HTTP answer to 250 kb, and an airdrop to thousands of addresses can be larger. The run then fails with an error and gives no verdict. Pass `block` for those.
- **The public RPC rate-limits.** The workflow spaces its requests and retries a few times. If the RPC keeps refusing, the run fails with an error and gives no verdict.
- This is a technical check of what a token is on chain. It is not legal advice and not investment advice.
