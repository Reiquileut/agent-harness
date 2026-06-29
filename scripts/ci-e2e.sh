#!/usr/bin/env bash
#
# End-to-end checks for CI. Exercises real writes into a throwaway HOME and a
# throwaway repo, then asserts results + idempotency. No real agents or network
# are needed: `-a` forces agent selection, and config-file merges + local skill
# copies don't require the agent binaries. Portable across Linux (HOME) and
# Windows git-bash (USERPROFILE) — both are set.
set -uo pipefail

CLI="$PWD/dist/cli.js"
fail=0

# Count keys under a top-level object in a JSON file: keys <file> <topLevelKey>
keys() {
  node -e 'const fs=require("fs");const o=JSON.parse(fs.readFileSync(process.argv[1]));console.log(Object.keys(o[process.argv[2]]||{}).length)' "$1" "$2"
}
chk() { if eval "$2"; then echo "  PASS  $1"; else echo "  FAIL  $1"; fail=1; fi; }

# --- init into a temp HOME (codex + opencode, everything) ---
H="$(mktemp -d)"
HOME="$H" USERPROFILE="$H" node "$CLI" init -y -a codex -a opencode --all >/dev/null 2>&1
chk "codex config.toml created"          '[ -f "$H/.codex/config.toml" ]'
chk "config.toml has chrome-devtools"    'grep -q "mcp_servers.chrome-devtools" "$H/.codex/config.toml"'
chk "opencode.json created"              '[ -f "$H/.config/opencode/opencode.json" ]'
chk "opencode.json has \$schema"         'grep -q "opencode.ai/config.json" "$H/.config/opencode/opencode.json"'
chk "anti-ai-slop copied to codex"       '[ -f "$H/.agents/skills/anti-ai-slop/SKILL.md" ]'
chk "impeccable scoped out of codex"     '[ ! -d "$H/.agents/skills/impeccable" ]'
chk "pencil scoped out of codex"         '! grep -q "mcp_servers.pencil" "$H/.codex/config.toml"'

cp "$H/.codex/config.toml" "$H/before.toml"
HOME="$H" USERPROFILE="$H" node "$CLI" init -y -a codex -a opencode --all >/dev/null 2>&1
chk "init idempotent (config unchanged)" 'diff -q "$H/before.toml" "$H/.codex/config.toml" >/dev/null'

# --- scaffold into a temp repo ---
R="$(mktemp -d)"
( cd "$R" && node "$CLI" scaffold --all -y >/dev/null 2>&1 )
chk "CLAUDE.md == AGENTS.md"             'diff -q "$R/CLAUDE.md" "$R/AGENTS.md" >/dev/null'
chk "CLAUDE.md is clean-code doc"        'head -1 "$R/CLAUDE.md" | grep -q "Clean Code for Agents"'
chk ".mcp.json has 4 servers"           '[ "$(keys "$R/.mcp.json" mcpServers)" = 4 ]'
chk "opencode.json has 2 servers"       '[ "$(keys "$R/opencode.json" mcp)" = 2 ]'
chk "skill installed into repo"         '[ -f "$R/.claude/skills/prd/SKILL.md" ]'
chk "claude-only skill not in .agents"  '[ ! -d "$R/.agents/skills/impeccable" ]'

echo ""
if [ "$fail" = 0 ]; then echo "E2E: all checks passed"; else echo "E2E: FAILURES above"; exit 1; fi
