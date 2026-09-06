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
import type { Action } from './actions';
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
  parseToml,
  readText,
  stringifyToml,
  tildify,
} from './fsx';

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

async function readAsset(rel: string): Promise<string | null> {
  const text = await readText(assetPath(rel));
  return text == null ? null : substitutePlaceholders(text);
}

async function buildCopy(file: PresetFile, label: string): Promise<Action> {
  const after = await readAsset(file.asset);
  if (after == null) return { kind: 'note', level: 'warn', label, message: `Preset asset missing: ${file.asset}` };
  const dest = expandHome(file.dest);
  const before = await readText(dest);
  if (before != null && file.keep && !isForce()) {
    return { kind: 'skip', label, reason: `${tildify(dest)} exists (use --force to overwrite)` };
  }
  return { kind: 'file', label, path: dest, before, after };
}

async function buildMergeJson(file: PresetFile, label: string): Promise<Action> {
  const assetText = await readAsset(file.asset);
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
  const assetText = await readAsset(file.asset);
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

/** Build every file action of a preset for the selected agents. */
export async function buildPresetActions(preset: PresetEntry, agentIds: string[]): Promise<Action[]> {
  const actions: Action[] = [];
  for (const file of preset.files) {
    if (file.agents && !agentIds.some((id) => appliesToAgent(file.agents, id))) continue;
    const label = `Preset ${preset.label ?? preset.id} → ${tildify(expandHome(file.dest))}`;
    switch (file.op) {
      case 'copy':
        actions.push(await buildCopy(file, label));
        break;
      case 'merge-json':
        actions.push(await buildMergeJson(file, label));
        break;
      case 'merge-toml':
        actions.push(await buildMergeToml(file, label));
        break;
    }
  }
  return actions;
}
