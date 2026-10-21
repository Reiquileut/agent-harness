#!/usr/bin/env bash
# e2e suite: the owner's global rules in ~/.codex/AGENTS.md (v1.7.0 `managed-block`).
# v1.6's `copy keep` skipped any existing file, so a machine whose AGENTS.md
# held only the post-install manifest never got the rules. Now the rules are a
# marked block (updated in place on every run); a hand-made copy of the rules
# that predates the markers is left alone. Sourced by scripts/ci-e2e.sh.

RULES_ARGS="-a codex -a claude-code --preset codex-global-instructions"

HRF="$(fresh_home)"
harness "$HRF" init -y $RULES_ARGS >/dev/null
chk "rules: fresh machine gets the rules block"     'grep -q "BEGIN agent-harness:codex-global-instructions" "$HRF/.codex/AGENTS.md" && grep -q "Clean Code for Agents" "$HRF/.codex/AGENTS.md"'
chk "rules: Claude imports the Codex AGENTS.md"     'grep -qx "@~/.codex/AGENTS.md" "$HRF/.claude/CLAUDE.md"'
cp "$HRF/.codex/AGENTS.md" "$HRF/before-agents.md"
harness "$HRF" init -y $RULES_ARGS >/dev/null
chk "rules: re-run leaves AGENTS.md unchanged"      'diff -q "$HRF/before-agents.md" "$HRF/.codex/AGENTS.md" >/dev/null'

HRM="$(fresh_home)"; mkdir -p "$HRM/.codex"
printf '<!-- BEGIN agent-harness -->\n## Provisioned by agent-harness v1.3.0\n<!-- END agent-harness -->\n' > "$HRM/.codex/AGENTS.md"
harness "$HRM" init -y $RULES_ARGS >/dev/null
chk "rules: manifest-only AGENTS.md gets the rules" 'grep -q "Clean Code for Agents" "$HRM/.codex/AGENTS.md"'
chk "rules: the old manifest block is kept"         'grep -q "Provisioned by agent-harness" "$HRM/.codex/AGENTS.md"'

HRU="$(fresh_home)"; mkdir -p "$HRU/.codex"
printf '# Clean Code for Agents\n\nmy own edited rules\n' > "$HRU/.codex/AGENTS.md"
harness "$HRU" init -y $RULES_ARGS >/dev/null
chk "rules: an unmanaged copy is left alone"        '! grep -q "BEGIN agent-harness:codex-global-instructions" "$HRU/.codex/AGENTS.md" && grep -q "my own edited rules" "$HRU/.codex/AGENTS.md"'
