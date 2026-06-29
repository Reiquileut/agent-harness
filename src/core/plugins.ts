/**
 * plugins — Claude Code marketplaces + plugins.
 *
 * Primary path uses the `claude` CLI (marketplace add + plugin install). These
 * execs are marked tolerant so "already added/installed" is treated as benign,
 * which keeps re-runs idempotent without brittle list-parsing.
 *
 * Fallback (no `claude` on PATH): write extraKnownMarketplaces + enabledPlugins
 * into ~/.claude/settings.json. The exact schema is verified-ish (issue #15524)
 * — prefer the CLI; this is a best-effort backup.
 */
import type { Action } from './actions';
import type { AgentInfo } from './agents';
import { commandOnPath } from './agents';
import type { PluginEntry } from './catalog';
import { expandHome, isRecord, jsonStringify, readText, tildify } from './fsx';

/** The marketplace's declared name (install ref `<plugin>@<name>`). */
export function marketplaceName(plugin: PluginEntry): string {
  if (plugin.name) return plugin.name;
  const seg = plugin.marketplace.split('/').pop() ?? plugin.marketplace;
  return seg.replace(/\.git$/, '');
}

/** True when we can drive the `claude` CLI; otherwise the caller uses the fallback. */
export function claudeAvailable(): boolean {
  return commandOnPath('claude');
}

/** Primary actions via the `claude` CLI. Empty array when `claude` isn't on PATH. */
export function buildPluginActions(agent: AgentInfo, plugin: PluginEntry): Action[] {
  if (!agent.supports.plugins) {
    return [{ kind: 'skip', label: `Plugins → ${agent.label}`, reason: 'agent has no plugin system' }];
  }
  if (!claudeAvailable()) return [];

  const actions: Action[] = [
    {
      kind: 'exec',
      label: `Marketplace ${plugin.marketplace}`,
      cmd: 'claude',
      args: ['plugin', 'marketplace', 'add', plugin.marketplace],
      timeout: 120_000,
      tolerant: true,
    },
  ];
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
  const repo = plugin.marketplace.replace(/\.git$/, '');

  const ekm = isRecord(root.extraKnownMarketplaces) ? { ...root.extraKnownMarketplaces } : {};
  ekm[mpName] = { source: { source: 'github', repo } };
  root.extraKnownMarketplaces = ekm;

  const enabled = isRecord(root.enabledPlugins) ? { ...root.enabledPlugins } : {};
  for (const name of plugin.install) enabled[`${name}@${mpName}`] = true;
  root.enabledPlugins = enabled;

  return { kind: 'file', label, path: file, before: before ?? null, after: jsonStringify(root) };
}
