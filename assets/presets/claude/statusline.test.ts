// Failure modes for assets/presets/claude/statusline.ts, listed BEFORE the code was written (rule 7).
// This suite covers the in-process ones; statusline-io.test.ts covers files, git and processes.
//   stdin   : empty, whitespace, truncated, not JSON, JSON that is not an object, UTF-8 BOM
//   fields  : missing, wrong types, non-numeric strings, negative/fractional numbers, null cost
//   context : zero usage, rounding edges, window from field / model "1M" / used > 200k, fallbacks
//   path    : Windows and POSIX homes, sibling prefix, mixed separators, drive-letter case, no home
//   git     : not a repo, clean, dirty, stash, detached HEAD, failing commands, no call without a cwd
//   output  : one line, no CR, exact ANSI bytes, never throws, exit code 0 as a real process
//
// Run: node --test assets/presets/claude/statusline.test.ts   (Node >= 22.18 runs .ts files natively)
// Ported on 2026-10-20 from tests/statusline.test.ts of the tsup-bundled runner repo (agent-harness): same
// cases, now a plain `.ts` file next to the asset that imports it by relative path. Shared helpers live in
// statusline-test-support.ts. Pure ASCII on purpose: the BOM is written \u{FEFF}, never typed as a raw character.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import {
  collapseHomeDirectory,
  describeGitWorkTree,
  formatClockLabel,
  formatUsdAmount,
  parseStatusLineInput,
  renderStatusLine,
  renderStatusLineSafely,
  resolveUserName,
} from './statusline.ts';
import type { GitRunner, StatusLineInput } from './statusline.ts';
import {
  buildEnvironment,
  buildSampleInput,
  DEFAULT_PLAIN_LINE,
  FakeGitRunner,
  renderPlain,
  runTypeScriptScript,
  skipWithoutTypeStripping,
  stripAnsi,
} from './statusline-test-support.ts';

const STATUSLINE_SCRIPT = fileURLToPath(new URL('./statusline.ts', import.meta.url));
const CONTEXT_SEGMENT = /ctx \d+k\/(?:\d+k|1M) \(\d+%\)/;
const CLEAN_REPO: Readonly<Record<string, string>> = {
  'rev-parse --is-inside-work-tree': 'true\n',
  'branch --show-current': 'main\n',
  'status --porcelain': '',
  'stash list': '',
};
const DIRTY_REPO_WITH_TWO_STASHES: Readonly<Record<string, string>> = {
  ...CLEAN_REPO,
  'status --porcelain': ' M src/index.ts\n?? notes.txt\n',
  'stash list': 'stash@{0}: WIP on main: abc123 one\nstash@{1}: WIP on main: def456 two\n',
};
const explodingFakeGitRunner: GitRunner = () => {
  throw new Error('fake git runner exploded');
};

function contextOf(contextWindow: Record<string, unknown>, modelName = 'Claude'): string {
  const plain = renderPlain({ model: { display_name: modelName }, context_window: contextWindow });
  const match = CONTEXT_SEGMENT.exec(plain);
  assert.ok(match, `no ctx segment in ${JSON.stringify(plain)}`);
  return match[0];
}

// --- fail-safe stdin handling ---------------------------------------------------------------

const UNUSABLE_STDIN: ReadonlyArray<readonly [string, string]> = [
  ['empty', ''],
  ['whitespace only', '  \n\t '],
  ['truncated JSON', '{"model": {"display_name": '],
  ['plain text', 'not json at all'],
  ['JSON null', 'null'],
  ['a JSON array', '[1,2,3]'],
  ['a JSON string', '"Opus"'],
  ['a JSON number', '42'],
  ['an empty JSON object', '{}'],
];

for (const [label, rawStdin] of UNUSABLE_STDIN) {
  test(`stdin that is ${label} renders the default line without throwing`, () => {
    assert.equal(stripAnsi(renderStatusLineSafely(rawStdin, buildEnvironment())), DEFAULT_PLAIN_LINE);
  });
}

const MALFORMED_FIELDS: ReadonlyArray<readonly [string, StatusLineInput]> = [
  ['model is a string', { model: 'Opus' }],
  ['display_name is a number', { model: { display_name: 42 } }],
  ['display_name is empty', { model: { display_name: '' } }],
  ['workspace is an array', { workspace: ['x'] }],
  ['current_dir is a number', { workspace: { current_dir: 7 }, cwd: 9 }],
  ['cost is an object', { cost: { total_cost_usd: {} } }],
  ['context_window is a string', { context_window: 'wide' }],
  ['transcript_path is a number', { transcript_path: 99 }],
];

for (const [label, input] of MALFORMED_FIELDS) {
  test(`malformed field (${label}) falls back to the default segment`, () => {
    assert.equal(renderPlain(input), DEFAULT_PLAIN_LINE);
  });
}

test('parseStatusLineInput keeps JSON objects, strips a BOM and rejects everything else', () => {
  assert.deepEqual(parseStatusLineInput('{"cwd":"/x"}'), { cwd: '/x' });
  assert.deepEqual(parseStatusLineInput('\u{FEFF}{"cwd":"/x"}'), { cwd: '/x' });
  for (const rawText of ['', 'nope', '[]', 'null', '7', '"s"']) assert.deepEqual(parseStatusLineInput(rawText), {});
});

test('renderStatusLineSafely recovers from a renderer that throws', () => {
  const rawStdin = JSON.stringify({ workspace: { current_dir: '/work/app' } });
  const line = renderStatusLineSafely(rawStdin, buildEnvironment({ runGit: explodingFakeGitRunner }));
  assert.equal(stripAnsi(line), DEFAULT_PLAIN_LINE);
});

// --- directory and cost -----------------------------------------------------------------------

test('workspace.current_dir beats cwd, and an empty current_dir falls back to cwd', () => {
  assert.match(renderPlain({ workspace: { current_dir: '/a' }, cwd: '/b' }), / \| \/a \| ctx/);
  assert.match(renderPlain({ workspace: { current_dir: '' }, cwd: '/b' }), / \| \/b \| ctx/);
  assert.match(renderPlain({ cwd: '/b' }), / \| \/b \| ctx/);
});

test('cost segment is omitted for null or missing cost but shown for zero', () => {
  assert.doesNotMatch(renderPlain({ cost: { total_cost_usd: null } }), /\$/);
  assert.doesNotMatch(renderPlain({ cost: {} }), /\$/);
  assert.doesNotMatch(renderPlain({ cost: { total_cost_usd: 'abc' } }), /\$/);
  assert.match(renderPlain({ cost: { total_cost_usd: 0 } }), / \| \$0\.00 \| Claude$/);
});

// Expected strings come from Python's "{:.2f}".format(), the helper being ported.
const COST_FORMATS: ReadonlyArray<readonly [number, string]> = [
  [1.2345, '1.23'], [0, '0.00'], [12.5, '12.50'], [100, '100.00'], [1234.567, '1234.57'],
  [0.125, '0.12'], [0.375, '0.38'], [0.625, '0.62'], [0.875, '0.88'], [1.125, '1.12'],
  [1.005, '1.00'], [2.675, '2.67'], [0.005, '0.01'], [99.995, '100.00'],
  [-0.5, '-0.50'], [-0.125, '-0.12'], [-0, '-0.00'],
];

test('formatUsdAmount matches Python two-decimal formatting, including half-even binary ties', () => {
  for (const [amount, expected] of COST_FORMATS) assert.equal(formatUsdAmount(amount), expected, `amount ${amount}`);
});

// --- context segment --------------------------------------------------------------------------

test('zero usage on the default window renders ctx 0k/200k (0%)', () => {
  assert.equal(contextOf({ current_usage: null, context_window_size: 200000 }), 'ctx 0k/200k (0%)');
});

test('used tokens are input + cache read + cache creation; output tokens are ignored', () => {
  const usage = { input_tokens: 1000, cache_read_input_tokens: 40000, cache_creation_input_tokens: 2500, output_tokens: 99999 };
  assert.equal(contextOf({ current_usage: usage }), 'ctx 44k/200k (21%)');
});

const ROUNDING_CASES: ReadonlyArray<readonly [number, string]> = [
  [499, 'ctx 0k/200k (0%)'], [500, 'ctx 1k/200k (0%)'], [1499, 'ctx 1k/200k (0%)'], [1500, 'ctx 2k/200k (0%)'],
  [1999, 'ctx 2k/200k (0%)'], [2000, 'ctx 2k/200k (1%)'], [12345, 'ctx 12k/200k (6%)'],
  [100000, 'ctx 100k/200k (50%)'], [199999, 'ctx 200k/200k (99%)'], [200000, 'ctx 200k/200k (100%)'],
];

test('thousands round half up and the percentage floors', () => {
  for (const [usedTokens, expected] of ROUNDING_CASES) {
    assert.equal(contextOf({ current_usage: { input_tokens: usedTokens } }), expected, `used ${usedTokens}`);
  }
});

test('total_input_tokens is used when current_usage is missing, null or sums to zero', () => {
  assert.equal(contextOf({ total_input_tokens: 30000 }), 'ctx 30k/200k (15%)');
  assert.equal(contextOf({ current_usage: null, total_input_tokens: 30000 }), 'ctx 30k/200k (15%)');
  assert.equal(contextOf({ current_usage: { output_tokens: 5 }, total_input_tokens: 30000 }), 'ctx 30k/200k (15%)');
  assert.equal(contextOf({ current_usage: { input_tokens: 10000 }, total_input_tokens: 30000 }), 'ctx 10k/200k (5%)');
});

test('window label: explicit sizes, 1M cap label and sub-million sizes', () => {
  assert.equal(contextOf({ context_window_size: 1000000 }), 'ctx 0k/1M (0%)');
  assert.equal(contextOf({ context_window_size: 2000000 }), 'ctx 0k/1M (0%)');
  assert.equal(contextOf({ context_window_size: 500000 }), 'ctx 0k/500k (0%)');
  assert.equal(contextOf({ context_window_size: 1500 }), 'ctx 0k/1k (0%)');
});

test('window falls back to 1M when the model name mentions 1M, otherwise 200k', () => {
  assert.equal(contextOf({}, 'Opus 4.5 (1M context)'), 'ctx 0k/1M (0%)');
  assert.equal(contextOf({}, 'claude-opus-4-5[1m]'), 'ctx 0k/1M (0%)');
  assert.equal(contextOf({}, 'Sonnet 4.5'), 'ctx 0k/200k (0%)');
  assert.equal(contextOf({ context_window_size: 0 }, 'Opus (1M context)'), 'ctx 0k/1M (0%)');
});

test('an explicit window beats the model-name hint', () => {
  assert.equal(contextOf({ context_window_size: 200000 }, 'Opus (1M context)'), 'ctx 0k/200k (0%)');
});

test('without a window, usage above 200000 implies 1M but exactly 200000 does not', () => {
  assert.equal(contextOf({ current_usage: { input_tokens: 200000 } }), 'ctx 200k/200k (100%)');
  assert.equal(contextOf({ current_usage: { input_tokens: 200001 } }), 'ctx 200k/1M (20%)');
  assert.equal(contextOf({ current_usage: { input_tokens: 250000 } }), 'ctx 250k/1M (25%)');
  assert.equal(contextOf({ current_usage: { input_tokens: 250000 }, context_window_size: 200000 }), 'ctx 250k/200k (125%)');
});

test('non-numeric strings, objects, negatives and fractions in numeric fields count as absent', () => {
  const garbageStrings = {
    current_usage: { input_tokens: 'many', cache_read_input_tokens: {}, cache_creation_input_tokens: 'lots' },
    total_input_tokens: 'x',
    context_window_size: 'wide',
  };
  const garbageNumbers = {
    current_usage: { input_tokens: -5, cache_read_input_tokens: 1.5, cache_creation_input_tokens: Number.NaN },
    total_input_tokens: Number.POSITIVE_INFINITY,
    context_window_size: -200000,
  };
  assert.equal(contextOf(garbageStrings), 'ctx 0k/200k (0%)');
  assert.equal(contextOf(garbageNumbers), 'ctx 0k/200k (0%)');
});

// --- home directory collapse -----------------------------------------------------------------

const HOME_COLLAPSE_CASES: ReadonlyArray<readonly [string, string, string, string]> = [
  ['Windows home', 'C:\\Users\\me\\Documents\\GitHub\\agent-harness', 'C:\\Users\\me', '~\\Documents\\GitHub\\agent-harness'],
  ['POSIX home', '/Users/bob/dev/app', '/Users/bob', '~/dev/app'],
  ['exactly the home', '/Users/bob', '/Users/bob', '~'],
  ['home with a trailing slash', '/Users/bob/dev', '/Users/bob/', '~/dev'],
  ['sibling sharing the prefix', '/Users/bobby/dev', '/Users/bob', '/Users/bobby/dev'],
  ['outside the home', '/opt/work', '/Users/bob', '/opt/work'],
  ['unknown home', '/Users/bob/dev', '', '/Users/bob/dev'],
  ['root as home', '/srv/app', '/', '/srv/app'],
  ['forward slashes against a backslash home', 'C:/Users/me/x', 'C:\\Users\\me', '~/x'],
  ['drive-letter case', 'c:\\users\\me\\x', 'C:\\Users\\me', '~\\x'],
  ['POSIX stays case-sensitive', '/users/bob/dev', '/Users/bob', '/users/bob/dev'],
  ['glob characters are literal', '/srv/we*rd/app', '/srv/we*rd', '~/app'],
  ['unknown directory marker', '?', '/Users/bob', '?'],
];

test('collapseHomeDirectory replaces the home prefix with ~ on Windows and POSIX paths', () => {
  for (const [label, directory, homeDirectory, expected] of HOME_COLLAPSE_CASES) {
    assert.equal(collapseHomeDirectory(directory, homeDirectory), expected, label);
  }
});

test('the rendered path segment is collapsed with the injected home directory', () => {
  const plain = renderPlain({ cwd: 'C:\\Users\\tester\\work' }, { homeDirectory: 'C:\\Users\\tester' });
  assert.match(plain, / \| ~\\work \| ctx/);
});

// --- git segment ------------------------------------------------------------------------------

function describeFakeRepository(responses: Readonly<Record<string, string | null>>): string {
  return describeGitWorkTree('/r', new FakeGitRunner(responses).run);
}

test('git segment is omitted when the directory is not a work tree, after a single probe', () => {
  const runner = new FakeGitRunner({});
  assert.equal(describeGitWorkTree('/work/app', runner.run), '');
  assert.deepEqual(runner.calls, ['/work/app::rev-parse --is-inside-work-tree']);
});

test('git state text: clean, dirty, stashed and detached HEAD', () => {
  assert.equal(describeFakeRepository(CLEAN_REPO), 'main');
  assert.equal(describeFakeRepository({ ...CLEAN_REPO, 'status --porcelain': ' M a.ts\n' }), 'main *');
  assert.equal(describeFakeRepository({ ...CLEAN_REPO, 'stash list': 'stash@{0}: WIP\n' }), 'main (1 stash)');
  assert.equal(describeFakeRepository(DIRTY_REPO_WITH_TWO_STASHES), 'main * (2 stash)');
  const detachedHead = { ...CLEAN_REPO, 'branch --show-current': '\n', 'rev-parse --short HEAD': 'abc1234\n' };
  assert.equal(describeFakeRepository(detachedHead), 'abc1234');
});

test('failing status or stash commands count as clean and unstashed, and an empty state hides the segment', () => {
  assert.equal(describeFakeRepository({ ...CLEAN_REPO, 'status --porcelain': null, 'stash list': null }), 'main');
  assert.equal(describeFakeRepository({ ...CLEAN_REPO, 'branch --show-current': '' }), '');
});

test('git segment sits between the clock and the path and never runs without a directory', () => {
  const runner = new FakeGitRunner(DIRTY_REPO_WITH_TWO_STASHES);
  const plain = renderPlain({ workspace: { current_dir: '/work/app' } }, { runGit: runner.run });
  assert.equal(plain, 'tester on Tue 09:05PM | main * (2 stash) | /work/app | ctx 0k/200k (0%) | Claude');
  assert.ok(runner.calls.every((call) => call.startsWith('/work/app::')));
  const idleRunner = new FakeGitRunner(DIRTY_REPO_WITH_TWO_STASHES);
  renderPlain({}, { runGit: idleRunner.run });
  assert.deepEqual(idleRunner.calls, []);
});

// --- clock and user name ----------------------------------------------------------------------

const CLOCK_CASES: ReadonlyArray<readonly [Date, string]> = [
  [new Date(2026, 9, 20, 21, 5), 'Tue 09:05PM'],
  [new Date(2026, 9, 18, 0, 0), 'Sun 12:00AM'],
  [new Date(2026, 9, 19, 12, 0), 'Mon 12:00PM'],
  [new Date(2026, 9, 21, 13, 7), 'Wed 01:07PM'],
  [new Date(2026, 9, 22, 23, 59), 'Thu 11:59PM'],
  [new Date(2026, 9, 23, 0, 5), 'Fri 12:05AM'],
  [new Date(2026, 9, 24, 9, 30), 'Sat 09:30AM'],
];

test('formatClockLabel matches date "+%a %I:%M%p" in the C locale', () => {
  for (const [moment, expected] of CLOCK_CASES) assert.equal(formatClockLabel(moment), expected);
  assert.equal(formatClockLabel(new Date(Number.NaN)), '');
});

test('resolveUserName prefers USERNAME, then the OS user, then "user"', () => {
  assert.equal(resolveUserName('me', () => 'os-user'), 'me');
  assert.equal(resolveUserName('', () => 'os-user'), 'os-user');
  assert.equal(resolveUserName(undefined, () => 'os-user'), 'os-user');
  assert.equal(resolveUserName(undefined, () => ''), 'user');
  assert.equal(resolveUserName(undefined, () => { throw new Error('no passwd entry'); }), 'user');
});

// --- exact bytes ------------------------------------------------------------------------------

const ANSI_WHITE_PIPE = ' \x1b[38;2;255;255;255m|\x1b[0m ';
const GOLDEN_FULL_LINE =
  '\x1b[38;2;255;112;166mtester\x1b[0m \x1b[38;2;255;255;255mon\x1b[0m \x1b[38;2;188;147;255mTue 09:05PM\x1b[0m' +
  `${ANSI_WHITE_PIPE}\x1b[38;2;238;121;209mmain * (2 stash)\x1b[0m` +
  `${ANSI_WHITE_PIPE}\x1b[38;2;255;175;210m~\\work\\app\x1b[0m` +
  `${ANSI_WHITE_PIPE}\x1b[38;2;95;215;255mctx 44k/200k (21%)\x1b[0m` +
  `${ANSI_WHITE_PIPE}\x1b[38;2;126;231;135m$1.23\x1b[0m` +
  `${ANSI_WHITE_PIPE}\x1b[2mOpus 4.5\x1b[0m`;
const GOLDEN_MINIMAL_LINE =
  '\x1b[38;2;255;112;166mtester\x1b[0m \x1b[38;2;255;255;255mon\x1b[0m \x1b[38;2;188;147;255mTue 09:05PM\x1b[0m' +
  `${ANSI_WHITE_PIPE}\x1b[38;2;255;175;210m?\x1b[0m` +
  `${ANSI_WHITE_PIPE}\x1b[38;2;95;215;255mctx 0k/200k (0%)\x1b[0m` +
  `${ANSI_WHITE_PIPE}\x1b[2mClaude\x1b[0m`;

test('golden line: every segment, separator and truecolor escape byte-for-byte', () => {
  const runner = new FakeGitRunner(DIRTY_REPO_WITH_TWO_STASHES);
  const environment = buildEnvironment({ homeDirectory: 'C:\\Users\\tester', runGit: runner.run });
  assert.equal(renderStatusLine(buildSampleInput('C:\\Users\\tester\\work\\app'), environment), GOLDEN_FULL_LINE);
});

test('golden line: the minimal default line has no git and no cost segment', () => {
  assert.equal(renderStatusLine({}, buildEnvironment()), GOLDEN_MINIMAL_LINE);
});

test('output is one line without CR, LF or a trailing newline, even for CR in model or directory', () => {
  const line = renderStatusLine({ model: { display_name: 'Opus\r' }, workspace: { current_dir: '/work/app\r' } }, buildEnvironment());
  assert.doesNotMatch(line, /[\r\n]/);
  assert.match(stripAnsi(line), / \| \/work\/app \| .* \| Opus$/);
});

test('a newline inside the directory name (legal on POSIX) is flattened to a space, keeping one line', () => {
  const input = { model: { display_name: 'Opus' }, workspace: { current_dir: '/work/a\npp' }, cost: { total_cost_usd: 0.5 } };
  const line = renderStatusLine(input, buildEnvironment());
  assert.doesNotMatch(line, /[\r\n]/);
  assert.match(stripAnsi(line), / \| \/work\/a pp \| ctx 0k\/200k \(0%\) \| \$0\.50 \| Opus$/);
});

// --- the real script as a process -------------------------------------------------------------

test('node statusline.ts prints the line for Claude Code JSON on stdin and exits 0', (t) => {
  if (skipWithoutTypeStripping(t)) return;
  const run = runTypeScriptScript(STATUSLINE_SCRIPT, JSON.stringify(buildSampleInput()));
  assert.equal(run.status, 0, run.stderr);
  assert.match(stripAnsi(run.stdout), /ctx 44k\/200k \(21%\) \| \$1\.23 \| Opus 4\.5$/);
  assert.doesNotMatch(run.stdout, /[\r\n]/);
});

test('node statusline.ts still exits 0 with the default line for empty or invalid stdin', (t) => {
  if (skipWithoutTypeStripping(t)) return;
  for (const rawStdin of ['', 'not json', '[1]']) {
    const run = runTypeScriptScript(STATUSLINE_SCRIPT, rawStdin);
    assert.equal(run.status, 0, run.stderr);
    assert.match(stripAnsi(run.stdout), / \| \? \| ctx 0k\/200k \(0%\) \| Claude$/);
  }
});
