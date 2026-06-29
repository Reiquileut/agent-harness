/**
 * prompts — the interactive clack flow for `init` (and the scaffold helper).
 *
 * Values are namespaced (`mcp:`, `skill:`, `plugin:`) so the grouped multiselect
 * never collides when an MCP and a skill share an id (e.g. "obsidian-cli").
 */
import {
  cancel,
  confirm,
  groupMultiselect,
  intro,
  isCancel,
  multiselect,
  note,
} from '@clack/prompts';
import pc from 'picocolors';
import type { Selection } from '../commands/init';
import { DEFAULT_MEMORY_DEST, type ScaffoldPlan } from '../commands/scaffold';
import { type AgentInfo, detectInstalledAgentIds, getAgent } from '../core/agents';
import type { CatalogData, McpEntry } from '../core/catalog';

function toAgents(ids: string[]): AgentInfo[] {
  return ids.map(getAgent).filter((a): a is AgentInfo => Boolean(a));
}

function mcpHint(m: McpEntry): string {
  return m.agents ? `${m.transport} · ${m.agents.join('/')} only` : m.transport;
}

export async function promptInitSelection(catalog: CatalogData): Promise<Selection | null> {
  intro(pc.bgCyan(pc.black(' agent-harness ')));

  const detected = new Set(detectInstalledAgentIds());
  const agentOptions = catalog.agents.map((id) => {
    const a = getAgent(id);
    return {
      value: id,
      label: a?.label ?? id,
      hint: detected.has(id) ? 'detected' : undefined,
    };
  });

  const agentSel = await multiselect({
    message: 'Which agents do you want to configure?',
    options: agentOptions,
    initialValues: catalog.agents.filter((id) => detected.has(id)),
    required: true,
  });
  if (isCancel(agentSel)) return abort();

  // Grouped catalog items
  const options: Record<string, Array<{ value: string; label: string; hint?: string }>> = {};
  if (catalog.mcps.length) {
    options['MCP servers'] = catalog.mcps.map((m) => ({
      value: `mcp:${m.id}`,
      label: m.label,
      hint: mcpHint(m),
    }));
  }
  if (catalog.skills.length) {
    options['Skills'] = catalog.skills.map((s) => ({
      value: `skill:${s.id}`,
      label: s.label ?? s.skill,
      hint: s.agents ? `${s.agents.join('/')} only` : undefined,
    }));
  }
  if (catalog.plugins.length) {
    options['Plugins'] = catalog.plugins.map((p) => ({
      value: `plugin:${p.id}`,
      label: p.label ?? p.id,
      hint: p.agent,
    }));
  }

  let chosen: string[] = [];
  if (Object.keys(options).length) {
    const picked = await groupMultiselect({
      message: 'Select items to install (space to toggle, enter to confirm):',
      options,
      required: false,
      selectableGroups: true,
    });
    if (isCancel(picked)) return abort();
    chosen = picked;
  }

  const has = (prefix: string) => chosen.filter((v) => v.startsWith(prefix)).map((v) => v.slice(prefix.length));
  const mcpIds = has('mcp:');
  const skillIds = has('skill:');
  const pluginIds = has('plugin:');

  const agents = toAgents(agentSel);
  note(
    [
      `Agents:  ${agents.map((a) => a.label).join(', ')}`,
      `MCPs:    ${mcpIds.length ? mcpIds.join(', ') : pc.dim('none')}`,
      `Skills:  ${skillIds.length ? skillIds.join(', ') : pc.dim('none')}`,
      `Plugins: ${pluginIds.length ? pluginIds.join(', ') : pc.dim('none')}`,
    ].join('\n'),
    'Summary',
  );

  const ok = await confirm({ message: 'Proceed with installation?' });
  if (isCancel(ok) || !ok) return abort();

  return {
    agents,
    mcps: catalog.mcps.filter((m) => mcpIds.includes(m.id)),
    skills: catalog.skills.filter((s) => skillIds.includes(s.id)),
    plugins: catalog.plugins.filter((p) => pluginIds.includes(p.id)),
  };
}

export async function promptScaffoldSelection(catalog: CatalogData): Promise<ScaffoldPlan | null> {
  intro(pc.bgCyan(pc.black(' agent-harness scaffold ')));

  const artifacts = await multiselect({
    message: 'What should I add to this repo?',
    options: [
      { value: 'claude-md', label: 'CLAUDE.md', hint: 'Claude Code instructions' },
      { value: 'agents-md', label: 'AGENTS.md', hint: 'Codex / OpenCode instructions' },
      { value: 'memory', label: 'Skill memory file', hint: DEFAULT_MEMORY_DEST },
      { value: 'mcp', label: 'Project .mcp.json', hint: 'Claude project MCPs' },
      { value: 'opencode', label: 'Project opencode.json', hint: 'OpenCode project MCPs' },
      { value: 'gitignore', label: 'Merge .gitignore', hint: 'agent caches' },
    ],
    initialValues: ['claude-md', 'agents-md', 'gitignore'],
    required: false,
  });
  if (isCancel(artifacts)) return abort();

  const want = (v: string) => artifacts.includes(v);

  let mcps: McpEntry[] = [];
  if ((want('mcp') || want('opencode')) && catalog.mcps.length) {
    const picked = await multiselect({
      message: 'Which MCPs for the project config?',
      options: catalog.mcps.map((m) => ({ value: m.id, label: m.label, hint: mcpHint(m) })),
      required: false,
    });
    if (isCancel(picked)) return abort();
    mcps = catalog.mcps.filter((m) => picked.includes(m.id));
  }

  const plan: ScaffoldPlan = {
    withClaudeMd: want('claude-md'),
    withAgentsMd: want('agents-md'),
    withMemory: want('memory'),
    withOpencode: want('opencode'),
    withGitignore: want('gitignore'),
    mcps,
    memoryDest: DEFAULT_MEMORY_DEST,
  };

  note(
    [
      `Docs:     ${[plan.withClaudeMd && 'CLAUDE.md', plan.withAgentsMd && 'AGENTS.md', plan.withMemory && 'memory'].filter(Boolean).join(', ') || pc.dim('none')}`,
      `MCPs:     ${mcps.length ? mcps.map((m) => m.id).join(', ') : pc.dim('none')}${plan.withOpencode ? pc.dim(' (+opencode.json)') : ''}`,
      `gitignore: ${plan.withGitignore ? 'merge' : pc.dim('skip')}`,
    ].join('\n'),
    'Summary',
  );

  const ok = await confirm({ message: 'Scaffold these into the current directory?' });
  if (isCancel(ok) || !ok) return abort();

  return plan;
}

function abort(): null {
  cancel('Cancelled — nothing was changed.');
  return null;
}
