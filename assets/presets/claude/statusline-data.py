#!/usr/bin/env python
# Helper for statusline-command.sh:
# reads the Claude Code status JSON from stdin and prints 5 lines:
#   model display name, cwd, cost(usd), context tokens used, context window
# Context tokens come from the last usage entry in the session transcript.
import sys, json, os


def read_tail_lines(path, maxbytes=1_000_000):
    size = os.path.getsize(path)
    with open(path, "rb") as f:
        if size > maxbytes:
            f.seek(size - maxbytes)
        data = f.read()
    return data.decode("utf-8", "replace").splitlines()


def context_used(tpath):
    try:
        lines = read_tail_lines(tpath)
    except Exception:
        return 0
    for line in reversed(lines):
        if '"usage"' not in line:
            continue
        try:
            o = json.loads(line)
        except Exception:
            continue
        msg = o.get("message")
        u = msg.get("usage") if isinstance(msg, dict) else None
        if not u:
            continue
        return (
            (u.get("input_tokens") or 0)
            + (u.get("cache_read_input_tokens") or 0)
            + (u.get("cache_creation_input_tokens") or 0)
        )
    return 0


def main():
    try:
        d = json.loads(sys.stdin.read())
    except Exception:
        d = {}
    model = ((d.get("model") or {}).get("display_name")) or "Claude"
    ws = d.get("workspace") or {}
    cwd = ws.get("current_dir") or d.get("cwd") or ""
    cost = (d.get("cost") or {}).get("total_cost_usd")
    tpath = d.get("transcript_path") or ""

    # Prefer the native context_window block (Claude Code >= 2.x); fall back to
    # parsing the transcript + guessing the window for older versions.
    cw = d.get("context_window") or {}
    u = cw.get("current_usage") or {}
    used = (
        (u.get("input_tokens") or 0)
        + (u.get("cache_read_input_tokens") or 0)
        + (u.get("cache_creation_input_tokens") or 0)
    ) or (cw.get("total_input_tokens") or 0)
    if not used:
        used = context_used(tpath) if tpath else 0

    window = cw.get("context_window_size") or 0
    if not window:
        ml = model.lower()
        window = 1_000_000 if ("1m" in ml or used > 200_000) else 200_000

    cost_s = "" if cost is None else "{:.2f}".format(float(cost))

    for v in (model, cwd, cost_s, used, window):
        sys.stdout.write("{}\n".format(v))


main()
