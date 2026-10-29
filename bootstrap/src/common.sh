# Shared part of the one-command bootstraps bootstrap/ubuntu.sh and bootstrap/macos.sh (v1.7.0,
# 2026-10-21). Never run on its own: scripts/build-bootstrap.mjs inlines this file at the
# `# @include common.sh` line of each bootstrap/src/<os>.sh, because `curl … | bash` fetches ONE file
# and cannot source a sibling. Before main runs, each OS file defines BOOTSTRAP_SCRIPT_NAME,
# SHELL_RC_HINT, AI_MEMORY_OS_TAG, bootstrap_preflight, install_all_prerequisites, print_os_next_steps.
# Must run on bash 3.2 (stock macOS): no mapfile, associative arrays, case-changing ${v,,}, or
# "${array[@]}" on an array that can be empty under `set -u`.

DRY_RUN=0; ASSUME_YES=0; SKIP_HARNESS=0
OVERLAY_SPEC=""; HARNESS_SRC=""; REPORT_FILE=""
EXTRA_INIT_ARGS=(); STEP_ROWS=(); FAILED_STEPS=0
NODE_MIN_VERSION="22.18.0" # hooks, mods and the status line run .ts files with native type stripping
# pnpm 10, not latest: pnpm >= 11 ignores package.json "pnpm" settings and rejects this repo's
# lockfile (found by the clean-container CI run, 2026-10-09); CI pins 10 too.
PNPM_SPEC="pnpm@10"
AI_MEMORY_BASE="https://github.com/akitaonrails/ai-memory/releases/latest/download"
LOCAL_BIN="$HOME/.local/bin"
# One of the paths `ai-memory install-hooks` searches for its hook-script bundle (v3.2.9).
AI_MEMORY_SHARE_DIR="$HOME/.local/share/ai-memory"
SCRATCH_DIR=""
# The terminal handed to the interactive menu; BOOTSTRAP_TTY overrides it (the e2e suite uses a file).
BOOTSTRAP_TTY="${BOOTSTRAP_TTY:-/dev/tty}"

log() { printf '[bootstrap] %s\n' "$*"; }
die() { printf '[bootstrap] ERROR: %s\n' "$*" >&2; exit 1; }

# The header comment of this script; piped into bash there is no file to read it from.
usage() {
  local self="${BASH_SOURCE[0]:-}"
  if [ ! -r "$self" ]; then printf 'Usage: see the header of bootstrap/%s in Reiquileut/agent-harness\n' "$BOOTSTRAP_SCRIPT_NAME"; return 0; fi
  sed -n '2,/^set -euo/p' "$self" | sed '$d' | sed 's/^# \{0,1\}//'
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

detect_os_name() {
  local pretty=""
  if command -v sw_vers >/dev/null 2>&1; then
    pretty="$(sw_vers -productName 2>/dev/null) $(sw_vers -productVersion 2>/dev/null)"
  elif [ -r /etc/os-release ]; then
    pretty="$(. /etc/os-release; printf '%s' "${PRETTY_NAME:-${ID:-unknown}}")"
  fi
  printf '%s' "${pretty:-$(uname -s)}"
}

detect_arch_name() {
  case "$(uname -m)" in
    x86_64|amd64) printf 'x86_64' ;;
    aarch64|arm64) printf 'aarch64' ;;
    *) die "unsupported CPU architecture: received '$(uname -m)', expected x86_64 or aarch64" ;;
  esac
}

prepare_scratch_dir() {
  if [ "$DRY_RUN" = 1 ]; then SCRATCH_DIR="/tmp/agent-harness-bootstrap-dry-run"; return; fi
  SCRATCH_DIR="$(mktemp -d)"
  trap 'rm -rf "$SCRATCH_DIR"' EXIT
}

ensure_local_bin_on_path() {
  case ":$PATH:" in
    *":$LOCAL_BIN:"*) ;;
    *) log "hint: add to $SHELL_RC_HINT -> export PATH=\"\$HOME/.local/bin:\$PATH\"" ;;
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

# --- shared install functions -------------------------------------------------

# True when dotted version $2 >= $1, e.g. version_at_least 22.18.0 22.22.2. Pure bash, because
# `sort -V` is missing from older macOS; anything after the numeric part (-rc.1) is ignored.
version_at_least() {
  local IFS=. want have i
  want=(${1%%[!0-9.]*}); have=(${2%%[!0-9.]*})
  for i in 0 1 2; do
    [ "${have[$i]:-0}" -gt "${want[$i]:-0}" ] && return 0
    [ "${have[$i]:-0}" -lt "${want[$i]:-0}" ] && return 1
  done
  return 0
}

node_meets_minimum() {
  local current
  current="$(node -v 2>/dev/null)" || return 1
  [ -n "$current" ] && version_at_least "$NODE_MIN_VERSION" "${current#v}"
}

# per code.claude.com/docs/en/setup (native install for macOS, Linux and WSL; puts claude in
# ~/.local/bin), re-checked 2026-10-21
install_claude_code_native() {
  run_pipeline 'curl -fsSL https://claude.ai/install.sh | bash'
}

# sha256sum on Linux; macOS ships shasum instead.
sha256_of_file() {
  if command -v sha256sum >/dev/null 2>&1; then sha256sum "$1" | awk '{print $1}'; return; fi
  shasum -a 256 "$1" | awk '{print $1}'
}

verify_sha256_matches() {
  local file="$1" sumfile="$2" expected actual
  printf '+ verify sha256 of %s against %s\n' "$file" "$sumfile"
  [ "$DRY_RUN" = 1 ] && return 0
  expected="$(awk '{print $1}' "$sumfile")"
  actual="$(sha256_of_file "$file")"
  [ "$expected" = "$actual" ] && return 0
  log "sha256 mismatch for $file: received '$actual', expected '$expected'"
  return 1
}

# Portable `install -D -m 755 <src> <dest>`: BSD install (macOS) has no -D.
install_executable() {
  run mkdir -p "$(dirname "$2")" || return 1
  run install -m 755 "$1" "$2"
}

# Release assets checked with `gh release view --repo akitaonrails/ai-memory` (v3.1.2), 2026-10-21:
# ai-memory-<linux|macos>-<x86_64|aarch64>.tar.gz + .sha256; the tarball holds ./ai-memory at its root,
# next to ./hooks/<agent>/ (checked on v3.2.9, 2026-10-28). The hooks bundle used to be left behind,
# so `ai-memory install-hooks` failed for claude-code and codex with "could not locate hooks directory".
install_ai_memory_release() {
  local asset dir="$SCRATCH_DIR"
  asset="ai-memory-$AI_MEMORY_OS_TAG-$(detect_arch_name).tar.gz"
  run curl -fsSL -o "$dir/$asset" "$AI_MEMORY_BASE/$asset" || return 1
  run curl -fsSL -o "$dir/$asset.sha256" "$AI_MEMORY_BASE/$asset.sha256" || return 1
  verify_sha256_matches "$dir/$asset" "$dir/$asset.sha256" || return 1
  run tar -xzf "$dir/$asset" -C "$dir" ./ai-memory ./hooks || return 1
  install_executable "$dir/ai-memory" "$LOCAL_BIN/ai-memory" || return 1
  install_ai_memory_hooks_bundle "$dir/hooks"
}

# Replaces the bundle wholesale, so a script dropped upstream does not linger from an older release.
install_ai_memory_hooks_bundle() {
  run mkdir -p "$AI_MEMORY_SHARE_DIR" || return 1
  run rm -rf "$AI_MEMORY_SHARE_DIR/hooks" || return 1
  run cp -R "$1" "$AI_MEMORY_SHARE_DIR/hooks"
}

# Binary AND hooks bundle: a machine bootstrapped before the bundle fix gets repaired on re-run.
# The /usr paths are where a distro package puts the bundle; those installs are left alone.
ai_memory_installed() {
  local share
  command -v ai-memory || return 1
  for share in "$AI_MEMORY_SHARE_DIR" /usr/local/share/ai-memory /usr/share/ai-memory; do
    [ -d "$share/hooks/claude-code" ] && return 0
  done
  return 1
}

# The steps both OSes run the same way, after their own package-manager steps.
install_shared_tools() {
  run_step "pnpm" "command -v pnpm" "install_npm_global_package $PNPM_SPEC" "pnpm -v"
  run_step "claude-code" "command -v claude" install_claude_code_native "claude --version"
  run_step "codex" "command -v codex" "install_npm_global_package @openai/codex" "codex --version"
  run_step "opencode" "command -v opencode" "install_npm_global_package opencode-ai" "opencode --version"
  run_step "task-master-ai" "command -v task-master" "install_npm_global_package task-master-ai" "task-master --version"
  run_step "ai-memory" ai_memory_installed install_ai_memory_release "ai-memory --version"
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

# Opening the terminal for real, unlike `[ -r ]`: /dev/tty exists even where there is no controlling
# terminal (CI, cron, ssh -T), and redirecting from it there would abort the run.
terminal_available() {
  ( : < "$BOOTSTRAP_TTY" ) 2>/dev/null
}

# The interactive menu needs the keyboard. Piped in by `curl … | bash`, the bootstrap's stdin is the
# spent script, so the harness saw no terminal and quietly installed nothing (found 2026-10-21, v1.7.1):
# without --yes it gets the terminal instead. --yes and --dry-run never need it.
run_harness_command() {
  if [ "$ASSUME_YES" = 1 ] || [ "$DRY_RUN" = 1 ] || [ -t 0 ]; then run "${HARNESS_CMD[@]}"; return; fi
  if terminal_available; then run "${HARNESS_CMD[@]}" < "$BOOTSTRAP_TTY"; return; fi
  log "no terminal for the interactive menu: init installs only what flags name; re-run with --yes for the owner defaults"
  run "${HARNESS_CMD[@]}"
}

run_agent_harness_init() {
  local HARNESS_CMD=() final=installed
  build_harness_command
  [ "$DRY_RUN" = 1 ] && final=dry-run
  if run_harness_command; then record_step "agent-harness-init" "$final" ""; return 0; fi
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
    die "jq not found: --report needs jq, expected it from the first package step"
  fi
  if [ "$DRY_RUN" = 1 ]; then log "dry-run report (not written to $REPORT_FILE):"; build_report_json; return 0; fi
  mkdir -p "$(dirname "$REPORT_FILE")"
  build_report_json > "$REPORT_FILE"
  log "report written: $REPORT_FILE"
}

# Phase 2 of a new machine: everything above installed without a single secret; these need one.
print_next_steps() {
  cat <<'NEXT'

Next steps: logins and secrets (this script never asks for or writes credentials):
  1. claude                                 # log in to Claude Code
  2. codex login
  3. opencode auth login
  4. gh auth login && gh auth setup-git     # also lets --overlay clone a private repo
  5. export AI_MEMORY_SERVER_URL=...        # your ai-memory server
     export AI_MEMORY_AUTH_TOKEN=...        # its token, plus any MCP token your overlay names
  6. add your private overlay and the integrations that waited for a secret (safe to re-run):
     npx -y github:reiquileut/agent-harness init -y --defaults -a claude-code -a codex -a opencode [--overlay <spec>]
     ai-memory doctor
NEXT
  print_os_next_steps
}

main() {
  parse_bootstrap_args "$@"
  log "OS: $(detect_os_name) | arch: $(uname -m) | dry-run: $DRY_RUN"
  bootstrap_preflight
  prepare_scratch_dir
  ensure_local_bin_on_path
  install_all_prerequisites
  [ "$SKIP_HARNESS" = 1 ] || run_agent_harness_init
  write_report_file
  print_next_steps
  [ "$FAILED_STEPS" -eq 0 ] || die "$FAILED_STEPS step(s) failed: see 'failed' entries above"
}
