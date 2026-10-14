# Which wallets the walk follows

This file states the selection so that it can be reproduced from the public Robinhood Chain RPC (`https://rpc.mainnet.chain.robinhood.com`, chain id 4663) without reading the code. The code is `scripts/select-wallets.ts`. Its output is `docs/walk/selection.json` (the selected wallets with every purchase counted), `docs/walk/selection-purchases.json` and `docs/walk/wallets.json` (what `agent/walk.ts` reads).

There are three groups. They are never mixed in a total without saying so: every ledger row carries its group (`cohort`), and `docs/ledger.json` gives the main counts per group (`totals.by_cohort`).

## Group 1, `top_buyers`: the 30 largest buyers of Stock Tokens in 30 days

**Window.** Blocks 62,420,751 to 87,977,834, both included. The end is the head of the chain when the selection was first run (block time 2026-10-14T01:33:25Z). The start is the first block whose timestamp is at or after the end's timestamp minus 30 × 86,400 seconds (block time 2026-09-14T01:33:25Z).

**Tokens.** The entries of `token-check/registry-snapshot.json` (Robinhood's own asset list at `https://docs.robinhood.com/chain/contracts`, taken 2026-09-28T22:24:32Z, 195 Stock Tokens) whose `feed` is not null: 33 tokens. The addresses and feeds are repeated in `selection.json` under `tokens`.

**Official venues.**
- the Uniswap v4 PoolManager, `0x8366a39cc670b4001a1121b8f6a443a643e40951`;
- every Uniswap v3 pool created by the factory `0x1f7d7550b1b028f7571e69a784071f0205fd2efa` for a pair that holds one of the 33 tokens: the address in the second data word of each `PoolCreated(address,address,uint24,int24,address)` log (topic0 `0x783cca1c0412dd0d695e784568c96da2e9c22ff989357a2e8b1d9b2b4e6b7118`) of that factory, from block 0 to the end of the window, whose `token0` (topic1) or `token1` (topic2) is one of the 33 tokens.

**Candidate transfer.** A log of one of the 33 tokens with topic0 `Transfer(address,address,uint256)` (`0xddf252ad…b3ef`), exactly three topics, `from` (topic1) an official venue **of that token** (the PoolManager, or a v3 pool that holds that token), in a block of the window. A transfer whose receiver is itself an official venue of any of the 33 tokens is dropped.

**Purchase.** A candidate transfer to an address W is a purchase by W when all of these hold:
1. the transaction succeeded (`status` 1) and its `from` is W, so W signed it;
2. W paid in the same transaction: the receipt holds a `Transfer` log with three topics whose `from` (topic1) is W and whose emitting contract is not the token bought, or the transaction's `value` is above zero.

So a liquidity-pool `collect`, a fee claim, a withdrawal, an airdrop, a bridge delivery and a purchase made through a contract that keeps the tokens are not purchases.

**Size of a purchase.** `amount / 10^18 × P`, written with two decimals (JavaScript `toFixed(2)`). `amount` is the data word of the Transfer log. `P` is the token's Chainlink feed value at the block: the `current` (topic1, read as a signed 256-bit integer) of the last `AnswerUpdated(int256,uint256,uint256)` log (topic0 `0x0559884f…fc5f`) of the feed's aggregator with a block number at or below the purchase's block and `current` above zero, divided by `10^decimals()` of the feed. The aggregator is what the feed's `aggregator()` (selector `0x245a7bfc`) answers at `latest`. Its logs are read from block (window start − 6,000,000) on. A transfer with no such value is not counted (count in `selection-output.txt`). No age limit applies to `P` here.

**Ranking.** The size of W is the sum of the two-decimal sizes of its purchases in the window. Wallets are ranked by size, largest first, ties by address ascending. The first 30 are the group.

**How the top 30 are found without opening every transaction.** For each receiver, the sum of `amount / 10^18 × P` over all its candidate transfers is an upper bound of its size. Receivers are read from the largest bound down. An address with contract code at `latest` cannot sign a transaction and has size 0 (code that starts with `0xef0100`, an EIP-7702 delegation, counts as an account, not a contract). For an account every transaction is opened and the purchases are summed. The reading stops when the 30th-largest size found so far is at least the next unread receiver's bound. `selection.json` lists every receiver read, with its bound and its size, under `read`.

**Not excluded.** No wallet is dropped because vet402 could not build a record for it, because it is busy, or because its trades lost money. A wallet for which vet402's free route does not answer 200 stays in the walk: each of its purchases becomes a decision that opens nothing, with the HTTP status as the reason.

## Group 2, `watched`: one wallet

`0xe9b08727131e34010b34006c660d4c1b436ec25f`, the wallet copy-guard was first pointed at, and the only wallet vet402 has anchored a record for. It is here because the earlier runs of this agent watched it, not because of the rule above. Tokens with the tickers NVDA and USDG that the issuer did not issue were sent to it.

## Group 3, `same_ticker_buyers`: the first 20 buyers of one token that uses the ticker SPY

This group is an observation chosen for what it shows. It is not a sample of anything, and its rows are counted apart.

**Token.** `0x69e7778d46713e17572d610bdaca3943aa4e6219`. Its `symbol()` answers `SPY` and its `name()` answers `Spy Chip`. It is not in Robinhood's asset list, where SPY is another address. Nothing here says who made it or why.

**Purchase.** As in group 1, with this token in place of the 33 and the v4 PoolManager as the only venue: a `Transfer` of the token from the PoolManager to W, in a transaction W signed and in which W paid. In the window the PoolManager sent this token 441 times to 224 receivers, all between blocks 87,803,610 and 87,836,198.

**Group.** The 20 wallets with the earliest purchase, ordered by block, then by transaction hash ascending, then by address ascending. A wallet already in group 1 or 2 stays in that group and is not counted here, and the next wallet takes its place.

## What the walk reads for each wallet

For each wallet, vet402's free route `https://vet402.com/api/v1/rwa/facts/<address>?chain=4663` is asked once and the answer saved in `docs/walk/records/`. The moves of a wallet are every transaction its record lists as evidence, every transaction in which its record names a token under a listed ticker, and every purchase counted above. For a wallet with no record they are the purchases counted above.

## Why 30 days and not the whole history

The 33 tokens left official venues several million times since the chain opened. The public RPC answers at most 10,000 logs per query and throttles. Thirty days is what one run reads in under an hour. The window is a choice, stated here. The rule itself does not depend on it: `--days` changes it.
