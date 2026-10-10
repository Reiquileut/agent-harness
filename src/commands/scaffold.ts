/**
 * scaffold — repo-level: drop starter AGENTS.md / CLAUDE.md / memory, install
 * project-scoped skills, generate a project .mcp.json (and optionally
 * opencode.json), write an `.ai-memory.toml` marker, and merge .gitignore.
 *
 * AGENTS.md is the canonical instructions file (Codex/OpenCode read it
 * directly); CLAUDE.md is a stub whose first line is `@AGENTS.md`, because
 * Claude Code does not read AGENTS.md when a CLAUDE.md exists. So asking for
 * CLAUDE.md always brings AGENTS.md along — a stub importing a missing file
 * would be a silent no-op.
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
  type SubagentEntry,
  mcpAppliesTo,
  skillAppliesTo,
} from '../core/catalog';
import { isDryRun, log } from '../core/fsx';
import { buildProjectMcpAction } from '../core/mcp';
import { buildAiMemoryTomlAction } from '../core/aimemory';
import { loadCatalogWithOverlays } from '../core/overlay';
import {
  buildInstallerSkillAction,
  buildLocalSkillCopyActions,
  buildSkillAction,
  hasInstaller,
  isLocalSkill,
} from '../core/skills';
import { buildSubagentCopyAction, hasSubagentFor } from '../core/subagents';
import { buildGitignoreMergeAction, buildTemplateCopyAction } from '../core/templates';
import { promptScaffoldSelection } from '../ui/prompts';

export const DEFAULT_MEMORY_DEST = '.claude/skills/memory/memory.md';

export interface ScaffoldOptions {
  mcp: string[];
  skill: string[];
  subagent: string[];
  withClaudeMd: boolean;
  withAgentsMd: boolean;
  withMemory: boolean;
  withOpencode: boolean;
  /** Write .ai-memory.toml (needs aiMemoryWorkspace). */
  withAiMemory: boolean;
  aiMemoryWorkspace?: string;
  aiMemoryProject?: string;
  gitignore: boolean; // commander: --no-gitignore => false
  memoryDest?: string;
  /** Private overlay catalogs (dirs or git URLs); AGENT_HARNESS_OVERLAY adds more. */
  overlay: string[];
  all: boolean;
  yes: boolean;
}

export interface ScaffoldPlan {
  withClaudeMd: boolean;
  withAgentsMd: boolean;
  withMemory: boolean;
  withOpencode: boolean;
  withGitignore: boolean;
  withAiMemory: boolean;
  aiMemoryWorkspace?: string;
  aiMemoryProject?: string;
  mcps: McpEntry[];
  skills: SkillEntry[];
  subagents: SubagentEntry[];
  memoryDest: string;
}

function planFromFlags(catalog: CatalogData, opts: ScaffoldOptions): ScaffoldPlan {
  const aiMemory = { aiMemoryWorkspace: opts.aiMemoryWorkspace, aiMemoryProject: opts.aiMemoryProject };
  const memoryDest = opts.memoryDest ?? DEFAULT_MEMORY_DEST;
  if (opts.all) {
    return {
      withClaudeMd: true,
      withAgentsMd: true,
      withMemory: true,
      withOpencode: true,
      withGitignore: true,
      withAiMemory: true,
      ...aiMemory,
      mcps: catalog.mcps,
      skills: catalog.skills,
      subagents: catalog.subagents,
      memoryDest,
    };
  }
  return {
    withClaudeMd: opts.withClaudeMd,
    withAgentsMd: opts.withAgentsMd || opts.withClaudeMd,
    withMemory: opts.withMemory,
    withOpencode: opts.withOpencode,
    withGitignore: opts.gitignore,
    withAiMemory: opts.withAiMemory,
    ...aiMemory,
    mcps: catalog.mcps.filter((m) => opts.mcp.includes(m.id)),
    skills: catalog.skills.filter((s) => opts.skill.includes(s.id)),
    subagents: catalog.subagents.filter((s) => opts.subagent.includes(s.id)),
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
    opts.withAiMemory ||
    opts.mcp.length > 0 ||
    opts.skill.length > 0 ||
    opts.subagent.length > 0;
  if (explicit) return false;
  return Boolean(process.stdout.isTTY && process.stdin.isTTY);
}

function isEmptyPlan(p: ScaffoldPlan): boolean {
  return (
    !p.withClaudeMd &&
    !p.withAgentsMd &&
    !p.withMemory &&
    !p.withGitignore &&
    !p.withAiMemory &&
    p.mcps.length === 0 &&
    p.skills.length === 0 &&
    p.subagents.length === 0
  );
}

/** Project-scoped skill installs, one per (skill × applicable agent); installer skills once. */
async function skillActions(skills: SkillEntry[]): Promise<Action[]> {
  const actions: Action[] = [];
  for (const skill of skills) {
    if (hasInstaller(skill)) {
      actions.push(buildInstallerSkillAction(AGENTS, skill, 'project'));
      continue;
    }
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

/** Project-scoped custom subagent installs, one per (subagent × agent with a matching variant). */
async function subagentActions(subagents: SubagentEntry[]): Promise<Action[]> {
  const actions: Action[] = [];
  for (const entry of subagents) {
    for (const agent of AGENTS) {
      if (!agent.supports.subagents || !hasSubagentFor(entry, agent)) continue;
      actions.push(await buildSubagentCopyAction(agent, entry, 'project'));
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
  if (plan.withAgentsMd || plan.withClaudeMd) {
    actions.push(await buildTemplateCopyAction(catalog.templates.agents_md, 'AGENTS.md', 'AGENTS.md (canonical)'));
  }
  if (plan.withClaudeMd) {
    actions.push(await buildTemplateCopyAction(catalog.templates.claude_md, 'CLAUDE.md', 'CLAUDE.md (@AGENTS.md import)'));
  }
  if (plan.withMemory) {
    actions.push(
      await buildTemplateCopyAction(catalog.templates.memory, plan.memoryDest, `memory → ${plan.memoryDest}`),
    );
  }
  if (plan.skills.length) {
    actions.push(...(await skillActions(plan.skills)));
  }
  if (plan.subagents.length) {
    actions.push(...(await subagentActions(plan.subagents)));
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
  if (plan.withAiMemory) {
    actions.push(await buildAiMemoryTomlAction(plan.aiMemoryWorkspace, plan.aiMemoryProject));
  }
  if (plan.withGitignore) {
    actions.push(await buildGitignoreMergeAction(catalog.gitignore));
  }
  return actions;
}

export async function runScaffoldCommand(opts: ScaffoldOptions): Promise<void> {
  const loaded = await loadCatalogWithOverlays(opts.overlay);
  try {
    for (const note of loaded.notes) log.warn(note);
    await runScaffoldWithCatalog(loaded.catalog, opts);
  } finally {
    await loaded.dispose();
  }
}

async function runScaffoldWithCatalog(catalog: CatalogData, opts: ScaffoldOptions): Promise<void> {
  const plan = isInteractive(opts)
    ? await promptScaffoldSelection(catalog)
    : planFromFlags(catalog, opts);

  if (!plan) {
    log.warn('Nothing selected — aborting.');
    return;
  }
  if (isEmptyPlan(plan)) {
    log.warn(
      'Nothing to scaffold. Pass --with-claude-md / --with-agents-md / --with-memory / --with-ai-memory / --skill <id> / --mcp <id> / --all.',
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
  log.plain(pc.dim('  AGENTS.md → canonical (Codex & OpenCode read it) · CLAUDE.md → @AGENTS.md import for Claude Code · skills → project skill dirs.'));
}
