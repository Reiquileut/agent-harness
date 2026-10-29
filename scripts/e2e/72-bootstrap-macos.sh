#!/usr/bin/env bash
# e2e suite: bootstrap/macos.sh (v1.7.0) in --dry-run and in its refusal paths, on any OS. Fakes from
# test/fixtures/bootstrap-macos/ stand in for the Mac (uname says Darwin/arm64, brew only logs) and
# shadow curl/npm, so no installer ever runs. The PATH is cut to the fakes plus /usr/bin:/bin, so the
# plan is the one a bare Mac gets; on a macOS runner that also means the stock /bin/bash 3.2.
# Sourced by scripts/ci-e2e.sh.
#
# Failure modes, listed before the script was written:
#   flags    : unknown flag; flag without its value; args after `--` must reach init
#   platform : a real run off macOS must stop (pointing to ubuntu.sh); --dry-run runs anywhere
#   homebrew : on PATH; installed but off PATH (loaded from its prefix); missing on a real run
#              (stop before any step, print the official installer); missing on --dry-run (go on)
#   plan     : --yes = `init -y --defaults` for the three agents; overlay forwarded with its
#              credentials masked; the ai-memory asset matches macos + the CPU; no apt-get, no sudo;
#              Claude Code from its native installer; TWG from Atlassian's silent package
#   shells   : piped into bash, as `curl | bash` does; the stock bash 3.2

MAC_BOOT="$REPO_ROOT/bootstrap/macos.sh"
MAC_BASE_PATH="/usr/bin:/bin"
MAC_WITH_BREW="$(mktemp -d)"; MAC_NO_BREW="$(mktemp -d)"; MAC_EMPTY_PREFIX="$(mktemp -d)"
# A fresh HOME too: the script puts ~/.local/bin on PATH, where this machine may already have claude.
MAC_HOME="$(mktemp -d)"
cp "$E2E_FIXTURES/bootstrap-macos/"* "$MAC_WITH_BREW/"
cp "$E2E_FIXTURES/bootstrap-macos/uname" "$E2E_FIXTURES/bootstrap-macos/curl" "$E2E_FIXTURES/bootstrap-macos/npm" "$E2E_FIXTURES/bootstrap-macos/node" "$MAC_NO_BREW/"
chmod +x "$MAC_WITH_BREW/"* "$MAC_NO_BREW/"*
# mac_boot <fake-bin-dir> <args…>: run the script as a bare Mac would, all output plus "exit=<code>".
mac_boot() {
  local bin="$1"; shift
  HOME="$MAC_HOME" PATH="$bin:$MAC_BASE_PATH" BOOTSTRAP_BREW_PREFIXES="${MAC_PREFIXES:-$MAC_EMPTY_PREFIX}" \
    bash "$MAC_BOOT" "$@" 2>&1
  echo "exit=$?"
}

OUT_MD="$(mac_boot "$MAC_WITH_BREW" --dry-run --yes --overlay "https://e2euser:SEK@RET789@example.test/private.git")"
chk "macos: dry-run exits 0"                          'echo "$OUT_MD" | grep -q "exit=0"'
chk "macos: --yes runs init with the owner defaults"  'echo "$OUT_MD" | grep -q -- "init -y --defaults -a claude-code -a codex -a opencode"'
chk "macos: overlay forwarded, credentials masked"    'echo "$OUT_MD" | grep -q -- "--overlay https://\*\*\*@example.test/private.git"'
chk "macos: never prints URL credentials"             'echo "$OUT_MD" | grep -q "exit=0" && ! echo "$OUT_MD" | grep -qE "SEK|RET789"'
chk "macos: no apt-get or sudo in the plan"           'echo "$OUT_MD" | grep -q "exit=0" && ! echo "$OUT_MD" | grep -qE "^\+ .*(apt-get|sudo)"'
chk "macos: Node from Homebrew"                       'echo "$OUT_MD" | grep -q "^+ brew install node$"'
chk "macos: Claude Code from its native installer"    'echo "$OUT_MD" | grep -qF "+ curl -fsSL https://claude.ai/install.sh | bash"'
chk "macos: ai-memory asset for macos on Apple Silicon" 'echo "$OUT_MD" | grep -q "ai-memory-macos-aarch64.tar.gz"'
chk "macos: TWG from the silent package, no sudo"     'echo "$OUT_MD" | grep -q "^+ /usr/sbin/installer -pkg .* -target CurrentUserHomeDirectory$"'
chk "macos: every step reported"                      '[ "$(echo "$OUT_MD" | grep -c "^\[bootstrap\] step ")" = 12 ]'

OUT_MI="$(FAKE_UNAME_M=x86_64 mac_boot "$MAC_WITH_BREW" --dry-run)"
chk "macos: ai-memory asset for macos on Intel"       'echo "$OUT_MI" | grep -q "ai-memory-macos-x86_64.tar.gz"'

MAC_NET_LOG="$(mktemp)"
OUT_MN="$(FAKE_NET_LOG="$MAC_NET_LOG" mac_boot "$MAC_NO_BREW" --yes)"
chk "macos: missing Homebrew stops a real run"        'echo "$OUT_MN" | grep -q "exit=1" && echo "$OUT_MN" | grep -q "Homebrew not found"'
chk "macos: missing Homebrew prints its installer"    'echo "$OUT_MN" | grep -qF "https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh"'
chk "macos: nothing runs before Homebrew is there"    'echo "$OUT_MN" | grep -q "Homebrew not found" && ! echo "$OUT_MN" | grep -q "^+ " && [ ! -s "$MAC_NET_LOG" ]'
OUT_MO="$(mac_boot "$MAC_NO_BREW" --dry-run)"
chk "macos: missing Homebrew only warns on --dry-run" 'echo "$OUT_MO" | grep -q "exit=0" && echo "$OUT_MO" | grep -q "Homebrew not found"'

MAC_PREFIX="$(mktemp -d)"; mkdir -p "$MAC_PREFIX/bin"
cp "$E2E_FIXTURES/bootstrap-macos/brew" "$MAC_PREFIX/bin/brew" && chmod +x "$MAC_PREFIX/bin/brew"
MAC_BREW_LOG="$(mktemp)"
OUT_MP="$(FAKE_BREW_LOG="$MAC_BREW_LOG" MAC_PREFIXES="$MAC_EMPTY_PREFIX $MAC_PREFIX" mac_boot "$MAC_NO_BREW" --dry-run)"
chk "macos: Homebrew off PATH loaded from its prefix" 'grep -q "argv=shellenv" "$MAC_BREW_LOG" && echo "$OUT_MP" | grep -q "exit=0"'

OUT_ML="$(FAKE_UNAME_S=Linux mac_boot "$MAC_WITH_BREW" --yes)"
chk "macos: a real run off macOS stops, naming ubuntu.sh" 'echo "$OUT_ML" | grep -q "exit=1" && echo "$OUT_ML" | grep -q "bootstrap/ubuntu.sh"'
OUT_MX="$(mac_boot "$MAC_WITH_BREW" --bogus)"
chk "macos: unknown flag rejected with its value"     'echo "$OUT_MX" | grep -q -- "--bogus" && echo "$OUT_MX" | grep -q "exit=1"'
OUT_MV="$(mac_boot "$MAC_WITH_BREW" --overlay)"
chk "macos: flag without its value rejected"          'echo "$OUT_MV" | grep -q "needs a value" && echo "$OUT_MV" | grep -q "exit=1"'
OUT_MA="$(mac_boot "$MAC_WITH_BREW" --dry-run -- --agent codex --preset codex-config)"
chk "macos: args after -- reach init"                 'echo "$OUT_MA" | grep -q -- "init --agent codex --preset codex-config"'

OUT_MS="$(HOME="$MAC_HOME" PATH="$MAC_WITH_BREW:$MAC_BASE_PATH" BOOTSTRAP_BREW_PREFIXES="$MAC_EMPTY_PREFIX" bash -s -- --dry-run --yes < "$MAC_BOOT" 2>&1; echo "exit=$?")"
chk "macos: works piped into bash (curl | bash)"      'echo "$OUT_MS" | grep -q "exit=0" && echo "$OUT_MS" | grep -q -- "init -y --defaults"'
if [ -x /bin/bash ] && [ "$(/bin/bash -c 'echo "${BASH_VERSINFO[0]}"')" = 3 ]; then
  OUT_M3="$(HOME="$MAC_HOME" PATH="$MAC_WITH_BREW:$MAC_BASE_PATH" BOOTSTRAP_BREW_PREFIXES="$MAC_EMPTY_PREFIX" /bin/bash "$MAC_BOOT" --dry-run --yes 2>&1; echo "exit=$?")"
  chk "macos: runs under the stock bash 3.2"          'echo "$OUT_M3" | grep -q "exit=0"'
fi
