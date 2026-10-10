#!/usr/bin/env bash
#
# CI job body, run INSIDE a fresh ubuntu:24.04 container with the repo at /src
# (already built: /src/dist/cli.js). Runs bootstrap/ubuntu.sh end to end, then asserts
# the toolchain and the harness output. Artifacts: /src/artifacts/e2e/bootstrap-ubuntu*.{json,log}
set -uo pipefail

SRC="${SRC:-/src}"
ART="$SRC/artifacts/e2e"
REPORT="$ART/bootstrap-ubuntu.json"
CHECKS="$ART/bootstrap-ubuntu-checks.json"
LOG="$ART/bootstrap-ubuntu.log"
fail=0

mkdir -p "$ART"
echo '[]' > "$CHECKS"
export PATH="$HOME/.local/bin:$PATH"

# Append {name, pass} to the checks array (jq exists once the bootstrap's apt step ran).
record_check() {
  local tmp="$CHECKS.tmp"
  jq --arg n "$1" --argjson p "$2" '. + [{name:$n, pass:$p}]' "$CHECKS" > "$tmp" && mv "$tmp" "$CHECKS"
}

# Same style as scripts/ci-e2e.sh, plus a JSON record per check.
chk() {
  local pass=false
  if eval "$2"; then echo "  PASS  $1"; pass=true; else echo "  FAIL  $1"; fail=1; fi
  record_check "$1" "$pass"
}

node_at_least_22_18() {
  node -e 'const [a,b]=process.versions.node.split(".").map(Number);process.exit(a>22||(a===22&&b>=18)?0:1)'
}

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
for tool in node pnpm gh uv claude codex ai-memory task-master; do
  chk "$tool on PATH"                     "command -v $tool"
done
chk "node >= 22.18"                       'node_at_least_22_18'
chk "pnpm is major 10"                    '[ "$(pnpm -v | cut -d. -f1)" = 10 ]'
chk "report has ok:true"                  'jq -e ".ok == true" "$REPORT" >/dev/null'
chk "codex config.toml exists"            '[ -f "$HOME/.codex/config.toml" ]'
chk "claude settings.json exists"         '[ -f "$HOME/.claude/settings.json" ]'
chk "ai-memory skipped: AI_MEMORY_SERVER_URL unset" 'grep -q "export AI_MEMORY_SERVER_URL in your shell first" "$LOG"'
chk "opencode on PATH"                    'command -v opencode'
chk "overlay skill installed for claude"  '[ -f "$HOME/.claude/skills/fixture-private-skill/SKILL.md" ]'
chk "linux: no Windows-only pencil MCP"   '! grep -q "mcp_servers.pencil" "$HOME/.codex/config.toml"'
chk "linux: no [windows] codex table"     '! grep -q "^\[windows\]" "$HOME/.codex/config.toml"'
chk "global CLAUDE.md imports AGENTS.md"  'head -1 "$HOME/.claude/CLAUDE.md" | grep -qF "@~/.codex/AGENTS.md"'
chk "commit guard hook tests pass on this node" 'node --test "$HOME/.claude/hooks/bloquear-mencao-claude-commit.test.ts" >/dev/null 2>&1'
chk "statusline renders with python3"     'echo "{}" | bash "$HOME/.claude/statusline-command.sh" | grep -q "ctx"'
chk "init reported no failed action"      '! sed -n "/dist\/cli.js init/,\$p" "$LOG" | grep -q "✗"'

exit $fail
