#!/usr/bin/env bash
# e2e suite: the portable status line (v1.7.0). v1.6 shipped a bash + python
# pair whose `mapfile` needs bash >= 4 — stock macOS has 3.2. The TypeScript
# port runs with node on every OS (type stripping, Node >= 22.18).
# Sourced by scripts/ci-e2e.sh.

HSL="$(fresh_home)"
harness "$HSL" init -y -a claude-code --preset claude-settings >/dev/null
chk "statusline: script copied"                    '[ -s "$HSL/.claude/statusline.ts" ]'
chk "statusline: settings run it with node"         '[ "$(jget "$HSL/.claude/settings.json" statusLine.command)" = "\"node ~/.claude/statusline.ts\"" ]'
chk "statusline: no bash/python pair left behind"   '[ ! -e "$HSL/.claude/statusline-command.sh" ] && [ ! -e "$HSL/.claude/statusline-data.py" ]'

SL_NODE_OK="$(node -e 'const [a,b]=process.versions.node.split(".").map(Number);console.log(a>22||(a===22&&b>=18)?1:0)')"
if [ "$SL_NODE_OK" = 1 ]; then
  SL_LINE="$(printf '{"model":{"display_name":"Opus 5.5"},"workspace":{"current_dir":"/tmp"},"cost":{"total_cost_usd":1.5},"context_window":{"current_usage":{"input_tokens":50000},"context_window_size":200000}}' | node "$HSL/.claude/statusline.ts")"
  chk "statusline: renders context and model"       'echo "$SL_LINE" | grep -q "ctx 50k/200k (25%)" && echo "$SL_LINE" | grep -q "Opus 5.5"'
  SL_BAD="$(printf 'not json' | node "$HSL/.claude/statusline.ts"; echo " exit=$?")"
  chk "statusline: bad input still prints a line"   'echo "$SL_BAD" | grep -q "ctx " && echo "$SL_BAD" | grep -q "exit=0"'
fi
