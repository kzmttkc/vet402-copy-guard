# token-check

A Chainlink CRE workflow an agent calls before it acts on a transfer. It takes one transaction on Robinhood Chain (chain id 4663) and one wallet, finds every ERC-20 token that moved in or out of that wallet in the transaction, and answers one question per token: is this the issuer's Robinhood Stock Token, or does it only look like one?

It calls no vet402 API. Every input of the decision is read from the chain's public RPC (`https://rpc.mainnet.chain.robinhood.com`) through CRE's HTTP capability, or comes from the asset list bundled with the workflow. It writes nothing onchain.

Code: [`token-check/`](../../token-check). The decision is a pure function in `check.ts`. `workflow.ts` only reads the chain and hands the answers to it.

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

## Run it

```sh
cd token-check && bun install && bun test     # 79 tests, no network
./token-check/simulate.sh                     # the three runs above, needs `cre login`
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
- **`latest` state.** The public RPC keeps no historical state. Code, beacon slot, `symbol()`, `name()` and `uiMultiplier()` are read as they are now, which can differ from what they were in the block of the transaction. The transfer logs and the multiplier logs are historical.
- **The list is a snapshot** of 2026-09-28. A Stock Token listed later is not in it. Such a token comes out as `UNVERIFIED`, and the run does not allow it. A token delisted later still passes while the chain confirms it.
- **A ticker match is enough for `LOOKALIKE`.** An unrelated token that happens to share a listed ticker gets the same verdict.
- **USDG is matched by address.** Its code is not pinned.
- **Caps.** One run reads at most 8 tokens and 32 transfer logs of the wallet, and looks at multiplier logs over at most 40,000,000 blocks from the transaction on. Past a cap the run says so (`TOO_MANY_TRANSFERS`, or `multiplierChangedAfterTx: null`) and does not guess.
- **Large transactions.** Without `block` in the payload the workflow fetches the transaction object to find its block. CRE limits an HTTP answer to 250 kb, and an airdrop to thousands of addresses can be larger. The run then fails with an error and gives no verdict. Pass `block` for those.
- **The public RPC rate-limits.** The workflow spaces its requests and retries a few times. If the RPC keeps refusing, the run fails with an error and gives no verdict.
- This is a technical check of what a token is on chain. It is not legal advice and not investment advice.
