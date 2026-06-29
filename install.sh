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
CMD="${1:-init}"

has() { command -v "$1" >/dev/null 2>&1; }

if ! has node; then
  echo "agent-harness: Node >= 20 is required. Install it from https://nodejs.org and re-run." >&2
  exit 1
fi

if has pnpm; then
  exec pnpm dlx "$REPO" "$CMD"
elif has npx; then
  exec npx -y "$REPO" "$CMD"
else
  echo "agent-harness: need pnpm or npx. Installing Node gives you npx." >&2
  exit 1
fi
