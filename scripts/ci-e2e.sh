#!/usr/bin/env bash
#
# End-to-end checks: real writes into throwaway HOMEs and repos, asserting
# results + idempotency. No real agents are needed (`-a` forces agent
# selection; config merges and local skill copies don't need the binaries).
# Remote-source skills try the network but fall back to their bundled copies,
# so the assertions hold offline too. Portable across Linux (HOME) and Windows
# Git Bash (USERPROFILE) — both are set by `harness` in scripts/e2e/lib.sh.
#
# Usage:  bash scripts/ci-e2e.sh [suite…]   e.g.  bash scripts/ci-e2e.sh 40-overlay
# Artifact: artifacts/e2e/report.json (pass/fail decided by its "failed" count).
set -uo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
REPORT="${E2E_REPORT:-$REPO_ROOT/artifacts/e2e/report.json}"
E2E_RESULTS="$(mktemp)"
export REPO_ROOT E2E_RESULTS
cd "$REPO_ROOT"
# shellcheck source=e2e/lib.sh
. "$REPO_ROOT/scripts/e2e/lib.sh"

suites=("$@")
if [ "${#suites[@]}" = 0 ]; then
  for f in "$REPO_ROOT"/scripts/e2e/[0-9]*.sh; do suites+=("$(basename "$f" .sh)"); done
fi

for suite in "${suites[@]}"; do
  echo "== $suite"
  E2E_SUITE="$suite"
  # shellcheck disable=SC1090
  . "$REPO_ROOT/scripts/e2e/$suite.sh"
done

write_report "$REPORT"
echo ""
echo "report: $REPORT"
if [ "$fail" = 0 ]; then echo "E2E: all checks passed"; else echo "E2E: FAILURES above"; exit 1; fi
