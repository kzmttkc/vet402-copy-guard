---
name: vet402-rwa-verify
description: Re-verify a wallet's vet402 /rwa record of Robinhood Chain Stock Tokens against its onchain anchor, through a Chainlink CRE workflow paid per call with x402 (0.01 USDG). Use for checking that a tokenized-stock record is the one that was anchored before an agent acts on it, for example before copying a wallet's trade. Do NOT use for price quotes, for trade execution, for chains other than Robinhood Chain, or as legal or investment advice.
---

# vet402 rwa-verify

A Chainlink CRE workflow behind an x402 gate. An agent pays 0.01 USDG, the gate runs the workflow, and the answer is `MATCH` or `MISMATCH` with one reason bit per failed check.

## Start here

Read these in order. Every path is on the gate's own host.

- `/.well-known/agent.json`: what the gate does, what it costs, where to pay.
- `/v1/catalog`: the workflows on offer (one: `rwa-verify`).
- `/v1/catalog/rwa-verify`: `input_schema`, `output_schema`, price, and how the workflow is executed.
- `/SKILL.md`: this file.

## Quick setup

```bash
git clone https://github.com/kzmttkc/vet402-copy-guard && cd vet402-copy-guard
cd agent && bun install && cd ..
bun agent/gate/server.ts                 # http://127.0.0.1:4021, CRE simulated
bun agent/gate/server.ts --broadcast     # also writes the verdict to Robinhood Testnet
```

The gate needs the CRE CLI (v1.37.0, `cre login` once) and Bun. It holds no key for payments. `--broadcast` uses a testnet-only key for testnet gas.

## Identity vs Payment

x402 only proves that a payment authorization was supplied. It says nothing about who the caller is. The gate asks for no account and keeps no caller data. If your agent needs to show who it acts for, that is a separate record: copy-guard carries a mandate signed by its principal inside every reasoning trail (see `mandate/`).

## What you sign

The gate's terms are fixed. Refuse anything else before you sign.

| Field | Value |
|---|---|
| x402 version | 2 |
| scheme | `exact` |
| network | `eip155:4663` (Robinhood Chain) |
| asset | USDG `0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168`, 6 decimals |
| amount | `10000` (0.01 USDG) |
| payTo | `0x973cD8a91A771C2C04C6036888F8175D6b4F6227` |
| transfer method | `permit2`, because USDG has no EIP-3009 |

You sign one Permit2 `PermitWitnessTransferFrom` (EIP-712). The spender is the canonical `x402ExactPermit2Proxy` `0x402085c248EeA27D92E8b30b2C58ed07f9E20001`, and the witness pins `to` to the `payTo` above. The Dexter facilitator sends the settlement and pays its gas. Your wallet needs gas once, to approve Permit2 for USDG.

## 1. Ask, and read the 402

`POST /v1/workflows/rwa-verify` with a JSON body (`{}` is enough) and no payment header. The answer is `402` with a `PAYMENT-REQUIRED` header: base64 JSON with `x402Version`, `resource` and `accepts`.

## 2. Check the terms and sign

Compare `accepts[0]` with the table above. Build the Permit2 typed data, sign it, and put `{ x402Version: 2, resource, accepted, payload: { signature, permit2Authorization } }` as base64 JSON in the `PAYMENT-SIGNATURE` header. `agent/gate/client.ts` is a working client with a spend cap, a ledger and a lock.

## 3. Send the same request with the payment

The gate checks the header and the signature, asks the facilitator to verify, runs `cre workflow simulate rwa-verify`, and settles only after the workflow has answered. A request that fails before that is not charged.

```json
{
  "workflow": "vet402-rwa-verify",
  "mode": "broadcast",
  "result": { "verdict": "MATCH", "reasonBits": 0, "anchorTx": "0x15f9…5c7f", "recomputedFactsHash": "0x9d0e…21ee", "anchoredFactsHash": "0x9d0e…21ee" },
  "verdict_tx": "0x…",
  "payment": { "status": "settled", "transaction": "0x…", "payer": "0x…" }
}
```

The `PAYMENT-RESPONSE` header carries the facilitator's settlement result.

## 4. Do not take the gate's word for it

`verdict_tx` is a `RecordChecked` event on Robinhood Testnet. `payment.transaction` is a USDG transfer on Robinhood Chain. `node verify.mjs` in the repo rechecks both, and the anchor itself, with no key and no install.

## Input

All fields are optional. With `{}` the workflow checks the demo wallet's anchor.

| Field | Meaning |
|---|---|
| `tx` | the anchor transaction on Robinhood Chain |
| `recordUrl` | https URL of the anchored record JSON under test |
| `record` | the record under test, inline, instead of `recordUrl` |
| `operator` | the operator whose anchor is accepted when the record names none |

## Limits

- The workflow runs under `cre workflow simulate`. Nothing is deployed to a DON, and a simulated write goes through CRE's simulation forwarder, which accepts reports from anyone. The answer is not a DON attestation.
- Robinhood Chain mainnet is not on CRE's supported network list, so the anchor is read over the HTTP capability and the verdict is written to Robinhood Testnet.
- The answer says whether a record matches its anchor. It is not legal or investment advice.
