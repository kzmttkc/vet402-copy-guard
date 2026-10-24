#!/bin/bash
# Capture saved verify outputs with the 3-line header: $ command, node -v, UTC.
# The full runs go first: a quick run prints "about N minutes" from docs/verify/verify-five-runs.txt.
# Times depend on the load of the machine, so each label records the load average at the start.
set -euo pipefail
cd "$(dirname "$0")/.."
OUT=docs/verify
NODE_V=$(node -v)
utc_now() { date -u +"%Y-%m-%dT%H:%M:%SZ"; }
utc_hms() { date -u +"%H:%M:%SZ"; }
DAY=$(date -u +"%Y-%m-%d")

# the third line is the UTC time the run started (given), or now
header3() {
  local cmd="$1"
  printf '%s\n' "$ $cmd"
  printf '%s\n' "$NODE_V"
  printf '%s\n' "${2:-$(utc_now)}"
}

summary_line() {
  # last RESULT line plus the OK/FAIL line before it
  local text="$1"
  local result ok
  result=$(printf '%s\n' "$text" | grep '^RESULT:' | tail -1)
  ok=$(printf '%s\n' "$text" | grep -E '^[0-9]+ OK,' | tail -1)
  printf '%s %s' "$ok" "$result"
}

run_five() {
  local cmd="$1"
  local runs_file="$2"
  local one_file="$3"
  local label="$4"
  local tmpdir
  tmpdir=$(mktemp -d)
  {
    header3 "$cmd"
    printf '%s\n' "$label"
  } > "$runs_file"
  local i=1
  while [ "$i" -le 5 ]; do
    local start end secs code out t
    t=$(utc_hms)
    last_start=$(utc_now)
    start=$(date +%s)
    set +e
    out=$(eval "$cmd" 2>&1)
    code=$?
    set -e
    end=$(date +%s)
    secs=$((end - start))
    printf '%s\n' "$out" > "$tmpdir/run$i.txt"
    printf 'run %d (%s): exit %d, %d s, %s\n' "$i" "$t" "$code" "$secs" "$(summary_line "$out")" >> "$runs_file"
    echo "captured $cmd run $i: exit $code ${secs}s"
    i=$((i + 1))
  done
  {
    header3 "$cmd" "$last_start"
    cat "$tmpdir/run5.txt"
  } > "$one_file"
  rm -rf "$tmpdir"
}

echo "=== full x5 ==="
run_five "node verify.mjs" "$OUT/verify-five-runs.txt" "$OUT/verify-output.txt" \
  "node verify.mjs, five runs back to back on ${DAY} (UTC), this machine, public RPCs, load average $(sysctl -n vm.loadavg 2>/dev/null | awk '{print $2}'):"

echo "=== quick x5 ==="
run_five "node verify.mjs --quick" "$OUT/verify-quick-runs.txt" "$OUT/verify-quick-output.txt" \
  "node verify.mjs --quick, five runs back to back on ${DAY} (UTC), this machine, public RPCs, load average $(sysctl -n vm.loadavg 2>/dev/null | awk '{print $2}'):"

echo "=== one block ==="
{
  header3 "node verify.mjs 73953009"
  node verify.mjs 73953009
} > "$OUT/verify-one-block.txt"

echo "=== one digit changed --quick ==="
REC=docs/agent/first-paid-run/record.json
cp "$REC" /tmp/record.json.capture.bak
python3 -c '
from pathlib import Path
p=Path("docs/agent/first-paid-run/record.json")
t=p.read_text()
p.write_text(t.replace("\"realized_usd\": \"-170.59\"", "\"realized_usd\": \"-170.58\"", 1))
'
{
  header3 "node verify.mjs --quick"
  set +e
  node verify.mjs --quick
  set -e
} > "$OUT/verify-one-digit-changed.txt" || true
mv /tmp/record.json.capture.bak "$REC"
echo "record restored"

echo "done captures except node20 and test-results"
