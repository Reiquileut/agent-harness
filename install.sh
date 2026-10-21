#!/usr/bin/env bash
#
# agent-harness bootstrap — OPTIONAL convenience wrapper.
#
# It just forwards to the real entrypoint:
#     pnpm dlx github:reiquileut/agent-harness init
#
# Intended to be served from a nice URL (see vercel.json) so a fresh machine can:
#     curl -fsSL https://harness.r2t.dev | bash
#
# The "brain" always lives in the repo; this script only picks a runner.
set -euo pipefail

REPO="github:reiquileut/agent-harness"
# Command (default init) + every remaining arg is forwarded, so
#   curl -fsSL <url> | bash -s -- init --overlay <git-url> -a codex
# works. On a fresh Ubuntu box or Mac use bootstrap/ubuntu.sh or bootstrap/macos.sh instead
# (they install Node and the agents first).
CMD="${1:-init}"
[ $# -gt 0 ] && shift

has() { command -v "$1" >/dev/null 2>&1; }

if ! has node; then
  echo "agent-harness: Node >= 22 is required. Install it from https://nodejs.org (Ubuntu: bootstrap/ubuntu.sh, Mac: bootstrap/macos.sh) and re-run." >&2
  exit 1
fi

if has pnpm; then
  exec pnpm dlx "$REPO" "$CMD" "$@"
elif has npx; then
  exec npx -y "$REPO" "$CMD" "$@"
else
  echo "agent-harness: need pnpm or npx. Installing Node gives you npx." >&2
  exit 1
fi
