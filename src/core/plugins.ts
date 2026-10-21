/**
 * plugins — marketplaces + plugins for the agents that have a plugin system.
 *
 * Claude Code: primary path uses the `claude` CLI (marketplace add + plugin
 * install). These execs are marked tolerant so "already added/installed" is
 * treated as benign, which keeps re-runs idempotent without brittle
 * list-parsing. Fallback (no `claude` on PATH): write extraKnownMarketplaces +
 * enabledPlugins into ~/.claude/settings.json (best-effort; the CLI is the
 * source of truth).
 *
 * Codex: plugins live in ~/.codex/config.toml as
 *   [marketplaces.<name>]  source_type = "git"  source = "https://github.com/<repo>.git"
 *   [plugins."<plugin>@<name>"]  enabled = true
 * We append only the missing tables (comments/settings preserved verbatim), or
 * rewrite the file under --force. Marketplaces flagged `builtin` (openai-curated,
 * openai-bundled, …) are registered by the Codex app itself, so only the
 * `[plugins.*]` enable tables are written.
 *
 * Bundled marketplaces (v1.7.0, the owner's Claude Code mods) ship inside this
 * repo: they are staged into `installPath` (a file edited there is kept unless
 * --force) and registered by that local path — `claude plugin marketplace add
 * ./dir` (Context7 code.claude.com/docs plugins, 2026-10-20), a `directory`
 * source in the settings fallback, `source_type = "local"` for Codex.
 */
import { promises as fs } from 'node:fs';
import path from 'node:path';
import type { Action } from './actions';
import type { AgentInfo } from './agents';
import { commandOnPath, userMcpFileAbs } from './agents';
import { type PluginEntry, assetPath } from './catalog';
import {
  expandHome,
  isForce,
  isRecord,
  jsonStringify,
  log,
  parseToml,
  readBytes,
  readText,
  stringifyToml,
  tildify,
} from './fsx';

/** The marketplace's declared name (install ref `<plugin>@<name>`). */
export function marketplaceName(plugin: PluginEntry): string {
  if (plugin.name) return plugin.name;
  const seg = plugin.marketplace.split('/').pop() ?? plugin.marketplace;
  return seg.replace(/\.git$/, '');
}

/** Git URL Codex clones for a marketplace (`owner/repo` -> GitHub). */
export function marketplaceGitUrl(plugin: PluginEntry): string {
  const m = plugin.marketplace;
  if (/^(https?:|git@|ssh:)/.test(m)) return m;
  return `https://github.com/${m.replace(/\.git$/, '')}.git`;
}

// ---------------------------------------------------------------------------
// Bundled marketplaces (mods)
// ---------------------------------------------------------------------------
/** Absolute dir a bundled marketplace is staged into. Example: bundledInstallPath(mod) → '/home/me/.claude/mods'. */
export function bundledInstallPath(plugin: PluginEntry): string {
  return expandHome(plugin.installPath ?? '');
}

async function installedCopyDiffers(src: string, dest: string): Promise<boolean> {
  const installed = await readBytes(dest);
  if (installed == null) return false;
  const bundled = await readBytes(src);
  return bundled == null || !bundled.equals(installed);
}

/** One staged file; a copy the user edited in place is kept unless --force. */
async function bundledStagingAction(src: string, dest: string): Promise<Action> {
  const label = `Bundled plugin file ${path.basename(src)}`;
  if (!isForce() && (await installedCopyDiffers(src, dest))) {
    return { kind: 'skip', label, reason: `${tildify(dest)} edited locally (use --force to replace)` };
  }
  return { kind: 'copy', label, src, dest };
}

async function bundledStagingTree(sourceDir: string, destDir: string): Promise<Action[]> {
  const entries = await fs.readdir(sourceDir, { withFileTypes: true });
  const actions: Action[] = [];
  for (const entry of entries) {
    const src = path.join(sourceDir, entry.name);
    const dest = path.join(destDir, entry.name);
    if (entry.isDirectory()) actions.push(...(await bundledStagingTree(src, dest)));
    else if (entry.isFile()) actions.push(await bundledStagingAction(src, dest));
  }
  return actions;
}

/** Stage a bundled marketplace before it is registered. Example: await buildBundledStagingActions(mod). */
export async function buildBundledStagingActions(plugin: PluginEntry): Promise<Action[]> {
  if (!plugin.bundled) return [];
  const sourceDir = assetPath(plugin.marketplace, plugin.assetsRoot);
  try {
    return await bundledStagingTree(sourceDir, bundledInstallPath(plugin));
  } catch (err) {
    const message = `Bundled marketplace missing at ${sourceDir} (expected a dir with .claude-plugin/marketplace.json): ${(err as Error).message}`;
    return [{ kind: 'note', level: 'warn', label: `Plugin ${plugin.id}`, message }];
  }
}

/** True when we can drive the `claude` CLI; otherwise the caller uses the fallback. */
export function claudeAvailable(): boolean {
  return commandOnPath('claude');
}

/**
 * Build the plugin actions for one agent. Empty array = use the Claude settings
 * fallback. `seenMarketplaces` (shared across one agent's plugins) keeps a
 * marketplace — the 4 mods share one — from being staged and added again.
 */
export async function buildPluginActions(
  agent: AgentInfo,
  plugin: PluginEntry,
  seenMarketplaces: Set<string> = new Set(),
): Promise<Action[]> {
  if (!agent.supports.plugins || !agent.pluginMethod) {
    return [{ kind: 'skip', label: `Plugins → ${agent.label}`, reason: 'agent has no plugin system' }];
  }
  const firstUse = !seenMarketplaces.has(marketplaceName(plugin));
  seenMarketplaces.add(marketplaceName(plugin));
  const staging = firstUse ? await buildBundledStagingActions(plugin) : [];
  switch (agent.pluginMethod) {
    case 'claude-cli':
      return [...staging, ...(await buildClaudePluginActions(plugin, firstUse, plugin.bundled))];
    case 'codex-toml':
      return [...staging, await buildCodexPluginAction(agent, plugin)];
  }
}

// ---------------------------------------------------------------------------
// Claude Code
// ---------------------------------------------------------------------------
/** What `claude plugin marketplace add` receives: the staged dir for bundled ones, else the repo. */
function claudeMarketplaceSource(plugin: PluginEntry): string {
  return plugin.bundled ? bundledInstallPath(plugin) : plugin.marketplace;
}

/**
 * Claude CLI actions. Without the CLI: [] (the caller falls back), except for a
 * bundled marketplace, whose settings fallback is returned here so its staged
 * files are never mistaken for "nothing to do".
 */
async function buildClaudePluginActions(plugin: PluginEntry, addMarketplace: boolean, bundled: boolean): Promise<Action[]> {
  if (!claudeAvailable()) return bundled ? [await buildPluginSettingsFallbackAction(plugin)] : [];

  const actions: Action[] = [];
  if (!plugin.builtin && addMarketplace) {
    const source = claudeMarketplaceSource(plugin);
    actions.push({
      kind: 'exec',
      label: `Marketplace ${plugin.bundled ? tildify(source) : source}`,
      cmd: 'claude',
      args: ['plugin', 'marketplace', 'add', source],
      timeout: 120_000,
      tolerant: true,
    });
  }
  const mp = marketplaceName(plugin);
  for (const name of plugin.install) {
    const ref = `${name}@${mp}`;
    actions.push({
      kind: 'exec',
      label: `Plugin ${ref}`,
      cmd: 'claude',
      args: ['plugin', 'install', ref, '--scope', 'user'],
      timeout: 120_000,
      tolerant: true,
    });
  }
  return actions;
}

/** settings.json `extraKnownMarketplaces` source: a directory for bundled packs, else GitHub. */
function settingsMarketplaceSource(plugin: PluginEntry): Record<string, string> {
  if (plugin.bundled) return { source: 'directory', path: bundledInstallPath(plugin) };
  return { source: 'github', repo: plugin.marketplace.replace(/\.git$/, '') };
}

/** Fallback: merge marketplace + enabled plugins into ~/.claude/settings.json. */
export async function buildPluginSettingsFallbackAction(plugin: PluginEntry): Promise<Action> {
  const file = expandHome('~/.claude/settings.json');
  const label = `Claude settings (plugins) → ${marketplaceName(plugin)}`;
  const before = await readText(file);
  let root: Record<string, unknown> = {};
  if (before && before.trim()) {
    try {
      const parsed: unknown = JSON.parse(before);
      if (isRecord(parsed)) root = parsed;
    } catch {
      return {
        kind: 'note',
        level: 'warn',
        label,
        message: `Could not parse ${tildify(file)}; configure the plugin manually.`,
      };
    }
  }

  const mpName = marketplaceName(plugin);

  if (!plugin.builtin) {
    const ekm = isRecord(root.extraKnownMarketplaces) ? { ...root.extraKnownMarketplaces } : {};
    ekm[mpName] = { source: settingsMarketplaceSource(plugin) };
    root.extraKnownMarketplaces = ekm;
  }

  const enabled = isRecord(root.enabledPlugins) ? { ...root.enabledPlugins } : {};
  for (const name of plugin.install) enabled[`${name}@${mpName}`] = true;
  root.enabledPlugins = enabled;

  const after = jsonStringify(root);
  if (before === after) return { kind: 'skip', label, reason: 'already in settings.json' };
  return { kind: 'file', label, path: file, before: before ?? null, after };
}

// ---------------------------------------------------------------------------
// Codex
// ---------------------------------------------------------------------------
function safeParseToml(text: string): Record<string, unknown> | null {
  try {
    return parseToml(text);
  } catch {
    return null;
  }
}

async function buildCodexPluginAction(agent: AgentInfo, plugin: PluginEntry): Promise<Action> {
  const file = userMcpFileAbs(agent);
  const mpName = marketplaceName(plugin);
  const label = `Plugins ${plugin.install.map((p) => `${p}@${mpName}`).join(', ')} → ${agent.label}`;
  if (!file) return { kind: 'skip', label, reason: 'no codex config path' };

  const before = await readText(file);
  const root = before && before.trim() ? safeParseToml(before) : {};
  if (root === null) {
    return {
      kind: 'note',
      level: 'warn',
      label,
      message: `Could not parse ${tildify(file)}; add [marketplaces.${mpName}] / [plugins] manually.`,
    };
  }

  const marketplaces = isRecord(root.marketplaces) ? root.marketplaces : {};
  const plugins = isRecord(root.plugins) ? root.plugins : {};

  const wantMarketplace = !plugin.builtin && !(mpName in marketplaces);
  const wantPlugins = plugin.install
    .map((p) => `${p}@${mpName}`)
    .filter((ref) => {
      const cur = plugins[ref];
      if (!isRecord(cur)) return true; // missing
      return isForce() && cur.enabled !== true; // present but disabled: only touch under --force
    });

  if (!wantMarketplace && wantPlugins.length === 0) {
    return { kind: 'skip', label, reason: `already in ${path.basename(file)}` };
  }

  const patch: Record<string, unknown> = {};
  if (wantMarketplace) {
    patch.marketplaces = { [mpName]: plugin.bundled
      ? { source_type: 'local', source: bundledInstallPath(plugin) }
      : { source_type: 'git', source: marketplaceGitUrl(plugin) } };
  }
  if (wantPlugins.length) {
    patch.plugins = Object.fromEntries(wantPlugins.map((ref) => [ref, { enabled: true }]));
  }

  // A plugin table that exists (disabled) can't be re-declared by appending;
  // under --force we rewrite the whole file instead.
  const mustRewrite = wantPlugins.some((ref) => isRecord(plugins[ref]));
  if (mustRewrite) {
    if (before?.includes('#')) {
      log.warn(`   rewriting ${tildify(file)} (TOML comments may be lost)`);
    }
    const next: Record<string, unknown> = { ...root };
    if (wantMarketplace) next.marketplaces = { ...marketplaces, ...(patch.marketplaces as object) };
    next.plugins = { ...plugins, ...(patch.plugins as object) };
    return { kind: 'file', label, path: file, before: before ?? null, after: stringifyToml(next) };
  }

  let block = stringifyToml(patch);
  block = block.replace(/^\[(marketplaces|plugins)\]\s*\n+/gm, ''); // drop bare parent headers
  const after =
    before == null || before.trim() === ''
      ? block
      : `${before}${before.endsWith('\n') ? '' : '\n'}\n${block}`;
  return { kind: 'file', label, path: file, before: before ?? null, after };
}
