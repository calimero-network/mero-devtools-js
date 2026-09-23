#!/usr/bin/env bash
# Tests for resolve-core-ref.sh. No network.
#
#   bash .github/scripts/resolve-core-ref.test.sh

set -uo pipefail

RESOLVE="$(cd "$(dirname "$0")" && pwd -P)/resolve-core-ref.sh"
PASS=0
FAIL=0

# check <label> <want-exit> <want-stdout> <body>
check() {
  local out got
  out=$(PR_BODY="$4" bash "$RESOLVE" 0.11.0-rc.41 2>/dev/null)
  got=$?
  if [ "$got" -eq "$2" ] && [ "$out" = "$3" ]; then
    PASS=$((PASS + 1)); printf '  ok    %s\n' "$1"
  else
    FAIL=$((FAIL + 1)); printf '  FAIL  %s\n     exit %s, stdout "%s"\n' "$1" "$got" "$out"
  fi
}

check "no body resolves to the default"  0 "0.11.0-rc.41"   ""
check "a core-ref line wins"             0 "feat/some-abi"  $'## Summary\n\ncore-ref: feat/some-abi\n'
check "the first of two lines wins"      0 "feat/first"     $'core-ref: feat/first\ncore-ref: feat/second'
check "another key is ignored"           0 "0.11.0-rc.41"   "sdk-ref: feat/x"
check "an unsafe ref is refused"         1 ""               "core-ref: --upload-pack=x"
check "path traversal is refused"        1 ""               "core-ref: a/../b"

printf '\n%s passed, %s failed\n' "$PASS" "$FAIL"
[ "$FAIL" -eq 0 ]
