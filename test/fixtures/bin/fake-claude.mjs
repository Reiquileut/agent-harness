// Fake `claude` CLI for scripts/e2e/15-claude-cli.sh. Records argv and mimics
// the real CLI's parsing trap: `-e/--env` and `-H/--header` are VARIADIC, so
// any token after them that doesn't start with "-" is swallowed as another
// value — `claude mcp add --env K=V name …` loses the server name (seen with
// Claude Code 2.1.296 in a clean ubuntu:24.04 container, 2026-10-09).
import { appendFileSync } from 'node:fs';
import process from 'node:process';

const argv = process.argv.slice(2);
const VARIADIC = new Set(['-e', '--env', '-H', '--header']);
const WITH_VALUE = new Set(['-s', '--scope', '-t', '--transport']);

function recordFakeClaudeCall(verdict) {
  if (process.env.FAKE_CLAUDE_LOG) appendFileSync(process.env.FAKE_CLAUDE_LOG, `${verdict} argv=${argv.join(' ')}\n`);
}

/** Positionals of `mcp add …` as the real (commander) parser sees them. */
function fakeClaudePositionals(rest) {
  const positionals = [];
  let mode = 'normal';
  for (let i = 0; i < rest.length; i += 1) {
    const token = rest[i];
    if (token === '--') return [...positionals, ...rest.slice(i + 1)];
    if (VARIADIC.has(token)) { mode = 'variadic'; continue; }
    if (WITH_VALUE.has(token)) { i += 1; mode = 'normal'; continue; }
    if (token.startsWith('-')) { mode = 'normal'; continue; }
    if (mode === 'normal') positionals.push(token);
  }
  return positionals;
}

if (argv[0] === 'mcp' && argv[1] === 'get') process.exit(1);
if (argv[0] === 'mcp' && argv[1] === 'add') {
  const [name] = fakeClaudePositionals(argv.slice(2));
  const expected = process.env.FAKE_CLAUDE_EXPECT_NAME;
  const ok = !expected || name === expected;
  recordFakeClaudeCall(ok ? 'ok' : `bad-name(${name ?? 'none'})`);
  process.exit(ok ? 0 : 1);
}
recordFakeClaudeCall('other');
