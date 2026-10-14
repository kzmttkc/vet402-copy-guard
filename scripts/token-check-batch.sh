#!/usr/bin/env bash
# Checks every token the walk meets with the CRE workflow `token-check`, anchors the
# result on Robinhood Testnet, and rechecks every row without CRE.
#
#   scripts/token-check-batch.sh [tokens.json]
#
# tokens.json: an array of token addresses. Default: docs/walk/tokens.json. When that
# file does not exist yet, the list is built from the saved walk (docs/walk/trails.jsonl.gz
# and docs/ledger.json) into docs/token-check/tokens.json.
#
# Writes, under docs/token-check/:
#   results.json          { generated_at, cre_runs, tokens }, the fixed shape the walk reads
#   details.json          what stands behind each row, and which run checked which token
#   anchor.json           the transaction that holds keccak256(results.json)
#   batch/*.cre.txt       the output of every `cre workflow simulate` run
#   recheck.json          every row read again over plain JSON-RPC, and compared
#   recheck-output.txt    the same, as text
#
# Nothing is paid. The only key used is the testnet-only key, for testnet gas.
# Needs `cre login` once, and `bun install` in token-check/ and agent/.
set -euo pipefail
cd "$(dirname "$0")/.."
[ -d "$HOME/.local/bun-npm/node_modules/.bin" ] && export PATH="$HOME/.local/bun-npm/node_modules/.bin:$PATH"
TOKENS="${1:-docs/walk/tokens.json}"
if [ ! -f "$TOKENS" ]; then
  echo "$TOKENS is missing: building the list from the saved walk"
  node scripts/token-check-tokens.mjs
  TOKENS=docs/token-check/tokens.json
fi
bun scripts/token-check-batch.ts "$TOKENS"
node token-check/recheck.mjs docs/token-check/results.json | tee docs/token-check/recheck-output.txt
