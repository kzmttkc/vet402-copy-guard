#!/usr/bin/env bash
# Deploys LedgerRootReceiver on Robinhood Testnet, verifies it on the explorer and
# writes its address into trail-anchor/config.json as ledgerReceiverAddress. Testnet only.
#
# The key is a testnet-only key read from $KEY_FILE. It is never printed. The receiver
# trusts CRE's simulation forwarder (MockKeystoneForwarder), like the other two
# receivers, because `cre workflow simulate --broadcast` writes through it.
set -euo pipefail
cd "$(dirname "$0")/.."
KEY_FILE="${KEY_FILE:-$HOME/.vet402/bli-testnet.key}"
RPC=https://rpc.testnet.chain.robinhood.com
EXPLORER=https://explorer.testnet.chain.robinhood.com
MOCK_FORWARDER=0x0b93082D9b3C7C97fAcd250082899BAcf3af3885
OUT=docs/walk/deploy-ledger-receiver.txt
mkdir -p docs/walk

[ -f "$KEY_FILE" ] || { echo "no key at $KEY_FILE"; exit 1; }
[ "$(cast chain-id --rpc-url "$RPC")" = "46630" ] || { echo "RPC is not Robinhood Testnet"; exit 1; }
ADDR=$(cast wallet address --private-key "$(cat "$KEY_FILE")")
echo "deployer $ADDR balance $(cast balance "$ADDR" --rpc-url "$RPC") wei on Robinhood Testnet (46630)"

(cd contracts && forge create src/LedgerRootReceiver.sol:LedgerRootReceiver \
  --rpc-url "$RPC" --private-key "$(cat "$KEY_FILE")" --broadcast \
  --constructor-args "$MOCK_FORWARDER") | tee "$OUT"
RECEIVER=$(grep -o 'Deployed to: 0x[0-9a-fA-F]\{40\}' "$OUT" | awk '{print $3}')
echo "receiver $RECEIVER"
[ "$(cast call "$RECEIVER" 'FORWARDER()(address)' --rpc-url "$RPC")" = "$MOCK_FORWARDER" ]

(cd contracts && forge verify-contract "$RECEIVER" src/LedgerRootReceiver.sol:LedgerRootReceiver \
  --rpc-url "$RPC" --verifier blockscout --verifier-url "$EXPLORER/api/" \
  --constructor-args "$(cast abi-encode 'constructor(address)' "$MOCK_FORWARDER")" --watch) \
  | tee docs/walk/verify-ledger-receiver.txt || echo "explorer verification failed, see docs/walk/verify-ledger-receiver.txt"

python3 - "$RECEIVER" <<'PY'
import json, sys
p = 'trail-anchor/config.json'
c = json.load(open(p))
c['ledgerReceiverAddress'] = sys.argv[1]
open(p, 'w').write(json.dumps(c, indent=2) + '\n')
PY
