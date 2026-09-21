#!/usr/bin/env bash
# Resolve which core ref the schema parity job compares against: a
# `core-ref: <ref>` line in the PR body (env PR_BODY), else the default (arg $1).
set -euo pipefail

DEFAULT_REF="${1:?usage: resolve-core-ref.sh <default-ref>}"

ref="$(printf '%s\n' "${PR_BODY:-}" | sed -n 's/^[[:space:]]*core-ref:[[:space:]]*\([^[:space:]]*\).*/\1/p' | head -n1)"
if [ -z "$ref" ]; then
  echo "$DEFAULT_REF"
  exit 0
fi

# The ref is fed to actions/checkout, so hold it to a safe git-ref shape.
case "$ref" in
  *[!A-Za-z0-9._/-]* | *..* | -* | /*)
    echo "resolve-core-ref: refusing unsafe core-ref: $ref" >&2
    exit 1
    ;;
esac
echo "$ref"
