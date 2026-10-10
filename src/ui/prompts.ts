/**
 * prompts — the interactive clack flow.
 *
 * The unified `init` menu has two groups — "Nesta máquina" (user-scope MCPs,
 * plugins, global skills, custom agents, presets) and "Neste repositório"
 * (CLAUDE.md, AGENTS.md, project skills, project .mcp.json). Values are
 * namespaced (`mcp:`, `plugin:`, `mskill:`, `magent:`, `preset:`, `integ:`,
 * `doc:*`, `pskill:`, `pagent:`, `projmcp`, `gitignore`) so nothing collides
 * when an MCP and a skill share an id, or a skill appears at both scopes.
 *
 * Items from a private overlay are tagged " · privado"; items this OS can't
 * use (Pencil's .exe on Linux) stay listed — so `--all` and flags behave the
 * same everywhere — but are dimmed and skipped at install time.
 */
import path from 'node:path';
import process from 'node:process';
import {
  cancel,
  confirm,
  groupMultiselect,
  intro,
  isCancel,
  multiselect,
  note,
  text,
} from '@clack/prompts';
import pc from 'picocolors';
import type { Selection } from '../commands/init';
import { DEFAULT_MEMORY_DEST, type ScaffoldPlan } from '../commands/scaffold';
import { type AgentInfo, detectInstalledAgentIds, getAgent } from '../core/agents';
import { defaultAiMemoryProject } from '../core/aimemory';
import { type Platform, currentPlatform, platformAllows } from '../core/platform';
import type {
  CatalogData,
  IntegrationEntry,
  McpEntry,
  PluginEntry,
  PresetEntry,
  SkillEntry,
  SubagentEntry,
} from '../core/catalog';

function toAgents(ids: string[]): AgentInfo[] {
  return ids.map(getAgent).filter((a): a is AgentInfo => Boolean(a));
}

function mcpHint(m: McpEntry): string {
  return m.agents ? `${m.transport} · ${m.agents.join('/')} only` : m.transport;
}

type GroupOption = { value: string; label: string; hint?: string };
type MenuEntry = { overlay?: string; platforms?: Platform[] };

/** Label with the private tag; dimmed when this OS can't use the item. */
function menuLabel(entry: MenuEntry, label: string): string {
  const tagged = entry.overlay ? `${label} · privado` : label;
  return platformAllows(entry.platforms) ? tagged : pc.dim(tagged);
}

/** Hint plus an "unavailable here" suffix for platform-restricted items. */
function menuHint(entry: MenuEntry, hint: string): string {
  return platformAllows(entry.platforms) ? hint : `${hint} · indisponível em ${currentPlatform()}`;
}

function integrationHint(i: IntegrationEntry): string {
  return `${Object.keys(i.agentNames).join('/')} · env ${i.requiredEnv.join(', ') || '—'}`;
}

function skillHint(s: SkillEntry, scope: string): string {
  const who = s.installer?.providers ? Object.keys(s.installer.providers) : s.agents;
  return who ? `${who.join('/')} · ${scope}` : scope;
}

function subagentHint(a: SubagentEntry, scope: string): string {
  return `${a.codex_file ? 'claude/codex' : 'claude only'} · ${scope}`;
}

function pluginHint(p: PluginEntry): string {
  return p.agents ? p.agents.join('/') : 'claude/codex';
}

function presetHint(p: PresetEntry): string {
  return p.agents ? p.agents.join('/') : 'all agents';
}

/** Two-group option set: "Nesta máquina" (global) and "Neste repositório". */
function buildUnifiedGroups(catalog: CatalogData): Record<string, GroupOption[]> {
  const groups: Record<string, GroupOption[]> = {};

  const machine: GroupOption[] = [];
  for (const m of catalog.mcps) machine.push({ value: `mcp:${m.id}`, label: menuLabel(m, m.label), hint: menuHint(m, mcpHint(m)) });
  for (const p of catalog.plugins) machine.push({ value: `plugin:${p.id}`, label: menuLabel(p, p.label ?? p.id), hint: pluginHint(p) });
  for (const s of catalog.skills) machine.push({ value: `mskill:${s.id}`, label: menuLabel(s, s.label ?? s.skill), hint: menuHint(s, skillHint(s, 'global')) });
  for (const a of catalog.subagents) machine.push({ value: `magent:${a.id}`, label: menuLabel(a, a.label ?? a.id), hint: subagentHint(a, 'global') });
  for (const p of catalog.presets) machine.push({ value: `preset:${p.id}`, label: menuLabel(p, p.label ?? p.id), hint: presetHint(p) });
  for (const i of catalog.integrations) machine.push({ value: `integ:${i.id}`, label: menuLabel(i, i.label ?? i.id), hint: menuHint(i, integrationHint(i)) });
  if (machine.length) groups['Nesta máquina (todos os projetos)'] = machine;

  const repo: GroupOption[] = [
    { value: 'doc:agents', label: 'AGENTS.md', hint: 'canônico · Codex / OpenCode' },
    { value: 'doc:claude', label: 'CLAUDE.md', hint: '@AGENTS.md import · Claude Code (inclui AGENTS.md)' },
    { value: 'doc:memory', label: 'Skill memory', hint: DEFAULT_MEMORY_DEST },
    { value: 'doc:aimemory', label: '.ai-memory.toml', hint: 'escopo do ai-memory (pede workspace)' },
  ];
  for (const s of catalog.skills) repo.push({ value: `pskill:${s.id}`, label: menuLabel(s, s.label ?? s.skill), hint: menuHint(s, skillHint(s, 'repo')) });
  for (const a of catalog.subagents) repo.push({ value: `pagent:${a.id}`, label: menuLabel(a, a.label ?? a.id), hint: subagentHint(a, 'repo') });
  if (catalog.mcps.length) repo.push({ value: 'projmcp', label: '.mcp.json + opencode.json', hint: 'as MCPs marcadas acima' });
  repo.push({ value: 'gitignore', label: 'Merge .gitignore', hint: 'agent caches' });
  groups[`Neste repositório (${path.basename(process.cwd())})`] = repo;

  return groups;
}

/** Pure: turn the namespaced menu values into a Selection (machine + optional repo). */
export function parseUnifiedSelection(
  catalog: CatalogData,
  agents: AgentInfo[],
  values: string[],
): Selection {
  const has = (v: string) => values.includes(v);
  const ids = (prefix: string) =>
    values.filter((v) => v.startsWith(prefix)).map((v) => v.slice(prefix.length));

  const mcps = catalog.mcps.filter((m) => ids('mcp:').includes(m.id));
  const repoSkillIds = ids('pskill:');
  const repoSubagentIds = ids('pagent:');
  const wantRepo =
    has('doc:claude') ||
    has('doc:agents') ||
    has('doc:memory') ||
    has('doc:aimemory') ||
    repoSkillIds.length > 0 ||
    repoSubagentIds.length > 0 ||
    has('projmcp');

  const repo: ScaffoldPlan | undefined = wantRepo
    ? {
        withClaudeMd: has('doc:claude'),
        withAgentsMd: has('doc:agents') || has('doc:claude'),
        withMemory: has('doc:memory'),
        withOpencode: has('projmcp'),
        withGitignore: has('gitignore'),
        withAiMemory: has('doc:aimemory'),
        mcps: has('projmcp') ? mcps : [],
        skills: catalog.skills.filter((s) => repoSkillIds.includes(s.id)),
        subagents: catalog.subagents.filter((a) => repoSubagentIds.includes(a.id)),
        memoryDest: DEFAULT_MEMORY_DEST,
      }
    : undefined;

  return {
    agents,
    mcps,
    skills: catalog.skills.filter((s) => ids('mskill:').includes(s.id)),
    plugins: catalog.plugins.filter((p) => ids('plugin:').includes(p.id)),
    subagents: catalog.subagents.filter((a) => ids('magent:').includes(a.id)),
    presets: catalog.presets.filter((p) => ids('preset:').includes(p.id)),
    integrations: catalog.integrations.filter((i) => ids('integ:').includes(i.id)),
    repo,
  };
}

function unifiedSummary(sel: Selection): string {
  const names = (arr: Array<{ id: string }>) => (arr.length ? arr.map((x) => x.id).join(', ') : pc.dim('none'));
  const lines = [
    `Agentes:  ${sel.agents.map((a) => a.label).join(', ')}`,
    `Máquina:  MCPs ${names(sel.mcps)} · skills ${names(sel.skills)} · plugins ${names(sel.plugins)}`,
    `          agentes custom ${names(sel.subagents)} · presets ${names(sel.presets)}`,
    `          integrações ${names(sel.integrations)}`,
  ];
  if (sel.repo) {
    const docs =
      [sel.repo.withClaudeMd && 'CLAUDE.md', sel.repo.withAgentsMd && 'AGENTS.md', sel.repo.withMemory && 'memory', sel.repo.withAiMemory && '.ai-memory.toml']
        .filter(Boolean)
        .join(', ') || pc.dim('none');
    lines.push(
      `Repo:     ${docs} · skills ${names(sel.repo.skills)} · agentes custom ${names(sel.repo.subagents)}${sel.repo.mcps.length ? ' · .mcp.json' : ''}`,
    );
  }
  return lines.join('\n');
}

export async function promptInitSelection(catalog: CatalogData): Promise<Selection | null> {
  intro(pc.bgCyan(pc.black(' agent-harness ')));

  const detected = new Set(detectInstalledAgentIds());
  const agentSel = await multiselect({
    message: 'Quais agentes configurar?',
    options: catalog.agents.map((id) => ({
      value: id,
      label: getAgent(id)?.label ?? id,
      hint: detected.has(id) ? 'detected' : undefined,
    })),
    initialValues: catalog.agents.filter((id) => detected.has(id)),
    required: true,
  });
  if (isCancel(agentSel)) return abort();
  const agents = toAgents(agentSel);

  const groups = buildUnifiedGroups(catalog);
  let chosen: string[] = [];
  if (Object.keys(groups).length) {
    const picked = await groupMultiselect({
      message: 'Marque o que instalar (espaço alterna, enter confirma):',
      options: groups,
      required: false,
      selectableGroups: false,
    });
    if (isCancel(picked)) return abort();
    chosen = picked;
  }

  const sel = parseUnifiedSelection(catalog, agents, chosen);
  if (sel.repo?.withAiMemory && !(await promptAiMemoryScope(sel.repo))) return abort();
  note(unifiedSummary(sel), 'Resumo');

  const ok = await confirm({ message: 'Prosseguir com a instalação?' });
  if (isCancel(ok) || !ok) return abort();
  return sel;
}

export async function promptScaffoldSelection(catalog: CatalogData): Promise<ScaffoldPlan | null> {
  intro(pc.bgCyan(pc.black(' agent-harness scaffold ')));

  const artifacts = await multiselect({
    message: 'What should I add to this repo?',
    options: [
      { value: 'agents-md', label: 'AGENTS.md', hint: 'canonical instructions (Codex / OpenCode)' },
      { value: 'claude-md', label: 'CLAUDE.md', hint: '@AGENTS.md import for Claude Code (brings AGENTS.md)' },
      { value: 'memory', label: 'Skill memory file', hint: DEFAULT_MEMORY_DEST },
      { value: 'ai-memory', label: '.ai-memory.toml', hint: 'ai-memory workspace/project + secret capture excludes' },
      { value: 'skills', label: 'Skills', hint: 'install into the repo (project-scoped)' },
      { value: 'agents', label: 'Custom agents', hint: 'custom Claude Code / Codex subagents (repo-scoped)' },
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
      options: catalog.mcps.map((m) => ({ value: m.id, label: menuLabel(m, m.label), hint: menuHint(m, mcpHint(m)) })),
      required: false,
    });
    if (isCancel(picked)) return abort();
    mcps = catalog.mcps.filter((m) => picked.includes(m.id));
  }

  let skills: SkillEntry[] = [];
  if (want('skills') && catalog.skills.length) {
    const picked = await multiselect({
      message: 'Which skills to install into the repo?',
      options: catalog.skills.map((s) => ({
        value: s.id,
        label: menuLabel(s, s.label ?? s.skill),
        hint: s.agents ? `${s.agents.join('/')} only` : undefined,
      })),
      required: false,
    });
    if (isCancel(picked)) return abort();
    skills = catalog.skills.filter((s) => picked.includes(s.id));
  }

  let subagents: SubagentEntry[] = [];
  if (want('agents') && catalog.subagents.length) {
    const picked = await multiselect({
      message: 'Which custom agents to install into the repo?',
      options: catalog.subagents.map((a) => ({ value: a.id, label: menuLabel(a, a.label ?? a.id), hint: subagentHint(a, 'repo') })),
      required: false,
    });
    if (isCancel(picked)) return abort();
    subagents = catalog.subagents.filter((a) => picked.includes(a.id));
  }

  const plan: ScaffoldPlan = {
    withClaudeMd: want('claude-md'),
    withAgentsMd: want('agents-md') || want('claude-md'),
    withMemory: want('memory'),
    withOpencode: want('opencode'),
    withGitignore: want('gitignore'),
    withAiMemory: want('ai-memory'),
    mcps,
    skills,
    subagents,
    memoryDest: DEFAULT_MEMORY_DEST,
  };

  note(
    [
      `Docs:     ${[plan.withClaudeMd && 'CLAUDE.md', plan.withAgentsMd && 'AGENTS.md', plan.withMemory && 'memory', plan.withAiMemory && '.ai-memory.toml'].filter(Boolean).join(', ') || pc.dim('none')}`,
      `Skills:   ${skills.length ? skills.map((s) => s.id).join(', ') : pc.dim('none')}`,
      `Agents:   ${subagents.length ? subagents.map((a) => a.id).join(', ') : pc.dim('none')}`,
      `MCPs:     ${mcps.length ? mcps.map((m) => m.id).join(', ') : pc.dim('none')}${plan.withOpencode ? pc.dim(' (+opencode.json)') : ''}`,
      `gitignore: ${plan.withGitignore ? 'merge' : pc.dim('skip')}`,
    ].join('\n'),
    'Summary',
  );

  if (plan.withAiMemory && !(await promptAiMemoryScope(plan))) return abort();
  const ok = await confirm({ message: 'Scaffold these into the current directory?' });
  if (isCancel(ok) || !ok) return abort();

  return plan;
}

/**
 * Ask for the ai-memory workspace/project of this repo (fills `plan`).
 * Returns false when the user cancels.
 */
async function promptAiMemoryScope(plan: ScaffoldPlan): Promise<boolean> {
  const workspace = await text({ message: 'ai-memory workspace (ex.: pessoal, nome do cliente):', placeholder: 'pessoal' });
  if (isCancel(workspace)) return false;
  const project = await text({ message: 'ai-memory project:', defaultValue: defaultAiMemoryProject(), placeholder: defaultAiMemoryProject() });
  if (isCancel(project)) return false;
  plan.aiMemoryWorkspace = workspace.trim() || undefined;
  plan.aiMemoryProject = project.trim() || undefined;
  return true;
}

function abort(): null {
  cancel('Cancelled — nothing was changed.');
  return null;
}
