#!/usr/bin/env bash
# Deploys RwaVerdictReceiver on Robinhood Testnet, verifies it on the explorer,
# points the workflow at it, then runs `cre workflow simulate --broadcast` for
# MATCH and MISMATCH so the verdicts land onchain. Testnet only.
#
# The key is a testnet-only key read from $KEY_FILE. It is never printed.
# The receiver trusts the CRE simulation forwarder (MockKeystoneForwarder),
# because that is the forwarder `cre workflow simulate --broadcast` writes through.
set -euo pipefail
cd "$(dirname "$0")/.."
KEY_FILE="${KEY_FILE:-$HOME/.vet402/bli-testnet.key}"
CRE="${CRE:-$HOME/.cre/bin/cre}"
RPC=https://rpc.testnet.chain.robinhood.com
EXPLORER=https://explorer.testnet.chain.robinhood.com
MOCK_FORWARDER=0x0b93082D9b3C7C97fAcd250082899BAcf3af3885
[ -d "$HOME/.local/bun-npm/node_modules/.bin" ] && export PATH="$HOME/.local/bun-npm/node_modules/.bin:$PATH"

[ -f "$KEY_FILE" ] || { echo "no key at $KEY_FILE"; exit 1; }
ADDR=$(cast wallet address --private-key "$(cat "$KEY_FILE")")
[ "$(cast chain-id --rpc-url "$RPC")" = "46630" ] || { echo "RPC is not Robinhood Testnet"; exit 1; }
BAL=$(cast balance "$ADDR" --rpc-url "$RPC")
echo "deployer $ADDR balance $BAL wei on Robinhood Testnet (46630)"
[ "$BAL" != "0" ] || { echo "no testnet ETH yet"; exit 1; }

if [ -z "${RECEIVER:-}" ]; then
  (cd contracts && forge create src/RwaVerdictReceiver.sol:RwaVerdictReceiver \
    --rpc-url "$RPC" --private-key "$(cat "$KEY_FILE")" --broadcast \
    --constructor-args "$MOCK_FORWARDER") | tee docs/deploy-receiver.txt
  RECEIVER=$(grep -o 'Deployed to: 0x[0-9a-fA-F]\{40\}' docs/deploy-receiver.txt | awk '{print $3}')
fi
echo "receiver $RECEIVER"
[ "$(cast call "$RECEIVER" 'FORWARDER()(address)' --rpc-url "$RPC")" = "$MOCK_FORWARDER" ]

(cd contracts && forge verify-contract "$RECEIVER" src/RwaVerdictReceiver.sol:RwaVerdictReceiver \
  --rpc-url "$RPC" --verifier blockscout --verifier-url "$EXPLORER/api/" \
  --constructor-args "$(cast abi-encode 'constructor(address)' "$MOCK_FORWARDER")" --watch) \
  | tee docs/verify-receiver.txt || echo "explorer verification failed, see docs/verify-receiver.txt"

python3 - "$RECEIVER" <<'PY'
import json, sys
p = 'rwa-verify/config.json'
c = json.load(open(p))
c['receiverAddress'] = sys.argv[1]
open(p, 'w').write(json.dumps(c, indent=2) + '\n')
PY

for case in match mismatch-one-char; do
  out="docs/broadcast-${case}.txt"
  {
    echo "\$ cre workflow simulate rwa-verify --target local-simulation --non-interactive --trigger-index 0 --broadcast --http-payload rwa-verify/payloads/${case}.json"
    CRE_ETH_PRIVATE_KEY="$(cat "$KEY_FILE")" "$CRE" workflow simulate rwa-verify --target local-simulation \
      --non-interactive --trigger-index 0 --broadcast --http-payload "rwa-verify/payloads/${case}.json" 2>&1
  } | tee "$out"
  TX=$(grep -o 'verdict written to .* tx 0x[0-9a-f]\{64\}' "$out" | grep -o '0x[0-9a-f]\{64\}$' || true)
  if [ -n "$TX" ]; then
    {
      echo "tx $EXPLORER/tx/$TX"
      cast receipt "$TX" --rpc-url "$RPC" --json | python3 -c '
import json, sys
r = json.load(sys.stdin)
print("status", r["status"], "block", int(r["blockNumber"], 16))
for l in r["logs"]:
    print("log", l["address"], " ".join(l["topics"]), l["data"])'
    } | tee "docs/broadcast-${case}.receipt.txt"
  fi
done
