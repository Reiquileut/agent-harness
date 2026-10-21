// Claude Code status line for any OS: `node statusline.ts` reads the status JSON on stdin and prints one
// line without a trailing newline, e.g.
//   user on Tue 09:05PM | main * (1 stash) | ~/app | ctx 44k/200k (21%) | $1.23 | Opus 4.5
//
// Ported on 2026-10-20 from the maintainer's machine-specific pair ~/.claude/statusline-command.sh
// (bash 4 `mapfile`, `date`, python) and ~/.claude/statusline-data.py, which break on macOS (bash 3.2,
// no python). Node >= 22.18 strips types at load time, so this must stay ONE file of erasable syntax
// (no enum, namespace, parameter properties, decorators) importing only `node:` modules; install it by
// copying, because Node refuses to strip types inside node_modules
// (per Context7 /websites/nodejs_latest-v22_x_api, 2026-10-20).
//
// Deliberate differences from the pair; everything else is the same line, byte for byte:
//  - "~" home collapse: the bash `${path/#$home/~}` never collapsed anything (the tilde expands to $HOME
//    inside the replacement, and an unquoted backslash home acts as a glob escape). This port does what the
//    script documents, at a path boundary and tolerant of / vs \ and of drive-letter case.
//  - A wrongly typed field degrades on its own; in the pair it crashed the python helper into defaults.
//  - Transcript lines are split on "\n"; Python's str.splitlines() also split on U+2028, U+2029 and U+0085.
//  - A newline inside a field (only a POSIX directory name can hold one) becomes a space; in the pair `mapfile`
//    shifted every later field into garbage.
import { execFileSync } from 'node:child_process';
import { closeSync, fstatSync, openSync, readSync, realpathSync } from 'node:fs';
import { userInfo } from 'node:os';
import { pathToFileURL } from 'node:url';

type JsonObject = Readonly<Record<string, unknown>>;

/** The JSON object Claude Code sends on stdin; fields are read defensively, so every key is `unknown`. */
export type StatusLineInput = JsonObject;

/** Runs `git -C <directory> --no-optional-locks <arguments>`; returns its stdout, or null on any failure. */
export type GitRunner = (workingDirectory: string, gitArguments: readonly string[]) => string | null;

/** Everything the renderer needs from the outside world, injected so tests can pin it. */
export interface StatusLineEnvironment {
  readonly now: Date;
  /** USERPROFILE or HOME; '' when unknown (the path is then shown unshortened). */
  readonly homeDirectory: string;
  readonly userName: string;
  readonly runGit: GitRunner;
}

interface ContextMetrics {
  readonly usedTokens: number;
  readonly windowSize: number;
}

const FALLBACK_MODEL_NAME = 'Claude';
const FALLBACK_USER_NAME = 'user';
const UNKNOWN_DIRECTORY_LABEL = '?';
const DEFAULT_WINDOW_TOKENS = 200_000;
const EXTENDED_WINDOW_TOKENS = 1_000_000;
const TRANSCRIPT_TAIL_BYTES = 1_000_000;
// execFileSync options per Context7 /websites/nodejs_latest-v22_x_api, 2026-10-20 (timeout, maxBuffer, windowsHide).
// A git stuck on a dead network drive must not freeze the prompt, so each call gets a short leash.
const GIT_TIMEOUT_MILLISECONDS = 3_000;
// A huge `status --porcelain` must not be mistaken for a clean tree: execFileSync throws past maxBuffer.
const GIT_MAX_OUTPUT_BYTES = 64 * 1024 * 1024;
const WEEKDAY_ABBREVIATIONS: readonly string[] = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const EMPTY_JSON_OBJECT: JsonObject = Object.freeze({});

// Truecolor palette lifted from the oh-my-posh theme 1_shell.omp.json via the original script
// (its USER_C constant was declared but never used: the user name is painted with the accent color).
const ESCAPE = '\u001b';
const RESET_CODE = `${ESCAPE}[0m`;

function truecolor(red: number, green: number, blue: number): string {
  return `${ESCAPE}[38;2;${red};${green};${blue}m`;
}

const PALETTE = {
  accent: truecolor(255, 112, 166),
  date: truecolor(188, 147, 255),
  git: truecolor(238, 121, 209),
  path: truecolor(255, 175, 210),
  context: truecolor(95, 215, 255),
  cost: truecolor(126, 231, 135),
  white: truecolor(255, 255, 255),
  dim: `${ESCAPE}[2m`,
} as const;
const SEGMENT_SEPARATOR = ` ${PALETTE.white}|${RESET_CODE} `;

/**
 * Builds the whole status line: ANSI colors, always a single line (no CR or LF), no trailing newline.
 *
 * @example
 * // with environment.userName === 'user' and the clock at Tue 21:05
 * renderStatusLine({ model: { display_name: 'Opus 4.5' } }, environment)
 * // => "user on Tue 09:05PM | ? | ctx 0k/200k (0%) | Opus 4.5"
 */
export function renderStatusLine(input: StatusLineInput, environment: StatusLineEnvironment): string {
  const modelName = readModelName(input);
  const workingDirectory = readWorkingDirectory(input);
  const gitText = workingDirectory === '' ? '' : describeGitWorkTree(workingDirectory, environment.runGit);
  const shownDirectory = collapseHomeDirectory(workingDirectory || UNKNOWN_DIRECTORY_LABEL, environment.homeDirectory);
  const costUsd = readCostUsd(input);
  const segments: string[] = [renderIdentitySegment(environment)];
  if (gitText !== '') segments.push(paint(PALETTE.git, gitText));
  segments.push(paint(PALETTE.path, shownDirectory));
  segments.push(paint(PALETTE.context, renderContextText(measureContext(input, modelName))));
  if (costUsd !== null) segments.push(paint(PALETTE.cost, `$${formatUsdAmount(costUsd)}`));
  segments.push(paint(PALETTE.dim, modelName));
  return toSingleLine(segments.join(SEGMENT_SEPARATOR));
}

// The pair piped python through `tr -d '\r'` because Windows python printed CRLF; keep that guarantee, and
// keep the promised single line even if a field holds a newline.
function toSingleLine(text: string): string {
  return text.replace(/\r/g, '').replace(/\n/g, ' ');
}

/**
 * Parses raw stdin and renders it; if anything throws, falls back to the line for empty input.
 *
 * @example renderStatusLineSafely('not json', environment) // the default line, never an exception
 */
export function renderStatusLineSafely(rawStdin: string, environment: StatusLineEnvironment): string {
  try {
    return renderStatusLine(parseStatusLineInput(rawStdin), environment);
  } catch {
    return renderStatusLine(EMPTY_JSON_OBJECT, environment);
  }
}

/**
 * Parses the stdin text into a JSON object; empty, invalid or non-object JSON (and a leading BOM) is tolerated.
 *
 * @example parseStatusLineInput('{"cwd":"/work"}') // { cwd: '/work' }; parseStatusLineInput('oops') // {}
 */
export function parseStatusLineInput(rawText: string): StatusLineInput {
  try {
    const parsed: unknown = JSON.parse(rawText.replace(/^\uFEFF/, ''));
    return isJsonObject(parsed) ? parsed : EMPTY_JSON_OBJECT;
  } catch {
    return EMPTY_JSON_OBJECT;
  }
}

function isJsonObject(candidate: unknown): candidate is JsonObject {
  return typeof candidate === 'object' && candidate !== null && !Array.isArray(candidate);
}

function asJsonObject(candidate: unknown): JsonObject {
  return isJsonObject(candidate) ? candidate : EMPTY_JSON_OBJECT;
}

function paint(color: string, text: string): string {
  return `${color}${text}${RESET_CODE}`;
}

function renderIdentitySegment(environment: StatusLineEnvironment): string {
  const userText = paint(PALETTE.accent, environment.userName);
  const connectorText = paint(PALETTE.white, 'on');
  return `${userText} ${connectorText} ${paint(PALETTE.date, formatClockLabel(environment.now))}`;
}

// --- fields read from the JSON --------------------------------------------------------------------

function readModelName(input: StatusLineInput): string {
  const displayName = asJsonObject(input.model).display_name;
  return typeof displayName === 'string' && displayName !== '' ? displayName : FALLBACK_MODEL_NAME;
}

// statusline-data.py: `ws.get("current_dir") or d.get("cwd") or ""`.
function readWorkingDirectory(input: StatusLineInput): string {
  const workspaceDirectory = asJsonObject(input.workspace).current_dir;
  if (typeof workspaceDirectory === 'string' && workspaceDirectory !== '') return workspaceDirectory;
  return typeof input.cwd === 'string' ? input.cwd : '';
}

function readCostUsd(input: StatusLineInput): number | null {
  const totalCost = asJsonObject(input.cost).total_cost_usd;
  return typeof totalCost === 'number' && Number.isFinite(totalCost) ? totalCost : null;
}

function readTranscriptPath(input: StatusLineInput): string {
  return typeof input.transcript_path === 'string' ? input.transcript_path : '';
}

// Python's `x or 0`: only positive whole numbers count; strings, objects, negatives, fractions, NaN do not.
function readTokenCount(candidate: unknown): number {
  return typeof candidate === 'number' && Number.isSafeInteger(candidate) && candidate > 0 ? candidate : 0;
}

/**
 * Formats a dollar amount like Python's "{:.2f}".format(): two decimals, exact binary ties (0.125, 0.625...)
 * rounded half to even. JS toFixed rounds those ties up, which would print $0.13 where the original printed $0.12.
 *
 * @example formatUsdAmount(0.125) // "0.12"; formatUsdAmount(1.2345) // "1.23"
 */
export function formatUsdAmount(amount: number): string {
  const sign = amount < 0 || Object.is(amount, -0) ? '-' : '';
  return `${sign}${roundHalfEvenToCents(Math.abs(amount))}`;
}

function roundHalfEvenToCents(magnitude: number): string {
  const eighths = magnitude * 8;
  const isExactTie = Number.isInteger(eighths) && eighths % 2 === 1;
  if (!isExactTie) return magnitude.toFixed(2);
  const lowerCents = Math.floor(magnitude * 100);
  const evenCents = lowerCents % 2 === 0 ? lowerCents : lowerCents + 1;
  return (evenCents / 100).toFixed(2);
}

// --- context window -------------------------------------------------------------------------------

function measureContext(input: StatusLineInput, modelName: string): ContextMetrics {
  const contextWindow = asJsonObject(input.context_window);
  const usedTokens = resolveUsedTokens(contextWindow, readTranscriptPath(input));
  const declaredWindow = readTokenCount(contextWindow.context_window_size);
  return { usedTokens, windowSize: resolveWindowSize(declaredWindow, modelName, usedTokens) };
}

// statusline-data.py: current_usage sum, else total_input_tokens, else the transcript tail.
function resolveUsedTokens(contextWindow: JsonObject, transcriptPath: string): number {
  const fromCurrentUsage = sumUsageTokens(asJsonObject(contextWindow.current_usage));
  if (fromCurrentUsage > 0) return fromCurrentUsage;
  const fromTotalInput = readTokenCount(contextWindow.total_input_tokens);
  if (fromTotalInput > 0) return fromTotalInput;
  return transcriptPath === '' ? 0 : readUsageFromTranscript(transcriptPath);
}

// Output tokens are excluded on purpose: the original counts what is already sitting in the context.
function sumUsageTokens(usage: JsonObject): number {
  const total =
    readTokenCount(usage.input_tokens) +
    readTokenCount(usage.cache_read_input_tokens) +
    readTokenCount(usage.cache_creation_input_tokens);
  return Number.isSafeInteger(total) ? total : 0;
}

function resolveWindowSize(declaredWindow: number, modelName: string, usedTokens: number): number {
  if (declaredWindow > 0) return declaredWindow;
  const mentionsOneMillion = modelName.toLowerCase().includes('1m');
  return mentionsOneMillion || usedTokens > DEFAULT_WINDOW_TOKENS ? EXTENDED_WINDOW_TOKENS : DEFAULT_WINDOW_TOKENS;
}

// BigInt mirrors the bash 64-bit integer math, so `used * 100` stays exact for any safe-integer count.
function renderContextText(metrics: ContextMetrics): string {
  const usedTokens = BigInt(metrics.usedTokens);
  const usedKilo = (usedTokens + 500n) / 1000n;
  const percent = (usedTokens * 100n) / BigInt(metrics.windowSize);
  const windowLabel = metrics.windowSize >= EXTENDED_WINDOW_TOKENS ? '1M' : `${Math.floor(metrics.windowSize / 1000)}k`;
  return `ctx ${usedKilo}k/${windowLabel} (${percent}%)`;
}

// --- transcript fallback --------------------------------------------------------------------------

/**
 * Context tokens of the newest `message.usage` in the last 1 MB of a Claude Code transcript (JSONL).
 * Returns 0 when the file is unreadable or holds no usable usage entry.
 *
 * @example readUsageFromTranscript('/home/me/.claude/projects/app/session.jsonl') // 43500
 */
export function readUsageFromTranscript(transcriptPath: string): number {
  const lines = readTranscriptTail(transcriptPath).split('\n');
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    const usedTokens = extractUsageTokens(lines[index] ?? '');
    if (usedTokens !== null) return usedTokens;
  }
  return 0;
}

// statusline-data.py context_used(): skip lines without "usage", unparsable lines and empty/absent usage;
// the first non-empty usage object wins even when its input sum is zero.
function extractUsageTokens(line: string): number | null {
  if (!line.includes('"usage"')) return null;
  let entry: unknown;
  try {
    entry = JSON.parse(line);
  } catch {
    return null;
  }
  const usage = asJsonObject(asJsonObject(asJsonObject(entry).message).usage);
  return Object.keys(usage).length === 0 ? null : sumUsageTokens(usage);
}

function readTranscriptTail(transcriptPath: string): string {
  let descriptor: number | null = null;
  try {
    descriptor = openSync(transcriptPath, 'r');
    const { size } = fstatSync(descriptor);
    const startOffset = Math.max(0, size - TRANSCRIPT_TAIL_BYTES);
    return readByteRange(descriptor, startOffset, size - startOffset).toString('utf8');
  } catch {
    return '';
  } finally {
    closeQuietly(descriptor);
  }
}

function readByteRange(descriptor: number, startOffset: number, byteCount: number): Buffer {
  const buffer = Buffer.alloc(byteCount);
  let filled = 0;
  while (filled < byteCount) {
    const bytesRead = readSync(descriptor, buffer, filled, byteCount - filled, startOffset + filled);
    if (bytesRead === 0) break;
    filled += bytesRead;
  }
  return buffer.subarray(0, filled);
}

function closeQuietly(descriptor: number | null): void {
  if (descriptor === null) return;
  try {
    closeSync(descriptor);
  } catch {
    // Nothing to recover: the bytes were already read, and a status line must not fail on cleanup.
  }
}

// --- git segment ----------------------------------------------------------------------------------

/**
 * Default {@link GitRunner}: spawns git, hides the Windows console flash, and never throws.
 *
 * @example runGitCommand('/work/app', ['branch', '--show-current']) // "main\n", or null outside a repo
 */
export function runGitCommand(workingDirectory: string, gitArguments: readonly string[]): string | null {
  try {
    return execFileSync('git', ['-C', workingDirectory, '--no-optional-locks', ...gitArguments], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
      timeout: GIT_TIMEOUT_MILLISECONDS,
      maxBuffer: GIT_MAX_OUTPUT_BYTES,
      windowsHide: true,
    });
  } catch {
    return null;
  }
}

/**
 * Text of the git segment ("branch", plus " *" when dirty and " (N stash)"), or '' outside a work tree.
 * Mirrors statusline-command.sh: the probe's exit code alone decides, a detached HEAD shows the short hash.
 *
 * @example describeGitWorkTree('/work/app', runGitCommand) // "main * (2 stash)"
 */
export function describeGitWorkTree(workingDirectory: string, runGit: GitRunner): string {
  if (runGit(workingDirectory, ['rev-parse', '--is-inside-work-tree']) === null) return '';
  const branchName = readBranchName(workingDirectory, runGit);
  const dirtyMarker = hasUncommittedChanges(workingDirectory, runGit) ? ' *' : '';
  const stashCount = countStashEntries(workingDirectory, runGit);
  const stashMarker = stashCount > 0 ? ` (${stashCount} stash)` : '';
  return `${branchName}${dirtyMarker}${stashMarker}`;
}

function readBranchName(workingDirectory: string, runGit: GitRunner): string {
  const currentBranch = (runGit(workingDirectory, ['branch', '--show-current']) ?? '').trim();
  if (currentBranch !== '') return currentBranch;
  return (runGit(workingDirectory, ['rev-parse', '--short', 'HEAD']) ?? '').trim();
}

function hasUncommittedChanges(workingDirectory: string, runGit: GitRunner): boolean {
  return (runGit(workingDirectory, ['status', '--porcelain']) ?? '').trim() !== '';
}

function countStashEntries(workingDirectory: string, runGit: GitRunner): number {
  const stashListing = runGit(workingDirectory, ['stash', 'list']) ?? '';
  return stashListing.split('\n').filter((line) => line.trim() !== '').length;
}

// --- path, clock, user ----------------------------------------------------------------------------

/**
 * Replaces the home directory prefix of `directory` with "~". Matches at a path boundary only, treats
 * / and \ alike, and ignores case when the home starts with a drive letter (Windows paths are case-insensitive).
 *
 * @example collapseHomeDirectory('C:\\Users\\me\\app', 'C:\\Users\\me') // "~\\app"
 */
export function collapseHomeDirectory(directory: string, homeDirectory: string): string {
  const homePrefixLength = measureHomePrefix(directory, homeDirectory);
  return homePrefixLength === 0 ? directory : `~${directory.slice(homePrefixLength)}`;
}

function measureHomePrefix(directory: string, homeDirectory: string): number {
  const home = homeDirectory.replace(/[\\/]+$/, '');
  if (home === '') return 0;
  const ignoreCase = /^[A-Za-z]:/.test(home);
  const comparableHome = toComparablePath(home, ignoreCase);
  const comparableDirectory = toComparablePath(directory, ignoreCase);
  // Case folding can change a string's length (e.g. 'İ'); then the offsets no longer line up, so do not guess.
  if (comparableHome.length !== home.length || comparableDirectory.length !== directory.length) return 0;
  const isInsideHome = comparableDirectory === comparableHome || comparableDirectory.startsWith(`${comparableHome}/`);
  return isInsideHome ? home.length : 0;
}

function toComparablePath(filePath: string, ignoreCase: boolean): string {
  const slashedPath = filePath.replace(/\\/g, '/');
  return ignoreCase ? slashedPath.toLowerCase() : slashedPath;
}

/**
 * Local time like `date "+%a %I:%M%p"` in the C locale, built by hand so no ICU or OS locale can change it.
 *
 * @example formatClockLabel(new Date(2026, 9, 20, 21, 5)) // "Tue 09:05PM"
 */
export function formatClockLabel(now: Date): string {
  if (Number.isNaN(now.getTime())) return '';
  const hours24 = now.getHours();
  const hours12 = hours24 % 12 === 0 ? 12 : hours24 % 12;
  const weekday = WEEKDAY_ABBREVIATIONS[now.getDay()] ?? '';
  const meridiem = hours24 < 12 ? 'AM' : 'PM';
  return `${weekday} ${padTwoDigits(hours12)}:${padTwoDigits(now.getMinutes())}${meridiem}`;
}

function padTwoDigits(quantity: number): string {
  return String(quantity).padStart(2, '0');
}

/**
 * The USERNAME environment variable, else the OS account name, else "user" (bash: `${USERNAME:-$(whoami)}`).
 *
 * @example resolveUserName(process.env.USERNAME, () => userInfo().username)
 */
export function resolveUserName(
  environmentUserName: string | undefined,
  readOperatingSystemUserName: () => string,
): string {
  if (environmentUserName) return environmentUserName;
  try {
    return readOperatingSystemUserName() || FALLBACK_USER_NAME;
  } catch {
    return FALLBACK_USER_NAME;
  }
}

// --- process wiring -------------------------------------------------------------------------------

function buildLiveEnvironment(): StatusLineEnvironment {
  return {
    now: new Date(),
    homeDirectory: process.env.USERPROFILE || process.env.HOME || '',
    userName: resolveUserName(process.env.USERNAME, () => userInfo().username),
    runGit: runGitCommand,
  };
}

// A terminal would make `for await` wait for Ctrl-D (bash `cat` did too); a manual run should just show defaults.
async function readStandardInput(): Promise<string> {
  if (process.stdin.isTTY) return '';
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin as AsyncIterable<Buffer | string>) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks).toString('utf8');
}

async function main(): Promise<void> {
  try {
    // Claude Code may drop the pipe when a newer refresh supersedes this one; that is not a failure.
    process.stdout.on('error', () => undefined);
    const rawStdin = await readStandardInput().catch(() => '');
    process.stdout.write(renderStatusLineSafely(rawStdin, buildLiveEnvironment()));
  } catch {
    // Exit 0 with an empty line: a broken status line must never surface as a failing command.
  }
}

function resolveRealPath(filePath: string): string {
  try {
    return realpathSync(filePath);
  } catch {
    return filePath;
  }
}

/**
 * True only when this TypeScript source is the process entry point. Requiring ".ts" keeps tsup test
 * bundles (which are their own entry point and inline this module) from starting the CLI and blocking on
 * stdin; the real path is checked too, because Node reports symlinked entries by their target.
 *
 * @example isStatusLineEntryPoint(import.meta.url, process.argv[1])
 */
export function isStatusLineEntryPoint(moduleUrl: string, entryScriptPath: string | undefined): boolean {
  if (entryScriptPath === undefined || !moduleUrl.endsWith('.ts')) return false;
  const entryPaths = [entryScriptPath, resolveRealPath(entryScriptPath)];
  return entryPaths.some((entryPath) => pathToFileURL(entryPath).href === moduleUrl);
}

if (isStatusLineEntryPoint(import.meta.url, process.argv[1])) {
  void main();
}
