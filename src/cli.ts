import { Command } from 'commander';
import process from 'node:process';
import pkg from '../package.json';
import { log, setRunContext } from './core/fsx';
import { runInitCommand } from './commands/init';
import { runScaffoldCommand } from './commands/scaffold';

/** Collector for repeatable string options: `--mcp a --mcp b` => ['a','b']. */
function collect(value: string, previous: string[]): string[] {
  return previous.concat([value]);
}

const program = new Command();

program
  .name('agent-harness')
  .description('Dotfiles-for-AI-agents bootstrapper — configure MCPs, skills, and plugins across Claude Code, Codex, and OpenCode.')
  .version(pkg.version);

program
  .command('init', { isDefault: true })
  .description('Configure agents on this machine (user-scope MCPs, skills, plugins), then print the login block.')
  .option('-a, --agent <id>', 'target agent (repeatable)', collect, [])
  .option('--mcp <id>', 'MCP to install (repeatable)', collect, [])
  .option('--skill <id>', 'skill to install (repeatable)', collect, [])
  .option('--plugin <id>', 'plugin to install (repeatable)', collect, [])
  .option('--all', 'select every catalog item', false)
  .option('-y, --yes', 'assume defaults, no prompts (CI)', false)
  .option('--dry-run', 'show actions without writing anything', false)
  .option('--force', 'overwrite existing entries instead of skipping', false)
  .action(async (opts) => {
    setRunContext({ dryRun: !!opts.dryRun, force: !!opts.force, yes: !!opts.yes });
    await runInitCommand({
      agent: opts.agent,
      mcp: opts.mcp,
      skill: opts.skill,
      plugin: opts.plugin,
      all: !!opts.all,
      yes: !!opts.yes,
    });
  });

program
  .command('scaffold')
  .description('Scaffold the current repo: CLAUDE.md, AGENTS.md, skill memory, project-scoped skills, project .mcp.json, and merge .gitignore.')
  .option('--mcp <id>', 'MCP to include in project config (repeatable)', collect, [])
  .option('--skill <id>', 'skill to install into the repo, project-scoped (repeatable)', collect, [])
  .option('--with-claude-md', 'write CLAUDE.md', false)
  .option('--with-agents-md', 'write AGENTS.md', false)
  .option('--with-memory', 'write the skill memory file', false)
  .option('--with-opencode', 'also write a project opencode.json', false)
  .option('--memory-dest <path>', 'destination path for the memory file')
  .option('--no-gitignore', 'do not merge .gitignore')
  .option('--all', 'scaffold all docs + all catalog MCPs', false)
  .option('-y, --yes', 'assume defaults, no prompts (CI)', false)
  .option('--dry-run', 'show actions without writing anything', false)
  .option('--force', 'overwrite existing template files', false)
  .action(async (opts) => {
    setRunContext({ dryRun: !!opts.dryRun, force: !!opts.force, yes: !!opts.yes });
    await runScaffoldCommand({
      mcp: opts.mcp,
      skill: opts.skill,
      withClaudeMd: !!opts.withClaudeMd,
      withAgentsMd: !!opts.withAgentsMd,
      withMemory: !!opts.withMemory,
      withOpencode: !!opts.withOpencode,
      gitignore: opts.gitignore !== false,
      memoryDest: opts.memoryDest,
      all: !!opts.all,
      yes: !!opts.yes,
    });
  });

program.parseAsync().catch((err: unknown) => {
  log.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
