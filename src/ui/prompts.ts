/**
 * prompts — the interactive clack flow.
 *
 * The unified `init` menu has two groups — "Nesta máquina" (user-scope MCPs,
 * global skills, plugins) and "Neste repositório" (CLAUDE.md, AGENTS.md, project
 * skills, project .mcp.json). Values are namespaced (`mcp:`, `mskill:`,
 * `plugin:`, `doc:*`, `pskill:`, `projmcp`, `gitignore`) so nothing collides when
 * an MCP and a skill share an id, or a skill appears at both scopes.
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
} from '@clack/prompts';
import pc from 'picocolors';
import type { Selection } from '../commands/init';
import { DEFAULT_MEMORY_DEST, type ScaffoldPlan } from '../commands/scaffold';
import { type AgentInfo, detectInstalledAgentIds, getAgent } from '../core/agents';
import type { CatalogData, McpEntry, SkillEntry } from '../core/catalog';

function toAgents(ids: string[]): AgentInfo[] {
  return ids.map(getAgent).filter((a): a is AgentInfo => Boolean(a));
}

function mcpHint(m: McpEntry): string {
  return m.agents ? `${m.transport} · ${m.agents.join('/')} only` : m.transport;
}

type GroupOption = { value: string; label: string; hint?: string };

function skillHint(s: SkillEntry, scope: string): string {
  return s.agents ? `${s.agents.join('/')} · ${scope}` : scope;
}

/** Two-group option set: "Nesta máquina" (global) and "Neste repositório". */
function buildUnifiedGroups(catalog: CatalogData): Record<string, GroupOption[]> {
  const groups: Record<string, GroupOption[]> = {};

  const machine: GroupOption[] = [];
  for (const m of catalog.mcps) machine.push({ value: `mcp:${m.id}`, label: m.label, hint: mcpHint(m) });
  for (const p of catalog.plugins) machine.push({ value: `plugin:${p.id}`, label: p.label ?? p.id, hint: p.agent });
  for (const s of catalog.skills) machine.push({ value: `mskill:${s.id}`, label: s.label ?? s.skill, hint: skillHint(s, 'global') });
  if (machine.length) groups['Nesta máquina (todos os projetos)'] = machine;

  const repo: GroupOption[] = [
    { value: 'doc:claude', label: 'CLAUDE.md', hint: 'Claude Code' },
    { value: 'doc:agents', label: 'AGENTS.md', hint: 'Codex / OpenCode' },
    { value: 'doc:memory', label: 'Skill memory', hint: DEFAULT_MEMORY_DEST },
  ];
  for (const s of catalog.skills) repo.push({ value: `pskill:${s.id}`, label: s.label ?? s.skill, hint: skillHint(s, 'repo') });
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
  const wantRepo =
    has('doc:claude') || has('doc:agents') || has('doc:memory') || repoSkillIds.length > 0 || has('projmcp');

  const repo: ScaffoldPlan | undefined = wantRepo
    ? {
        withClaudeMd: has('doc:claude'),
        withAgentsMd: has('doc:agents'),
        withMemory: has('doc:memory'),
        withOpencode: has('projmcp'),
        withGitignore: has('gitignore'),
        mcps: has('projmcp') ? mcps : [],
        skills: catalog.skills.filter((s) => repoSkillIds.includes(s.id)),
        memoryDest: DEFAULT_MEMORY_DEST,
      }
    : undefined;

  return {
    agents,
    mcps,
    skills: catalog.skills.filter((s) => ids('mskill:').includes(s.id)),
    plugins: catalog.plugins.filter((p) => ids('plugin:').includes(p.id)),
    repo,
  };
}

function unifiedSummary(sel: Selection): string {
  const names = (arr: Array<{ id: string }>) => (arr.length ? arr.map((x) => x.id).join(', ') : pc.dim('none'));
  const lines = [
    `Agentes:  ${sel.agents.map((a) => a.label).join(', ')}`,
    `Máquina:  MCPs ${names(sel.mcps)} · skills ${names(sel.skills)} · plugins ${names(sel.plugins)}`,
  ];
  if (sel.repo) {
    const docs =
      [sel.repo.withClaudeMd && 'CLAUDE.md', sel.repo.withAgentsMd && 'AGENTS.md', sel.repo.withMemory && 'memory']
        .filter(Boolean)
        .join(', ') || pc.dim('none');
    lines.push(`Repo:     ${docs} · skills ${names(sel.repo.skills)}${sel.repo.mcps.length ? ' · .mcp.json' : ''}`);
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
      { value: 'claude-md', label: 'CLAUDE.md', hint: 'Claude Code instructions' },
      { value: 'agents-md', label: 'AGENTS.md', hint: 'Codex / OpenCode instructions' },
      { value: 'memory', label: 'Skill memory file', hint: DEFAULT_MEMORY_DEST },
      { value: 'skills', label: 'Skills', hint: 'install into the repo (project-scoped)' },
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

  let skills: SkillEntry[] = [];
  if (want('skills') && catalog.skills.length) {
    const picked = await multiselect({
      message: 'Which skills to install into the repo?',
      options: catalog.skills.map((s) => ({
        value: s.id,
        label: s.label ?? s.skill,
        hint: s.agents ? `${s.agents.join('/')} only` : undefined,
      })),
      required: false,
    });
    if (isCancel(picked)) return abort();
    skills = catalog.skills.filter((s) => picked.includes(s.id));
  }

  const plan: ScaffoldPlan = {
    withClaudeMd: want('claude-md'),
    withAgentsMd: want('agents-md'),
    withMemory: want('memory'),
    withOpencode: want('opencode'),
    withGitignore: want('gitignore'),
    mcps,
    skills,
    memoryDest: DEFAULT_MEMORY_DEST,
  };

  note(
    [
      `Docs:     ${[plan.withClaudeMd && 'CLAUDE.md', plan.withAgentsMd && 'AGENTS.md', plan.withMemory && 'memory'].filter(Boolean).join(', ') || pc.dim('none')}`,
      `Skills:   ${skills.length ? skills.map((s) => s.id).join(', ') : pc.dim('none')}`,
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
