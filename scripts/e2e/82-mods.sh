#!/usr/bin/env bash
# e2e suite: the owner's Claude Code mods (v1.7.0) — a bundled local plugin
# marketplace staged into ~/.claude/mods and registered by path. A fake `claude`
# (test/fixtures/bin) records argv; without it, settings.json declares the
# marketplace as a `directory` source. A mod edited in place survives a re-run.
# Sourced by scripts/ci-e2e.sh.

MODS_BIN="$(mktemp -d)"
cp "$E2E_FIXTURES/bin/"* "$MODS_BIN/" && chmod +x "$MODS_BIN/claude"
MODS_BASE_PATH="/usr/bin:/bin:$(dirname "$(command -v node)")"
MODS_ARGS="-a claude-code --plugin mod-savvy --plugin mod-tool-skins"

HMD="$(fresh_home)"; MODS_LOG="$(mktemp)"
FAKE_CLAUDE_LOG="$MODS_LOG" PATH="$MODS_BIN:$MODS_BASE_PATH" harness "$HMD" init -y $MODS_ARGS >/dev/null
chk "mods: marketplace staged into ~/.claude/mods"   '[ -f "$HMD/.claude/mods/.claude-plugin/marketplace.json" ]'
chk "mods: mod sources staged"                       '[ -f "$HMD/.claude/mods/savvy/hooks/register.ts" ] && [ -f "$HMD/.claude/mods/tool-skins/hooks/register.tsx" ]'
chk "mods: local marketplace registered once"        '[ "$(grep -c "argv=plugin marketplace add .*[/\\]\.claude[/\\]mods" "$MODS_LOG")" = 1 ]'
chk "mods: savvy installed at user scope"            'grep -q "argv=plugin install savvy@agent-harness-mods --scope user" "$MODS_LOG"'
chk "mods: tool-skins installed at user scope"       'grep -q "argv=plugin install tool-skins@agent-harness-mods --scope user" "$MODS_LOG"'

printf '{"edited":true}\n' > "$HMD/.claude/mods/savvy/savvy.config.json"
FAKE_CLAUDE_LOG="$(mktemp)" PATH="$MODS_BIN:$MODS_BASE_PATH" harness "$HMD" init -y $MODS_ARGS >/dev/null
chk "mods: a mod edited in place is kept"            'grep -q "\"edited\":true" "$HMD/.claude/mods/savvy/savvy.config.json"'
FAKE_CLAUDE_LOG="$(mktemp)" PATH="$MODS_BIN:$MODS_BASE_PATH" harness "$HMD" init -y --force $MODS_ARGS >/dev/null
chk "mods: --force restores the bundled mod"         'cmp -s "$REPO_ROOT/assets/plugins/agent-harness-mods/savvy/savvy.config.json" "$HMD/.claude/mods/savvy/savvy.config.json"'

HMN="$(fresh_home)"
PATH="$MODS_BASE_PATH" harness "$HMN" init -y $MODS_ARGS >/dev/null
chk "mods: no claude CLI → directory marketplace"    '[ "$(jget "$HMN/.claude/settings.json" extraKnownMarketplaces.agent-harness-mods.source.source)" = "\"directory\"" ]'
chk "mods: no claude CLI → mods enabled"             '[ "$(jget "$HMN/.claude/settings.json" enabledPlugins.savvy@agent-harness-mods)" = "true" ]'
chk "mods: no claude CLI → files still staged"       '[ -f "$HMN/.claude/mods/savvy/hooks/register.ts" ]'
