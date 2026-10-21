/**
 * presets — machine-level config files that aren't MCPs/skills/plugins: Claude
 * `settings.json` (model, effort, permissions, status line…), the status-line
 * scripts, Codex `config.toml` defaults, global instruction files.
 *
 * Each preset is a list of file ops from the catalog:
 *   - merge-json / merge-toml: deep-merge the asset into the destination. Objects
 *     merge recursively; arrays UNION (by value) so re-runs never duplicate a
 *     permission or a hook; scalars from the asset win. Unchanged → noop.
 *   - copy: write the asset verbatim (`keep`: never overwrite unless --force).
 *
 * `{{HOME}}` inside an asset expands to the home dir (forward slashes, which
 * Node and both agents accept on Windows too).
 */
import { type Action, type ApplyResult, runAction } from './actions';
import { assetPath } from './catalog';
import type { PresetEntry, PresetFile } from './catalog';
import { appliesToAgent } from './catalog';
import {
  expandHome,
  homeDir,
  isForce,
  isRecord,
  jsonStringify,
  log,
  mergeManagedBlock,
  parseToml,
  readText,
  stringifyToml,
  tildify,
} from './fsx';
import { platformAllows, platformSkipReason } from './platform';

/** Deep merge where arrays union by JSON value (order: base first, then new). */
export function deepMergeUnion(base: unknown, patch: unknown): unknown {
  if (Array.isArray(patch)) {
    const out: unknown[] = Array.isArray(base) ? [...base] : [];
    const seen = new Set(out.map((x) => JSON.stringify(x)));
    for (const item of patch) {
      const key = JSON.stringify(item);
      if (!seen.has(key)) {
        seen.add(key);
        out.push(item);
      }
    }
    return out;
  }
  if (!isRecord(patch)) return patch;
  const out: Record<string, unknown> = isRecord(base) ? { ...base } : {};
  for (const [k, v] of Object.entries(patch)) out[k] = deepMergeUnion(out[k], v);
  return out;
}

/** Expand `{{HOME}}` placeholders (forward-slash home dir). */
export function substitutePlaceholders(text: string): string {
  const home = homeDir().replace(/\\/g, '/');
  return text.replaceAll('{{HOME}}', home);
}

function sameJson(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

/** Read a preset asset from the catalog it came from (bundled or overlay), `{{HOME}}` expanded. */
async function readAsset(file: PresetFile): Promise<string | null> {
  const text = await readText(assetPath(file.asset, file.assetsRoot));
  return text == null ? null : substitutePlaceholders(text);
}

async function buildCopy(file: PresetFile, label: string): Promise<Action> {
  const after = await readAsset(file);
  if (after == null) return { kind: 'note', level: 'warn', label, message: `Preset asset missing: ${file.asset}` };
  const dest = expandHome(file.dest);
  const before = await readText(dest);
  if (before != null && file.keep && !isForce()) {
    return { kind: 'skip', label, reason: `${tildify(dest)} exists (use --force to overwrite)` };
  }
  return { kind: 'file', label, path: dest, before, after };
}

async function buildMergeJson(file: PresetFile, label: string): Promise<Action> {
  const assetText = await readAsset(file);
  if (assetText == null) return { kind: 'note', level: 'warn', label, message: `Preset asset missing: ${file.asset}` };
  let patch: unknown;
  try {
    patch = JSON.parse(assetText);
  } catch (err) {
    return { kind: 'note', level: 'warn', label, message: `Preset asset ${file.asset} is not valid JSON: ${(err as Error).message}` };
  }
  const dest = expandHome(file.dest);
  const before = await readText(dest);
  let base: unknown = {};
  if (before && before.trim()) {
    try {
      base = JSON.parse(before);
    } catch {
      return { kind: 'note', level: 'warn', label, message: `Could not parse ${tildify(dest)} as JSON; merge it manually.` };
    }
  }
  const merged = deepMergeUnion(base, patch);
  if (before != null && sameJson(base, merged)) {
    return { kind: 'skip', label, reason: `already merged into ${tildify(dest)}` };
  }
  return { kind: 'file', label, path: dest, before, after: jsonStringify(merged) };
}

async function buildMergeToml(file: PresetFile, label: string): Promise<Action> {
  const assetText = await readAsset(file);
  if (assetText == null) return { kind: 'note', level: 'warn', label, message: `Preset asset missing: ${file.asset}` };
  let patch: Record<string, unknown>;
  try {
    patch = parseToml(assetText);
  } catch (err) {
    return { kind: 'note', level: 'warn', label, message: `Preset asset ${file.asset} is not valid TOML: ${(err as Error).message}` };
  }
  const dest = expandHome(file.dest);
  const before = await readText(dest);
  let base: Record<string, unknown> = {};
  if (before && before.trim()) {
    try {
      base = parseToml(before);
    } catch {
      return { kind: 'note', level: 'warn', label, message: `Could not parse ${tildify(dest)} as TOML; merge it manually.` };
    }
  }
  const merged = deepMergeUnion(base, patch) as Record<string, unknown>;
  if (before != null && sameJson(base, merged)) {
    return { kind: 'skip', label, reason: `already merged into ${tildify(dest)}` };
  }
  if (before?.includes('#')) {
    log.warn(`   rewriting ${tildify(dest)} (TOML comments may be lost)`);
  }
  return { kind: 'file', label, path: dest, before, after: stringifyToml(merged) };
}

/**
 * ensure-prefix: write the asset when `dest` is missing; prepend it when the
 * file exists but lacks the asset's first line (e.g. the `@~/.codex/AGENTS.md`
 * import missing from a CLAUDE.md an older harness run created with only the
 * manifest block); otherwise leave the user's file alone.
 */
async function buildEnsurePrefix(file: PresetFile, label: string): Promise<Action> {
  const asset = await readAsset(file);
  if (asset == null) return { kind: 'note', level: 'warn', label, message: `Preset asset missing: ${file.asset}` };
  const dest = expandHome(file.dest);
  const before = await readText(dest);
  if (before == null) return { kind: 'file', label, path: dest, before, after: asset };
  const marker = asset.split(/\r?\n/)[0]?.trim() ?? '';
  if (before.split(/\r?\n/).some((line) => line.trim() === marker)) {
    return { kind: 'skip', label, reason: `${tildify(dest)} already starts with ${marker}` };
  }
  return { kind: 'file', label, path: dest, before, after: `${asset.trimEnd()}\n\n${before}` };
}

/** Markers of a preset's managed block. Example: managedBlockMarkers('x') → ['<!-- BEGIN agent-harness:x -->', …]. */
export function managedBlockMarkers(presetId: string): [string, string] {
  return [`<!-- BEGIN agent-harness:${presetId} -->`, `<!-- END agent-harness:${presetId} -->`];
}

/** True when `existing` holds the asset outside our markers (a copy made before v1.7). */
function holdsUnmanagedCopy(existing: string, asset: string, begin: string): boolean {
  if (existing.includes(begin)) return false;
  const signature = asset.split(/\r?\n/).find((line) => line.trim())?.trim();
  return Boolean(signature) && existing.split(/\r?\n/).some((line) => line.trim() === signature);
}

/**
 * managed-block (v1.7.0): keep the asset between agent-harness markers in a file
 * that may hold other content. Why: `copy keep` left the owner's rules out of a
 * ~/.codex/AGENTS.md that already held only the post-install manifest (older
 * harness runs), and never refreshed them. A hand-made copy is left alone.
 */
async function buildManagedBlock(presetId: string, file: PresetFile, label: string): Promise<Action> {
  const asset = await readAsset(file);
  if (asset == null) return { kind: 'note', level: 'warn', label, message: `Preset asset missing: ${file.asset}` };
  const dest = expandHome(file.dest);
  const before = await readText(dest);
  const [begin, end] = managedBlockMarkers(presetId);
  if (before != null && holdsUnmanagedCopy(before, asset, begin)) {
    return { kind: 'skip', label, reason: `${tildify(dest)} holds an unmanaged copy (delete it to let agent-harness manage it)` };
  }
  return { kind: 'file', label, path: dest, before, after: mergeManagedBlock(before, asset, begin, end) };
}

/**
 * Build the action for ONE preset file. Callers must run it before building
 * the next file: two files with the same `dest` (a base preset plus its
 * `platforms:["win32"]` companion) would otherwise both merge into the same
 * stale `before` and the second write would drop the first.
 */
export async function buildPresetFileAction(preset: Pick<PresetEntry, 'id' | 'label'>, file: PresetFile): Promise<Action> {
  const label = `Preset ${preset.label ?? preset.id} → ${tildify(expandHome(file.dest))}`;
  if (!platformAllows(file.platforms)) {
    return { kind: 'skip', label, reason: platformSkipReason(file.platforms) };
  }
  switch (file.op) {
    case 'copy':
      return buildCopy(file, label);
    case 'merge-json':
      return buildMergeJson(file, label);
    case 'merge-toml':
      return buildMergeToml(file, label);
    case 'ensure-prefix':
      return buildEnsurePrefix(file, label);
    case 'managed-block':
      return buildManagedBlock(preset.id, file, label);
  }
}

/** The preset's files that apply to the selected agents (file-level `agents` filter). */
export function presetFilesFor(files: PresetFile[], agentIds: string[]): PresetFile[] {
  return files.filter((file) => !file.agents || agentIds.some((id) => appliesToAgent(file.agents, id)));
}

/**
 * Build-and-run every file of a preset, one at a time (see buildPresetFileAction).
 * Example: `await runPresetFiles(preset, preset.files, ['codex'])`.
 */
export async function runPresetFiles(
  preset: Pick<PresetEntry, 'id' | 'label'>,
  files: PresetFile[],
  agentIds: string[],
): Promise<ApplyResult[]> {
  const results: ApplyResult[] = [];
  for (const file of presetFilesFor(files, agentIds)) {
    results.push(await runAction(await buildPresetFileAction(preset, file)));
  }
  return results;
}
