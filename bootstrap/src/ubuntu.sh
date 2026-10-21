#!/usr/bin/env bash
#
# One-command bootstrap for a FRESH Ubuntu/Debian machine: installs the prerequisites
# (git, Node 22, pnpm, gh, uv, Claude Code, Codex, OpenCode, task-master, ai-memory)
# and then runs `agent-harness init`. Idempotent: every step checks first and skips.
# Every install command below was verified against the official docs on 2026-10-09.
#
# Usage: bootstrap/ubuntu.sh [--dry-run] [--yes] [--overlay <spec>] [--skip-harness]
#                            [--harness-src <dir>] [--report <file>] [-h] [-- <init args>]
set -euo pipefail

BOOTSTRAP_SCRIPT_NAME="ubuntu.sh"
SHELL_RC_HINT="~/.bashrc"
AI_MEMORY_OS_TAG="linux"
APT_PACKAGES="git curl ca-certificates gnupg jq python3 make unzip xz-utils"
# shellcheck source=common.sh
. "$(dirname "${BASH_SOURCE[0]}")/common.sh" # @include common.sh

# Root only when needed: plain call as root (bare containers have no sudo), sudo otherwise.
as_root() {
  if [ "$(id -u)" -eq 0 ]; then run "$@"; return; fi
  if command -v sudo >/dev/null 2>&1 || [ "$DRY_RUN" = 1 ]; then run sudo "$@"; return; fi
  die "root required: running as uid $(id -u) without sudo, expected root or sudo on PATH"
}

write_root_file() {
  printf '+ write %s: %s\n' "$1" "$2"
  [ "$DRY_RUN" = 1 ] && return 0
  printf '%s\n' "$2" | as_root tee "$1" >/dev/null
}

# Real runs need apt; --dry-run is allowed anywhere so the plan can be previewed.
bootstrap_preflight() {
  command -v apt-get >/dev/null 2>&1 && return 0
  if [ "$DRY_RUN" = 1 ]; then log "not an apt system ($(detect_os_name)); continuing because --dry-run"; return 0; fi
  die "unsupported OS: detected '$(detect_os_name)' without apt-get, expected Debian/Ubuntu (on a Mac use bootstrap/macos.sh)"
}

apt_packages_present() {
  # shellcheck disable=SC2086
  dpkg -s $APT_PACKAGES >/dev/null 2>&1
}

install_apt_prerequisites() {
  as_root env DEBIAN_FRONTEND=noninteractive apt-get update || return 1
  # shellcheck disable=SC2086
  as_root env DEBIAN_FRONTEND=noninteractive apt-get install -y $APT_PACKAGES
}

# per github.com/nodesource/distributions DEV_README.md (Ubuntu, Node 22.x), 2026-10-09
install_nodejs_from_nodesource() {
  local script="$SCRATCH_DIR/nodesource_setup.sh"
  run curl -fsSL https://deb.nodesource.com/setup_22.x -o "$script" || return 1
  as_root bash "$script" || return 1
  as_root env DEBIAN_FRONTEND=noninteractive apt-get install -y nodejs
}

# NodeSource's node lives in /usr, so global npm installs need root there.
install_npm_global_package() {
  as_root npm install -g "$1"
}

# per github.com/cli/cli/blob/trunk/docs/install_linux.md (Debian/Ubuntu), 2026-10-09
install_github_cli_from_apt_repo() {
  local keyring="/etc/apt/keyrings/githubcli-archive-keyring.gpg" arch
  arch="$(dpkg --print-architecture 2>/dev/null || echo amd64)"
  as_root mkdir -p -m 755 /etc/apt/keyrings || return 1
  run curl -fsSL https://cli.github.com/packages/githubcli-archive-keyring.gpg -o "$SCRATCH_DIR/gh.gpg" || return 1
  as_root install -m 644 "$SCRATCH_DIR/gh.gpg" "$keyring" || return 1
  write_root_file /etc/apt/sources.list.d/github-cli.list \
    "deb [arch=$arch signed-by=$keyring] https://cli.github.com/packages stable main" || return 1
  as_root env DEBIAN_FRONTEND=noninteractive apt-get update || return 1
  as_root env DEBIAN_FRONTEND=noninteractive apt-get install -y gh
}

# per docs.astral.sh/uv/getting-started/installation (standalone installer), 2026-10-09
install_uv_standalone() {
  run_pipeline 'curl -LsSf https://astral.sh/uv/install.sh | sh'
}

install_all_prerequisites() {
  run_step "apt-packages" apt_packages_present install_apt_prerequisites "true"
  run_step "nodejs" node_meets_minimum install_nodejs_from_nodesource "node -v"
  run_step "gh" "command -v gh" install_github_cli_from_apt_repo "gh --version"
  run_step "uv" "command -v uv" install_uv_standalone "uv --version"
  install_shared_tools
}

# TWG stays a step of its own here: Atlassian's Linux installer signs you in while it installs
# (developer.atlassian.com/cloud/twg-cli/getting-started/installation, 2026-10-21).
print_os_next_steps() {
  cat <<'NEXT'
  7. TWG skills (Atlassian): run Atlassian's installer, which also signs you in, then re-run step 6:
     curl -fsSL --retry 2 https://teamwork-graph.atlassian.com/cli/install | bash
NEXT
}

main "$@"
