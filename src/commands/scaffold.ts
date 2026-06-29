/**
 * scaffold — repo-level: drop starter CLAUDE.md / AGENTS.md / memory, generate a
 * project .mcp.json (and optionally opencode.json), and merge .gitignore.
 *
 * Interactive by default; fully flag-drivable for CI (`-y`). Idempotent and
 * never clobbers existing files unless --force.
 */
import process from 'node:process';
import pc from 'picocolors';
import { type Action, runActions } from '../core/actions';
import { type CatalogData, type McpEntry, loadCatalog, mcpAppliesTo } from '../core/catalog';
import { isDryRun, log } from '../core/fsx';
import { buildProjectMcpAction } from '../core/mcp';
import { buildGitignoreMergeAction, buildTemplateCopyAction } from '../core/templates';
import { promptScaffoldSelection } from '../ui/prompts';

export const DEFAULT_MEMORY_DEST = '.claude/skills/memory/memory.md';

export interface ScaffoldOptions {
  mcp: string[];
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
      memoryDest,
    };
  }
  const mcps = catalog.mcps.filter((m) => opts.mcp.includes(m.id));
  return {
    withClaudeMd: opts.withClaudeMd,
    withAgentsMd: opts.withAgentsMd,
    withMemory: opts.withMemory,
    withOpencode: opts.withOpencode,
    withGitignore: opts.gitignore,
    mcps,
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
    opts.mcp.length > 0;
  if (explicit) return false;
  return Boolean(process.stdout.isTTY && process.stdin.isTTY);
}

function isEmptyPlan(p: ScaffoldPlan): boolean {
  return (
    !p.withClaudeMd &&
    !p.withAgentsMd &&
    !p.withMemory &&
    !p.withGitignore &&
    p.mcps.length === 0
  );
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
      'Nothing to scaffold. Pass --with-claude-md / --with-agents-md / --with-memory / --mcp <id> / --all.',
    );
    return;
  }

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

  log.plain('');
  log.info(`${isDryRun() ? pc.yellow('Dry run — ') : ''}Scaffolding ${pc.bold(process.cwd())}`);
  log.plain('');
  await runActions(actions);

  log.plain('');
  log.success(isDryRun() ? 'Dry run complete — nothing written.' : 'Scaffold complete.');
  log.plain(pc.dim('  CLAUDE.md → Claude Code · AGENTS.md → Codex & OpenCode · .mcp.json is team-shared.'));
}
