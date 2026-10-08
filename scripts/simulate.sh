#!/usr/bin/env bash
# Runs `cre workflow simulate` for the MATCH and MISMATCH payloads and saves the
# output under docs/. Needs `cre login` once. No key, no --broadcast: the EVM
# write is a dry run (eth_call against the CRE MockKeystoneForwarder).
set -euo pipefail
cd "$(dirname "$0")/.."
CRE="${CRE:-$HOME/.cre/bin/cre}"
# bun installed from npm into ~/.local/bun-npm on this machine; any bun on PATH also works
[ -d "$HOME/.local/bun-npm/node_modules/.bin" ] && export PATH="$HOME/.local/bun-npm/node_modules/.bin:$PATH"
for case in match mismatch-one-char; do
  out="docs/simulate-${case}.txt"
  {
    echo "\$ cre version"; "$CRE" version
    echo "\$ cre workflow simulate rwa-verify --target local-simulation --non-interactive --trigger-index 0 --http-payload @rwa-verify/payloads/${case}.json"
    "$CRE" workflow simulate rwa-verify --target local-simulation --non-interactive --trigger-index 0 \
      --http-payload "@rwa-verify/payloads/${case}.json" 2>&1
  } | tee "$out"
done
