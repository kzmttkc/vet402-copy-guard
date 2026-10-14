# Architecture

One page: who pays whom, where each check happens, and what stays on which chain.

```mermaid
flowchart TB
  subgraph person["The person"]
    P["Principal<br/>signs mandate/mandate.json<br/>writes limits.json"]
  end

  subgraph agent["copy-guard, the autonomous agent (agent/)"]
    W["1. See a move<br/>ERC-20 Transfer logs of a watched wallet"]
    E["2. Get the evidence<br/>vet402 /rwa record, feed value, venue"]
    R["3. Decide<br/>18 fixed rules, no language model<br/>FULL / REDUCED / NONE"]
    L["4. Practice ledger<br/>entry, size, exit, card<br/>next to a blind copy"]
  end

  subgraph cre["Chainlink CRE workflows (cre workflow simulate)"]
    G["x402 gate (agent/gate)<br/>402, 0.01 USDG, then run"]
    V["rwa-verify<br/>record against its anchor<br/>MATCH / MISMATCH"]
    T["token-check<br/>real Stock Token or look-alike<br/>share multiplier"]
    A["trail-anchor<br/>rerun the rules of one decision,<br/>or the Merkle root of a walk"]
  end

  subgraph main["Robinhood Chain 4663 (mainnet)"]
    RA["RwaAnchor 0x1955…c22d<br/>hash of the anchored record"]
    USDG["USDG<br/>0.01 from the agent 0xc380…ED94<br/>to vet402 0x973c…6227"]
    FEED["Chainlink price feeds<br/>AnswerUpdated logs"]
    TOK["Stock Token contracts<br/>code hash, beacon, multiplier"]
  end

  subgraph test["Robinhood Testnet 46630"]
    RV["RwaVerdictReceiver 0x8bf4…2Cb3<br/>RecordChecked"]
    RT["ReasoningTrailReceiver 0x9913…a0B3<br/>DecisionRecorded"]
    RL["LedgerRootReceiver 0xe3f0…F0C9<br/>LedgerAnchored"]
  end

  CHK["verify.mjs<br/>one file, no key, no install,<br/>no code shared with the agent"]

  P -- "signature (EIP-191)" --> R
  P -- "limits, named by hash" --> R
  W --> E --> R --> L
  E -- "pays over x402 (Permit2, Dexter facilitator)" --> G
  G --> V
  G -. "settles" .-> USDG
  V -- "reads over HTTP" --> RA
  V -- "writes" --> RV
  E -- "reads" --> FEED
  T -- "reads over HTTP" --> TOK
  R -- "one decision" --> A
  L -- "root of every decision" --> A
  A -- "writes" --> RT
  A -- "writes" --> RL
  CHK -. "rebuilds every hash, reruns every rule,<br/>replays the ledger, reads both chains" .-> main
  CHK -.-> test
```

## Who pays whom

| Payment | From | To | How | Status |
|---|---|---|---|---|
| 0.01 USDG for the wallet's record | the agent's wallet `0xc380…ED94` | vet402's wallet `0x973c…6227` | x402 v2, `exact`, Permit2, settled by the Dexter facilitator, which pays the gas | settled once, 2026-10-08, tx `0x65c314bd…87af61`. My own test: both wallets are mine |
| 0.01 USDG for one run of `rwa-verify` | the agent's wallet | the same vet402 wallet | the same terms, asked for by the gate in front of the workflow | dry run only: the agent read the 402 and built the payment without signing |
| testnet gas for the CRE writes | a testnet-only key | Robinhood Testnet | `cre workflow simulate --broadcast` | no real value |

The agent can pay one address. `pickAccept` refuses any other payee, token, chain or price before a signature exists, and the Permit2 witness pins the recipient inside the signed message. The cap is 1 USDG in code. The user's `limits.json` can lower it and cannot raise it.

## Where each check happens

| Check | Where | What it refuses |
|---|---|---|
| The record is the one vet402 anchored | CRE `rwa-verify` | one changed character, another contract, operator, wallet or date |
| The token is the issuer's real Stock Token | CRE `token-check`, straight from the chain | a look-alike with a copied ticker or name, without asking vet402 |
| The decision follows from its inputs | the agent, then CRE `trail-anchor`, then `verify.mjs` | a conclusion, a size or a card the rules do not give |
| The person authorized it | rule M1 in every decision | no signature, another signer, other rules, other limits, another payment key, another date |
| The size stays inside the user's limits | rules L1 and L2, and the sizes in `limits.json` | more than the daily limit, more open positions than allowed |
| Nothing was changed afterwards | `verify.mjs` | any file that no longer hashes to what is onchain |

## What stays where

| Where | What | Changeable afterwards |
|---|---|---|
| Robinhood Chain | the anchor of the demo wallet's record, the 0.01 USDG settlement, every move the agent judged, every feed value | no |
| Robinhood Testnet | one `RecordChecked` per CRE verdict, one `DecisionRecorded` per single decision, one `LedgerAnchored` with the Merkle root of a whole walk | no. All three receivers have no owner, no storage and no upgrade path |
| This repo | the records as read, the feed values, one trail per decision, the ledger, the mandate, the limits | yes, and `verify.mjs` then fails at the line that compares the hash |

The testnet receivers trust CRE's simulation forwarder, which accepts reports from anyone. An event there fixes a hash and a time. It does not show that a DON produced it. The content is shown to be right by rerunning it.

## A walk, step by step

1. `bun agent/walk.ts` reads each wallet's record once from vet402's free route and lists the moves the record names as evidence.
2. For each move, in block order, it reads the receipt, the block time, the venue the Stock Token came from and the Chainlink feed's last value at or before that block.
3. The 18 rules give a size. The practice book opens, or does not open, a position. Earlier positions leave when the copied wallet sells, when the feed crosses the stop or the target, or when the time limit passes.
4. Each decision becomes one JSON trail with a card. Its keccak256 is a leaf.
5. The CRE workflow `trail-anchor` recomputes the Merkle root from the leaves and writes it once to `LedgerRootReceiver`.
6. `node scripts/build-page.mjs` puts the ledger into `docs/index.html`.
7. `node verify.mjs` reruns all of it from the saved files and compares with both chains.
