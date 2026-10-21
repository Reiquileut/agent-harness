#!/usr/bin/env bash
# e2e suite: global hooks added in v1.7.0 — the Docker/disk hygiene guard for
# Claude Code (preset `docker-disk-hygiene`) and the Codex SessionStart hook that
# makes every Codex session read ai-memory first (part of the ai-memory
# integration). Both are .ts files run by node (type stripping, Node >= 22.18).
# Sourced by scripts/ci-e2e.sh.

HK_NODE_OK="$(node -e 'const [a,b]=process.versions.node.split(".").map(Number);console.log(a>22||(a===22&&b>=18)?1:0)')"

HHK="$(fresh_home)"
harness "$HHK" init -y -a claude-code --preset docker-disk-hygiene >/dev/null
HK_SETTINGS="$HHK/.claude/settings.json"
chk "hooks: docker hygiene script copied"           '[ -s "$HHK/.claude/hooks/higiene-docker-disco.ts" ]'
chk "hooks: docker hygiene on SessionStart"         'jget "$HK_SETTINGS" hooks.SessionStart | grep -q "higiene-docker-disco.ts"'
chk "hooks: docker hygiene on SubagentStart"        'jget "$HK_SETTINGS" hooks.SubagentStart | grep -q "higiene-docker-disco.ts"'
chk "hooks: docker hygiene guards Bash|PowerShell"  'jget "$HK_SETTINGS" hooks.PreToolUse | grep -q "Bash|PowerShell"'
chk "hooks: registered with an absolute home path"  '! jget "$HK_SETTINGS" hooks | grep -q "{{HOME}}"'
cp "$HK_SETTINGS" "$HHK/before-settings.json"
harness "$HHK" init -y -a claude-code --preset docker-disk-hygiene >/dev/null
chk "hooks: re-run registers nothing twice"         'diff -q "$HHK/before-settings.json" "$HK_SETTINGS" >/dev/null'
if [ "$HK_NODE_OK" = 1 ]; then
  HK_DENY="$(printf '{"hook_event_name":"PreToolUse","tool_name":"Bash","tool_input":{"command":"docker rm -f db"}}' | node "$HHK/.claude/hooks/higiene-docker-disco.ts")"
  chk "hooks: installed guard denies docker rm without -v" 'echo "$HK_DENY" | grep -q "deny"'
fi

# Codex start-up read, delivered with the ai-memory integration (fake CLI on PATH).
HK_BIN="$(mktemp -d)"
cp "$E2E_FIXTURES/bin/"* "$HK_BIN/" && chmod +x "$HK_BIN/ai-memory"
HCX="$(fresh_home)"
FAKE_AI_MEMORY_LOG="$(mktemp)" AI_MEMORY_SERVER_URL="https://memory.example.test" \
  PATH="$HK_BIN:/usr/bin:/bin:$(dirname "$(command -v node)")" harness "$HCX" init -y -a codex --integration ai-memory >/dev/null
chk "hooks: codex start-up hook copied"             '[ -s "$HCX/.codex/hooks/ai-memory-startup.ts" ] && [ -s "$HCX/.codex/hooks/ai-memory-startup.txt" ]'
chk "hooks: codex start-up hook registered"         'jget "$HCX/.codex/hooks.json" hooks.SessionStart | grep -q "ai-memory-startup.ts"'
if [ "$HK_NODE_OK" = 1 ]; then
  chk "hooks: codex start-up hook emits SessionStart context" 'node "$HCX/.codex/hooks/ai-memory-startup.ts" | grep -q "\"hookEventName\":\"SessionStart\""'
fi
