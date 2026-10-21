#!/usr/bin/env bash
#
# CI job body on a macOS runner, with the repo checked out, installed and built (v1.7.0). Runs
# bootstrap/macos.sh for real under the stock /bin/bash 3.2, the repo as the harness source, then
# asserts the toolchain and the harness output. The runner is not a bare Mac (Homebrew, gh and
# setup-node's Node come with it), so those steps are skipped; what this proves is the macOS-only
# code: loading Homebrew, the shasum check, BSD tar/install, the TWG package and init on darwin.
# Artifacts: artifacts/e2e/bootstrap-macos*.{json,log}
set -uo pipefail

SRC="${SRC:-$PWD}"
ART="$SRC/artifacts/e2e"
BOOT_NAME=macos
REPORT="$ART/bootstrap-macos.json"
LOG="$ART/bootstrap-macos.log"
export PATH="$HOME/.local/bin:$PATH"
# shellcheck source=ci-bootstrap-checks.sh
. "$SRC/scripts/ci-bootstrap-checks.sh"

/bin/bash "$SRC/bootstrap/macos.sh" --yes --harness-src "$SRC" \
  --report "$REPORT" --overlay "$SRC/test/fixtures/overlay" 2>&1 | tee "$LOG"
boot_rc=${PIPESTATUS[0]}
hash -r

chk "bootstrap + harness exited 0 under /bin/bash $(/bin/bash -c 'echo "$BASH_VERSION"')" '[ "$boot_rc" -eq 0 ]'
check_bootstrap_toolchain
chk "twg on PATH (Atlassian silent package)" 'command -v twg'
chk "ai-memory macOS binary runs"         'ai-memory --version >/dev/null'
check_bootstrap_harness_output

exit $fail
