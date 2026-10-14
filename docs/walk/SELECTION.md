# Which wallets the walk follows

**In one sentence: the walk follows notable wallets whose record can be checked.**

This file states the selection so that it can be reproduced from the public Robinhood Chain RPC (`https://rpc.mainnet.chain.robinhood.com`, chain id 4663) and vet402's free route, without reading the code. The code is `scripts/select-wallets.ts`. Its output is `docs/walk/selection.json` and `docs/walk/wallets.json` (what `agent/walk.ts` reads).

Two things are kept apart and never mixed in a total without saying so: the **selected wallets** (section 1), and two **observations** (section 3), which are not "notable wallets" and are counted as their own groups. Every ledger row carries its group (`cohort`), and `docs/ledger.json` gives the counts per group (`totals.by_cohort`).

This is the third version of the rule. The first one ranked wallets by purchases they signed themselves. An independent re-implementation showed four faults in it: a rearranged liquidity position counted as a purchase, an exchange of one Stock Token for another counted as a purchase, a purchase through a router was never counted, and finding the top 30 needed about 42,000 receipts (20 hours on the public RPC). The second version answered those four, but it still ranked only what a venue sent straight to an address: whoever bought through a router was credited to the router, and the router itself (a contract with no record) took a place in the ranking. The third version credits the buyer behind a listed router, and passes over routers and other contracts without asking for a record.

## 1. The selected wallets (`top_buyers`)

**Window.** Blocks 62,420,751 to 87,977,834, both included. The end is the head of the chain when the selection was first run (block time 2026-10-14T01:33:25Z). The start is the first block whose timestamp is at or after the end's timestamp minus 30 × 86,400 seconds (block time 2026-09-14T01:33:25Z).

**Tokens.** The entries of `token-check/registry-snapshot.json` whose `feed` is not null: 33 tokens. The snapshot is a copy of Robinhood's own asset list at `https://docs.robinhood.com/chain/contracts`, taken 2026-09-28T22:24:32Z (195 Stock Tokens). A token listed, or given a Chainlink feed, after that date is not in it. The addresses and feeds are repeated in `selection.json` under `tokens`.

**Official venues.**
- the Uniswap v4 PoolManager, `0x8366a39cc670b4001a1121b8f6a443a643e40951`;
- every Uniswap v3 pool created by the factory `0x1f7d7550b1b028f7571e69a784071f0205fd2efa` for a pair that holds one of the 33 tokens: the address in the second data word of each `PoolCreated(address,address,uint24,int24,address)` log (topic0 `0x783cca1c0412dd0d695e784568c96da2e9c22ff989357a2e8b1d9b2b4e6b7118`) of that factory, from block 0 to the end of the window, whose `token0` (topic1) or `token1` (topic2) is one of the 33 tokens. There are 1,901 such pools.

**Candidate transfer.** A log of one of the 33 tokens with topic0 `Transfer(address,address,uint256)` (`0xddf252ad…b3ef`), exactly three topics, `from` (topic1) an official venue **of that token** (the PoolManager, or a v3 pool that holds that token), in a block of the window. A transfer whose receiver is itself an official venue of any of the 33 tokens is dropped. In the window there are 9,651,160 such transfers (7,547,153 out of the PoolManager and 2,065,463 out of v3 pools after 38,544 to a venue are dropped), to 55,090 receivers.

**Through a router.** A router takes a token from an official venue and passes it on to the buyer in the same transaction. The routers listed:

| Router | Address | Why it is listed |
|---|---|---|
| Uniswap SwapRouter02 | `0xcaf681a66d020601342297493863e78c959e5cb2` | Uniswap's own deployment list for Robinhood Chain (4663); verified as SwapRouter02 on robinhoodchain.blockscout.com |
| Uniswap UniversalRouter | `0x8876789976decbfcbbbe364623c63652db8c0904` | the same list; verified as UniversalRouter |
| a router measured on the chain | `0x3d90f66b534dd8482b181e24655a9e8265316be9` | measured, not named by anyone: in the sampled transactions it receives a Stock Token from the v4 PoolManager and sends the same amount to the transaction's signer, who paid USDG for it (`agent/fixtures/move-routed-buy.json` is one such transaction). The independent re-implementation found 91,735 such transfers to 384 accounts in the window, all accounts, none of which the second version asked about |

How the list was checked: two transactions of each of the top 100 addresses of the second version's ranking were opened, and for each address it was noted whether a token it received in the transaction went on to an account, and to the signer. Three contracts sent tokens to the signer in both: `0x3d90f66b…` (the whole Stock Token amount it got from the PoolManager, to a signer who paid USDG: a purchase through a router), `0x73991a25…` (in both transactions opened, a pool's payout of a Stock Token and WETH, which it passed to the signer: a liquidity withdrawal through a helper, not a purchase), and `0xfe12d3d0…` (it sent most of what it got back to the PoolManager and a small remainder to the signer: a trading program). Only the first is listed. The others passed tokens on in ways that are not a purchase for someone else (back to the venue, to an address that is not the signer, out of a liquidity position). A router not in this table is ranked like any other contract and passed over (below).

What is credited: for a transfer of one of the 33 tokens from a listed router to an address R in a transaction X, the part of it that official venues of that token sent to that router in X and that the router has not yet passed on in X (in log order of the saved transfers). R is never a venue or a listed router. The transfers out of the routers are read from the logs, one query per token and router (`Transfer` with topic1 the router).

**Rank.** For each receiver, the sum over its candidate transfers and the router transfers credited to it of `amount / 10^18 × P`, where `amount` is the data word of the log and `P` is the token's price at that block (section 2, "Price"). This is an upper bound of what the receiver bought, found in one pass over the logs. No receipt is opened for it. `selection.json` gives each address's sum as `bound_usd`, split into `direct_usd` (straight from a venue) and `routed_usd` (through a listed router). Receivers are ranked by `bound_usd`, largest first, ties by address ascending. The sum is a floating-point number written with two decimals: it orders addresses and is never added to a ledger total.

**Select.** From the top of the ranking down:
- A listed router, or an address with contract code at the head of the chain (anything but `0x` or an EIP-7702 delegation `0xef0100…`, which is an account that signs for itself), is **passed over without asking**. It is written to `selection.json` under `no_record` with `asked: false`, `not_a_wallet` (`router` or `contract`), `http_status: null` and the reason. It counts among the addresses for which no record was built, and it does not use up one of the questions. A contract is not a wallet a person could copy: it is a router, a pool, a vault or a trading program.
- Every other address is asked about once on vet402's free route `https://vet402.com/api/v1/rwa/facts/<address>?chain=4663` (at most ten requests a minute), and the answer is saved in `docs/walk/records/`. An answer saved by an earlier run is read from the file and not asked again.
- HTTP 200 with a record, whatever its `r1_status` (complete or partial): the address is **selected**.
- Any other answer (for example 422 when the address has more history than the route rebuilds): the address is **not selected**. It is written to `selection.json` under `no_record`, with its rank, its upper bound, the HTTP status and the reason vet402 gave. The ledger counts these addresses and says why nothing was opened for them: a wallet whose record cannot be built cannot be checked.
- A busy answer (429, 5xx, no answer in 120 seconds) is asked again up to three times, 30 seconds apart. If it stays busy the address is not selected, with that status.

The selection stops when 30 addresses are selected or 100 addresses have been asked, whichever comes first. `selection.json` says which, and gives the counts: `considered` (places of the ranking gone through), `not_asked_routers`, `not_asked_contracts`, `asked`, `selected`, `via_router` (selected addresses with a part of their sum through a router), `no_record` (asked, no record) and `passed_over` (`no_record` plus the routers and contracts).

**Not excluded.** No address is dropped by hand, for being busy, or because its trades lost money. The only filters are the two above: the address is a wallet (not a router or another contract), and vet402 could build its record.

**What is opened on the chain.** Only the transactions of the selected wallets that their records list (vet402's free route lists at most 600 per wallet). That is what makes the selection finish on the public RPC.

## 2. Definitions the selection, rule D1 and the ticker-copy baseline share

**Purchase.** Within one transaction, a wallet W **bought** a token T (a Stock Token, or in section 3 the token named there) when all of these hold:

(a) *An official swap put T out.* An official venue emitted a swap log in the transaction, and the same venue sent T in the transaction (a `Transfer` of T whose `from` is that venue), and W ended the transaction with more T than it began with (the `Transfer`s of T to W add up to more than those from W, so a router that only passes T on has not bought it). The swap log is `Swap(bytes32,address,int128,int128,uint160,uint128,int24,uint24)` of the v4 PoolManager (topic0 `0x40e9cecb9f5f1f1c5b9c97dec2917b7ee92e57ba5563708daca94dd84ad7112f`), or `Swap(address,address,int256,int256,uint160,uint128,int24)` (topic0 `0xc42079f94a6350d7e6235f29174924f928cc2ac818eb64fed8004e115fbcca67`) of a contract whose `factory()` answers the official v3 factory. T need not come to W straight from the venue: a router may stand between.

(b) *W itself paid.* A `Transfer` of USDG (`0x5fc5360d0400a0fd4f2af552add042d716f1d168`) or of WETH (`0x0bd7d308f8e1639fab988df18a8011f41eacad73`, what `WETH9()` of the official position manager answers) whose `from` is W is in the transaction, or the transaction's `value` is above zero and its `from` is W. Another Stock Token, or a token of unknown worth, leaving W is not a payment.

(c) *No liquidity operation.* The transaction holds none of these logs: v3 pool `Mint(address,address,int24,int24,uint128,uint256,uint256)`, `Burn(address,int24,int24,uint128,uint256,uint256)`, `Collect(address,address,int24,int24,uint128,uint128)`; position manager `IncreaseLiquidity(uint256,uint128,uint256,uint256)`, `DecreaseLiquidity(uint256,uint128,uint256,uint256)`, `Collect(uint256,address,uint256,uint256)`; v4 PoolManager `ModifyLiquidity(bytes32,address,int24,int24,int256,bytes32)`. The test is the whole transaction, which is stricter than "an operation of W": a transaction that rearranges liquidity is never a purchase.

(d) *No other Stock Token left W.* If a Stock Token other than T left W in the transaction (a `Transfer` whose `from` is W, of any token in the issuer's list), the move is a **rotation**, an exchange of one Stock Token for another, and not a purchase, whatever else was paid.

The signer of the transaction need not be W. A relayed or routed transaction is a purchase when the payment left W.

**Which transfer is judged.** A decision is about one transaction and one wallet. The leg judged is the first transfer of T in the transaction's log order whose `from` or `to` is W. If that transfer leaves W, the move is **out**, even when T also came back to W later in the transaction. If it comes to W, the move is an arrival, and it is judged below even when T also left W later in the same transaction. Where T both came in and went out, the tests below still look at the whole transaction: a liquidity log in it makes it **liquidity** first, and (a) asks whether W ended with more T than it began with.

Every arrival of T in W is one of six kinds, tested in this order, the first that fits:
1. **liquidity**: (c) fails, whatever else holds.
2. **rotation**: (d) fails.
3. **purchase**: (a) and (b) hold.
4. **swapped, not paid by the wallet** (`swapped_unpaid`): (a) holds, (b) does not.
5. **bought outside the official venues** (`purchase_off_venue`): no official swap put T out, but W ended the transaction with more T than it began with and (b) holds: W itself paid USDG, WETH or ETH. It was bought, through some other venue or a private counterparty, and not on Robinhood's official Uniswap pools.
6. **received**: anything else. W paid nothing that counts (no USDG, WETH or ETH left W, and W did not send ETH as the signer), or W did not end with more T: a plain transfer, an airdrop, a bridge delivery, or a token that came in and left again. Who signed does not decide it.

A transfer of T out of W is **out**. copy-guard opens a practice position only on a **purchase**: rule V1 (an official venue swapped it) fails on a `purchase_off_venue`, and so does D1. The ticker copy opens one on a **purchase** and on a **purchase_off_venue**, because a bot that copies by ticker and amount does not look at the venue.

**Price.** The price of a Stock Token at a block is its Chainlink feed's last answer at or before that block. The public RPC keeps no historical state (an `eth_call` of `latestRoundData()` at a past block is refused), so the answer is read from logs: the `current` (topic1, a signed 256-bit integer) of the last `AnswerUpdated(int256,uint256,uint256)` log (topic0 `0x0559884f…fc5f`) of the feed's aggregator whose block number is at or below the block and whose `current` is above zero, divided by `10^decimals()` of the feed. When several such logs are in the same block, the last in log order is used, also for a move earlier in that block.

**Rounding.** The ledger rounds in three places and says where. (1) A decision writes the price as the feed's answer divided by `10^decimals` with four decimals (`price_usd`); a position's entry, its exits, its stop loss and take profit and its result use that four-decimal price. (2) What a wallet's move was worth (`move_usd`, and the followed purchases built from it) uses no rounded price: the raw amount times the raw answer, in integers, divided by `10^(token decimals + feed decimals)` and rounded half up to the cent once. (Before this, `move_usd` multiplied the four-decimal price in floating point; one row came out 0.03 USD off.) (3) The ranking's `bound_usd` is a floating-point sum written with two decimals (section 1). The aggregator is what the feed's `aggregator()` (selector `0x245a7bfc`) answers at `latest`, and its logs are read from block (window start − 6,000,000) on. `selection.json` records, per feed, that this aggregator has an answer before the window starts, so no price in the window is missing because a feed changed its aggregator. Every decision that reads a price names the transaction that published it, and the ledger says which of the two ways was used (`price_source`).

## 3. Observations, counted apart

These are not "notable wallets". They are here for what they show, and the ledger gives their rows as their own groups.

**`watched`, one wallet.** `0xe9b08727131e34010b34006c660d4c1b436ec25f`, the wallet copy-guard was first pointed at, and the only wallet vet402 has anchored a record for. A token with the ticker NVDA and tokens that read as USDG, none of them the issuer's, were sent to it.

**`same_ticker_buyers`, the first 20 buyers of one token that uses the ticker SPY.**
- *Token.* `0x69e7778d46713e17572d610bdaca3943aa4e6219`. Its `symbol()` answers `SPY` and its `name()` answers `Spy Chip`; the selection reads both from the chain each time it runs (`selection.json`, `same_ticker_buyers.symbol` and `.name`). It is not in the issuer's list, where SPY is another address. Nothing here says who made it or why.
- *Left out.* The receiver of the token's first mint (the `to` of its first `Transfer` log whose `from` is the zero address, by block and log index), and the signer of that transaction. Also any wallet already in section 1 or the watched wallet.
- *Purchase.* The definition of section 2 with this token as T and the v4 PoolManager as the only venue. In the window the PoolManager sent this token 441 times to 224 receivers, all between blocks 87,803,610 and 87,836,198.
- *Group.* The 20 wallets with the earliest purchase, ordered by block, then by transaction hash ascending, then by address ascending.
- *Record.* Each is asked for once on vet402's free route. A wallet with no record stays in the group: its one counted purchase becomes a decision that opens nothing, with the HTTP status as the reason.
- *Value.* A practice position the ticker-copy baseline opens in this token is valued at the pool's own price: the pool's price in the swap of the purchase against the pool's last swap at or before the mark block. It is never assumed to be worth zero.

## 4. What the walk reads for each wallet

The moves of a wallet are every transaction its record lists as evidence and every transaction in which its record names a token under a listed ticker. For a `same_ticker_buyers` wallet the one purchase counted above is added.

## 5. Why 30 days, 30 wallets and 100 questions

The 33 tokens left official venues 9.65 million times in 30 days, and the public RPC answers at most 10,000 logs per query. Thirty days is what one pass reads in about two hours. vet402's free route allows ten requests a minute, so 100 questions take at least ten minutes and usually more. These three numbers are choices, stated here. `--days`, `--top` and `--max-asked` change them.
