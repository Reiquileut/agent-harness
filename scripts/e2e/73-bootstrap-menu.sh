#!/usr/bin/env bash
# e2e suite: the bootstrap hands its terminal to the interactive menu (v1.7.1). Run as
# `curl … | bash` without --yes, the bootstrap's stdin is the spent script pipe, so the harness saw
# no terminal and quietly installed nothing (found 2026-10-21). The terminal is BOOTSTRAP_TTY
# (default /dev/tty): here a plain file stands in for it, and a fake harness records where its
# stdin came from. Every prerequisite is a fake that is already "installed", so nothing installs.
# Sourced by scripts/ci-e2e.sh.
#
# Failure modes, listed before the fix was written:
#   piped, no --yes, a terminal exists -> the harness must read the terminal, not the spent pipe
#   piped, no --yes, no terminal (CI, cron, ssh -T) -> do not open it (that would abort the run);
#                                       say the menu cannot open and point to --yes; still run init
#   --yes      -> never touch the terminal: no menu by design, `init -y --defaults`
#   --dry-run  -> print the plan only: the harness does not run, nothing reads the terminal

MENU_BIN="$(mktemp -d)"; MENU_HOME="$(mktemp -d)"; MENU_EMPTY="$(mktemp -d)"
MENU_HARNESS="$(mktemp -d)"; MENU_LOG="$(mktemp -u)"; MENU_TTY="$(mktemp)"
cp "$E2E_FIXTURES/bootstrap-macos/uname" "$E2E_FIXTURES/bootstrap-macos/brew" "$MENU_BIN/"
for tool in git jq pnpm gh uv claude codex opencode task-master ai-memory twg; do
  printf '#!/bin/sh\necho "%s 0.0.0-fake"\n' "$tool" > "$MENU_BIN/$tool"
done
chmod +x "$MENU_BIN/"*
echo "FROM-TERMINAL" > "$MENU_TTY"
mkdir -p "$MENU_HARNESS/dist"
cat > "$MENU_HARNESS/dist/cli.js" <<'FAKE'
// Fake agent-harness for 73-bootstrap-menu: records its argv and whatever its stdin held.
const fs = require('fs');
let stdin = '';
try { stdin = fs.readFileSync(0, 'utf8'); } catch (err) { stdin = `<unreadable ${err.code}>`; }
fs.writeFileSync(process.env.FAKE_HARNESS_LOG, `argv=${process.argv.slice(2).join(' ')}\nstdin=${stdin.trim()}\n`);
FAKE
MENU_NODE_DIR="$(dirname "$(command -v node)")"

# menu_boot <terminal-path> <bootstrap args…>: the macOS bootstrap piped into bash, as `curl | bash`
# runs it, with everything already installed; prints all output plus "exit=<code>".
menu_boot() {
  local tty="$1"; shift
  rm -f "$MENU_LOG"
  cat "$REPO_ROOT/bootstrap/macos.sh" | HOME="$MENU_HOME" PATH="$MENU_BIN:$MENU_NODE_DIR:/usr/bin:/bin" \
    BOOTSTRAP_TTY="$tty" BOOTSTRAP_BREW_PREFIXES="$MENU_EMPTY" FAKE_HARNESS_LOG="$(native_path "$MENU_LOG")" \
    bash -s -- --harness-src "$MENU_HARNESS" "$@" 2>&1
  echo "exit=$?"
}

OUT_MT="$(menu_boot "$MENU_TTY")"
chk "menu: piped run without --yes exits 0"            'echo "$OUT_MT" | grep -q "exit=0"'
chk "menu: the harness reads the terminal, not the pipe" 'grep -q "^stdin=FROM-TERMINAL$" "$MENU_LOG"'
chk "menu: without --yes init gets no -y (menu mode)"  'grep -q "^argv=init$" "$MENU_LOG"'

OUT_MN="$(menu_boot "$MENU_EMPTY/no-such-tty")"
chk "menu: no terminal still runs init and exits 0"    'echo "$OUT_MN" | grep -q "exit=0" && grep -q "^argv=init$" "$MENU_LOG"'
chk "menu: no terminal says so and points to --yes"    'echo "$OUT_MN" | grep -q "no terminal" && echo "$OUT_MN" | grep -q -- "--yes"'
chk "menu: no terminal leaves the harness stdin alone" '! grep -q "FROM-TERMINAL" "$MENU_LOG"'

OUT_MY="$(menu_boot "$MENU_TTY" --yes)"
chk "menu: --yes never reads the terminal"             'echo "$OUT_MY" | grep -q "exit=0" && ! grep -q "FROM-TERMINAL" "$MENU_LOG"'
chk "menu: --yes still means init -y --defaults"       'grep -q "^argv=init -y --defaults -a claude-code -a codex -a opencode$" "$MENU_LOG"'

OUT_MR="$(menu_boot "$MENU_TTY" --dry-run)"
chk "menu: --dry-run never starts the harness"         'echo "$OUT_MR" | grep -q "exit=0" && [ ! -e "$MENU_LOG" ]'
