#!/usr/bin/env bash
#
# One-command bootstrap for a Mac (Apple Silicon or Intel) that has Homebrew: installs the
# prerequisites (git, jq, Node, pnpm, gh, uv, Claude Code, Codex, OpenCode, task-master,
# ai-memory, the Atlassian TWG CLI) and then runs `agent-harness init`. Idempotent: every
# step checks first and skips. Needs no secret: the logins and tokens come afterwards, as the
# closing "Next steps" list says. Runs on the stock bash 3.2.
# Every install command below was verified against the official docs on 2026-10-21.
#
# Usage: bootstrap/macos.sh [--dry-run] [--yes] [--overlay <spec>] [--skip-harness]
#                           [--harness-src <dir>] [--report <file>] [-h] [-- <init args>]
set -euo pipefail

BOOTSTRAP_SCRIPT_NAME="macos.sh"
SHELL_RC_HINT="~/.zprofile"
AI_MEMORY_OS_TAG="macos"
BREW_FORMULAE="git jq"
# Where Homebrew lives when it is installed but not yet on PATH: Apple Silicon, then Intel.
# BOOTSTRAP_BREW_PREFIXES overrides it (the e2e suite points it at fakes).
BREW_PREFIXES="${BOOTSTRAP_BREW_PREFIXES:-/opt/homebrew /usr/local}"
HOMEBREW_INSTALL_URL="https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh"
TWG_PKG_URL="https://teamwork-graph.atlassian.com/cli/install.pkg"
# shellcheck source=common.sh
. "$(dirname "${BASH_SOURCE[0]}")/common.sh" # @include common.sh

# Real runs need macOS; --dry-run is allowed anywhere so the plan can be previewed.
require_macos() {
  [ "$(uname -s)" = Darwin ] && return 0
  if [ "$DRY_RUN" = 1 ]; then log "not macOS ($(detect_os_name)); continuing because --dry-run"; return 0; fi
  die "unsupported OS: detected '$(uname -s)', expected macOS (Darwin); on Ubuntu/Debian use bootstrap/ubuntu.sh"
}

# Load an installed Homebrew that is not on PATH yet, as `brew shellenv` in ~/.zprofile does
# (per docs.brew.sh/Installation, 2026-10-21).
load_homebrew_shellenv() {
  local prefix
  command -v brew >/dev/null 2>&1 && return 0
  for prefix in $BREW_PREFIXES; do
    [ -x "$prefix/bin/brew" ] || continue
    eval "$("$prefix/bin/brew" shellenv)"
    return 0
  done
  return 1
}

# Homebrew is the one prerequisite this script does not install: its installer asks for the Mac
# password and may open the Xcode tools dialog, which is the owner's call, made once.
require_homebrew() {
  load_homebrew_shellenv && return 0
  if [ "$DRY_RUN" = 1 ]; then log "Homebrew not found; continuing because --dry-run"; return 0; fi
  die "Homebrew not found: looked on PATH and in '$BREW_PREFIXES', expected brew. Install it, open a new terminal and re-run: /bin/bash -c \"\$(curl -fsSL $HOMEBREW_INSTALL_URL)\""
}

bootstrap_preflight() {
  require_macos
  require_homebrew
}

brew_formulae_present() {
  local formula
  for formula in $BREW_FORMULAE; do command -v "$formula" >/dev/null 2>&1 || return 1; done
}

install_brew_formulae() {
  # shellcheck disable=SC2086
  run brew install $BREW_FORMULAE
}

# `node`, not `node@22`: the versioned formula is keg-only, so the global npm tools below would
# fall off PATH in every new shell. NODE_MIN_VERSION still guards the floor.
install_nodejs_from_homebrew() {
  run brew install node
}

# Homebrew's prefix belongs to the user, so global npm installs need no sudo.
install_npm_global_package() {
  run npm install -g "$1"
}

# per developer.atlassian.com/cloud/twg-cli/getting-started/installation (silent macOS package:
# no sign-in or setup prompts, installs ~/.local/bin/twg, no sudo), 2026-10-21. `twg setup` logs in later.
install_twg_cli_package() {
  local pkg="$SCRATCH_DIR/twg-install.pkg"
  run curl -fsSL "$TWG_PKG_URL" -o "$pkg" || return 1
  run /usr/sbin/installer -pkg "$pkg" -target CurrentUserHomeDirectory
}

install_all_prerequisites() {
  run_step "homebrew-packages" brew_formulae_present install_brew_formulae "git --version"
  run_step "nodejs" node_meets_minimum install_nodejs_from_homebrew "node -v"
  run_step "gh" "command -v gh" "run brew install gh" "gh --version"
  run_step "uv" "command -v uv" "run brew install uv" "uv --version"
  install_shared_tools
  run_step "twg" "command -v twg" install_twg_cli_package "twg --version"
}

print_os_next_steps() {
  cat <<'NEXT'
  7. twg setup                              # Atlassian sign-in; the TWG CLI and its skills are installed
  New terminal: ~/.zprofile must load Homebrew (the Homebrew installer prints that line) and ~/.local/bin.
NEXT
}

main "$@"
