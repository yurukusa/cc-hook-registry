#!/bin/bash
# cc-hook-registry tests
set -euo pipefail
PASS=0; FAIL=0
CLI="$(dirname "$0")/index.mjs"

test_cmd() {
    local desc="$1" cmd="$2" expect="$3"
    local out
    out=$(eval "$cmd" 2>&1) || true
    if echo "$out" | grep -q "$expect"; then
        echo "  PASS: $desc"; PASS=$((PASS+1))
    else
        echo "  FAIL: $desc (expected '$expect')"; FAIL=$((FAIL+1))
    fi
}

echo "--- cc-hook-registry tests ---"

test_cmd "--help" "node $CLI --help" "Commands"
test_cmd "search database" "node $CLI search database" "block-database-wipe"
test_cmd "search git" "node $CLI search git" "result"
test_cmd "search nonexistent" "node $CLI search zzzznotfound" "No hooks"
test_cmd "browse" "node $CLI browse" "hooks"
test_cmd "browse safety" "node $CLI browse safety" "Safety"
test_cmd "info destructive-guard" "node $CLI info destructive-guard" "Destructive"
test_cmd "info nonexistent" "node $CLI info notreal" "not found"
test_cmd "stats" "node $CLI stats" "Total hooks"
test_cmd "stats count" "node $CLI stats" "59"

echo ""
echo "Results: $PASS/$((PASS+FAIL)) passed"
[ "$FAIL" -gt 0 ] && exit 1
echo "All tests passed!"
