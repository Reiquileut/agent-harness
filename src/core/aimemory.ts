/**
 * aimemory — the per-repo `.ai-memory.toml` marker written by
 * `scaffold --with-ai-memory` (https://github.com/akitaonrails/ai-memory).
 *
 * Why a marker per repo: without it captures fall into an automatic scope
 * derived from the cwd, which changes from machine to machine; pinning
 * `workspace`/`project` keeps one memory per project across machines.
 * Shape mirrors the markers already in use (ai-memory 2.5.x).
 *
 * `[capture] ignore_paths` keeps secrets out of memory. Each glob is written
 * twice — bare and with a `**\/` prefix — because ai-memory's leading `**\/`
 * does NOT match zero directories: with only `**\/.env`, the repo-root `.env`
 * was still captured (measured 2026-10-05, ai-memory 2.5.2).
 */
import path from 'node:path';
import process from 'node:process';
import type { Action } from './actions';
import { isForce, readText, tildify } from './fsx';

export const AI_MEMORY_MARKER_FILE = '.ai-memory.toml';

/** Secrets that must never become memory. */
export const DEFAULT_AI_MEMORY_IGNORES = ['.env', '.env.*', '*.pem', '*.key', '*.tfstate', '*.tfstate.*'];

/** Each glob bare and with `**\/`, deduped. Example: ['.env'] → ['.env', '**\/.env']. */
export function withDoubleStarVariants(globs: string[]): string[] {
  const out = globs.flatMap((g) => {
    const bare = g.replace(/^(\*\*\/)+/, '');
    return [bare, `**/${bare}`];
  });
  return [...new Set(out)];
}

/** Project name from a dir name: lowercase, spaces → '-'. Example: 'My Repo' → 'my-repo'. */
export function defaultAiMemoryProject(cwd: string = process.cwd()): string {
  return path.basename(cwd).trim().toLowerCase().replace(/\s+/g, '-');
}

/** Render the marker. Strings go through JSON.stringify (valid TOML basic strings). */
export function renderAiMemoryToml(workspace: string, project: string, ignores: string[] = DEFAULT_AI_MEMORY_IGNORES): string {
  const globs = withDoubleStarVariants(ignores).map((g) => `  ${JSON.stringify(g)},`);
  return [
    '# ai-memory scope for this repo (https://github.com/akitaonrails/ai-memory).',
    '# Written by agent-harness scaffold --with-ai-memory. Pins workspace/project so',
    '# captures land in the same memory on every machine.',
    `workspace = ${JSON.stringify(workspace)}`,
    `project = ${JSON.stringify(project)}`,
    '',
    '[capture]',
    '# Secrets never become memory. Each glob appears bare AND with **/ because',
    "# ai-memory's leading **/ does not match zero dirs (root .env would leak).",
    'ignore_paths = [',
    ...globs,
    ']',
    '',
  ].join('\n');
}

/**
 * Plan the marker write. Skips (with a hint) when no workspace was given, and
 * keeps an existing marker unless --force. Example:
 * `await buildAiMemoryTomlAction('acme', 'widget', '/repo')`.
 */
export async function buildAiMemoryTomlAction(
  workspace: string | undefined,
  project: string | undefined,
  cwd: string = process.cwd(),
): Promise<Action> {
  const label = AI_MEMORY_MARKER_FILE;
  if (!workspace) {
    return { kind: 'note', level: 'warn', label, message: `${label}: pass --ai-memory-workspace <name> (and optionally --ai-memory-project) — skipped.` };
  }
  const dest = path.join(cwd, AI_MEMORY_MARKER_FILE);
  const before = await readText(dest);
  if (before != null && !isForce()) {
    return { kind: 'skip', label, reason: `${tildify(dest)} exists (use --force to overwrite)` };
  }
  const after = renderAiMemoryToml(workspace, project || defaultAiMemoryProject(cwd));
  return { kind: 'file', label, path: dest, before, after };
}
