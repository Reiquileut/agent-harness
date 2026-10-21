// Failure modes for assets/hooks/codex/ai-memory-startup.ts, listed BEFORE the code was written (rule 7):
//   instruction file : missing, a directory, empty, BOM only, BOM + text, CRLF, invalid UTF-8
//   payload          : wrong shape, pretty-printed, quotes/backslashes/control chars/U+2028/lone surrogate
//   process          : non-zero exit, noise on stdout, stdin ignored, runs outside the repository
//   asset            : the shipped .txt must stay LF-only UTF-8 without BOM and keep the user's wording
// Codex contract (Context7 /openai/codex, verified 2026-10-20): SessionStart stdout is
// { hookSpecificOutput: { hookEventName: "SessionStart", additionalContext } }; broken JSON fails the hook.
//
// Run: node --test assets/hooks/codex/ai-memory-startup.test.ts   (Node >= 22.18 runs .ts files natively)
// Ported on 2026-10-20 from tests/codex-startup-hook.test.ts of the tsup-bundled runner repo (agent-harness):
// same cases, now a plain `.ts` file next to the hook that imports it by relative path. Standalone on purpose,
// like the Claude hook tests: the few process helpers are inlined (same contract as statusline-test-support.ts
// in assets/presets/claude/; keep both copies in sync), so nothing else has to be copied next to this file.
// Pure ASCII on purpose: accents, check mark, emoji, U+2028, U+2029, U+FFFD and the BOM are \u{...} escapes.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import type { SpawnSyncReturns } from 'node:child_process';
import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import type { TestContext } from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';
import {
  buildSessionStartPayload,
  isStartupHookEntryPoint,
  readStartupInstructions,
  stripUtf8Bom,
} from './ai-memory-startup.ts';

const HOOK_SCRIPT = fileURLToPath(new URL('./ai-memory-startup.ts', import.meta.url));
const SHIPPED_INSTRUCTIONS = fileURLToPath(new URL('./ai-memory-startup.txt', import.meta.url));
const CODEX_EVENT_ON_STDIN = JSON.stringify({ hook_event_name: 'SessionStart', session_id: 'test-session', cwd: '/work/app' });
const UTF8_BOM_BYTES = Buffer.from([0xef, 0xbb, 0xbf]);
// JSON-hostile on purpose: tab, quote, backslash, NUL, BEL, CRLF, the U+2028 and U+2029 separators, an emoji,
// accented letters (c-cedilla, a-tilde) and a check mark.
const HOSTILE_TEXT =
  'tab\t quote" backslash\\ nul\u{0} bell\u{7} crlf\r\n ' +
  'line-sep\u{2028} para-sep\u{2029} emoji \u{1F642} acentos a\u{E7}\u{E3}o \u{2713}';
const TEMP_PREFIX = 'harness-hook-';

// --- process helpers: same contract as statusline-test-support.ts --------------------------------

/**
 * Runs `body` inside a fresh temp directory that is removed afterwards, pass or fail.
 *
 * @example await withTemporaryDirectory('harness-x-', async (directory) => { ... });
 */
async function withTemporaryDirectory(prefix: string, body: (directory: string) => Promise<void>): Promise<void> {
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
function supportsNativeTypeStripping(nodeVersion: string): boolean {
  const [major = 0, minor = 0] = nodeVersion.split('.').map(Number);
  if (major >= 24) return true;
  return major === 23 ? minor >= 6 : major === 22 && minor >= 18;
}

/**
 * Marks the running test skipped on a Node that cannot execute .ts files; callers must then return.
 *
 * @example if (skipWithoutTypeStripping(t)) return;
 */
function skipWithoutTypeStripping(context: TestContext): boolean {
  if (supportsNativeTypeStripping(process.versions.node)) return false;
  context.skip('running .ts directly needs Node >= 22.18');
  return true;
}

/**
 * Runs `node <scriptPath>` as a real child process with the given stdin; warnings are muted so the
 * type-stripping notice on older Node 22 builds cannot pollute stderr assertions.
 *
 * @example runTypeScriptScript(HOOK_SCRIPT, '{}').status === 0
 */
function runTypeScriptScript(scriptPath: string, standardInput: string): SpawnSyncReturns<string> {
  return spawnSync(process.execPath, [scriptPath], {
    input: standardInput,
    encoding: 'utf8',
    env: { ...process.env, NODE_NO_WARNINGS: '1' },
    timeout: 30_000,
    windowsHide: true,
  });
}

/** Copies the hook next to a fresh instruction file (null = no file at all), like an installed copy. */
async function installHookCopy(directory: string, instructions: Buffer | string | null): Promise<string> {
  const scriptPath = path.join(directory, 'ai-memory-startup.ts');
  await copyFile(HOOK_SCRIPT, scriptPath);
  if (instructions !== null) await writeFile(path.join(directory, 'ai-memory-startup.txt'), instructions);
  return scriptPath;
}

function readAdditionalContext(standardOutput: string): unknown {
  const payload: { hookSpecificOutput?: { additionalContext?: unknown } } = JSON.parse(standardOutput);
  return payload.hookSpecificOutput?.additionalContext;
}

// --- pure functions ---------------------------------------------------------------------------

test('stripUtf8Bom removes exactly one leading BOM and nothing else', () => {
  assert.equal(stripUtf8Bom('\u{FEFF}ol\u{E1}'), 'ol\u{E1}');
  assert.equal(stripUtf8Bom('ol\u{E1}'), 'ol\u{E1}');
  assert.equal(stripUtf8Bom(''), '');
  assert.equal(stripUtf8Bom('a\u{FEFF}b'), 'a\u{FEFF}b');
  assert.equal(stripUtf8Bom('\u{FEFF}\u{FEFF}x'), '\u{FEFF}x');
});

test('buildSessionStartPayload is compact JSON in the Codex SessionStart shape', () => {
  const payload = buildSessionStartPayload('line 1\nline 2 "quoted" \\ done');
  assert.ok(payload.startsWith('{"hookSpecificOutput":{"hookEventName":"SessionStart","additionalContext":'));
  assert.doesNotMatch(payload, /[\r\n]/);
  assert.deepEqual(JSON.parse(payload), {
    hookSpecificOutput: { hookEventName: 'SessionStart', additionalContext: 'line 1\nline 2 "quoted" \\ done' },
  });
});

test('buildSessionStartPayload round-trips characters that break naive JSON writers', () => {
  for (const hostileText of [HOSTILE_TEXT, '\u{D800} lone surrogate', '', '   ']) {
    assert.equal(readAdditionalContext(buildSessionStartPayload(hostileText)), hostileText);
  }
});

test('readStartupInstructions returns the text without BOM, or null when there is nothing to inject', async () => {
  await withTemporaryDirectory(TEMP_PREFIX, async (directory) => {
    const instructionsUrl = pathToFileURL(path.join(directory, 'instructions.txt'));
    assert.equal(readStartupInstructions(instructionsUrl), null);
    await writeFile(instructionsUrl, Buffer.concat([UTF8_BOM_BYTES, Buffer.from('Ol\u{E1} a\u{E7}\u{E3}o\n')]));
    assert.equal(readStartupInstructions(instructionsUrl), 'Ol\u{E1} a\u{E7}\u{E3}o\n');
    await writeFile(instructionsUrl, UTF8_BOM_BYTES);
    assert.equal(readStartupInstructions(instructionsUrl), null);
    await writeFile(instructionsUrl, '');
    assert.equal(readStartupInstructions(instructionsUrl), null);
    assert.equal(readStartupInstructions(pathToFileURL(directory)), null);
  });
});

test('readStartupInstructions keeps CRLF and replaces invalid UTF-8 instead of failing', async () => {
  await withTemporaryDirectory(TEMP_PREFIX, async (directory) => {
    const instructionsUrl = pathToFileURL(path.join(directory, 'instructions.txt'));
    await writeFile(instructionsUrl, 'a\r\nb\r\n');
    assert.equal(readStartupInstructions(instructionsUrl), 'a\r\nb\r\n');
    await writeFile(instructionsUrl, Buffer.from([0x61, 0xff, 0x62]));
    assert.equal(readStartupInstructions(instructionsUrl), 'a\u{FFFD}b');
  });
});

test('entry-point guard accepts only this TypeScript file as the process entry', async () => {
  await withTemporaryDirectory(TEMP_PREFIX, async (directory) => {
    const scriptPath = path.join(directory, 'ai-memory-startup.ts');
    const bundlePath = path.join(directory, 'ai-memory-startup.test.js');
    await writeFile(scriptPath, '');
    assert.equal(isStartupHookEntryPoint(pathToFileURL(scriptPath).href, scriptPath), true);
    assert.equal(isStartupHookEntryPoint(pathToFileURL(scriptPath).href, path.join(directory, 'other.ts')), false);
    assert.equal(isStartupHookEntryPoint(pathToFileURL(scriptPath).href, undefined), false);
    // A bundled .js copy of this suite is its own entry point but must never print a hook payload.
    assert.equal(isStartupHookEntryPoint(pathToFileURL(bundlePath).href, bundlePath), false);
  });
});

// --- shipped asset ----------------------------------------------------------------------------

test('the shipped instructions are LF-only UTF-8 without a BOM and keep the user wording', async () => {
  const bytes = await readFile(SHIPPED_INSTRUCTIONS);
  assert.equal(bytes.subarray(0, 3).equals(UTF8_BOM_BYTES), false);
  const text = bytes.toString('utf8');
  assert.equal(text.includes('\r'), false);
  assert.equal(text.includes('\u{FFFD}'), false);
  assert.ok(text.startsWith('## Leitura inicial obrigatoria do ai-memory no Codex\n'));
  assert.ok(text.includes('memory_briefing'));
});

// --- real processes ---------------------------------------------------------------------------

test('node ai-memory-startup.ts prints compact SessionStart JSON carrying the instruction file', async (t) => {
  if (skipWithoutTypeStripping(t)) return;
  const run = runTypeScriptScript(HOOK_SCRIPT, CODEX_EVENT_ON_STDIN);
  assert.equal(run.status, 0, run.stderr);
  const expectedText = await readFile(SHIPPED_INSTRUCTIONS, 'utf8');
  const payload: unknown = JSON.parse(run.stdout);
  assert.deepEqual(payload, { hookSpecificOutput: { hookEventName: 'SessionStart', additionalContext: expectedText } });
  assert.equal(run.stdout, `${JSON.stringify(payload)}\n`);
});

test('an installed copy strips a UTF-8 BOM and keeps accents and emoji intact', async (t) => {
  if (skipWithoutTypeStripping(t)) return;
  await withTemporaryDirectory(TEMP_PREFIX, async (directory) => {
    const instructions = Buffer.concat([UTF8_BOM_BYTES, Buffer.from('Ol\u{E1} a\u{E7}\u{E3}o \u{2713} \u{1F642}\nsegunda linha')]);
    const run = runTypeScriptScript(await installHookCopy(directory, instructions), CODEX_EVENT_ON_STDIN);
    assert.equal(run.status, 0, run.stderr);
    assert.equal(readAdditionalContext(run.stdout), 'Ol\u{E1} a\u{E7}\u{E3}o \u{2713} \u{1F642}\nsegunda linha');
  });
});

test('an installed copy sends JSON-hostile text and CRLF through unchanged', async (t) => {
  if (skipWithoutTypeStripping(t)) return;
  await withTemporaryDirectory(TEMP_PREFIX, async (directory) => {
    const run = runTypeScriptScript(await installHookCopy(directory, HOSTILE_TEXT), CODEX_EVENT_ON_STDIN);
    assert.equal(run.status, 0, run.stderr);
    assert.equal(readAdditionalContext(run.stdout), HOSTILE_TEXT);
    assert.equal(run.stdout.trimEnd().includes('\n'), false);
  });
});

test('fail open: a missing, empty or BOM-only instruction file prints nothing and exits 0', async (t) => {
  if (skipWithoutTypeStripping(t)) return;
  await withTemporaryDirectory(TEMP_PREFIX, async (directory) => {
    const cases: ReadonlyArray<readonly [string, Buffer | string | null]> = [
      ['no-file', null], ['empty-file', ''], ['bom-only-file', UTF8_BOM_BYTES],
    ];
    for (const [label, instructions] of cases) {
      const caseDirectory = path.join(directory, label);
      await mkdir(caseDirectory);
      const run = runTypeScriptScript(await installHookCopy(caseDirectory, instructions), CODEX_EVENT_ON_STDIN);
      assert.equal(run.status, 0, `${label}: ${run.stderr}`);
      assert.equal(run.stdout, '', label);
    }
  });
});

test('fail open: an instruction path that is a directory prints nothing and exits 0', async (t) => {
  if (skipWithoutTypeStripping(t)) return;
  await withTemporaryDirectory(TEMP_PREFIX, async (directory) => {
    const scriptPath = await installHookCopy(directory, null);
    await mkdir(path.join(directory, 'ai-memory-startup.txt'));
    const run = runTypeScriptScript(scriptPath, CODEX_EVENT_ON_STDIN);
    assert.equal(run.status, 0, run.stderr);
    assert.equal(run.stdout, '');
  });
});
