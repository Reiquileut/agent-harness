/**
 * templates — copy starter docs (CLAUDE.md / AGENTS.md / memory) into a repo
 * and merge managed entries into .gitignore. All operations are idempotent and
 * never clobber an existing file unless --force is set.
 */
import path from 'node:path';
import process from 'node:process';
import type { Action } from './actions';
import { assetPath } from './catalog';
import { GITIGNORE_BEGIN, isForce, mergeGitignore, readText, tildify } from './fsx';

const DEFAULT_GITIGNORE_ENTRIES = ['.claude/settings.local.json'];

function resolveInCwd(rel: string, cwd?: string): string {
  return path.isAbsolute(rel) ? rel : path.resolve(cwd ?? process.cwd(), rel);
}

/**
 * Copy a catalog asset (e.g. "templates/CLAUDE.md") to a repo-relative dest.
 * Skips when the dest already exists (unless --force) so user edits survive.
 */
export async function buildTemplateCopyAction(
  assetRel: string,
  destRel: string,
  label: string,
  cwd?: string,
): Promise<Action> {
  const dest = resolveInCwd(destRel, cwd);
  const after = await readText(assetPath(assetRel));
  if (after == null) {
    return { kind: 'note', level: 'warn', label, message: `Template asset missing: ${assetRel}` };
  }
  const before = await readText(dest);
  if (before != null && !isForce()) {
    return { kind: 'skip', label, reason: `${tildify(dest)} exists (use --force to overwrite)` };
  }
  return { kind: 'file', label, path: dest, before, after };
}

/** Merge managed entries into the repo .gitignore (dedup, under a managed block). */
export async function buildGitignoreMergeAction(entries: string[], cwd?: string): Promise<Action> {
  const list = entries.length ? entries : DEFAULT_GITIGNORE_ENTRIES;
  const file = resolveInCwd('.gitignore', cwd);
  const before = await readText(file);
  const { content, added } = mergeGitignore(before, list);
  if (added.length === 0) {
    return { kind: 'skip', label: '.gitignore', reason: 'all entries already present' };
  }
  const label = `.gitignore (+${added.length}: ${added.join(', ')})`;
  return { kind: 'file', label, path: file, before, after: content };
}

export { GITIGNORE_BEGIN };
