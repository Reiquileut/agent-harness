#!/usr/bin/env bash
# e2e suite: catalog `integrations` (ai-memory). A fake `ai-memory` on PATH
# (test/fixtures/bin) records its argv and whether the token reached it — the
# token value itself must never show up in output or in any file under HOME.
# Sourced by scripts/ci-e2e.sh.

FAKE_BIN="$(mktemp -d)"
cp "$E2E_FIXTURES/bin/"* "$FAKE_BIN/" && chmod +x "$FAKE_BIN/ai-memory"
NODE_DIR="$(dirname "$(command -v node)")"
BASE_PATH="/usr/bin:/bin:$NODE_DIR"
SECRET_TOKEN="tok-SEKRET-42"
INTEG_ARGS="-a codex -a claude-code --preset codex-global-instructions --integration ai-memory"

# run_integ <home> <log> <extra env…> -- <extra args…>: harness with the fake on PATH and the env set.
run_integ() {
  local home="$1" logf="$2"; shift 2
  FAKE_AI_MEMORY_LOG="$logf" AI_MEMORY_SERVER_URL="https://memory.example.test" \
    AI_MEMORY_AUTH_TOKEN="$SECRET_TOKEN" PATH="$FAKE_BIN:$BASE_PATH" harness "$home" init -y $INTEG_ARGS "$@"
}

# --- happy path ---
HI="$(fresh_home)"; LOG_I="$(mktemp)"
OUT_I="$(run_integ "$HI" "$LOG_I")"
chk "integ: install-mcp for codex"            'grep -q "argv=install-mcp --client codex --apply" "$LOG_I"'
chk "integ: install-hooks for codex"          'grep -q "argv=install-hooks --agent codex --apply" "$LOG_I"'
chk "integ: install-mcp for claude-code"      'grep -q "argv=install-mcp --client claude-code --apply" "$LOG_I"'
chk "integ: install-hooks for claude-code"    'grep -q "argv=install-hooks --agent claude-code --apply" "$LOG_I"'
chk "integ: once-step runs exactly once"      '[ "$(grep -c "argv=install-instructions" "$LOG_I")" = 1 ]'
chk "integ: once-step gets HOME expanded"     'grep "argv=install-instructions" "$LOG_I" | grep -q "/.codex/AGENTS.md" && ! grep -q "{{HOME}}" "$LOG_I"'
chk "integ: template existed before instructions" 'grep -q "target-had-template=yes" "$LOG_I"'
chk "integ: token reached the CLI via env"    'grep -q "token=set" "$LOG_I"'
chk "integ: token never printed"              '! echo "$OUT_I" | grep -q "$SECRET_TOKEN"'
chk "integ: token never written under HOME"   '! grep -rq "$SECRET_TOKEN" "$HI"'
chk "integ: ai-memory block before manifest"  '[ "$(grep -n "ai-memory:start" "$HI/.codex/AGENTS.md" | cut -d: -f1)" -lt "$(grep -n "BEGIN agent-harness" "$HI/.codex/AGENTS.md" | cut -d: -f1)" ]'
chk "integ: claude native memory off"         '[ "$(jget "$HI/.claude/settings.json" autoMemoryEnabled)" = "false" ] && [ "$(jget "$HI/.claude/settings.json" autoDreamEnabled)" = "false" ]'
chk "integ: manifest lists integrations"      'grep -q "Integrations" "$HI/.codex/AGENTS.md" && grep -q "ai-memory" "$HI/.codex/AGENTS.md"'

cp "$HI/.codex/AGENTS.md" "$HI/before-agents.md"; cp "$HI/.claude/settings.json" "$HI/before-settings.json"
run_integ "$HI" "$(mktemp)" >/dev/null
chk "integ: re-run keeps AGENTS.md unchanged" 'diff -q "$HI/before-agents.md" "$HI/.codex/AGENTS.md" >/dev/null'
chk "integ: re-run keeps settings unchanged"  'diff -q "$HI/before-settings.json" "$HI/.claude/settings.json" >/dev/null'

# --- binary missing: warn with an install hint, run nothing, exit 0 ---
OUT_NB="$(AI_MEMORY_SERVER_URL="https://memory.example.test" PATH="$BASE_PATH" harness "$(fresh_home)" init -y $INTEG_ARGS; echo "exit=$?")"
chk "integ: missing binary warns with hint"   'echo "$OUT_NB" | grep -q "akitaonrails/ai-memory" && echo "$OUT_NB" | grep -q "exit=0"'

# --- required env missing: warn listing the NAME only, run nothing ---
LOG_NE="$(mktemp)"
OUT_NE="$(FAKE_AI_MEMORY_LOG="$LOG_NE" PATH="$FAKE_BIN:$BASE_PATH" harness "$(fresh_home)" init -y $INTEG_ARGS; echo "exit=$?")"
chk "integ: missing env names AI_MEMORY_SERVER_URL" 'echo "$OUT_NE" | grep -q "AI_MEMORY_SERVER_URL" && echo "$OUT_NE" | grep -q "exit=0"'
chk "integ: missing env runs no command"      '[ ! -s "$LOG_NE" ]'

# --- dry-run previews the commands and runs none ---
LOG_DR="$(mktemp)"
OUT_DR="$(run_integ "$(fresh_home)" "$LOG_DR" --dry-run)"
chk "integ: dry-run prints the command"       'echo "$OUT_DR" | grep -q "run: ai-memory install-mcp --client codex --apply"'
chk "integ: dry-run runs nothing"             '[ ! -s "$LOG_DR" ]'
chk "integ: dry-run never prints the token"   '! echo "$OUT_DR" | grep -q "$SECRET_TOKEN"'

# --- a failing step is reported and the run continues ---
HF="$(fresh_home)"
OUT_F="$(FAKE_AI_MEMORY_FAIL=install-hooks run_integ "$HF" "$(mktemp)"; echo "exit=$?")"
chk "integ: failing step reported"            'echo "$OUT_F" | grep -qi "fail"'
chk "integ: run continues to the manifest"    'grep -q "BEGIN agent-harness" "$HF/.codex/AGENTS.md"'
