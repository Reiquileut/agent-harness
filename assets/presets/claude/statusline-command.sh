#!/usr/bin/env bash
# Status line derived from the user's oh-my-posh theme
# (C:\Users\<user>\AppData\Local\oh-my-posh\themes\1_shell.omp.json),
# which is loaded by the Windows PowerShell profile.
# Segments mirrored: session (user), time, git (branch/dirty/stash), path.
# Added: context window usage and session cost. Model name is appended (dimmed).

input=$(cat)

# Resolve the helper with a Windows-friendly path (forward slashes) so the
# native python interpreter can find it from Git Bash.
base="${USERPROFILE//\\//}"
[ -z "$base" ] && base="$HOME"
py="$base/.claude/statusline-data.py"

# tr -d '\r': native Windows python prints CRLF, which would otherwise leave a
# stray CR on every field (breaking the numeric guards and trailing segments).
mapfile -t d < <(printf '%s' "$input" | python "$py" 2>/dev/null | tr -d '\r')
model="${d[0]:-Claude}"
cwd="${d[1]:-}"
cost="${d[2]:-}"
used="${d[3]:-0}"
window="${d[4]:-200000}"

[ -z "$model" ] && model="Claude"
[ -z "$cwd" ] && cwd="?"
case "$used" in ''|*[!0-9]*) used=0;; esac
case "$window" in ''|*[!0-9]*) window=200000;; esac

user="${USERNAME:-$(whoami 2>/dev/null)}"
[ -z "$user" ] && user="user"

now=$(date "+%a %I:%M%p" 2>/dev/null)

home_win="${USERPROFILE:-$HOME}"
path_disp="$cwd"
[ -n "$home_win" ] && path_disp="${path_disp/#$home_win/~}"

git_info=""
if git -C "$cwd" --no-optional-locks rev-parse --is-inside-work-tree >/dev/null 2>&1; then
  branch=$(git -C "$cwd" --no-optional-locks branch --show-current 2>/dev/null)
  [ -z "$branch" ] && branch=$(git -C "$cwd" --no-optional-locks rev-parse --short HEAD 2>/dev/null)
  dirty=""
  [ -n "$(git -C "$cwd" --no-optional-locks status --porcelain 2>/dev/null)" ] && dirty=" *"
  stashn=$(git -C "$cwd" --no-optional-locks stash list 2>/dev/null | wc -l | tr -d ' ')
  stash=""
  [ "${stashn:-0}" -gt 0 ] 2>/dev/null && stash=" (${stashn} stash)"
  git_info="${branch}${dirty}${stash}"
fi

# Context usage: round tokens to nearest k and compute percentage of window.
used_k=$(( (used + 500) / 1000 ))
pct=0
[ "$window" -gt 0 ] && pct=$(( used * 100 / window ))
if [ "$window" -ge 1000000 ]; then
  win_label="1M"
else
  win_label="$(( window / 1000 ))k"
fi

# Truecolor palette lifted from 1_shell.omp.json.
# Use ANSI-C quoting ($'...') so the variables hold real ESC bytes — this makes
# them render correctly both inside printf formats and in plain concatenation.
USER_C=$'\033[38;2;255;190;188m'
ACCENT_C=$'\033[38;2;255;112;166m'
DATE_C=$'\033[38;2;188;147;255m'
GIT_C=$'\033[38;2;238;121;209m'
PATH_C=$'\033[38;2;255;175;210m'
CTX_C=$'\033[38;2;95;215;255m'
COST_C=$'\033[38;2;126;231;135m'
WHITE=$'\033[38;2;255;255;255m'
DIM=$'\033[2m'
RESET=$'\033[0m'

line=$(printf "${ACCENT_C}%s${RESET} ${WHITE}on${RESET} ${DATE_C}%s${RESET}" "$user" "$now")

if [ -n "$git_info" ]; then
  line="${line} ${WHITE}|${RESET} $(printf "${GIT_C}%s${RESET}" "$git_info")"
fi

line="${line} ${WHITE}|${RESET} $(printf "${PATH_C}%s${RESET}" "$path_disp")"
line="${line} ${WHITE}|${RESET} $(printf "${CTX_C}ctx %sk/%s (%s%%)${RESET}" "$used_k" "$win_label" "$pct")"
if [ -n "$cost" ]; then
  line="${line} ${WHITE}|${RESET} $(printf "${COST_C}\$%s${RESET}" "$cost")"
fi
line="${line} ${WHITE}|${RESET} $(printf "${DIM}%s${RESET}" "$model")"

printf "%s" "$line"
