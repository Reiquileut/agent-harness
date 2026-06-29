/**
 * init — machine-level: configure selected agents with user-scope MCPs, skills,
 * and plugins, then print the (manual) login block.
 *
 * This module owns selection resolution + execution + the auth block. The
 * interactive clack flow lives in ui/prompts.ts and feeds resolved ids here.
 */
import process from 'node:process';
import pc from 'picocolors';
import { runAction, runActions } from '../core/actions';
import {
  AGENTS,
  type AgentInfo,
  detectInstalledAgentIds,
  getAgent,
} from '../core/agents';
import {
  type CatalogData,
  type McpEntry,
  type PluginEntry,
  type SkillEntry,
  loadCatalog,
  looksLikePlaceholder,
} from '../core/catalog';
import { isDryRun, log } from '../core/fsx';
import {
  buildPluginActions,
  buildPluginSettingsFallbackAction,
} from '../core/plugins';
import { buildUserMcpAction, requiredEnvVars } from '../core/mcp';
import {
  buildLocalSkillCopyActions,
  buildSkillAction,
  hasLocalSkill,
  isLocalSkill,
} from '../core/skills';
import { promptInitSelection } from '../ui/prompts';

export interface InitOptions {
  agent: string[];
  mcp: string[];
  skill: string[];
  plugin: string[];
  all: boolean;
  yes: boolean;
}

export interface Selection {
  agents: AgentInfo[];
  mcps: McpEntry[];
  skills: SkillEntry[];
  plugins: PluginEntry[];
}

/** Resolve a selection purely from flags (non-interactive). */
function selectionFromFlags(catalog: CatalogData, opts: InitOptions): Selection {
  const agentIds = opts.agent.length
    ? opts.agent
    : opts.all
      ? catalog.agents
      : detectInstalledAgentIds();

  const agents = uniqueAgents(agentIds);
  const pick = <T extends { id: string }>(all: T[], ids: string[]): T[] =>
    opts.all ? all : all.filter((x) => ids.includes(x.id));

  return {
    agents,
    mcps: pick(catalog.mcps, opts.mcp),
    skills: pick(catalog.skills, opts.skill),
    plugins: pick(catalog.plugins, opts.plugin),
  };
}

function uniqueAgents(ids: string[]): AgentInfo[] {
  const seen = new Set<string>();
  const out: AgentInfo[] = [];
  for (const id of ids) {
    if (seen.has(id)) continue;
    seen.add(id);
    const a = getAgent(id);
    if (a) out.push(a);
    else log.warn(`Unknown agent "${id}" — skipping (known: ${AGENTS.map((x) => x.id).join(', ')})`);
  }
  return out;
}

/** True when we should drive the interactive menu. */
function isInteractive(opts: InitOptions): boolean {
  if (opts.yes) return false;
  const explicit =
    opts.all ||
    opts.agent.length > 0 ||
    opts.mcp.length > 0 ||
    opts.skill.length > 0 ||
    opts.plugin.length > 0;
  if (explicit) return false;
  return Boolean(process.stdout.isTTY && process.stdin.isTTY);
}

export async function runInitCommand(opts: InitOptions): Promise<void> {
  const catalog = await loadCatalog();

  const selection = isInteractive(opts)
    ? await promptInitSelection(catalog)
    : selectionFromFlags(catalog, opts);

  if (!selection) {
    log.warn('Nothing selected — aborting.');
    return;
  }

  if (selection.agents.length === 0) {
    log.warn('No agents selected or detected. Pass --agent <id> or install an agent first.');
    return;
  }

  warnPlaceholders(selection);

  log.plain('');
  log.info(
    `${isDryRun() ? pc.yellow('Dry run — ') : ''}Configuring ${selection.agents
      .map((a) => pc.bold(a.label))
      .join(', ')}`,
  );

  for (const agent of selection.agents) {
    log.plain('');
    log.step(pc.bold(agent.label));
    await configureAgent(agent, selection);
  }

  printAuthBlock(selection);
}

async function configureAgent(agent: AgentInfo, sel: Selection): Promise<void> {
  // MCPs
  if (agent.supports.mcp) {
    for (const m of sel.mcps) {
      await runAction(await buildUserMcpAction(agent, m));
    }
  } else if (sel.mcps.length) {
    log.plain(`   ${pc.dim('· skip MCPs — unsupported')}`);
  }

  // Skills (delegate to npx skills; direct-copy fallback on failure)
  if (agent.supports.skills) {
    for (const s of sel.skills) {
      if (isLocalSkill(s)) {
        await runActions(await buildLocalSkillCopyActions(agent, s, 'user'));
        continue;
      }
      const res = await runAction(buildSkillAction(agent, s, 'user'));
      if (res.status === 'failed' && hasLocalSkill(s)) {
        log.plain(`   ${pc.dim('· trying local fallback…')}`);
        await runActions(await buildLocalSkillCopyActions(agent, s, 'user'));
      }
    }
  } else if (sel.skills.length) {
    log.plain(`   ${pc.dim('· skip skills — unsupported')}`);
  }

  // Plugins (Claude only)
  if (agent.supports.plugins) {
    const forThisAgent = sel.plugins.filter((p) => p.agent === agent.id);
    for (const p of forThisAgent) {
      const actions = buildPluginActions(agent, p);
      if (actions.length === 0) {
        // claude CLI not on PATH -> settings fallback
        await runAction(await buildPluginSettingsFallbackAction(p));
      } else {
        await runActions(actions);
      }
    }
  } else if (sel.plugins.some((p) => p.agent === agent.id)) {
    log.plain(`   ${pc.dim('· skip plugins — unsupported')}`);
  }
}

function warnPlaceholders(sel: Selection): void {
  const offenders: string[] = [];
  for (const m of sel.mcps) {
    if (m.transport === 'stdio' && m.args.some(looksLikePlaceholder)) offenders.push(`mcp:${m.id}`);
  }
  for (const s of sel.skills) {
    if (looksLikePlaceholder(s.source) || looksLikePlaceholder(s.skill)) offenders.push(`skill:${s.id}`);
  }
  for (const p of sel.plugins) {
    if (looksLikePlaceholder(p.marketplace) || p.install.some(looksLikePlaceholder))
      offenders.push(`plugin:${p.id}`);
  }
  if (offenders.length) {
    log.warn(
      `Catalog placeholders detected (${offenders.join(', ')}). Edit assets/catalog.json with real values.`,
    );
  }
}

function printAuthBlock(sel: Selection): void {
  log.plain('');
  log.plain(pc.bold(isDryRun() ? '— Auth block (preview) —' : '✅ Installed. Run these logins once:'));
  log.plain('');
  const width = Math.max(...sel.agents.map((a) => a.label.length), 0);
  for (const a of sel.agents) {
    const note = a.login.note ? pc.dim(`  (${a.login.note})`) : '';
    log.plain(`  ${a.label.padEnd(width)}  →  ${pc.cyan(a.login.cmd)}${note}`);
  }
  log.plain('');
  log.plain(pc.dim('  MCPs with OAuth (Notion, Google…) authenticate on first tool use.'));
  const envs = requiredEnvVars(sel.mcps);
  if (envs.length) {
    log.plain(pc.dim(`  MCPs needing API keys — export in your shell/.env: ${envs.join(', ')}`));
  }
  log.plain('');
}
