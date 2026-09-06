#!/usr/bin/env bash
#
# End-to-end checks for CI. Exercises real writes into a throwaway HOME and a
# throwaway repo, then asserts results + idempotency. No real agents are needed:
# `-a` forces agent selection, and config-file merges + local skill copies don't
# require the agent binaries. The remote-source skill (archify) does try the
# network but falls back to its bundled copy, so the assertions hold offline too.
# The installer-backed skill (`npx impeccable install`) is deliberately NOT
# selected here. Portable across Linux (HOME) and Windows git-bash (USERPROFILE)
# — both are set.
set -uo pipefail

CLI="$PWD/dist/cli.js"
fail=0

# Count keys under a top-level object in a JSON file: keys <file> <topLevelKey>
keys() {
  node -e 'const fs=require("fs");const o=JSON.parse(fs.readFileSync(process.argv[1]));console.log(Object.keys(o[process.argv[2]]||{}).length)' "$1" "$2"
}
# Read a dotted path from a JSON file: jget <file> <a.b.c>
jget() {
  node -e 'const fs=require("fs");let o=JSON.parse(fs.readFileSync(process.argv[1]));for(const k of process.argv[2].split("."))o=o?.[k];console.log(JSON.stringify(o))' "$1" "$2"
}
# Read a dotted path from a TOML file: tget <file> <a.b.c>
tget() {
  node -e 'const fs=require("fs");const {parse}=require("smol-toml");let o=parse(fs.readFileSync(process.argv[1],"utf8"));for(const k of process.argv[2].split("."))o=o?.[k];console.log(JSON.stringify(o))' "$1" "$2"
}
chk() { if eval "$2"; then echo "  PASS  $1"; else echo "  FAIL  $1"; fail=1; fi; }

MCPS="--mcp figma --mcp chrome-devtools --mcp playwright --mcp context7 --mcp taskmaster --mcp pencil --mcp stitch --mcp lottiefiles-creator --mcp n8n-mcp"
SKILLS="--skill anti-ai-slop --skill prd --skill shadcn --skill archify --skill orca-cli"
PLUGINS="--plugin claude-official --plugin claude-code-warp --plugin codex-openai-curated"
AGENTS="--subagent documentation-auditor --subagent impeccable-manual-edit-applier"
PRESETS="--preset codex-config --preset codex-global-instructions"

# --- init into a temp HOME (codex + opencode) ---
H="$(mktemp -d)"
HOME="$H" USERPROFILE="$H" node "$CLI" init -y -a codex -a opencode $MCPS $SKILLS $PLUGINS $AGENTS $PRESETS >/dev/null 2>&1
chk "codex config.toml created"          '[ -f "$H/.codex/config.toml" ]'
chk "config.toml has chrome-devtools"    'grep -q "mcp_servers.chrome-devtools" "$H/.codex/config.toml"'
chk "config.toml has playwright"         'grep -q "mcp_servers.playwright" "$H/.codex/config.toml"'
chk "config.toml has n8n-mcp"            'grep -q "mcp_servers.n8n-mcp" "$H/.codex/config.toml"'
chk "pencil uses codexCLI in codex"      '[ "$(tget "$H/.codex/config.toml" mcp_servers.pencil.args)" = "[\"--app\",\"desktop\",\"--agent\",\"codexCLI\"]" ]'
chk "taskmaster extra keys in codex"     '[ "$(tget "$H/.codex/config.toml" mcp_servers.taskmaster.tools.set_task_status.approval_mode)" = "\"approve\"" ]'
chk "stitch scoped out of codex"         '! grep -q "mcp_servers.stitch" "$H/.codex/config.toml"'
chk "codex marketplace registered"       '[ "$(tget "$H/.codex/config.toml" marketplaces.claude-plugins-official.source)" = "\"https://github.com/anthropics/claude-plugins-official.git\"" ]'
chk "codex plugin enabled"               '[ "$(tget "$H/.codex/config.toml" plugins.context7@claude-plugins-official.enabled)" = "true" ]'
chk "codex builtin plugin enabled, no marketplace" '[ "$(tget "$H/.codex/config.toml" plugins.gmail@openai-curated.enabled)" = "true" ] && [ "$(tget "$H/.codex/config.toml" marketplaces.openai-curated)" = "undefined" ]'
chk "claude-only plugin not in codex"    '! grep -q "claude-code-warp" "$H/.codex/config.toml"'
chk "codex preset merged (model)"        '[ "$(tget "$H/.codex/config.toml" model)" = "\"gpt-6-astra\"" ]'
chk "codex preset merged (features)"     '[ "$(tget "$H/.codex/config.toml" features.multi_agent)" = "true" ]'
chk "codex global AGENTS.md from template" 'head -1 "$H/.codex/AGENTS.md" | grep -q "Clean Code for Agents"'
chk "manifest appended to codex AGENTS.md" 'grep -q "BEGIN agent-harness" "$H/.codex/AGENTS.md"'
chk "manifest lists a prerequisite"      'grep -q "Orca desktop app" "$H/.codex/AGENTS.md"'
chk "manifest lists env vars"            'grep -q "N8N_API_KEY" "$H/.codex/AGENTS.md"'
chk "manifest lists codex plugins"       'grep -q "codex-openai-curated" "$H/.codex/AGENTS.md"'
chk "manifest lists presets"             'grep -q "codex-config" "$H/.codex/AGENTS.md"'
chk "codex custom agent (toml) copied"   '[ -s "$H/.codex/agents/documentation-auditor.toml" ]'
chk "opencode.json created"              '[ -f "$H/.config/opencode/opencode.json" ]'
chk "opencode.json has \$schema"         'grep -q "opencode.ai/config.json" "$H/.config/opencode/opencode.json"'
chk "pencil uses openCodeCLI in opencode" 'grep -q "openCodeCLI" "$H/.config/opencode/opencode.json"'
chk "anti-ai-slop copied to codex"       '[ -f "$H/.agents/skills/anti-ai-slop/SKILL.md" ]'
chk "shadcn copied to codex"             '[ -f "$H/.agents/skills/shadcn/SKILL.md" ]'
chk "binary asset copied intact"         'cmp -s "$PWD/assets/skills/shadcn/assets/shadcn.png" "$H/.agents/skills/shadcn/assets/shadcn.png"'
chk "archify installed (remote or fallback)" '[ -f "$H/.agents/skills/archify/SKILL.md" ]'
chk "deep nested skill file copied"      '[ -f "$H/.agents/skills/archify/renderers/shared/geometry.mjs" ]'
chk "no claude dirs created (no claude-code)" '[ ! -d "$H/.claude" ]'

cp "$H/.codex/config.toml" "$H/before.toml"
cp "$H/.codex/AGENTS.md" "$H/before-agents.md"
cp "$H/.config/opencode/opencode.json" "$H/before.json"
HOME="$H" USERPROFILE="$H" node "$CLI" init -y -a codex -a opencode $MCPS $SKILLS $PLUGINS $AGENTS $PRESETS >/dev/null 2>&1
chk "init idempotent (config.toml unchanged)"  'diff -q "$H/before.toml" "$H/.codex/config.toml" >/dev/null'
chk "init idempotent (AGENTS.md unchanged)"    'diff -q "$H/before-agents.md" "$H/.codex/AGENTS.md" >/dev/null'
chk "init idempotent (opencode.json unchanged)" 'diff -q "$H/before.json" "$H/.config/opencode/opencode.json" >/dev/null'

# --- init into a temp HOME (claude-code, custom agents + settings preset; no claude binary on PATH) ---
HC="$(mktemp -d)"
CLAUDE_ARGS="-a claude-code $AGENTS --preset claude-settings --plugin claude-official --skill prd"
HOME="$HC" USERPROFILE="$HC" PATH="/usr/bin:/bin:$(dirname "$(command -v node)")" node "$CLI" init -y $CLAUDE_ARGS >/dev/null 2>&1
chk "documentation-auditor copied to ~/.claude/agents"      '[ -s "$HC/.claude/agents/documentation-auditor.md" ]'
chk "impeccable-manual-edit-applier copied to ~/.claude/agents" '[ -s "$HC/.claude/agents/impeccable-manual-edit-applier.md" ]'
chk "no toml agents for claude"          '[ ! -f "$HC/.claude/agents/documentation-auditor.toml" ]'
chk "claude settings preset merged"      '[ "$(jget "$HC/.claude/settings.json" model)" = "\"claude-fable-5-1[1m]\"" ]'
chk "claude settings permissions"        '[ "$(keys "$HC/.claude/settings.json" permissions)" = 2 ]'
chk "statusline script copied"           '[ -s "$HC/.claude/statusline-command.sh" ]'
chk "plugins fallback (no claude CLI)"   '[ "$(jget "$HC/.claude/settings.json" enabledPlugins.context7@claude-plugins-official)" = "true" ]'
chk "manifest written for claude"        'grep -q "BEGIN agent-harness" "$HC/.claude/CLAUDE.md"'

cp "$HC/.claude/settings.json" "$HC/before-settings.json"
cp "$HC/.claude/agents/documentation-auditor.md" "$HC/before-agent.md"
HOME="$HC" USERPROFILE="$HC" PATH="/usr/bin:/bin:$(dirname "$(command -v node)")" node "$CLI" init -y $CLAUDE_ARGS >/dev/null 2>&1
chk "custom agent install idempotent"    'diff -q "$HC/before-agent.md" "$HC/.claude/agents/documentation-auditor.md" >/dev/null'
chk "settings merge idempotent"          'diff -q "$HC/before-settings.json" "$HC/.claude/settings.json" >/dev/null'

# --- scaffold into a temp repo ---
R="$(mktemp -d)"
( cd "$R" && node "$CLI" scaffold -y --with-claude-md --with-agents-md --with-memory --with-opencode $MCPS --skill prd --skill anti-ai-slop $AGENTS >/dev/null 2>&1 )
chk "CLAUDE.md == AGENTS.md"             'diff -q "$R/CLAUDE.md" "$R/AGENTS.md" >/dev/null'
chk "CLAUDE.md is clean-code doc"        'head -1 "$R/CLAUDE.md" | grep -q "Clean Code for Agents"'
chk ".mcp.json has 6 servers"           '[ "$(keys "$R/.mcp.json" mcpServers)" = 6 ]'
chk "opencode.json has 7 servers"       '[ "$(keys "$R/opencode.json" mcp)" = 7 ]'
chk "pencil uses claudeCodeCLI in .mcp.json" 'grep -q "claudeCodeCLI" "$R/.mcp.json"'
chk "skill installed into repo"         '[ -f "$R/.claude/skills/prd/SKILL.md" ]'
chk "custom agent (md) installed into repo"   '[ -s "$R/.claude/agents/documentation-auditor.md" ]'
chk "custom agent (toml) installed into repo" '[ -s "$R/.codex/agents/documentation-auditor.toml" ]'
chk ".gitignore has managed block"      'grep -q "agent-harness" "$R/.gitignore"'

echo ""
if [ "$fail" = 0 ]; then echo "E2E: all checks passed"; else echo "E2E: FAILURES above"; exit 1; fi
