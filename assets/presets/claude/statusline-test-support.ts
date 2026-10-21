// Test support for statusline.test.ts and statusline-io.test.ts: renderer fixtures plus helpers that run a real
// script in a child `node`. It is a separate file because the two suites together pass the 500-line limit.
//
// Ported on 2026-10-20 from the runner repo's tests/support/statusline-support.ts and script-process.ts. That
// repo bundled its tests with tsup; this one has no test bundler, so the suites are plain `.ts` files run by
// `node --test` (Node >= 22.18 strips types at load time). Hence: erasable syntax only (no enum, namespace or
// parameter properties), `import type` for types, ".ts" spelled out in relative imports, `node:` builtins only.
// Pure ASCII on purpose: non-ASCII values are \u{...} escapes, so no invisible character can hide in the source.
//
// Not a test file: its name matches none of the patterns `node --test` auto-discovers. Suites resolve script
// paths from their own import.meta.url; nothing here does.
import { spawnSync } from 'node:child_process';
import type { SpawnSyncReturns } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type { TestContext } from 'node:test';
import { renderStatusLine } from './statusline.ts';
import type { GitRunner, StatusLineEnvironment, StatusLineInput } from './statusline.ts';

// Tue 20 Oct 2026 21:05 local time: the "Tue 09:05PM" example from the porting brief.
export const FIXED_CLOCK = new Date(2026, 9, 20, 21, 5, 0);
export const DEFAULT_PLAIN_LINE = 'tester on Tue 09:05PM | ? | ctx 0k/200k (0%) | Claude';
const ANSI_SEQUENCE = /\x1b\[[0-9;]*m/g;

/** Scripted stand-in for `git`: answers by joined arguments and records every call it receives. */
export class FakeGitRunner {
  readonly calls: string[] = [];
  private readonly responses: ReadonlyMap<string, string | null>;

  constructor(responses: Readonly<Record<string, string | null>>) {
    this.responses = new Map(Object.entries(responses));
  }

  readonly run: GitRunner = (workingDirectory, gitArguments) => {
    const command = gitArguments.join(' ');
    this.calls.push(`${workingDirectory}::${command}`);
    return this.responses.get(command) ?? null;
  };
}

/** Removes ANSI color escapes so assertions can read the plain text of the line. */
export function stripAnsi(line: string): string {
  return line.replace(ANSI_SEQUENCE, '');
}

/** Environment with a frozen clock, user "tester", no home directory and a git that is never a repo. */
export function buildEnvironment(overrides: Partial<StatusLineEnvironment> = {}): StatusLineEnvironment {
  return { now: FIXED_CLOCK, homeDirectory: '', userName: 'tester', runGit: new FakeGitRunner({}).run, ...overrides };
}

/** Renders `input` and strips the colors. */
export function renderPlain(input: StatusLineInput, overrides: Partial<StatusLineEnvironment> = {}): string {
  return stripAnsi(renderStatusLine(input, buildEnvironment(overrides)));
}

/** A realistic Claude Code payload: 43500 context tokens on a 200k window, $1.2345 so far. */
export function buildSampleInput(currentDirectory: string = os.tmpdir()): StatusLineInput {
  return {
    model: { display_name: 'Opus 4.5' },
    workspace: { current_dir: currentDirectory },
    cost: { total_cost_usd: 1.2345 },
    context_window: {
      current_usage: {
        input_tokens: 1000,
        cache_read_input_tokens: 40000,
        cache_creation_input_tokens: 2500,
        output_tokens: 300,
      },
      context_window_size: 200000,
    },
  };
}

/**
 * Runs `body` inside a fresh temp directory that is removed afterwards, pass or fail.
 *
 * @example await withTemporaryDirectory('harness-x-', async (directory) => { ... });
 */
export async function withTemporaryDirectory(
  prefix: string,
  body: (directory: string) => Promise<void>,
): Promise<void> {
  const directory = await mkdtemp(path.join(os.tmpdir(), prefix));
  try {
    await body(directory);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

/**
 * True when `node file.ts` works without flags: unflagged type stripping landed in 22.18 and 23.6.
 *
 * @example supportsNativeTypeStripping('22.17.1') === false
 */
export function supportsNativeTypeStripping(nodeVersion: string): boolean {
  const [major = 0, minor = 0] = nodeVersion.split('.').map(Number);
  if (major >= 24) return true;
  return major === 23 ? minor >= 6 : major === 22 && minor >= 18;
}

/**
 * Marks the running test skipped on a Node that cannot execute .ts files; callers must then return.
 *
 * @example if (skipWithoutTypeStripping(t)) return;
 */
export function skipWithoutTypeStripping(context: TestContext): boolean {
  if (supportsNativeTypeStripping(process.versions.node)) return false;
  context.skip('running .ts directly needs Node >= 22.18');
  return true;
}

/**
 * Runs `node <scriptPath>` as a real child process with the given stdin; warnings are muted so the
 * type-stripping notice on older Node 22 builds cannot pollute stderr assertions.
 *
 * @example runTypeScriptScript(statuslinePath, '{}').status === 0
 */
export function runTypeScriptScript(
  scriptPath: string,
  standardInput: string,
  environment: NodeJS.ProcessEnv = process.env,
): SpawnSyncReturns<string> {
  return spawnSync(process.execPath, [scriptPath], {
    input: standardInput,
    encoding: 'utf8',
    env: { ...environment, NODE_NO_WARNINGS: '1' },
    timeout: 30_000,
    windowsHide: true,
  });
}

/**
 * The current environment with PATH replaced by a single (empty) directory, so no external tool such as
 * git can be found. Windows spells the variable `Path`, so every casing is dropped before the new one is set.
 *
 * @example runTypeScriptScript(script, '{}', environmentWithOnlyPath(emptyDirectory))
 */
export function environmentWithOnlyPath(emptyDirectory: string): NodeJS.ProcessEnv {
  const keptEntries = Object.entries(process.env).filter(([name]) => name.toLowerCase() !== 'path');
  return { ...Object.fromEntries(keptEntries), PATH: emptyDirectory };
}
