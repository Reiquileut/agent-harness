#!/usr/bin/env bash
#
# CI job body, run INSIDE a fresh ubuntu:24.04 container with the repo at /src
# (already built: /src/dist/cli.js). Runs bootstrap/ubuntu.sh end to end, then asserts
# the toolchain and the harness output. Artifacts: /src/artifacts/e2e/bootstrap-ubuntu*.{json,log}
set -uo pipefail

SRC="${SRC:-/src}"
ART="$SRC/artifacts/e2e"
BOOT_NAME=ubuntu
REPORT="$ART/bootstrap-ubuntu.json"
LOG="$ART/bootstrap-ubuntu.log"
export PATH="$HOME/.local/bin:$PATH"
# shellcheck source=ci-bootstrap-checks.sh
. "$SRC/scripts/ci-bootstrap-checks.sh"

# 1) prerequisites only (a fresh box has no node/pnpm yet)
bash "$SRC/bootstrap/ubuntu.sh" --yes --skip-harness 2>&1 | tee "$LOG"
prereq_rc=${PIPESTATUS[0]}
hash -r

# 2) the harness as a fresh machine gets it: a clean copy with Linux-installed deps.
#    A mounted node_modules belongs to the host OS (pnpm's Windows junctions don't
#    resolve inside Linux), so it is never used.
WORK="$(mktemp -d)/agent-harness"
mkdir -p "$WORK"
tar -C "$SRC" --exclude=./node_modules --exclude=./.git --exclude=./artifacts -cf - . | tar -C "$WORK" -xf -
# npm, like `npx github:reiquileut/agent-harness` does on a new machine.
( cd "$WORK" && npm install --omit=dev --no-audit --no-fund ) >> "$LOG" 2>&1

# 3) re-run the bootstrap: every prerequisite is now skipped, then init runs.
bash "$SRC/bootstrap/ubuntu.sh" --yes --harness-src "$WORK" \
  --report "$REPORT" --overlay "$SRC/test/fixtures/overlay" 2>&1 | tee -a "$LOG"
boot_rc=${PIPESTATUS[0]}
hash -r

chk "prerequisites installed (exit 0)"   '[ "$prereq_rc" -eq 0 ]'
chk "bootstrap + harness exited 0"        '[ "$boot_rc" -eq 0 ]'
check_bootstrap_toolchain
check_bootstrap_harness_output

exit $fail
