#!/usr/bin/env bash
# e2e suite: machine-level `init` for codex + opencode, then claude-code (no
# claude binary on PATH). Sourced by scripts/ci-e2e.sh — uses lib.sh helpers.
# Platform is pinned to win32 here so the Pencil (Windows-only) assertions
# hold on every CI OS; scripts/e2e/30-platform.sh covers the linux side.

MCPS="--mcp figma --mcp chrome-devtools --mcp playwright --mcp context7 --mcp taskmaster --mcp pencil --mcp stitch --mcp lottiefiles-creator"
SKILLS="--skill anti-ai-slop --skill prd --skill shadcn --skill archify --skill orca-cli --skill grilling --skill domain-modeling"
PLUGINS="--plugin claude-official --plugin claude-code-warp --plugin codex-openai-curated --plugin codex-openai-bundled --plugin typesafe-ai"
SUBAGENTS="--subagent documentation-auditor --subagent impeccable-manual-edit-applier"
PRESETS="--preset codex-config --preset codex-global-instructions"

# --- codex + opencode ---
H="$(fresh_home)"
AGENT_HARNESS_PLATFORM=win32 harness "$H" init -y -a codex -a opencode $MCPS $SKILLS $PLUGINS $SUBAGENTS $PRESETS >/dev/null
chk "codex config.toml created"          '[ -f "$H/.codex/config.toml" ]'
chk "config.toml has chrome-devtools"    'grep -q "mcp_servers.chrome-devtools" "$H/.codex/config.toml"'
chk "config.toml has playwright"         'grep -q "mcp_servers.playwright" "$H/.codex/config.toml"'
chk "pencil uses codexCLI in codex"      '[ "$(tget "$H/.codex/config.toml" mcp_servers.pencil.args)" = "[\"--app\",\"desktop\",\"--agent\",\"codexCLI\"]" ]'
chk "taskmaster extra keys in codex"     '[ "$(tget "$H/.codex/config.toml" mcp_servers.taskmaster.tools.set_task_status.approval_mode)" = "\"approve\"" ]'
chk "stitch scoped out of codex"         '! grep -q "mcp_servers.stitch" "$H/.codex/config.toml"'
chk "codex marketplace registered"       '[ "$(tget "$H/.codex/config.toml" marketplaces.claude-plugins-official.source)" = "\"https://github.com/anthropics/claude-plugins-official.git\"" ]'
chk "codex plugin enabled"               '[ "$(tget "$H/.codex/config.toml" plugins.context7@claude-plugins-official.enabled)" = "true" ]'
chk "codex builtin plugin enabled, no marketplace" '[ "$(tget "$H/.codex/config.toml" plugins.gmail@openai-curated.enabled)" = "true" ] && [ "$(tget "$H/.codex/config.toml" marketplaces.openai-curated)" = "undefined" ]'
chk "codex bundled has code-review"      '[ "$(tget "$H/.codex/config.toml" plugins.code-review@openai-bundled.enabled)" = "true" ]'
chk "codex bundled no longer has sites"  '[ "$(tget "$H/.codex/config.toml" plugins.sites@openai-bundled)" = "undefined" ]'
chk "typesafe plugin enabled in codex"   '[ "$(tget "$H/.codex/config.toml" plugins.typesafe@typesafe-ai.enabled)" = "true" ]'
chk "claude-only plugin not in codex"    '! grep -q "claude-code-warp" "$H/.codex/config.toml"'
chk "codex preset merged (model)"        '[ "$(tget "$H/.codex/config.toml" model)" = "\"gpt-6.1-sol\"" ]'
chk "codex preset merged (service tier)" '[ "$(tget "$H/.codex/config.toml" service_tier)" = "\"priority\"" ]'
chk "codex native memories off (ai-memory)" '[ "$(tget "$H/.codex/config.toml" features.memories)" = "false" ]'
chk "codex preset merged (features)"     '[ "$(tget "$H/.codex/config.toml" features.multi_agent)" = "true" ]'
chk "codex global AGENTS.md from template" 'head -1 "$H/.codex/AGENTS.md" | grep -q "Clean Code for Agents"'
chk "template has model routing"         'grep -q "## Model routing" "$H/.codex/AGENTS.md"'
chk "template has git workflow"          'grep -q "## Git workflow" "$H/.codex/AGENTS.md"'
chk "manifest appended to codex AGENTS.md" 'grep -q "BEGIN agent-harness" "$H/.codex/AGENTS.md"'
chk "manifest lists a prerequisite"      'grep -q "Orca desktop app" "$H/.codex/AGENTS.md"'
chk "manifest lists codex plugins"       'grep -q "codex-openai-curated" "$H/.codex/AGENTS.md"'
chk "manifest lists presets"             'grep -q "codex-config" "$H/.codex/AGENTS.md"'
chk "codex custom agent (toml) copied"   '[ -s "$H/.codex/agents/documentation-auditor.toml" ]'
chk "opencode.json created"              '[ -f "$H/.config/opencode/opencode.json" ]'
chk "opencode.json has \$schema"         'grep -q "opencode.ai/config.json" "$H/.config/opencode/opencode.json"'
chk "pencil uses openCodeCLI in opencode" 'grep -q "openCodeCLI" "$H/.config/opencode/opencode.json"'
chk "anti-ai-slop copied to codex"       '[ -f "$H/.agents/skills/anti-ai-slop/SKILL.md" ]'
chk "shadcn copied to codex"             '[ -f "$H/.agents/skills/shadcn/SKILL.md" ]'
chk "binary asset copied intact"         'cmp -s "$REPO_ROOT/assets/skills/shadcn/assets/shadcn.png" "$H/.agents/skills/shadcn/assets/shadcn.png"'
chk "archify installed (remote or fallback)" '[ -f "$H/.agents/skills/archify/SKILL.md" ]'
chk "deep nested skill file copied"      '[ -f "$H/.agents/skills/archify/renderers/shared/geometry.mjs" ]'
chk "grilling installed (remote or fallback)" '[ -f "$H/.agents/skills/grilling/SKILL.md" ]'
chk "domain-modeling installed (remote or fallback)" '[ -f "$H/.agents/skills/domain-modeling/SKILL.md" ]'
chk "no claude dirs created (no claude-code)" '[ ! -d "$H/.claude" ]'

cp "$H/.codex/config.toml" "$H/before.toml"
cp "$H/.codex/AGENTS.md" "$H/before-agents.md"
cp "$H/.config/opencode/opencode.json" "$H/before.json"
AGENT_HARNESS_PLATFORM=win32 harness "$H" init -y -a codex -a opencode $MCPS $SKILLS $PLUGINS $SUBAGENTS $PRESETS >/dev/null
chk "init idempotent (config.toml unchanged)"  'diff -q "$H/before.toml" "$H/.codex/config.toml" >/dev/null'
chk "init idempotent (AGENTS.md unchanged)"    'diff -q "$H/before-agents.md" "$H/.codex/AGENTS.md" >/dev/null'
chk "init idempotent (opencode.json unchanged)" 'diff -q "$H/before.json" "$H/.config/opencode/opencode.json" >/dev/null'

# --- claude-code: custom agents + presets + global instructions; no claude binary on PATH ---
HC="$(fresh_home)"
NO_CLAUDE_PATH="/usr/bin:/bin:$(dirname "$(command -v node)")"
CLAUDE_ARGS="-a claude-code $SUBAGENTS --preset claude-settings --preset codex-global-instructions --preset no-ai-attribution --plugin claude-official --skill prd"
PATH="$NO_CLAUDE_PATH" harness "$HC" init -y $CLAUDE_ARGS >/dev/null
chk "documentation-auditor copied to ~/.claude/agents"      '[ -s "$HC/.claude/agents/documentation-auditor.md" ]'
chk "impeccable-manual-edit-applier copied to ~/.claude/agents" '[ -s "$HC/.claude/agents/impeccable-manual-edit-applier.md" ]'
chk "no toml agents for claude"          '[ ! -f "$HC/.claude/agents/documentation-auditor.toml" ]'
chk "claude settings: no pinned model"   '[ "$(jget "$HC/.claude/settings.json" model)" = "undefined" ]'
chk "claude settings: effort xhigh"      '[ "$(jget "$HC/.claude/settings.json" effortLevel)" = "\"xhigh\"" ]'
chk "claude settings: opus-5-5 xhigh"    '[ "$(jget "$HC/.claude/settings.json" modelSettings.claude-opus-5-5.effortLevel)" = "\"xhigh\"" ]'
chk "claude settings permissions"        '[ "$(keys "$HC/.claude/settings.json" permissions)" = 2 ]'
chk "statusline script copied"           '[ -s "$HC/.claude/statusline-command.sh" ]'
chk "statusline prefers python3"         'grep -q "python3" "$HC/.claude/statusline-command.sh"'
chk "plugins fallback (no claude CLI)"   '[ "$(jget "$HC/.claude/settings.json" enabledPlugins.context7@claude-plugins-official)" = "true" ]'
chk "global CLAUDE.md imports codex AGENTS.md" 'head -1 "$HC/.claude/CLAUDE.md" | grep -qF "@~/.codex/AGENTS.md"'
chk "claude-only run also writes ~/.codex/AGENTS.md" 'head -1 "$HC/.codex/AGENTS.md" | grep -q "Clean Code for Agents"'
chk "manifest written after the import stub" 'grep -q "BEGIN agent-harness" "$HC/.claude/CLAUDE.md"'
chk "attribution blanked (commit)"       '[ "$(jget "$HC/.claude/settings.json" attribution.commit)" = "\"\"" ]'
chk "attribution blanked (pr)"           '[ "$(jget "$HC/.claude/settings.json" attribution.pr)" = "\"\"" ]'
chk "commit guard hook copied"           '[ -s "$HC/.claude/hooks/bloquear-mencao-claude-commit.ts" ]'
chk "commit guard hook has no machine paths" '! grep -qE "C:/Users/|C:\\Users" "$HC/.claude/hooks/bloquear-mencao-claude-commit.ts"'
chk "commit guard wired in PreToolUse"   'grep -q "bloquear-mencao-claude-commit.ts" "$HC/.claude/settings.json"'

cp "$HC/.claude/settings.json" "$HC/before-settings.json"
cp "$HC/.claude/CLAUDE.md" "$HC/before-claude.md"
cp "$HC/.claude/agents/documentation-auditor.md" "$HC/before-agent.md"
PATH="$NO_CLAUDE_PATH" harness "$HC" init -y $CLAUDE_ARGS >/dev/null
chk "custom agent install idempotent"    'diff -q "$HC/before-agent.md" "$HC/.claude/agents/documentation-auditor.md" >/dev/null'
chk "settings merge idempotent"          'diff -q "$HC/before-settings.json" "$HC/.claude/settings.json" >/dev/null'
chk "global CLAUDE.md idempotent"        'diff -q "$HC/before-claude.md" "$HC/.claude/CLAUDE.md" >/dev/null'

# --- an existing CLAUDE.md without the import (left by an older harness) gets it prepended ---
HL="$(fresh_home)"
mkdir -p "$HL/.claude" && printf '# my notes\n\nkeep me\n' > "$HL/.claude/CLAUDE.md"
PATH="$NO_CLAUDE_PATH" harness "$HL" init -y -a claude-code --preset codex-global-instructions --no-manifest >/dev/null
chk "import prepended to existing CLAUDE.md" 'head -1 "$HL/.claude/CLAUDE.md" | grep -qF "@~/.codex/AGENTS.md"'
chk "existing CLAUDE.md content kept"    'grep -q "keep me" "$HL/.claude/CLAUDE.md"'
