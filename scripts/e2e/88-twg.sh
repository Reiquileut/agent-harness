#!/usr/bin/env bash
# e2e suite: the Atlassian TWG skills integration (v1.7.0). The skills are
# Atlassian-licensed, so the harness never bundles them: it runs the user's own
# `twg skills install`. A fake `twg` on PATH records the call. Sourced by
# scripts/ci-e2e.sh.

TWG_BIN="$(mktemp -d)"
cp "$E2E_FIXTURES/bin/"* "$TWG_BIN/" && chmod +x "$TWG_BIN/twg"
TWG_BASE_PATH="/usr/bin:/bin:$(dirname "$(command -v node)")"

TWG_LOG="$(mktemp)"
FAKE_TWG_LOG="$TWG_LOG" PATH="$TWG_BIN:$TWG_BASE_PATH" harness "$(fresh_home)" init -y -a claude-code -a codex --integration twg-skills >/dev/null
chk "twg: skills installed through the twg CLI"    'grep -q "argv=skills install -y --agent claude --agent opencode" "$TWG_LOG"'
chk "twg: one install covers every agent"          '[ "$(grep -c "argv=skills install" "$TWG_LOG")" = 1 ]'

OUT_TWG_MISSING="$(PATH="$TWG_BASE_PATH" harness "$(fresh_home)" init -y -a codex --integration twg-skills; echo "exit=$?")"
chk "twg: missing CLI warns with a hint and exits 0" 'echo "$OUT_TWG_MISSING" | grep -q "twg setup" && echo "$OUT_TWG_MISSING" | grep -q "exit=0"'
chk "twg: no Atlassian skill is bundled"            '! ls "$REPO_ROOT/assets/skills" | grep -q "^twg"'
