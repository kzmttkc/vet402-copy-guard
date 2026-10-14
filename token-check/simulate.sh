#!/usr/bin/env bash
# Runs `cre workflow simulate token-check` for the three real transactions in
# payloads/ and saves the output under docs/token-check/. Needs `cre login` once.
# No key, no --broadcast: the workflow reads the public Robinhood Chain RPC and
# writes nothing onchain. The home directory in the output is written as ~/.
set -euo pipefail
cd "$(dirname "$0")/.."
CRE="${CRE:-$HOME/.cre/bin/cre}"
# bun installed from npm into ~/.local/bun-npm on this machine; any bun on PATH also works
[ -d "$HOME/.local/bun-npm/node_modules/.bin" ] && export PATH="$HOME/.local/bun-npm/node_modules/.bin:$PATH"
mkdir -p docs/token-check
for case in "${@:-qqq-buy fake-nvda fake-usdg}"; do
  for name in $case; do
    out="docs/token-check/simulate-${name}.txt"
    {
      echo "\$ cre version"; "$CRE" version
      echo "\$ cre workflow simulate token-check --target local-simulation --non-interactive --trigger-index 0 --http-payload token-check/payloads/${name}.json"
      "$CRE" workflow simulate token-check --target local-simulation --non-interactive --trigger-index 0 \
        --http-payload "token-check/payloads/${name}.json" 2>&1
    } | sed "s#${HOME}/#~/#g" | tee "$out"
    # the public RPC throttles bursts, leave it a moment between runs
    sleep 3
  done
done
