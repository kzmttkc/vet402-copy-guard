# Fields of `docs/ledger.json` (ledger_version 3)

For whoever writes the README and the page. Every number shown anywhere comes from these fields. `agent/ledger.ts` builds them and `verify.mjs` rebuilds them with separate code. All money is a string with two decimals, in USD. `null` means "not measured", never zero.

Rules whose wording changed from v1: B2 (every moved token is one the agent can name: a Stock Token of the issuer's list, USDG, WETH, or a token under a listed ticker), C1, C2, V1 (an official venue swapped and sent the token) and D1 (a purchase, as in SELECTION.md section 2). The ticker copy opens only on a purchase too.

Words: the second book is called **ticker copy** in the data's sentences (`baseline`, `note`). Its field names still start with `blind_copy`. A token that uses a listed ticker at an address the issuer did not list is `same_ticker` in the data. No field or sentence says fake, scam or look-alike.

## Top level

| Field | Meaning |
|---|---|
| `note`, `baseline` | the two fixed sentences: what the ledger is not, and what the ticker copy does |
| `decided_at`, `mark_block` | when the walk ran (UTC), and the Robinhood Chain block open positions are valued at |
| `limits`, `limits_keccak` | the user's limits the walk used |
| `mandate.status` | `sample` (signed, but by the testnet-only stand-in key), `signed_by_principal` (the real principal signed) or `not_signed` |
| `mandate.sample` | true when the mandate's title starts with SAMPLE |
| `mandate.signed_by_principal` | the signature recovers to the principal named in that mandate. True for a sample too, so show `status`, not this |
| `mandate.title`, `.principal`, `.agent_payment_key`, `.keccak`, `.valid_from`, `.valid_until` | as in the mandate file |
| `token_check` | `null`, or `{ source, keccak }`: the CRE token-check results file every decision names |
| `context.window` | `from_block`, `to_block`, `from_time`, `to_time` of the selection |
| `context.wallets[]` | `wallet`, `cohort` (`top_buyers`, `watched`, `same_ticker_buyers`), `rank`, `purchases_usd` (the wallet's own purchases in the window, top buyers only), `record_http` (200, or what vet402 answered) |
| `context.selection` | `asked`, `selected`, `stop` (why the asking stopped), `no_record[]`: every address asked that vet402 could build no record for, with `bound_rank`, `bound_usd`, `has_code`, `http_status`, `reason` |
| `context.price_source` | how a price at a past block was read (the public RPC keeps no historical state) |
| `context.pool_marks` | per Uniswap v4 pool id: the last swap at or before the mark block (`block`, `tx`, `log_index`, `sqrt_price_x96`) |
| `root` | Merkle root of all decisions |

## `totals`

| Field | Meaning |
|---|---|
| `decisions`, `wallets` | rows, and wallets with at least one row |
| `wallets_by_cohort.{top_buyers,watched,same_ticker_buyers}` | wallets followed, per group |
| `by_cohort.<cohort>` | `wallets`, `decisions`, `full`, `reduced`, `none`, `other_token_moves`, `copy_guard_opened`, `ticker_copy_opened`, `ticker_copy_in_other_tokens`. Use these whenever a number could be read as a sample: `same_ticker_buyers` was chosen because they bought the token |
| `wallets_without_record`, `decisions_without_record` | wallets in the walk vet402 gave no record for (only observation wallets can be such: a ranked address with no record is not selected, see `context.selection.no_record`), and their rows (all NONE) |
| `stock_moves` | every incoming Stock Token by how it came: `purchase`, `rotation`, `liquidity`, `swapped_unpaid`, `received`, `out`. Only a purchase can open a position, in either book |
| `first_move_time`, `last_move_time` | the earliest and the latest move in the ledger |
| `full`, `reduced`, `none` | decisions by size |
| `none_by_reason[]` | `{ reason, count }`, the headline of every NONE card without "No position: ", most frequent first |
| `other_tokens.moves` | moves in which a different token under a listed ticker (or USDG's) was part |
| `other_tokens.tokens`, `.tickers[]`, `.list[]` | how many such tokens, their tickers, and each one: `token`, `ticker`, `name`, `moves` |
| `other_tokens.sent_to_the_wallet` | no official swap put it out (a transfer, an airdrop) |
| `other_tokens.bought_by_the_wallet` | a purchase (the definition in SELECTION.md, section 2) |
| `other_tokens.received_unpaid` | it came by a swap the wallet did not pay for, a liquidity operation or a rotation |
| `other_tokens.by_arrival` | the same moves by the six kinds of `stock_moves` |
| `other_tokens.logged_as_sent_by_the_wallet` | a log that names the wallet as sender |
| `other_tokens.with_invisible_characters` | moves whose token name carries invisible characters |
| `copy_guard.opened`, `.closed`, `.open`, `.put_in_usd`, `.result_usd` | the copy-guard book |
| `copy_guard.followed_purchases_usd` | the wallets' own purchases copy-guard followed, at the feed: `count`, `median`, `sum`, `min`, `max` |
| `blind_copy.opened`, `.closed`, `.open` | the ticker-copy book |
| `blind_copy.in_stock_tokens` | `count`, `put_in_usd`, `result_usd` |
| `blind_copy.in_other_tokens` | `count`, `tokens`, `put_in_usd`, `measured`, `result_measured_usd` (null when none is measured), `not_measured` |
| `same_size.size_usd` | the one size of the second pass (the reduced size) |
| `same_size.opened_by_both` | `count`, `put_in_usd`, `result_usd`: the positions both books opened, at that size. Identical for both books by construction |
| `same_size.opened_by_ticker_copy_only_stock` | the Stock Token positions only the ticker copy opened, at that size |
| `same_size.opened_by_ticker_copy_only_other` | its positions in other tokens: `count`, `put_in_usd`, `measured`, `result_measured_usd`, `not_measured` |

## `rows[]` (one per decision)

`n`, `wallet`, `cohort`, `move_tx`, `move_block`, `move_time`, `tier`, `failed[]`, `checks { passed, total, flags[] }`, `card { headline, happened, blind_view, why[], so }`, `book`, `leaf`, and:

| Field | Meaning |
|---|---|
| `main` | `null`, or the token the card talks about: `token`, `kind` (`stock`, `usdg`, `same_ticker`, `unknown`), `ticker`, `arrival` |
| `main.arrival` | from the transaction alone: `purchase` (an official swap put it out and the wallet itself paid USDG, WETH or ETH; the signer may be a relayer), `rotation` (another Stock Token left the wallet), `liquidity` (a liquidity log is in the transaction), `swapped_unpaid`, `received` (no official swap: a transfer, an airdrop), `out` |
| `move_usd` | the Stock Token the wallet received, in USD at the feed, or null |
| `copy_guard.opened` | `null`, or `tier`, `notional_usd`, `entry_price_usd`, `shares` |
| `blind_copy.opened` | `null`, or `notional_usd`, `entry_price_usd` (null for another token), `asset` (`stock` or `same_ticker`) |

## Positions (`copy_guard_positions[]`, `blind_copy_positions[]`)

`n`, `wallet`, `token`, `symbol`, `tier`, `asset` (`stock`, `same_ticker`), `valued_by` (`feed`, `pool`, `none`), `notional_usd`, `entry_price_usd`, `pool_entry`, `opened_block`, `opened_time`, `status`, `exit { reason, block, price_usd, at_decision }`, `mark { block, price_usd, pool }`, `result_usd` (null when `valued_by` is `none`).

A `pool` value is the token's price in the pool's other asset at the pool's last swap, against the price in the swap the wallet bought in. It does not include that other asset's own move in USD, and it does not say a position of that size could have been sold there.

## Cards for a first screen

A row for each kind can be found without hard-coding a transaction:
- a token sent to the wallet: `main.kind == "same_ticker"` and `main.arrival == "received"`
- a purchase copy-guard followed at the reduced size: `copy_guard.opened != null`
- a different token under a listed ticker that the wallet bought: `main.kind == "same_ticker"` and `main.arrival == "purchase"`
- a rotation or a liquidity operation copy-guard declined: `main.kind == "stock"` and `main.arrival` is `rotation` or `liquidity`
- a name with invisible characters: `card.happened` contains `⟨U+`

## Marks in README.md that `scripts/readme-numbers.mjs` fills

`<!-- LEDGER:BEGIN -->` … `<!-- LEDGER:END -->` and `<!-- VERIFY:BEGIN -->` … `<!-- VERIFY:END -->`. Run `node scripts/readme-numbers.mjs` after any change to README.md around them.
