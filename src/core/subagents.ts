/**
 * subagents — custom subagents bundled under assets/agents/<file>.
 *
 * Unlike skills, there's no external CLI to delegate to (no `npx agents add`
 * equivalent), so every install is a direct local-file copy. Each agent that
 * declares a `subagents` dir also declares the file format it reads: Claude
 * Code takes Markdown + frontmatter (`file`), Codex takes TOML (`codex_file`).
 * An entry without a variant for a given format is skipped for that agent.
 */
import { promises as fs } from 'node:fs';
import path from 'node:path';
import type { Action } from './actions';
import type { AgentInfo } from './agents';
import { assetsDir } from './catalog';
import type { SubagentEntry } from './catalog';
import { expandHome, pathExists, readText } from './fsx';

export type SubagentScope = 'user' | 'project';

/** The bundled filename for this agent's subagent format, if the entry ships one. */
export function subagentFileFor(entry: SubagentEntry, agent: AgentInfo): string | undefined {
  if (!agent.subagents) return undefined;
  return agent.subagents.format === 'toml' ? entry.codex_file : entry.file;
}

export function localSubagentFile(file: string): string {
  return path.join(assetsDir(), 'agents', file);
}

/** True when the entry has a bundled variant this agent can read. */
export function hasSubagentFor(entry: SubagentEntry, agent: AgentInfo): boolean {
  const file = subagentFileFor(entry, agent);
  return Boolean(file && pathExists(localSubagentFile(file)));
}

/** Copy the bundled subagent file into the agent's subagents dir. */
export async function buildSubagentCopyAction(
  agent: AgentInfo,
  entry: SubagentEntry,
  scope: SubagentScope,
): Promise<Action> {
  const label = `Agent ${entry.label ?? entry.id} → ${agent.label}`;
  if (!agent.subagents) {
    return { kind: 'skip', label, reason: 'agent has no subagents dir' };
  }
  const file = subagentFileFor(entry, agent);
  if (!file) {
    return { kind: 'skip', label, reason: `no ${agent.subagents.format} variant bundled` };
  }
  const srcFile = localSubagentFile(file);
  if (!pathExists(srcFile)) {
    return {
      kind: 'note',
      level: 'warn',
      label,
      message: `No local file at assets/agents/${file} — skipping.`,
    };
  }
  const destBase = expandHome(scope === 'user' ? agent.subagents.userDir : agent.subagents.projectDir);
  const dest = path.join(destBase, file);
  const after = await fs.readFile(srcFile, 'utf8');
  return { kind: 'file', label, path: dest, before: await readText(dest), after };
}
