#!/usr/bin/env bash
# e2e suite: private overlay catalogs (`--overlay <dir|git-url>` and
# AGENT_HARNESS_OVERLAY). Uses the harmless fixture in test/fixtures/overlay.
# Sourced by scripts/ci-e2e.sh.

FIX="$E2E_FIXTURES/overlay"
OV_PICK="--skill fixture-private-skill --skill prd --mcp fixture-private-mcp --subagent fixture-private-agent --preset fixture-private-preset"

# --- local dir overlay ---
HO="$(fresh_home)"
OUT_O="$(harness "$HO" init -y -a codex --overlay "$FIX" $OV_PICK)"
chk "overlay: local skill copied from overlay dir" 'grep -q "FIXTURE-PRIVATE-SKILL-MARKER" "$HO/.agents/skills/fixture-private-skill/SKILL.md"'
chk "overlay: colliding id resolved to overlay"    'grep -q "OVERLAY-PRD-MARKER" "$HO/.agents/skills/prd/SKILL.md"'
chk "overlay: collision warning printed"           'echo "$OUT_O" | grep -q "overrides" && echo "$OUT_O" | grep -q "prd"'
chk "overlay: subagent copied from overlay dir"    'grep -q "FIXTURE-PRIVATE-AGENT-MARKER" "$HO/.codex/agents/fixture-private-agent.toml"'
chk "overlay: preset asset merged"                 '[ "$(jget "$HO/.fixture-private/settings.json" fixture)" = "true" ]'
chk "overlay: MCP in codex config"                 'grep -q "mcp_servers.fixture-private-mcp" "$HO/.codex/config.toml"'
chk "overlay: manifest lists overlay ids"          'grep -q "fixture-private-skill" "$HO/.codex/AGENTS.md"'
chk "overlay: manifest lists overlay env names"    'grep -q "FIXTURE_PRIVATE_TOKEN" "$HO/.codex/AGENTS.md"'

HP="$(fresh_home)"
harness "$HP" init -y -a codex --skill fixture-private-skill --skill prd >/dev/null
chk "no overlay: public catalog has no overlay items" '[ ! -d "$HP/.agents/skills/fixture-private-skill" ]'
chk "no overlay: public prd untouched"             '! grep -q "OVERLAY-PRD-MARKER" "$HP/.agents/skills/prd/SKILL.md"'

# --- broken overlays fail loudly with the offending value ---
OV_EMPTY="$(mktemp -d)"
OUT_E="$(harness "$(fresh_home)" init -y -a codex --overlay "$OV_EMPTY"; echo "exit=$?")"
chk "overlay: missing catalog.json errors"         'echo "$OUT_E" | grep -q "catalog.json" && echo "$OUT_E" | grep -q "exit=1"'
OV_BAD="$(mktemp -d)" && printf '{ not json' > "$OV_BAD/catalog.json"
OUT_B="$(harness "$(fresh_home)" init -y -a codex --overlay "$OV_BAD"; echo "exit=$?")"
chk "overlay: invalid JSON errors"                 'echo "$OUT_B" | grep -qi "json" && echo "$OUT_B" | grep -q "exit=1"'
OV_ESC="$(mktemp -d)"
printf '{"presets":[{"id":"esc","files":[{"op":"copy","asset":"../escape.json","dest":"~/x.json"}]}]}' > "$OV_ESC/catalog.json"
OUT_X="$(harness "$(fresh_home)" init -y -a codex --overlay "$OV_ESC" --preset esc; echo "exit=$?")"
chk "overlay: asset path with .. rejected"         'echo "$OUT_X" | grep -qF "../escape.json" && echo "$OUT_X" | grep -q "exit=1"'

# --- AGENT_HARNESS_OVERLAY with two specs separated by ';' ---
OV2="$(mktemp -d)" && mkdir -p "$OV2/skills/second-fixture-skill"
printf '{"skills":[{"id":"second-fixture-skill","source":"local","skill":"second-fixture-skill"}]}' > "$OV2/catalog.json"
printf -- '---\nname: second-fixture-skill\ndescription: second overlay fixture\n---\nSECOND-MARKER\n' > "$OV2/skills/second-fixture-skill/SKILL.md"
HE="$(fresh_home)"
AGENT_HARNESS_OVERLAY="$(native_path "$FIX");$(native_path "$OV2")" harness "$HE" init -y -a codex --skill fixture-private-skill --skill second-fixture-skill >/dev/null
chk "overlay env: first spec loaded"               '[ -f "$HE/.agents/skills/fixture-private-skill/SKILL.md" ]'
chk "overlay env: second spec loaded"              '[ -f "$HE/.agents/skills/second-fixture-skill/SKILL.md" ]'

# --- git overlay (file:// repo) — clone lands in a temp dir that is removed afterwards ---
OV_GIT="$(mktemp -d)"
cp -r "$FIX/." "$OV_GIT/"
( cd "$OV_GIT" && git init -q && git add -A && git -c user.email=e2e@example.test -c user.name=e2e commit -q -m fixture )
OV_TMP="$(mktemp -d)"
HG="$(fresh_home)"
TMPDIR="$OV_TMP" TMP="$OV_TMP" TEMP="$OV_TMP" harness "$HG" init -y -a codex --overlay "$(file_url "$OV_GIT")" --skill fixture-private-skill >/dev/null
chk "overlay git: skill installed from clone"      'grep -q "FIXTURE-PRIVATE-SKILL-MARKER" "$HG/.agents/skills/fixture-private-skill/SKILL.md"'
chk "overlay git: temp clone removed"              '[ "$(ls "$OV_TMP" | grep -c agent-harness-overlay)" = 0 ]'

OUT_S="$(GIT_TERMINAL_PROMPT=0 harness "$(fresh_home)" init -y -a codex --overlay "https://e2euser:SEK@RET123@127.0.0.1:9/nope.git"; echo "exit=$?")"
chk "overlay git: unreachable URL fails"           'echo "$OUT_S" | grep -q "exit=1"'
chk "overlay git: credentials redacted in output"  '! echo "$OUT_S" | grep -qE "SEK|RET123"'
OUT_D="$(harness "$(fresh_home)" init -y -a codex --overlay "--upload-pack=touch /tmp/pwned"; echo "exit=$?")"
chk "overlay: spec starting with - rejected"       'echo "$OUT_D" | grep -q "exit=1" && [ ! -e /tmp/pwned ]'

# --- scaffold honours overlays too ---
R_O="$(mktemp -d)"
( cd "$R_O" && node "$CLI" scaffold -y --overlay "$FIX" --skill fixture-private-skill --no-gitignore >/dev/null 2>&1 )
chk "overlay scaffold: project skill from overlay" '[ -f "$R_O/.claude/skills/fixture-private-skill/SKILL.md" ]'
