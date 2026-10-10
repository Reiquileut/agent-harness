#!/usr/bin/env bash
# e2e suite: the `platforms` filter. AGENT_HARNESS_PLATFORM pins the platform
# so the Linux and Windows branches are both exercised on every CI OS.
# Sourced by scripts/ci-e2e.sh.

PLAT_ARGS="--mcp pencil --mcp chrome-devtools --preset codex-config --preset claude-settings"

# --- linux: Windows-only items are skipped, with a reason naming win32 ---
HPL="$(fresh_home)"
OUT_PL="$(AGENT_HARNESS_PLATFORM=linux PATH="/usr/bin:/bin:$(dirname "$(command -v node)")" harness "$HPL" init -y -a codex -a claude-code $PLAT_ARGS)"
chk "linux: pencil absent from codex config"  '! grep -q "mcp_servers.pencil" "$HPL/.codex/config.toml"'
chk "linux: chrome-devtools still installed"  'grep -q "mcp_servers.chrome-devtools" "$HPL/.codex/config.toml"'
chk "linux: no [windows] table in config.toml" '[ "$(tget "$HPL/.codex/config.toml" windows)" = "undefined" ]'
chk "linux: no computer_use.windows table"    '[ "$(tget "$HPL/.codex/config.toml" computer_use)" = "undefined" ]'
chk "linux: no Bash(powershell:*) allow"      '! grep -q "powershell" "$HPL/.claude/settings.json"'
chk "linux: skip line names win32"            'echo "$OUT_PL" | grep -q "win32"'

R_PL="$(mktemp -d)"
( cd "$R_PL" && AGENT_HARNESS_PLATFORM=linux node "$CLI" scaffold -y --mcp pencil --mcp chrome-devtools --no-gitignore >/dev/null 2>&1 )
chk "linux: scaffold .mcp.json omits pencil"  '! grep -q "pencil" "$R_PL/.mcp.json"'

# --- win32: both preset files land in the same dest without losing either ---
HPW="$(fresh_home)"
AGENT_HARNESS_PLATFORM=win32 PATH="/usr/bin:/bin:$(dirname "$(command -v node)")" harness "$HPW" init -y -a codex -a claude-code $PLAT_ARGS >/dev/null
chk "win32: pencil present"                   'grep -q "mcp_servers.pencil" "$HPW/.codex/config.toml"'
chk "win32: [windows] table present"          '[ "$(tget "$HPW/.codex/config.toml" windows.sandbox)" = "\"unelevated\"" ]'
chk "win32: base codex preset kept alongside" '[ "$(tget "$HPW/.codex/config.toml" model)" = "\"gpt-6.1-sol\"" ]'
chk "win32: Bash(powershell:*) present"       'grep -qF "Bash(powershell:*)" "$HPW/.claude/settings.json"'
chk "win32: base claude preset kept alongside" '[ "$(jget "$HPW/.claude/settings.json" effortLevel)" = "\"xhigh\"" ]'

cp "$HPW/.codex/config.toml" "$HPW/before.toml"
AGENT_HARNESS_PLATFORM=win32 PATH="/usr/bin:/bin:$(dirname "$(command -v node)")" harness "$HPW" init -y -a codex -a claude-code $PLAT_ARGS >/dev/null
chk "win32: platform run idempotent"          'diff -q "$HPW/before.toml" "$HPW/.codex/config.toml" >/dev/null'

# --- an invalid override fails loudly, naming the value and the accepted ones ---
OUT_PX="$(AGENT_HARNESS_PLATFORM=beos harness "$(fresh_home)" init -y -a codex --mcp pencil; echo "exit=$?")"
chk "invalid platform errors with value"      'echo "$OUT_PX" | grep -q "beos" && echo "$OUT_PX" | grep -q "win32" && echo "$OUT_PX" | grep -q "exit=1"'
