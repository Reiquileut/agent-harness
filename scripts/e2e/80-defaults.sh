#!/usr/bin/env bash
# e2e suite: catalog `default` flags (v1.7.0) — what the owner's machines run.
# `--defaults` installs exactly the flagged entries (plus any item flag given);
# a bare `-y` keeps installing nothing, so scripts written for v1.6 still behave.
# Uses a small fixture catalog built from the shipped one, so it stays offline.
# Sourced by scripts/ci-e2e.sh.

DEF_CAT="$(mktemp)"
node -e '
const fs = require("fs");
const c = JSON.parse(fs.readFileSync("assets/catalog.json", "utf8"));
const pick = (list, ids, defaults) => list.filter((e) => ids.includes(e.id)).map((e) => ({ ...e, default: defaults.includes(e.id) }));
c.mcps = pick(c.mcps, ["chrome-devtools", "figma"], ["chrome-devtools"]);
c.skills = pick(c.skills, ["prd", "anti-ai-slop"], ["prd"]);
c.subagents = pick(c.subagents, ["documentation-auditor", "impeccable-manual-edit-applier"], ["documentation-auditor"]);
c.plugins = []; c.presets = []; c.integrations = [];
fs.writeFileSync(process.argv[1], JSON.stringify(c));
' "$DEF_CAT"

HDF="$(fresh_home)"
AGENT_HARNESS_CATALOG="$DEF_CAT" harness "$HDF" init -y --defaults -a codex >/dev/null
chk "defaults: flagged skill installed"        '[ -f "$HDF/.agents/skills/prd/SKILL.md" ]'
chk "defaults: unflagged skill left out"       '[ ! -d "$HDF/.agents/skills/anti-ai-slop" ]'
chk "defaults: flagged MCP written"            'grep -q "mcp_servers.chrome-devtools" "$HDF/.codex/config.toml"'
chk "defaults: unflagged MCP left out"         '! grep -q "mcp_servers.figma" "$HDF/.codex/config.toml"'
chk "defaults: flagged custom agent copied"    '[ -f "$HDF/.codex/agents/documentation-auditor.toml" ]'
chk "defaults: unflagged custom agent left out" '[ ! -f "$HDF/.codex/agents/impeccable-manual-edit-applier.toml" ]'

HDB="$(fresh_home)"
AGENT_HARNESS_CATALOG="$DEF_CAT" harness "$HDB" init -y -a codex >/dev/null
chk "defaults: bare -y still installs no item" '[ ! -d "$HDB/.agents/skills" ] && [ ! -f "$HDB/.codex/config.toml" ]'

HDU="$(fresh_home)"
AGENT_HARNESS_CATALOG="$DEF_CAT" harness "$HDU" init -y --defaults -a codex --skill anti-ai-slop >/dev/null
chk "defaults: item flags add to the defaults" '[ -f "$HDU/.agents/skills/anti-ai-slop/SKILL.md" ] && [ -f "$HDU/.agents/skills/prd/SKILL.md" ]'

# The shipped catalog flags the live setup (2026-10-20) and nothing private.
chk "defaults: shipped catalog flags the 4 mods" 'node -e "const c=require(\"./assets/catalog.json\");process.exit(c.plugins.filter((p)=>p.default&&p.id.startsWith(\"mod-\")).length===4?0:1)"'
chk "defaults: shipped presets and integrations flagged" 'node -e "const c=require(\"./assets/catalog.json\");const off=[...c.presets,...c.integrations].filter((e)=>!e.default).map((e)=>e.id);process.exit(off.length===0?0:1)"'
# Captured first: with pipefail, `harness | grep -q` fails when grep closes the pipe early.
OUT_DEF_DRY="$(harness "$(fresh_home)" init -y --defaults -a claude-code --dry-run)"
chk "defaults: dry-run lists the flagged preset" 'echo "$OUT_DEF_DRY" | grep -qiE "docker-disk-hygiene|higiene"'
