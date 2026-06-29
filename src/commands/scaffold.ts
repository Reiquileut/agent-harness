/**
 * scaffold — repo-level: drop starter CLAUDE.md / AGENTS.md / memory, install
 * project-scoped skills, generate a project .mcp.json (and optionally
 * opencode.json), and merge .gitignore.
 *
 * Interactive by default; fully flag-drivable for CI (`-y`). Idempotent and
 * never clobbers existing files unless --force. Run it inside an existing repo
 * to add only the pieces you pick (e.g. just CLAUDE.md + AGENTS.md + skills).
 */
import process from 'node:process';
import pc from 'picocolors';
import { type Action, runActions } from '../core/actions';
import { AGENTS } from '../core/agents';
import {
  type CatalogData,
  type McpEntry,
  type SkillEntry,
  loadCatalog,
  mcpAppliesTo,
  skillAppliesTo,
} from '../core/catalog';
import { isDryRun, log } from '../core/fsx';
import { buildProjectMcpAction } from '../core/mcp';
import { buildLocalSkillCopyActions, buildSkillAction, isLocalSkill } from '../core/skills';
import { buildGitignoreMergeAction, buildTemplateCopyAction } from '../core/templates';
import { promptScaffoldSelection } from '../ui/prompts';

export const DEFAULT_MEMORY_DEST = '.claude/skills/memory/memory.md';

export interface ScaffoldOptions {
  mcp: string[];
  skill: string[];
  withClaudeMd: boolean;
  withAgentsMd: boolean;
  withMemory: boolean;
  withOpencode: boolean;
  gitignore: boolean; // commander: --no-gitignore => false
  memoryDest?: string;
  all: boolean;
  yes: boolean;
}

export interface ScaffoldPlan {
  withClaudeMd: boolean;
  withAgentsMd: boolean;
  withMemory: boolean;
  withOpencode: boolean;
  withGitignore: boolean;
  mcps: McpEntry[];
  skills: SkillEntry[];
  memoryDest: string;
}

function planFromFlags(catalog: CatalogData, opts: ScaffoldOptions): ScaffoldPlan {
  const memoryDest = opts.memoryDest ?? DEFAULT_MEMORY_DEST;
  if (opts.all) {
    return {
      withClaudeMd: true,
      withAgentsMd: true,
      withMemory: true,
      withOpencode: true,
      withGitignore: true,
      mcps: catalog.mcps,
      skills: catalog.skills,
      memoryDest,
    };
  }
  return {
    withClaudeMd: opts.withClaudeMd,
    withAgentsMd: opts.withAgentsMd,
    withMemory: opts.withMemory,
    withOpencode: opts.withOpencode,
    withGitignore: opts.gitignore,
    mcps: catalog.mcps.filter((m) => opts.mcp.includes(m.id)),
    skills: catalog.skills.filter((s) => opts.skill.includes(s.id)),
    memoryDest,
  };
}

function isInteractive(opts: ScaffoldOptions): boolean {
  if (opts.yes) return false;
  const explicit =
    opts.all ||
    opts.withClaudeMd ||
    opts.withAgentsMd ||
    opts.withMemory ||
    opts.withOpencode ||
    opts.mcp.length > 0 ||
    opts.skill.length > 0;
  if (explicit) return false;
  return Boolean(process.stdout.isTTY && process.stdin.isTTY);
}

function isEmptyPlan(p: ScaffoldPlan): boolean {
  return (
    !p.withClaudeMd &&
    !p.withAgentsMd &&
    !p.withMemory &&
    !p.withGitignore &&
    p.mcps.length === 0 &&
    p.skills.length === 0
  );
}

/** Project-scoped skill installs, one per (skill × applicable agent). */
async function skillActions(skills: SkillEntry[]): Promise<Action[]> {
  const actions: Action[] = [];
  for (const skill of skills) {
    for (const agent of AGENTS) {
      if (!agent.supports.skills || !skillAppliesTo(skill, agent.id)) continue;
      if (isLocalSkill(skill)) {
        actions.push(...(await buildLocalSkillCopyActions(agent, skill, 'project')));
      } else {
        actions.push(buildSkillAction(agent, skill, 'project'));
      }
    }
  }
  return actions;
}

/**
 * Build every repo-level action for a plan (docs, project skills, project MCP
 * files, .gitignore merge). Shared by `scaffold` and the unified `init` flow.
 */
export async function buildScaffoldActions(
  catalog: CatalogData,
  plan: ScaffoldPlan,
): Promise<Action[]> {
  const actions: Action[] = [];
  if (plan.withClaudeMd) {
    actions.push(await buildTemplateCopyAction(catalog.templates.claude_md, 'CLAUDE.md', 'CLAUDE.md'));
  }
  if (plan.withAgentsMd) {
    actions.push(await buildTemplateCopyAction(catalog.templates.agents_md, 'AGENTS.md', 'AGENTS.md'));
  }
  if (plan.withMemory) {
    actions.push(
      await buildTemplateCopyAction(catalog.templates.memory, plan.memoryDest, `memory → ${plan.memoryDest}`),
    );
  }
  if (plan.skills.length) {
    actions.push(...(await skillActions(plan.skills)));
  }
  if (plan.mcps.length) {
    const claudeMcps = plan.mcps.filter((m) => mcpAppliesTo(m, 'claude-code'));
    if (claudeMcps.length) {
      actions.push(await buildProjectMcpAction(claudeMcps, { file: '.mcp.json', format: 'claude' }));
    }
    if (plan.withOpencode) {
      const opencodeMcps = plan.mcps.filter((m) => mcpAppliesTo(m, 'opencode'));
      if (opencodeMcps.length) {
        actions.push(await buildProjectMcpAction(opencodeMcps, { file: 'opencode.json', format: 'opencode' }));
      }
    }
  }
  if (plan.withGitignore) {
    actions.push(await buildGitignoreMergeAction(catalog.gitignore));
  }
  return actions;
}

export async function runScaffoldCommand(opts: ScaffoldOptions): Promise<void> {
  const catalog = await loadCatalog();

  const plan = isInteractive(opts)
    ? await promptScaffoldSelection(catalog)
    : planFromFlags(catalog, opts);

  if (!plan) {
    log.warn('Nothing selected — aborting.');
    return;
  }
  if (isEmptyPlan(plan)) {
    log.warn(
      'Nothing to scaffold. Pass --with-claude-md / --with-agents-md / --with-memory / --skill <id> / --mcp <id> / --all.',
    );
    return;
  }

  const actions = await buildScaffoldActions(catalog, plan);

  log.plain('');
  log.info(`${isDryRun() ? pc.yellow('Dry run — ') : ''}Scaffolding ${pc.bold(process.cwd())}`);
  log.plain('');
  await runActions(actions);

  log.plain('');
  log.success(isDryRun() ? 'Dry run complete — nothing written.' : 'Scaffold complete.');
  log.plain(pc.dim('  CLAUDE.md → Claude Code · AGENTS.md → Codex & OpenCode · skills → project skill dirs.'));
}
