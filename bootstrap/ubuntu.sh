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

DRY_RUN=0; ASSUME_YES=0; SKIP_HARNESS=0
OVERLAY_SPEC=""; HARNESS_SRC=""; REPORT_FILE=""
EXTRA_INIT_ARGS=(); STEP_ROWS=(); FAILED_STEPS=0
APT_PACKAGES="git curl ca-certificates gnupg jq python3 make unzip xz-utils"
NODE_MIN_VERSION="22.18.0" # a Claude hook runs .ts files with native type stripping (Node >= 22.18)
AI_MEMORY_BASE="https://github.com/akitaonrails/ai-memory/releases/latest/download"
LOCAL_BIN="$HOME/.local/bin"
SCRATCH_DIR=""

log() { printf '[bootstrap] %s\n' "$*"; }
die() { printf '[bootstrap] ERROR: %s\n' "$*" >&2; exit 1; }

usage() {
  sed -n '2,/^set -euo/p' "${BASH_SOURCE[0]}" | sed '$d' | sed 's/^# \{0,1\}//'
}

parse_bootstrap_args() {
  while [ $# -gt 0 ]; do
    case "$1" in
      --dry-run) DRY_RUN=1 ;;
      --yes) ASSUME_YES=1 ;;
      --skip-harness) SKIP_HARNESS=1 ;;
      --overlay) OVERLAY_SPEC="$(require_flag_value "$@")"; shift ;;
      --harness-src) HARNESS_SRC="$(require_flag_value "$@")"; shift ;;
      --report) REPORT_FILE="$(require_flag_value "$@")"; shift ;;
      -h|--help) usage; exit 0 ;;
      --) shift; EXTRA_INIT_ARGS=("$@"); return 0 ;;
      *) die "unknown argument: received '$1', expected one of --dry-run --yes --overlay --skip-harness --harness-src --report -h --" ;;
    esac
    shift
  done
}

require_flag_value() {
  if [ $# -ge 2 ] && [ "${2#--}" = "$2" ]; then printf '%s' "$2"; return 0; fi
  die "flag $1 needs a value: received '${2:-<nothing>}', expected a path or spec"
}

# Mask `user:token@` in URLs before anything is echoed (an --overlay git URL may
# carry a token and CI logs are kept). Greedy to the last @ before the path.
redact_url_credentials() {
  printf '%s' "$1" | sed -E 's#(//)[^/[:space:]]*@#\1***@#g'
}

# Print the command (credentials masked); execute it only when not in --dry-run.
run() {
  printf '+ %s\n' "$(redact_url_credentials "$*")"
  [ "$DRY_RUN" = 1 ] && return 0
  "$@"
}

# Same as run, for a shell pipeline string (curl | sh installers).
run_pipeline() {
  printf '+ %s\n' "$(redact_url_credentials "$1")"
  [ "$DRY_RUN" = 1 ] && return 0
  bash -c "set -o pipefail; $1"
}

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

detect_os_name() {
  local pretty=""
  [ -r /etc/os-release ] && pretty="$(. /etc/os-release; printf '%s' "${PRETTY_NAME:-${ID:-unknown}}")"
  printf '%s' "${pretty:-$(uname -s)}"
}

detect_arch_name() {
  case "$(uname -m)" in
    x86_64|amd64) printf 'x86_64' ;;
    aarch64|arm64) printf 'aarch64' ;;
    *) die "unsupported CPU architecture: received '$(uname -m)', expected x86_64 or aarch64" ;;
  esac
}

# Real runs need apt; --dry-run is allowed anywhere so the plan can be previewed.
require_apt_system() {
  command -v apt-get >/dev/null 2>&1 && return 0
  if [ "$DRY_RUN" = 1 ]; then log "not an apt system ($(detect_os_name)); continuing because --dry-run"; return 0; fi
  die "unsupported OS: detected '$(detect_os_name)' without apt-get, expected Debian/Ubuntu"
}

prepare_scratch_dir() {
  if [ "$DRY_RUN" = 1 ]; then SCRATCH_DIR="/tmp/ubuntu-bootstrap-dry-run"; return; fi
  SCRATCH_DIR="$(mktemp -d)"
  trap 'rm -rf "$SCRATCH_DIR"' EXIT
}

ensure_local_bin_on_path() {
  case ":$PATH:" in
    *":$LOCAL_BIN:"*) ;;
    *) log "hint: add to your shell rc -> export PATH=\"\$HOME/.local/bin:\$PATH\"" ;;
  esac
  export PATH="$LOCAL_BIN:$PATH"
}

# --- step bookkeeping -------------------------------------------------------

version_line() {
  { eval "$1" 2>/dev/null || true; } | head -1
}

record_step() {
  STEP_ROWS+=("$(printf '%s\t%s\t%s' "$1" "$2" "$3")")
  log "step '$1': $2 ${3:+($3)}"
}

# run_step <name> <check-cmd> <install-cmd> <version-cmd>; commands are eval'd strings.
run_step() {
  local name="$1" check="$2" install="$3" vercmd="$4"
  if eval "$check" >/dev/null 2>&1; then record_step "$name" skipped "$(version_line "$vercmd")"; return; fi
  if [ "$DRY_RUN" = 1 ]; then eval "$install" || true; record_step "$name" dry-run ""; return; fi
  hash -r
  if eval "$install" && hash -r && eval "$check" >/dev/null 2>&1; then
    record_step "$name" installed "$(version_line "$vercmd")"
  else
    FAILED_STEPS=$((FAILED_STEPS + 1))
    record_step "$name" failed ""
    log "install failed for '$name': check '$check' still false after '$install'"
  fi
}

# --- install functions ------------------------------------------------------

apt_packages_present() {
  # shellcheck disable=SC2086
  dpkg -s $APT_PACKAGES >/dev/null 2>&1
}

install_apt_prerequisites() {
  as_root env DEBIAN_FRONTEND=noninteractive apt-get update || return 1
  # shellcheck disable=SC2086
  as_root env DEBIAN_FRONTEND=noninteractive apt-get install -y $APT_PACKAGES
}

node_meets_minimum() {
  local current lowest
  current="$(node -v 2>/dev/null | sed 's/^v//')" || return 1
  [ -n "$current" ] || return 1
  lowest="$(printf '%s\n%s\n' "$NODE_MIN_VERSION" "$current" | sort -V | head -1)"
  [ "$lowest" = "$NODE_MIN_VERSION" ]
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

# per code.claude.com/docs/en/setup (native install, recommended), 2026-10-09
install_claude_code_native() {
  run_pipeline 'curl -fsSL https://claude.ai/install.sh | bash'
}

verify_sha256_matches() {
  local file="$1" sumfile="$2" expected actual
  printf '+ verify sha256 of %s against %s\n' "$file" "$sumfile"
  [ "$DRY_RUN" = 1 ] && return 0
  expected="$(awk '{print $1}' "$sumfile")"
  actual="$(sha256sum "$file" | awk '{print $1}')"
  [ "$expected" = "$actual" ] && return 0
  log "sha256 mismatch for $file: received '$actual', expected '$expected'"
  return 1
}

# Release assets verified via `gh release view --repo akitaonrails/ai-memory` (v2.6.2), 2026-10-09:
# ai-memory-linux-<x86_64|aarch64>.tar.gz + .sha256; tarball holds ./ai-memory at its root.
install_ai_memory_release() {
  local asset dir="$SCRATCH_DIR"
  asset="ai-memory-linux-$(detect_arch_name).tar.gz"
  run curl -fsSL -o "$dir/$asset" "$AI_MEMORY_BASE/$asset" || return 1
  run curl -fsSL -o "$dir/$asset.sha256" "$AI_MEMORY_BASE/$asset.sha256" || return 1
  verify_sha256_matches "$dir/$asset" "$dir/$asset.sha256" || return 1
  run tar -xzf "$dir/$asset" -C "$dir" ./ai-memory || return 1
  run install -D -m 755 "$dir/ai-memory" "$LOCAL_BIN/ai-memory"
}

install_all_prerequisites() {
  run_step "apt-packages" apt_packages_present install_apt_prerequisites "true"
  run_step "nodejs" node_meets_minimum install_nodejs_from_nodesource "node -v"
  # pnpm 10, not latest: pnpm >= 11 ignores package.json "pnpm" settings and rejects
  # this repo's lockfile (found by the clean-container CI run, 2026-10-09); CI pins 10 too.
  run_step "pnpm" "command -v pnpm" "install_npm_global_package pnpm@10" "pnpm -v"
  run_step "gh" "command -v gh" install_github_cli_from_apt_repo "gh --version"
  run_step "uv" "command -v uv" install_uv_standalone "uv --version"
  run_step "claude-code" "command -v claude" install_claude_code_native "claude --version"
  run_step "codex" "command -v codex" "install_npm_global_package @openai/codex" "codex --version"
  run_step "opencode" "command -v opencode" "install_npm_global_package opencode-ai" "opencode --version"
  run_step "task-master-ai" "command -v task-master" "install_npm_global_package task-master-ai" "task-master --version"
  run_step "ai-memory" "command -v ai-memory" install_ai_memory_release "ai-memory --version"
}

# --- agent-harness ----------------------------------------------------------

build_harness_command() {
  if [ -n "$HARNESS_SRC" ]; then
    HARNESS_CMD=(node "$HARNESS_SRC/dist/cli.js")
  else
    HARNESS_CMD=(npx -y github:reiquileut/agent-harness)
  fi
  HARNESS_CMD+=(init)
  # --defaults (v1.7.0): the owner setup flagged in the catalogs, not --all — with an overlay,
  # --all would also pull the entries it keeps off by default (e.g. an MCP that can spend money).
  [ "$ASSUME_YES" = 1 ] && HARNESS_CMD+=(-y --defaults -a claude-code -a codex -a opencode)
  [ -n "$OVERLAY_SPEC" ] && HARNESS_CMD+=(--overlay "$OVERLAY_SPEC")
  [ "${#EXTRA_INIT_ARGS[@]}" -gt 0 ] && HARNESS_CMD+=("${EXTRA_INIT_ARGS[@]}")
  return 0
}

run_agent_harness_init() {
  local HARNESS_CMD=() final=installed
  build_harness_command
  [ "$DRY_RUN" = 1 ] && final=dry-run
  if run "${HARNESS_CMD[@]}"; then record_step "agent-harness-init" "$final" ""; return 0; fi
  FAILED_STEPS=$((FAILED_STEPS + 1))
  record_step "agent-harness-init" failed ""
}

# --- report + hints ---------------------------------------------------------

build_report_json() {
  local ok=true
  [ "$FAILED_STEPS" -eq 0 ] || ok=false
  printf '%s\n' "${STEP_ROWS[@]}" | jq -Rn --arg os "$(detect_os_name)" --arg arch "$(uname -m)" --argjson ok "$ok" \
    '{os:$os, arch:$arch, steps:[inputs | select(length>0) | split("\t") | {name:.[0], status:.[1], version:(.[2] // "")}], ok:$ok}'
}

write_report_file() {
  [ -n "$REPORT_FILE" ] || return 0
  if ! command -v jq >/dev/null 2>&1; then
    [ "$DRY_RUN" = 1 ] && { log "jq missing; skipping report in dry-run"; return 0; }
    die "jq not found: --report needs jq, expected it from the apt-packages step"
  fi
  if [ "$DRY_RUN" = 1 ]; then log "dry-run report (not written to $REPORT_FILE):"; build_report_json; return 0; fi
  mkdir -p "$(dirname "$REPORT_FILE")"
  build_report_json > "$REPORT_FILE"
  log "report written: $REPORT_FILE"
}

print_next_steps() {
  cat <<'NEXT'

Next steps (credentials are never written by this script):
  1. claude                 # log in to Claude Code
  2. codex login
  3. opencode auth login
  4. gh auth login
  5. export AI_MEMORY_SERVER_URL=...    # your ai-memory server
     export AI_MEMORY_AUTH_TOKEN=...    # its token
     then re-run:  npx -y github:reiquileut/agent-harness init -y --integration ai-memory                      -a claude-code -a codex -a opencode
  6. ai-memory doctor
  Private overlay over git? Run `gh auth login && gh auth setup-git` before --overlay <git-url>.
NEXT
}

main() {
  parse_bootstrap_args "$@"
  log "OS: $(detect_os_name) | arch: $(uname -m) | dry-run: $DRY_RUN"
  require_apt_system
  prepare_scratch_dir
  ensure_local_bin_on_path
  install_all_prerequisites
  [ "$SKIP_HARNESS" = 1 ] || run_agent_harness_init
  write_report_file
  print_next_steps
  [ "$FAILED_STEPS" -eq 0 ] || die "$FAILED_STEPS step(s) failed: see 'failed' entries above"
}

main "$@"
