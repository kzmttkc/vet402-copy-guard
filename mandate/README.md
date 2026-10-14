# The mandate

`mandate.json` says who the agent acts for and what it may do: the principal's address, the agent's payment key, practice trades only, the rules and `limits.json` by hash, and the dates it is valid. The principal signs the one line in `mandate.message.txt`, which carries the keccak256 of `mandate.json`, and puts the signature in `mandate.sig`.

Every decision carries the mandate, the signature and the address the signature recovers to. Rule M1 opens nothing unless that address is the principal. `node verify.mjs` recovers the signer again with its own code.

## Sign it (the principal, once)

```bash
cd ~/vet402-bli
cast wallet sign --private-key "$(cat ~/.vet402/rwa-anchor.key)" "$(cat mandate/mandate.message.txt)" > mandate/mandate.sig
```

The line that is signed can be read first: `cat mandate/mandate.message.txt`. It is an EIP-191 message (the "sign message" of any wallet), so a hardware wallet or a browser wallet works too: sign the exact text of the file and save the `0x…` signature, 65 bytes, in `mandate/mandate.sig`.

Then walk again, so every decision carries the principal's signature:

```bash
./scripts/walk.sh
```

## When it has to be signed again

`bun agent/make-mandate.ts` rewrites `mandate.json` from `agent/rules.ts`, `agent/rules-v2.ts` and `limits.json`. If any of the three changes, the hash in the mandate changes and the old signature no longer covers it. That is intended: new rules or new limits need the principal's consent.

## The sample

`sample/` holds the same mandate with a testnet-only key as its principal, signed with that key. Its title starts with SAMPLE. It exists so the tests and a first walk can run before the principal has signed. The page and `verify.mjs` say so in plain words whenever a walk used it.
