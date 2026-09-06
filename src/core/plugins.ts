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
 */
import path from 'node:path';
import type { Action } from './actions';
import type { AgentInfo } from './agents';
import { commandOnPath, userMcpFileAbs } from './agents';
import type { PluginEntry } from './catalog';
import {
  expandHome,
  isForce,
  isRecord,
  jsonStringify,
  log,
  parseToml,
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

/** True when we can drive the `claude` CLI; otherwise the caller uses the fallback. */
export function claudeAvailable(): boolean {
  return commandOnPath('claude');
}

/** Build the plugin actions for one agent. Empty array = use the Claude settings fallback. */
export async function buildPluginActions(agent: AgentInfo, plugin: PluginEntry): Promise<Action[]> {
  if (!agent.supports.plugins || !agent.pluginMethod) {
    return [{ kind: 'skip', label: `Plugins → ${agent.label}`, reason: 'agent has no plugin system' }];
  }
  switch (agent.pluginMethod) {
    case 'claude-cli':
      return buildClaudePluginActions(plugin);
    case 'codex-toml':
      return [await buildCodexPluginAction(agent, plugin)];
  }
}

// ---------------------------------------------------------------------------
// Claude Code
// ---------------------------------------------------------------------------
function buildClaudePluginActions(plugin: PluginEntry): Action[] {
  if (!claudeAvailable()) return [];

  const actions: Action[] = [];
  if (!plugin.builtin) {
    actions.push({
      kind: 'exec',
      label: `Marketplace ${plugin.marketplace}`,
      cmd: 'claude',
      args: ['plugin', 'marketplace', 'add', plugin.marketplace],
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
    const repo = plugin.marketplace.replace(/\.git$/, '');
    const ekm = isRecord(root.extraKnownMarketplaces) ? { ...root.extraKnownMarketplaces } : {};
    ekm[mpName] = { source: { source: 'github', repo } };
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
    patch.marketplaces = { [mpName]: { source_type: 'git', source: marketplaceGitUrl(plugin) } };
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
