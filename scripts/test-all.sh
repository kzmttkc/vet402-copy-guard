#!/bin/bash
# Every test in the README order, from a clean clone. The first lines name the command, the Node
# version, the UTC time, the Bun version and the commit, so a saved copy says what it tested.
#   scripts/test-all.sh > docs/verify/test-results.txt
set -u
cd "$(dirname "$0")/.."
BUN="${BUN:-bun}"
echo '$ scripts/test-all.sh'
node -v
date -u +%Y-%m-%dT%H:%M:%SZ
echo "bun $("$BUN" -v), commit $(git rev-parse --short HEAD)"
for d in rwa-verify trail-anchor token-check agent; do (cd "$d" && "$BUN" install --frozen-lockfile >/dev/null 2>&1) || echo "== $d: bun install --frozen-lockfile failed"; done
for d in rwa-verify trail-anchor token-check agent; do
	echo "== $d"
	(cd "$d" && "$BUN" test 2>&1 | grep -E '^ *[0-9]+ (pass|fail)$|^Ran |^\(fail\)')
done
echo '== repo root'
"$BUN" test verify.numbers.test.ts verify.order.test.ts check-surfaces.test.ts recount-vet402.test.ts 2>&1 | grep -E '^ *[0-9]+ (pass|fail)$|^Ran |^\(fail\)'
echo '== contracts'
if command -v forge >/dev/null; then
	(cd contracts && forge install foundry-rs/forge-std --no-git >/dev/null 2>&1; forge test 2>&1 | grep -E '^Ran [0-9]+ test suites')
else
	echo 'forge not installed'
fi
echo "git status after the run: $(git status --porcelain | wc -l | tr -d ' ') changed files"
