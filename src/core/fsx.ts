/**
 * fsx — shared filesystem, logging, and run-context primitives.
 *
 * Everything that writes to disk goes through here so that:
 *  - `--dry-run` short-circuits every mutation (nothing touches disk), and
 *  - writes are atomic (temp file + rename) and create parent dirs.
 *
 * Pure helpers (deepMerge, mergeGitignore) do no IO so callers can compute a
 * result, show a dry-run preview, and only then persist it.
 */
import { existsSync, promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import pc from 'picocolors';
import { parse as parseTomlRaw, stringify as stringifyTomlRaw } from 'smol-toml';

// ---------------------------------------------------------------------------
// Run context (set once from CLI global flags)
// ---------------------------------------------------------------------------
export interface RunContext {
  /** When true, no mutation touches disk; actions are only described. */
  dryRun: boolean;
  /** When true, overwrite/replace existing entries instead of skipping. */
  force: boolean;
  /** When true, assume defaults and never prompt (CI mode). */
  yes: boolean;
}

let ctx: RunContext = { dryRun: false, force: false, yes: false };

export function setRunContext(next: Partial<RunContext>): void {
  ctx = { ...ctx, ...next };
}
export function getRunContext(): Readonly<RunContext> {
  return ctx;
}
export const isDryRun = (): boolean => ctx.dryRun;
export const isForce = (): boolean => ctx.force;

// ---------------------------------------------------------------------------
// Logger
// ---------------------------------------------------------------------------
export const log = {
  info: (m: string) => console.log(`${pc.blue('i')}  ${m}`),
  success: (m: string) => console.log(`${pc.green('✓')}  ${m}`),
  warn: (m: string) => console.log(`${pc.yellow('!')}  ${m}`),
  error: (m: string) => console.error(`${pc.red('✗')}  ${m}`),
  step: (m: string) => console.log(`${pc.cyan('→')}  ${m}`),
  dim: (m: string) => console.log(pc.dim(m)),
  plain: (m: string) => console.log(m),
};

/** Yellow `[dry-run]` prefix, empty when applying for real. */
export const dryTag = (): string => (ctx.dryRun ? pc.yellow('[dry-run] ') : '');

// ---------------------------------------------------------------------------
// Path helpers (Windows-aware via os.homedir())
// ---------------------------------------------------------------------------
export const homeDir = (): string => os.homedir();

/** Expand a leading `~` to the user's home directory. */
export function expandHome(p: string): string {
  if (p === '~') return homeDir();
  if (p.startsWith('~/') || p.startsWith('~\\')) return path.join(homeDir(), p.slice(2));
  return p;
}

/** True if a file/dir exists (after `~` expansion). */
export const pathExists = (p: string): boolean => existsSync(expandHome(p));

/** Pretty path for logs: collapse the home dir back to `~`. */
export function tildify(p: string): string {
  const abs = path.resolve(expandHome(p));
  const home = homeDir();
  return abs.startsWith(home) ? `~${abs.slice(home.length)}` : p;
}

// ---------------------------------------------------------------------------
// Low-level IO (dry-run aware)
// ---------------------------------------------------------------------------
export async function ensureDir(dir: string): Promise<void> {
  if (ctx.dryRun) return;
  await fs.mkdir(expandHome(dir), { recursive: true });
}

/** Read a file, returning null when it does not exist. */
export async function readText(p: string): Promise<string | null> {
  try {
    return await fs.readFile(expandHome(p), 'utf8');
  } catch (err) {
    if ((err as NodeJS.ErrnoException)?.code === 'ENOENT') return null;
    throw err;
  }
}

/** Atomic write (temp + rename); creates parent dirs. No-op under --dry-run. */
export async function atomicWrite(p: string, content: string): Promise<void> {
  const target = expandHome(p);
  if (ctx.dryRun) return;
  await fs.mkdir(path.dirname(target), { recursive: true });
  const tmp = `${target}.${process.pid}.${Date.now()}.tmp`;
  await fs.writeFile(tmp, content, 'utf8');
  await fs.rename(tmp, target);
}

/** Copy a file's contents to a destination via atomicWrite (so dry-run/atomicity apply). */
export async function copyFile(src: string, dest: string): Promise<void> {
  const content = await fs.readFile(expandHome(src), 'utf8');
  await atomicWrite(dest, content);
}

// ---------------------------------------------------------------------------
// JSON read-modify-write
// ---------------------------------------------------------------------------
/** Narrow to a plain object (not null, not array). */
export function isRecord(x: unknown): x is Record<string, unknown> {
  return typeof x === 'object' && x !== null && !Array.isArray(x);
}

export async function readJson<T = unknown>(p: string): Promise<T | null> {
  const text = await readText(p);
  if (text == null || text.trim() === '') return null;
  return JSON.parse(text) as T;
}

/** Serialize with 2-space indent and a trailing newline. */
export function jsonStringify(value: unknown): string {
  return `${JSON.stringify(value, null, 2)}\n`;
}

/**
 * Deep-merge `patch` into `base`. Objects merge recursively; arrays and
 * primitives in `patch` replace whatever is in `base`. Returns a new value.
 */
export function deepMerge<T = unknown>(base: unknown, patch: unknown): T {
  if (patch === null || typeof patch !== 'object' || Array.isArray(patch)) {
    return patch as T;
  }
  const out: Record<string, unknown> =
    base && typeof base === 'object' && !Array.isArray(base)
      ? { ...(base as Record<string, unknown>) }
      : {};
  for (const [k, v] of Object.entries(patch as Record<string, unknown>)) {
    out[k] = deepMerge(out[k], v);
  }
  return out as T;
}

// ---------------------------------------------------------------------------
// TOML read-modify-write (re-export smol-toml with friendly names)
// ---------------------------------------------------------------------------
export function parseToml(text: string): Record<string, unknown> {
  return parseTomlRaw(text) as Record<string, unknown>;
}
export function stringifyToml(value: Record<string, unknown>): string {
  const out = stringifyTomlRaw(value);
  return out.endsWith('\n') ? out : `${out}\n`;
}

// ---------------------------------------------------------------------------
// .gitignore merge (pure — no IO)
// ---------------------------------------------------------------------------
export const GITIGNORE_BEGIN = '# >>> agent-harness >>>';
export const GITIGNORE_END = '# <<< agent-harness <<<';

/**
 * Idempotently add `entries` to gitignore content under a managed block.
 * Entries already present anywhere in the file (managed or not) are skipped.
 * Returns the new content and the list of entries actually added.
 */
export function mergeGitignore(
  existing: string | null,
  entries: string[],
): { content: string; added: string[] } {
  const base = existing ?? '';
  const present = new Set(
    base
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter(Boolean),
  );
  const toAdd = entries.map((e) => e.trim()).filter((e) => e && !present.has(e));

  if (toAdd.length === 0) return { content: base, added: [] };

  const hasBlock = base.includes(GITIGNORE_BEGIN);
  let content: string;
  if (hasBlock) {
    // Insert before the END marker, preserving the managed block.
    content = base.replace(GITIGNORE_END, `${toAdd.join('\n')}\n${GITIGNORE_END}`);
  } else {
    const prefix = base.length === 0 || base.endsWith('\n') ? base : `${base}\n`;
    const block = `${GITIGNORE_BEGIN}\n${toAdd.join('\n')}\n${GITIGNORE_END}\n`;
    content = `${prefix}${prefix.length && !prefix.endsWith('\n\n') ? '\n' : ''}${block}`;
  }
  return { content, added: toAdd };
}
