// Codex SessionStart hook: injects the ai-memory startup instructions (the sibling ai-memory-startup.txt)
// as additionalContext, so every new Codex session begins by recalling the project's memory.
//
// Ported on 2026-10-20 from the maintainer's ~/.codex/hooks/ai-memory-startup.ps1 so it runs the same on
// Windows, macOS and Linux with `node ai-memory-startup.ts`. Node >= 22.18 strips types at load time, so this
// must stay ONE file of erasable syntax importing only `node:` modules; install it by copying, because Node
// refuses to strip types inside node_modules (per Context7 /websites/nodejs_latest-v22_x_api, 2026-10-20).
//
// Codex contract (per Context7 /openai/codex, verified 2026-10-20): SessionStart stdout is
//   { hookSpecificOutput: { hookEventName: "SessionStart", additionalContext } }
// Stdout that looks like JSON but does not parse fails the hook, and so does a non-zero exit. Hence every
// error path prints nothing and exits 0 (fail open): a missing instruction file must never block a session.
import { readFileSync, realpathSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

export const SESSION_START_EVENT_NAME = 'SessionStart';
const INSTRUCTIONS_RELATIVE_URL = './ai-memory-startup.txt';
const UTF8_BYTE_ORDER_MARK = '\u{FEFF}';

/**
 * Removes one leading UTF-8 byte order mark. Windows editors add it, and the .ps1 original never saw it
 * because .NET's File.ReadAllText drops it while Node's readFileSync keeps it as U+FEFF.
 *
 * @example stripUtf8Bom('\u{FEFF}olá') // 'olá'
 */
export function stripUtf8Bom(text: string): string {
  return text.startsWith(UTF8_BYTE_ORDER_MARK) ? text.slice(UTF8_BYTE_ORDER_MARK.length) : text;
}

/**
 * Reads the instruction text; null when the file is missing, unreadable or empty, i.e. nothing to inject.
 * Invalid UTF-8 is replaced by U+FFFD rather than failing, and CRLF is kept as written.
 *
 * @example
 * readStartupInstructions(new URL('./ai-memory-startup.txt', import.meta.url)) // "## Leitura inicial..."
 */
export function readStartupInstructions(instructionsUrl: URL): string | null {
  try {
    const instructions = stripUtf8Bom(readFileSync(instructionsUrl, 'utf8'));
    return instructions === '' ? null : instructions;
  } catch {
    return null;
  }
}

/**
 * The compact JSON document Codex expects from a SessionStart hook (JSON.stringify escapes quotes,
 * backslashes, control characters and lone surrogates, so the output always parses).
 *
 * @example buildSessionStartPayload('hi') // '{"hookSpecificOutput":{"hookEventName":"SessionStart","additionalContext":"hi"}}'
 */
export function buildSessionStartPayload(additionalContext: string): string {
  return JSON.stringify({
    hookSpecificOutput: { hookEventName: SESSION_START_EVENT_NAME, additionalContext },
  });
}

function resolveRealPath(filePath: string): string {
  try {
    return realpathSync(filePath);
  } catch {
    return filePath;
  }
}

/**
 * True only when this TypeScript source is the process entry point. Requiring ".ts" keeps tsup test bundles
 * (their own entry point, with this module inlined) from printing a payload; the real path is checked too,
 * because Node reports symlinked entries by their target. Duplicated in statusline.ts on purpose: each
 * asset is installed alone and must stay a single file.
 *
 * @example isStartupHookEntryPoint(import.meta.url, process.argv[1])
 */
export function isStartupHookEntryPoint(moduleUrl: string, entryScriptPath: string | undefined): boolean {
  if (entryScriptPath === undefined || !moduleUrl.endsWith('.ts')) return false;
  const entryPaths = [entryScriptPath, resolveRealPath(entryScriptPath)];
  return entryPaths.some((entryPath) => pathToFileURL(entryPath).href === moduleUrl);
}

function main(): void {
  // Codex may close the pipe once it has what it needs; that is not a hook failure.
  process.stdout.on('error', () => undefined);
  try {
    const instructions = readStartupInstructions(new URL(INSTRUCTIONS_RELATIVE_URL, import.meta.url));
    if (instructions !== null) process.stdout.write(`${buildSessionStartPayload(instructions)}\n`);
  } catch {
    // Fail open: print nothing and exit 0, so Codex starts the session without the recall text.
  }
}

if (isStartupHookEntryPoint(import.meta.url, process.argv[1])) {
  main();
}
