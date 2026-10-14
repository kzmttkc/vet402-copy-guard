# The mandate

`mandate.json` says who the agent acts for and what it may do: the principal's address, the agent's payment key, practice trades only, the rules and `limits.json` by hash, and the dates it is valid. The principal signs the one line in `mandate.message.txt`, which carries the keccak256 of `mandate.json`, and puts the signature in `mandate.sig`.

Every decision carries the mandate, the signature and the address the signature recovers to. Rule M1 opens nothing unless that address is the principal the mandate names. `node verify.mjs` recovers the signer again with its own code.

The principal is an address. Nothing in this folder ties it to a legal identity, and signing is not a registration anywhere.

## What it allows and forbids

`scope` in `mandate.json`, word for word.

- may: "read public chain data and vet402 /rwa records"
- may: "pay for evidence over x402 in USDG on Robinhood Chain, within the limits named below"
- may: "record practice trades and write the hash of each reasoning trail onchain"
- may not: "place a real trade"
- may not: "pay any address other than 0x973cD8a91A771C2C04C6036888F8175D6b4F6227"
- may not: "move any asset other than the USDG it pays for evidence"
- may not: "act on a move when a rule of group A, B or M fails, except rule A4 when the record has no anchor yet, in which case the user's limits grade the size down"

The last line matches what the rules do. A record that fails its anchor check opens nothing. A record that has no anchor yet is weaker evidence, and `evidence.record_not_anchored` in `limits.json` says what the user wants then: a reduced position or none.

## Sign it (the principal, once)

Run this from the root of the repo, with the principal's own key. `PRINCIPAL_KEY_FILE` stands for wherever that key is kept. It is never copied into the repo.

```bash
cast wallet sign --private-key "$(cat "$PRINCIPAL_KEY_FILE")" "$(cat mandate/mandate.message.txt)" > mandate/mandate.sig
```

The line that is signed can be read first: `cat mandate/mandate.message.txt`. It is an EIP-191 message (the "sign message" of any wallet), so a hardware wallet or a browser wallet works too: sign the exact text of the file and save the `0x…` signature, 65 bytes, in `mandate/mandate.sig`.

Then walk again, so every decision carries the principal's signature:

```bash
./scripts/walk.sh
```

## When it has to be signed again

`bun agent/make-mandate.ts` rewrites `mandate.json` from `agent/rules.ts`, `agent/rules-v2.ts` and `limits.json`. If any of the three changes, the hash in the mandate changes and the old signature no longer covers it. That is intended: new rules or new limits need the principal's consent.

## The sample

`sample/` holds the same mandate with a testnet-only key as its principal, signed with that key. Its title starts with SAMPLE. It exists so the tests and a first walk can run before the principal has signed.

A walk that used the sample says so wherever a reader could take it for the principal's signature. The page shows a grey mark, "Sample mandate (not yet signed by the principal)", on every card and above the mandate table. The README's mandate block and `verify.mjs` say the same in a sentence. Only a walk under `mandate.json` with the principal's own signature shows "Mandate signed by the principal".
