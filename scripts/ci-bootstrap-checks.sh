#!/usr/bin/env bash
#
# Shared by the CI bootstrap jobs (scripts/ci-bootstrap-ubuntu.sh in a clean ubuntu:24.04 container,
# scripts/ci-bootstrap-macos.sh on a macOS runner): the check helpers plus the checks every OS must
# pass after a real `bootstrap/<os>.sh --yes --overlay test/fixtures/overlay` run (v1.7.0).
# Sourced, never run. Expects ART (artifact dir), BOOT_NAME (ubuntu|macos), LOG and REPORT.

CHECKS="$ART/bootstrap-$BOOT_NAME-checks.json"
fail=0
mkdir -p "$ART"
echo '[]' > "$CHECKS"

# Append {name, pass} to the checks array (jq exists once the bootstrap's first package step ran).
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

check_bootstrap_toolchain() {
  local tool
  for tool in node pnpm gh uv claude codex opencode ai-memory task-master; do
    chk "$tool on PATH" "command -v $tool"
  done
  chk "node >= 22.18"                       'node_at_least_22_18'
  chk "pnpm is major 10"                    '[ "$(pnpm -v | cut -d. -f1)" = 10 ]'
  # `ai-memory install-hooks` looks for its script bundle here; without it the Claude/Codex
  # hooks fail with "could not locate hooks directory" (found on a real Ubuntu setup, 2026-10-28).
  chk "ai-memory hooks bundle installed"    '[ -f "$HOME/.local/share/ai-memory/hooks/claude-code/session-start.sh" ] && [ -d "$HOME/.local/share/ai-memory/hooks/codex" ]'
  chk "report has ok:true"                  'jq -e ".ok == true" "$REPORT" >/dev/null'
}

check_bootstrap_harness_output() {
  chk "codex config.toml exists"            '[ -f "$HOME/.codex/config.toml" ]'
  chk "claude settings.json exists"         '[ -f "$HOME/.claude/settings.json" ]'
  chk "ai-memory skipped: AI_MEMORY_SERVER_URL unset" 'grep -q "export AI_MEMORY_SERVER_URL in your shell first" "$LOG"'
  chk "overlay default skill installed for claude" '[ -f "$HOME/.claude/skills/fixture-private-skill/SKILL.md" ]'
  chk "no Windows-only pencil MCP"          '! grep -q "mcp_servers.pencil" "$HOME/.codex/config.toml"'
  chk "no [windows] codex table"            '! grep -q "^\[windows\]" "$HOME/.codex/config.toml"'
  chk "global CLAUDE.md imports AGENTS.md"  'head -1 "$HOME/.claude/CLAUDE.md" | grep -qF "@~/.codex/AGENTS.md"'
  chk "global rules in their managed block" 'grep -q "BEGIN agent-harness:codex-global-instructions" "$HOME/.codex/AGENTS.md"'
  chk "commit guard hook tests pass on this node" 'node --test "$HOME/.claude/hooks/bloquear-mencao-claude-commit.test.ts" >/dev/null 2>&1'
  chk "docker hygiene hook tests pass on this node" 'node --test "$HOME/.claude/hooks/higiene-docker-disco.test.ts" >/dev/null 2>&1'
  chk "status line renders with node"       'echo "{}" | node "$HOME/.claude/statusline.ts" | grep -q "ctx"'
  chk "claude mods staged"                  '[ -f "$HOME/.claude/mods/.claude-plugin/marketplace.json" ]'
  chk "init reported no failed action"      '! sed -n "/dist\/cli.js init/,\$p" "$LOG" | grep -q "✗"'
}
