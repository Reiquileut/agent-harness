// Filesystem- and process-backed failure modes for assets/presets/claude/statusline.ts (rule 7, listed
// before the code): transcript missing / a directory / CRLF / junk lines / empty or output-only usage /
// a >1 MB tail / a line cut by the boundary; the entry-point guard; a script copied out of the repo;
// and a real git repository (dirty + stash) read through the default runner.
//
// Run: node --test assets/presets/claude/statusline-io.test.ts   (Node >= 22.18 runs .ts files natively)
// Ported on 2026-10-20 from tests/statusline-io.test.ts of the tsup-bundled runner repo (agent-harness): same
// cases, split from statusline.test.ts to stay under 500 lines per file. Helpers: statusline-test-support.ts.
// Pure ASCII on purpose: the accented letter used as padding is written \u{E9}, never typed as a raw character.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { realpathSync } from 'node:fs';
import { copyFile, mkdir, symlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';
import {
  describeGitWorkTree,
  isStatusLineEntryPoint,
  readUsageFromTranscript,
  runGitCommand,
} from './statusline.ts';
import {
  buildSampleInput,
  environmentWithOnlyPath,
  renderPlain,
  runTypeScriptScript,
  skipWithoutTypeStripping,
  stripAnsi,
  supportsNativeTypeStripping,
  withTemporaryDirectory,
} from './statusline-test-support.ts';

const STATUSLINE_SCRIPT = fileURLToPath(new URL('./statusline.ts', import.meta.url));
const TEMP_PREFIX = 'harness-statusline-';

function usageLine(inputTokens: number, cacheRead = 0, cacheCreation = 0, outputTokens = 7): string {
  const usage = {
    input_tokens: inputTokens,
    cache_read_input_tokens: cacheRead,
    cache_creation_input_tokens: cacheCreation,
    output_tokens: outputTokens,
  };
  return JSON.stringify({ type: 'assistant', message: { role: 'assistant', usage } });
}

async function writeTranscript(directory: string, lines: readonly string[], lineBreak = '\n'): Promise<string> {
  const transcriptPath = path.join(directory, 'session.jsonl');
  await writeFile(transcriptPath, lines.join(lineBreak) + lineBreak);
  return transcriptPath;
}

// Padding never contains the word "usage"; the accented letter e-acute (U+00E9) takes two bytes,
// so the 1 MB cut can split a character.
function paddingLine(): string {
  return JSON.stringify({ type: 'user', text: '\u{E9}'.repeat(50_000) });
}

// --- transcript fallback ----------------------------------------------------------------------

test('transcript fallback takes the last usage entry and sums input plus cache tokens only', async () => {
  await withTemporaryDirectory(TEMP_PREFIX, async (directory) => {
    const transcriptPath = await writeTranscript(directory, [usageLine(100), '{"type":"user"}', usageLine(1000, 2000, 500, 9999)]);
    assert.equal(readUsageFromTranscript(transcriptPath), 3500);
    assert.match(renderPlain({ transcript_path: transcriptPath }), /ctx 4k\/200k \(1%\)/);
  });
});

test('transcript fallback skips unparsable, usage-less and empty-usage lines', async () => {
  await withTemporaryDirectory(TEMP_PREFIX, async (directory) => {
    const junkLines = [
      '{"message": {"usage": {"input_tokens": ',
      '{"message":{"role":"user"},"note":"usage"}',
      '{"message":{"usage":{}}}',
      '["usage"]',
    ];
    const transcriptPath = await writeTranscript(directory, [usageLine(4000), ...junkLines]);
    assert.equal(readUsageFromTranscript(transcriptPath), 4000);
  });
});

test('transcript fallback stops at the newest non-empty usage object even when its input sum is zero', async () => {
  await withTemporaryDirectory(TEMP_PREFIX, async (directory) => {
    const outputOnly = '{"message":{"usage":{"output_tokens":12}}}';
    assert.equal(readUsageFromTranscript(await writeTranscript(directory, [usageLine(5000), outputOnly])), 0);
  });
});

test('transcript fallback handles CRLF line endings', async () => {
  await withTemporaryDirectory(TEMP_PREFIX, async (directory) => {
    assert.equal(readUsageFromTranscript(await writeTranscript(directory, [usageLine(2500), usageLine(2600)], '\r\n')), 2600);
  });
});

test('transcript fallback returns 0 for a missing file, a directory or an empty path', async () => {
  await withTemporaryDirectory(TEMP_PREFIX, async (directory) => {
    assert.equal(readUsageFromTranscript(path.join(directory, 'missing.jsonl')), 0);
    assert.equal(readUsageFromTranscript(directory), 0);
    assert.equal(readUsageFromTranscript(''), 0);
  });
});

test('current_usage wins over the transcript, which is only the last resort', async () => {
  await withTemporaryDirectory(TEMP_PREFIX, async (directory) => {
    const transcriptPath = await writeTranscript(directory, [usageLine(90000)]);
    const input = { transcript_path: transcriptPath, context_window: { current_usage: { input_tokens: 2000 } } };
    assert.match(renderPlain(input), /ctx 2k\/200k \(1%\)/);
  });
});

test('transcript fallback only reads the last 1 MB', async () => {
  await withTemporaryDirectory(TEMP_PREFIX, async (directory) => {
    const padding = Array.from({ length: 12 }, paddingLine);
    assert.equal(readUsageFromTranscript(await writeTranscript(directory, [usageLine(7777), ...padding])), 0);
    assert.equal(readUsageFromTranscript(await writeTranscript(directory, [...padding, usageLine(8888)])), 8888);
  });
});

test('a usage line cut in half by the 1 MB boundary is ignored instead of misread', async () => {
  await withTemporaryDirectory(TEMP_PREFIX, async (directory) => {
    const straddling = JSON.stringify({ padding: 'p'.repeat(1_000_500), message: { usage: { input_tokens: 1234 } } });
    assert.equal(readUsageFromTranscript(await writeTranscript(directory, [straddling])), 0);
  });
});

// --- entry-point guard ------------------------------------------------------------------------

test('entry-point guard accepts only this TypeScript file as the process entry', async () => {
  await withTemporaryDirectory(TEMP_PREFIX, async (directory) => {
    const scriptPath = path.join(directory, 'statusline.ts');
    const bundlePath = path.join(directory, 'statusline.test.js');
    await writeFile(scriptPath, '');
    assert.equal(isStatusLineEntryPoint(pathToFileURL(scriptPath).href, scriptPath), true);
    assert.equal(isStatusLineEntryPoint(pathToFileURL(scriptPath).href, path.join(directory, 'other.ts')), false);
    assert.equal(isStatusLineEntryPoint(pathToFileURL(scriptPath).href, undefined), false);
    // A bundled .js copy of this suite is its own entry point but must never start the CLI (it would block on stdin).
    assert.equal(isStatusLineEntryPoint(pathToFileURL(bundlePath).href, bundlePath), false);
  });
});

test('entry-point guard follows a linked directory to the real script location', async (t) => {
  await withTemporaryDirectory(TEMP_PREFIX, async (directory) => {
    const realDirectory = path.join(directory, 'real');
    const linkedDirectory = path.join(directory, 'linked');
    await mkdir(realDirectory);
    await writeFile(path.join(realDirectory, 'statusline.ts'), '');
    try {
      // A junction needs no elevated rights on Windows (file symlinks do); other platforms ignore the type.
      await symlink(realDirectory, linkedDirectory, 'junction');
    } catch {
      t.skip('this filesystem cannot link directories');
      return;
    }
    // The URL Node itself gives import.meta.url: its loader resolves the entry with the JS realpathSync,
    // which keeps 8.3 short names. The native realpath expands them, so it never matched on the
    // windows-latest runner, whose TEMP is C:\Users\RUNNER~1\… (fix for the first v1.7.0 CI run, 2026-10-21).
    const realUrl = pathToFileURL(realpathSync(path.join(realDirectory, 'statusline.ts'))).href;
    assert.equal(isStatusLineEntryPoint(realUrl, path.join(linkedDirectory, 'statusline.ts')), true);
  });
});

test('the script works when copied outside the repository, where no package.json sits beside it', async (t) => {
  if (skipWithoutTypeStripping(t)) return;
  await withTemporaryDirectory(TEMP_PREFIX, async (directory) => {
    const installedScript = path.join(directory, 'statusline.ts');
    await copyFile(STATUSLINE_SCRIPT, installedScript);
    const run = runTypeScriptScript(installedScript, JSON.stringify(buildSampleInput()));
    assert.equal(run.status, 0, run.stderr);
    assert.match(stripAnsi(run.stdout), /ctx 44k\/200k \(21%\)/);
  });
});

// --- real git ---------------------------------------------------------------------------------

function gitIsAvailable(): boolean {
  return spawnSync('git', ['--version'], { windowsHide: true }).status === 0;
}

function runGitFixtureCommand(repositoryDirectory: string, hooksDirectory: string, gitArguments: readonly string[]): void {
  const identity = [
    '-c', 'user.name=Fixture',
    '-c', 'user.email=fixture@example.test',
    '-c', 'commit.gpgsign=false',
    '-c', `core.hooksPath=${hooksDirectory}`,
  ];
  const run = spawnSync('git', ['-C', repositoryDirectory, ...identity, ...gitArguments], { encoding: 'utf8', windowsHide: true });
  assert.equal(run.status, 0, `git ${gitArguments.join(' ')}: ${run.stderr}`);
}

// A tracked-file change (not an untracked file) keeps the repo dirty even if the machine hides untracked files.
async function createDirtyRepositoryWithOneStash(directory: string): Promise<string> {
  const repositoryDirectory = path.join(directory, 'repo');
  const hooksDirectory = path.join(directory, 'no-hooks');
  await mkdir(repositoryDirectory);
  await mkdir(hooksDirectory);
  const git = (...gitArguments: string[]): void => runGitFixtureCommand(repositoryDirectory, hooksDirectory, gitArguments);
  git('init', '--quiet');
  git('symbolic-ref', 'HEAD', 'refs/heads/trunk');
  await writeFile(path.join(repositoryDirectory, 'a.txt'), 'one\n');
  git('add', 'a.txt');
  git('commit', '--quiet', '--no-verify', '-m', 'first');
  await writeFile(path.join(repositoryDirectory, 'a.txt'), 'two\n');
  git('stash', 'push', '--quiet');
  await writeFile(path.join(repositoryDirectory, 'a.txt'), 'three\n');
  return repositoryDirectory;
}

/** Runs `body` with a dirty repo holding one stash, plus an unrelated empty directory outside any repo. */
async function withDirtyRepository(
  body: (repositoryDirectory: string, plainDirectory: string) => Promise<void>,
): Promise<void> {
  await withTemporaryDirectory(TEMP_PREFIX, async (directory) => {
    const plainDirectory = path.join(directory, 'plain');
    await mkdir(plainDirectory);
    await body(await createDirtyRepositoryWithOneStash(directory), plainDirectory);
  });
}

test('real git: runGitCommand and describeGitWorkTree read a dirty repo with a stash', async (t) => {
  if (!gitIsAvailable()) return t.skip('git is not installed');
  await withDirtyRepository(async (repositoryDirectory, plainDirectory) => {
    assert.equal(runGitCommand(plainDirectory, ['rev-parse', '--is-inside-work-tree']), null);
    assert.equal(describeGitWorkTree(plainDirectory, runGitCommand), '');
    assert.equal(runGitCommand(repositoryDirectory, ['rev-parse', '--is-inside-work-tree'])?.trim(), 'true');
    assert.equal(describeGitWorkTree(repositoryDirectory, runGitCommand), 'trunk * (1 stash)');
  });
});

test('real git: the script shows the git segment, and loses only that segment when git is missing', async (t) => {
  if (!gitIsAvailable()) return t.skip('git is not installed');
  if (skipWithoutTypeStripping(t)) return;
  await withDirtyRepository(async (repositoryDirectory, plainDirectory) => {
    const standardInput = JSON.stringify(buildSampleInput(repositoryDirectory));
    const withGit = runTypeScriptScript(STATUSLINE_SCRIPT, standardInput);
    assert.match(stripAnsi(withGit.stdout), / \| trunk \* \(1 stash\) \| /);
    // A fresh machine may not have git yet: the line must lose only the git segment, never fail.
    const withoutGit = runTypeScriptScript(STATUSLINE_SCRIPT, standardInput, environmentWithOnlyPath(plainDirectory));
    assert.equal(withoutGit.status, 0, withoutGit.stderr);
    assert.doesNotMatch(stripAnsi(withoutGit.stdout), /trunk/);
    assert.match(stripAnsi(withoutGit.stdout), /ctx 44k\/200k \(21%\) \| \$1\.23 \| Opus 4\.5$/);
  });
});

test('supportsNativeTypeStripping follows the 22.18, 23.6 and 24 thresholds', () => {
  const cases: ReadonlyArray<readonly [string, boolean]> = [
    ['20.19.0', false], ['22.6.0', false], ['22.17.1', false], ['22.18.0', true], ['22.22.2', true],
    ['23.5.0', false], ['23.6.0', true], ['24.0.0', true], ['25.1.0', true],
  ];
  for (const [nodeVersion, expected] of cases) assert.equal(supportsNativeTypeStripping(nodeVersion), expected, nodeVersion);
});
