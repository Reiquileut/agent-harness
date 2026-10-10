#!/usr/bin/env bash
# e2e suite: repo-level `scaffold` — AGENTS.md canonical + CLAUDE.md import
# stub, project MCP files, skills, subagents, .gitignore, .ai-memory.toml.
# Sourced by scripts/ci-e2e.sh.

SCAFFOLD_MCPS="--mcp figma --mcp chrome-devtools --mcp playwright --mcp context7 --mcp taskmaster --mcp pencil --mcp stitch --mcp lottiefiles-creator"
SCAFFOLD_SUBAGENTS="--subagent documentation-auditor --subagent impeccable-manual-edit-applier"

R="$(mktemp -d)"
( cd "$R" && AGENT_HARNESS_PLATFORM=win32 node "$CLI" scaffold -y --with-claude-md --with-agents-md --with-memory --with-opencode $SCAFFOLD_MCPS --skill prd --skill anti-ai-slop $SCAFFOLD_SUBAGENTS >/dev/null 2>&1 )
chk "CLAUDE.md first line is @AGENTS.md" '[ "$(head -1 "$R/CLAUDE.md" | tr -d "\r")" = "@AGENTS.md" ]'
chk "CLAUDE.md explains the import"      'grep -q "<!--" "$R/CLAUDE.md"'
chk "AGENTS.md is the full template"     'head -1 "$R/AGENTS.md" | grep -q "Clean Code for Agents"'
chk "AGENTS.md has project-specific section" 'grep -q "Project-Specific Section" "$R/AGENTS.md"'
chk ".mcp.json has 5 servers"            '[ "$(keys "$R/.mcp.json" mcpServers)" = 5 ]'
chk "opencode.json has 6 servers"        '[ "$(keys "$R/opencode.json" mcp)" = 6 ]'
chk "pencil uses claudeCodeCLI in .mcp.json" 'grep -q "claudeCodeCLI" "$R/.mcp.json"'
chk "skill installed into repo"          '[ -f "$R/.claude/skills/prd/SKILL.md" ]'
chk "custom agent (md) installed into repo"   '[ -s "$R/.claude/agents/documentation-auditor.md" ]'
chk "custom agent (toml) installed into repo" '[ -s "$R/.codex/agents/documentation-auditor.toml" ]'
chk ".gitignore has managed block"       'grep -q "agent-harness" "$R/.gitignore"'
chk ".gitignore ignores claude worktrees" 'grep -qx ".claude/worktrees/" "$R/.gitignore"'
chk ".gitignore ignores .env"            'grep -qx ".env" "$R/.gitignore"'

# --with-claude-md alone must not leave a dangling @AGENTS.md import.
R2="$(mktemp -d)"
( cd "$R2" && node "$CLI" scaffold -y --with-claude-md --no-gitignore >/dev/null 2>&1 )
chk "--with-claude-md alone also writes AGENTS.md" '[ -f "$R2/AGENTS.md" ]'

# An existing CLAUDE.md is the user's: kept unless --force.
R3="$(mktemp -d)"
printf 'mine\n' > "$R3/CLAUDE.md"
( cd "$R3" && node "$CLI" scaffold -y --with-claude-md --no-gitignore >/dev/null 2>&1 )
chk "existing CLAUDE.md kept"            '[ "$(cat "$R3/CLAUDE.md" | tr -d "\r")" = "mine" ]'

# .ai-memory.toml: every capture glob appears bare AND with **/ (ai-memory's
# **/ does not match zero dirs — measured 2026-10-05 with ai-memory 2.5.2).
R4="$(mktemp -d)"
( cd "$R4" && node "$CLI" scaffold -y --with-ai-memory --ai-memory-workspace acme --ai-memory-project widget --no-gitignore >/dev/null 2>&1 )
chk ".ai-memory.toml written"            '[ -f "$R4/.ai-memory.toml" ]'
chk ".ai-memory.toml workspace"          '[ "$(tget "$R4/.ai-memory.toml" workspace)" = "\"acme\"" ]'
chk ".ai-memory.toml project"            '[ "$(tget "$R4/.ai-memory.toml" project)" = "\"widget\"" ]'
chk ".ai-memory.toml ignores .env bare"  'tget "$R4/.ai-memory.toml" capture.ignore_paths | grep -qF "\".env\""'
chk ".ai-memory.toml ignores **/.env"    'tget "$R4/.ai-memory.toml" capture.ignore_paths | grep -qF "\"**/.env\""'
chk ".ai-memory.toml ignores **/*.pem"   'tget "$R4/.ai-memory.toml" capture.ignore_paths | grep -qF "\"**/*.pem\""'
printf 'workspace = "keep"\n' > "$R4/.ai-memory.toml"
( cd "$R4" && node "$CLI" scaffold -y --with-ai-memory --ai-memory-workspace acme --no-gitignore >/dev/null 2>&1 )
chk ".ai-memory.toml kept without --force" 'grep -q "keep" "$R4/.ai-memory.toml"'
( cd "$R4" && node "$CLI" scaffold -y --with-ai-memory --ai-memory-workspace acme --no-gitignore --force >/dev/null 2>&1 )
chk ".ai-memory.toml overwritten with --force" '[ "$(tget "$R4/.ai-memory.toml" workspace)" = "\"acme\"" ]'
R5="$(mktemp -d)"
OUT5="$( cd "$R5" && node "$CLI" scaffold -y --with-ai-memory --no-gitignore 2>&1 )"
chk ".ai-memory.toml needs a workspace"  '[ ! -f "$R5/.ai-memory.toml" ] && echo "$OUT5" | grep -q -- "--ai-memory-workspace"'
