#!/usr/bin/env bash
# One command for the whole practice ledger:
#   walk every wallet in docs/walk/wallets.json, write the Merkle root to Robinhood
#   Testnet through the CRE workflow, rebuild the page, and save the recheck.
#
# Which wallets: scripts/select-wallets.ts writes docs/walk/wallets.json and
# docs/walk/selection.json by the rule in docs/walk/SELECTION.md. It reads 30 days of
# public logs and takes a while, so it runs here only when its output is missing.
#
# Uses mandate/ when the principal has signed it (mandate/mandate.sig exists), otherwise
# the sample mandate, and says which. Nothing is paid: the walk is a replay on the free
# route. The only key used is the testnet-only key, for testnet gas.
set -euo pipefail
cd "$(dirname "$0")/.."
[ -d "$HOME/.local/bun-npm/node_modules/.bin" ] && export PATH="$HOME/.local/bun-npm/node_modules/.bin:$PATH"
[ -s docs/walk/selection.json ] || bun scripts/select-wallets.ts
if [ -s mandate/mandate.sig ]; then MANDATE=mandate; else MANDATE=mandate/sample; echo "mandate/mandate.sig is missing: walking with the SAMPLE mandate"; fi
bun agent/walk.ts --mandate "$MANDATE" --broadcast
node scripts/build-page.mjs
mkdir -p docs/verify
node verify.mjs | tee docs/verify/verify-output.txt
node scripts/build-page.mjs
node scripts/readme-numbers.mjs
