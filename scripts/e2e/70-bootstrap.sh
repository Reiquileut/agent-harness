#!/usr/bin/env bash
# e2e suite: bootstrap/ubuntu.sh in --dry-run (runs on any OS; the real install
# is exercised by the bootstrap-ubuntu CI job in a clean container). Sourced by
# scripts/ci-e2e.sh.

BOOT="$REPO_ROOT/bootstrap/ubuntu.sh"
OUT_BD="$(bash "$BOOT" --dry-run --yes --overlay "https://e2euser:SEK@RET456@example.test/private.git" 2>&1; echo "exit=$?")"
chk "bootstrap dry-run exits 0"                 'echo "$OUT_BD" | grep -q "exit=0"'
chk "bootstrap dry-run forwards the overlay"    'echo "$OUT_BD" | grep -q -- "--overlay https://\*\*\*@example.test/private.git"'
chk "bootstrap never prints URL credentials"    '! echo "$OUT_BD" | grep -qE "SEK|RET456"'
chk "bootstrap pins pnpm 10"                    'grep -q "pnpm@10" "$BOOT"'
OUT_BX="$(bash "$BOOT" --bogus 2>&1; echo "exit=$?")"
chk "bootstrap rejects unknown flags with the value" 'echo "$OUT_BX" | grep -q -- "--bogus" && echo "$OUT_BX" | grep -q "exit=1"'
