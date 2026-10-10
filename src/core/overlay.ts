/**
 * overlay — private catalogs layered on top of the public one.
 *
 * The public repo ships only generic tooling; anything tied to a person's
 * accounts or clients (private skills, account-bound MCPs, server URLs) lives
 * in a separate private "overlay": a dir with its own partial catalog.json plus
 * skills/, agents/, presets/. `--overlay <dir|git-url>` (repeatable) or
 * AGENT_HARNESS_OVERLAY (`;`-separated — `:` would break URLs) adds it to the
 * menu. Git overlays are shallow-cloned with the user's own git credentials
 * into a temp dir that is always removed; credentials are never printed.
 *
 * Merge rule: overlay entries are appended; an id that collides with the
 * public catalog is replaced in place by the overlay entry (with a warning).
 *
 * Trust: an overlay is TRUSTED CODE, exactly like the public catalog — its
 * MCP commands, integration steps and preset `dest` paths run/write as given.
 * Only use overlays you control. The checks below just stop bundled asset
 * names from escaping the overlay dir; they are not a sandbox.
 */
import { existsSync, promises as fs, rmSync, statSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { execa } from 'execa';
import {
  type CatalogBase,
  type CatalogData,
  CatalogBaseSchema,
  loadCatalog,
  parseCatalogFile,
  stampCatalogOrigin,
} from './catalog';
import { expandHome } from './fsx';

export const OVERLAY_ENV_NAME = 'AGENT_HARNESS_OVERLAY';
const OVERLAY_TEMP_PREFIX = 'agent-harness-overlay-';
const GIT_SPEC_PATTERN = /^(git@|https?:\/\/|ssh:\/\/|file:\/\/|github:)/;
const SAFE_NAME_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

/** Runs `git` with the given args; injected so tests can fake the clone. */
export type OverlayGitRunner = (args: string[]) => Promise<void>;

export interface ResolvedOverlay {
  dir: string;
  /** Printable name (credentials redacted). */
  label: string;
  dispose: () => Promise<void>;
}

export interface LoadedCatalog {
  catalog: CatalogData;
  /** Warnings to show the user (id collisions). */
  notes: string[];
  /** Remove temp clones. Always call (finally). */
  dispose: () => Promise<void>;
}

/** Flags first, then the env var. Example: `parseOverlaySpecs(['a'], 'b;c')` → ['a','b','c']. */
export function parseOverlaySpecs(flags: string[], envValue: string | undefined = process.env[OVERLAY_ENV_NAME]): string[] {
  const fromEnv = (envValue ?? '').split(/[;\n]/);
  const all = [...flags, ...fromEnv].map((s) => s.trim()).filter(Boolean);
  return [...new Set(all)];
}

/** True for git URLs and `github:owner/repo`. */
export function isGitOverlaySpec(spec: string): boolean {
  return GIT_SPEC_PATTERN.test(spec);
}

/** `github:o/r` → `https://github.com/o/r.git`; other git URLs unchanged. */
export function toOverlayGitUrl(spec: string): string {
  return spec.startsWith('github:') ? `https://github.com/${spec.slice('github:'.length)}.git` : spec;
}

/**
 * Strip `user:pass@` and token query params from any text that may echo a URL.
 * Greedy up to the LAST `@` before the path, so a password containing `@`
 * can't leak its tail. Example: `https://u:p@ss@host/x` → `https://***@host/x`.
 */
export function redactOverlaySecrets(text: string): string {
  return text
    .replace(/(\/\/)[^/\s]*@/g, '$1***@')
    .replace(/([?&](?:token|access_token|auth|key)=)[^&\s]+/gi, '$1***');
}

function defaultOverlayGitRunner(args: string[]): Promise<void> {
  const env = { ...process.env, GIT_TERMINAL_PROMPT: '0' };
  return execa('git', args, { env, stdin: 'ignore', timeout: 120_000 }).then(() => undefined);
}

/** Shallow-clone a git overlay into a fresh temp dir; the dir is removed on failure. */
async function cloneOverlayRepo(spec: string, runGit: OverlayGitRunner): Promise<ResolvedOverlay> {
  const label = redactOverlaySecrets(spec);
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), OVERLAY_TEMP_PREFIX));
  const dispose = () => fs.rm(dir, { recursive: true, force: true });
  try {
    await runGit(['clone', '--depth', '1', '--quiet', '--', toOverlayGitUrl(spec), dir]);
  } catch (err) {
    await dispose();
    const first = (err instanceof Error ? err.message : String(err)).split('\n')[0] ?? '';
    throw new Error(`Overlay ${label}: git clone failed — ${redactOverlaySecrets(first)}`);
  }
  return { dir, label, dispose };
}

/** Resolve a local dir overlay (must exist and be a directory). */
function resolveLocalOverlay(spec: string): ResolvedOverlay {
  const dir = path.resolve(expandHome(spec));
  if (!existsSync(dir) || !statSync(dir).isDirectory()) {
    throw new Error(`Overlay ${JSON.stringify(spec)} is not a directory (expected a dir containing catalog.json, or a git URL).`);
  }
  return { dir, label: path.basename(dir), dispose: async () => {} };
}

/** Resolve one spec to a local dir. Rejects specs that git could read as options. */
export async function resolveOverlaySpec(
  spec: string,
  runGit: OverlayGitRunner = defaultOverlayGitRunner,
): Promise<ResolvedOverlay> {
  if (spec.startsWith('-')) {
    throw new Error(`Overlay spec ${JSON.stringify(redactOverlaySecrets(spec))} starts with "-"; expected a dir path or a git URL.`);
  }
  return isGitOverlaySpec(spec) ? cloneOverlayRepo(spec, runGit) : resolveLocalOverlay(spec);
}

function assertSafeOverlayName(value: string, field: string, label: string): void {
  if (SAFE_NAME_PATTERN.test(value) && !value.includes('..')) return;
  throw new Error(`Overlay ${label}: ${field} ${JSON.stringify(value)} is not a plain name (expected letters, digits, . _ -).`);
}

function assertSafeOverlayAsset(value: string, field: string, label: string): void {
  const segments = value.split(/[\\/]/);
  if (!path.isAbsolute(value) && !segments.includes('..')) return;
  throw new Error(`Overlay ${label}: ${field} ${JSON.stringify(value)} escapes the overlay dir (expected a relative path without "..").`);
}

/** Overlay assets must stay inside the overlay dir. */
function validateOverlayPaths(base: CatalogBase, label: string): void {
  for (const s of base.skills) {
    assertSafeOverlayName(s.id, `skill id`, label);
    assertSafeOverlayName(s.skill, `skill name`, label);
  }
  for (const a of base.subagents) {
    for (const f of [a.file, a.codex_file].filter((x): x is string => Boolean(x))) assertSafeOverlayName(f, 'subagent file', label);
  }
  for (const f of [...base.presets, ...base.integrations].flatMap((p) => p.files)) {
    assertSafeOverlayAsset(f.asset, 'preset asset', label);
  }
}

/** Parse, validate and stamp an overlay's catalog.json. */
export async function loadOverlayCatalog(overlay: ResolvedOverlay): Promise<CatalogBase> {
  const base = await parseCatalogFile(path.join(overlay.dir, 'catalog.json'), CatalogBaseSchema);
  validateOverlayPaths(base, overlay.label);
  return stampCatalogOrigin(base, { assetsRoot: overlay.dir, overlay: overlay.label });
}

/** Replace colliding ids in place, append the rest; record a note per collision. */
function mergeOverlaySection<T extends { id: string }>(base: T[], extra: T[], section: string, notes: string[], label: string): T[] {
  const out = [...base];
  for (const entry of extra) {
    const at = out.findIndex((x) => x.id === entry.id);
    if (at === -1) {
      out.push(entry);
      continue;
    }
    notes.push(`overlay "${label}" overrides ${section} id "${entry.id}"`);
    out[at] = entry;
  }
  return out;
}

/** Fold one overlay into the catalog (pure apart from `notes`). */
export function mergeOverlayCatalog(base: CatalogData, overlay: CatalogBase, label: string, notes: string[]): CatalogData {
  return {
    ...base,
    mcps: mergeOverlaySection(base.mcps, overlay.mcps, 'mcp', notes, label),
    skills: mergeOverlaySection(base.skills, overlay.skills, 'skill', notes, label),
    subagents: mergeOverlaySection(base.subagents, overlay.subagents, 'subagent', notes, label),
    plugins: mergeOverlaySection(base.plugins, overlay.plugins, 'plugin', notes, label),
    presets: mergeOverlaySection(base.presets, overlay.presets, 'preset', notes, label),
    integrations: mergeOverlaySection(base.integrations, overlay.integrations, 'integration', notes, label),
    gitignore: [...new Set([...base.gitignore, ...overlay.gitignore])],
  };
}

/**
 * Ctrl-C / SIGTERM skip `finally` blocks, which would leave a private clone in
 * the temp dir: remove clones synchronously, then exit 130. Returns the
 * function that unregisters the handlers.
 */
function removeClonesOnSignal(resolved: ResolvedOverlay[]): () => void {
  const onSignal = () => {
    for (const r of resolved) if (r.dir.includes(OVERLAY_TEMP_PREFIX)) rmSync(r.dir, { recursive: true, force: true });
    process.exit(130);
  };
  process.once('SIGINT', onSignal);
  process.once('SIGTERM', onSignal);
  return () => {
    process.off('SIGINT', onSignal);
    process.off('SIGTERM', onSignal);
  };
}

/**
 * Resolve every spec and merge it into `base`. On any failure, clones made so
 * far are removed before the error propagates.
 * Example: `const { catalog, dispose } = await applyOverlays(await loadCatalog(), ['~/private'])`.
 */
export async function applyOverlays(
  base: CatalogData,
  specs: string[],
  runGit: OverlayGitRunner = defaultOverlayGitRunner,
): Promise<LoadedCatalog> {
  const resolved: ResolvedOverlay[] = [];
  const releaseSignals = removeClonesOnSignal(resolved);
  const dispose = async () => {
    releaseSignals();
    await Promise.all(resolved.map((r) => r.dispose()));
  };
  const notes: string[] = [];
  let catalog = base;
  try {
    for (const spec of specs) {
      const overlay = await resolveOverlaySpec(spec, runGit);
      resolved.push(overlay);
      catalog = mergeOverlayCatalog(catalog, await loadOverlayCatalog(overlay), overlay.label, notes);
    }
  } catch (err) {
    await dispose();
    throw err;
  }
  return { catalog, notes, dispose };
}

/**
 * The public catalog plus every overlay from `--overlay` flags and the
 * AGENT_HARNESS_OVERLAY env var. Shared by `init` and `scaffold`.
 * Example: `const loaded = await loadCatalogWithOverlays(opts.overlay); try { … } finally { await loaded.dispose(); }`.
 */
export async function loadCatalogWithOverlays(flags: string[]): Promise<LoadedCatalog> {
  return applyOverlays(await loadCatalog(), parseOverlaySpecs(flags));
}
