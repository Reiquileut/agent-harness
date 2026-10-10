#!/usr/bin/env bash
#
# Shared helpers for the e2e suites in scripts/e2e/*.sh (sourced by
# scripts/ci-e2e.sh — never run directly). Every `chk` is recorded so the run
# ends in a machine-readable artifact (artifacts/e2e/report.json) that decides
# pass/fail on its own — no human reading the log required.

CLI="${CLI:-$PWD/dist/cli.js}"
REPO_ROOT="${REPO_ROOT:-$PWD}"
E2E_FIXTURES="$REPO_ROOT/test/fixtures"
E2E_RESULTS="${E2E_RESULTS:-$(mktemp)}"
E2E_SUITE="${E2E_SUITE:-unknown}"
fail=0
# Deterministic, greppable output: picocolors honours NO_COLOR (it otherwise
# colours even piped output on some Windows consoles).
export NO_COLOR=1

# Count keys under a top-level object in a JSON file: keys <file> <topLevelKey>
keys() {
  node -e 'const fs=require("fs");const o=JSON.parse(fs.readFileSync(process.argv[1]));console.log(Object.keys(o[process.argv[2]]||{}).length)' "$1" "$2"
}
# Read a dotted path from a JSON file: jget <file> <a.b.c>
jget() {
  node -e 'const fs=require("fs");let o=JSON.parse(fs.readFileSync(process.argv[1]));for(const k of process.argv[2].split("."))o=o?.[k];console.log(JSON.stringify(o))' "$1" "$2"
}
# Read a dotted path from a TOML file: tget <file> <a.b.c>
tget() {
  node -e 'const fs=require("fs");const {parse}=require("smol-toml");let o=parse(fs.readFileSync(process.argv[1],"utf8"));for(const k of process.argv[2].split("."))o=o?.[k];console.log(JSON.stringify(o))' "$1" "$2"
}

# chk <name> <shell-expr>: evaluate, print PASS/FAIL, append to the results file.
chk() {
  local verdict=true
  if eval "$2"; then echo "  PASS  $1"; else echo "  FAIL  $1"; fail=1; verdict=false; fi
  printf '%s\t%s\t%s\n' "$E2E_SUITE" "$verdict" "$1" >> "$E2E_RESULTS"
}

# fresh_home: print a new empty dir to use as HOME (Linux) / USERPROFILE (Windows).
fresh_home() { mktemp -d; }

# harness <home> <args…>: run the CLI against an isolated home, all output to stdout.
harness() {
  local home="$1"; shift
  HOME="$home" USERPROFILE="$home" node "$CLI" "$@" 2>&1
}

# file_url <dir>: a file:// URL git accepts for a local path on Linux and Git Bash.
file_url() {
  if command -v cygpath >/dev/null 2>&1; then echo "file:///$(cygpath -m "$1")"; else echo "file://$1"; fi
}

# native_path <path>: the path as the OS-native program sees it. Git Bash only
# rewrites POSIX paths in argv, not inside a ';'-joined env var value.
native_path() {
  if command -v cygpath >/dev/null 2>&1; then cygpath -m "$1"; else echo "$1"; fi
}

# write_report <file>: turn the TSV results into the JSON artifact.
write_report() {
  mkdir -p "$(dirname "$1")"
  node -e '
    const fs = require("fs");
    const rows = fs.readFileSync(process.argv[1], "utf8").split("\n").filter(Boolean);
    const checks = rows.map((r) => { const [suite, pass, name] = r.split("\t"); return { suite, name, pass: pass === "true" }; });
    const failed = checks.filter((c) => !c.pass).length;
    const report = { tool: "agent-harness", kind: "e2e", platform: process.platform, node: process.version, total: checks.length, failed, checks };
    fs.writeFileSync(process.argv[2], JSON.stringify(report, null, 2) + "\n");
  ' "$E2E_RESULTS" "$1"
}
