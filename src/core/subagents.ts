/**
 * subagents — custom Claude Code subagents bundled under assets/agents/<file>.
 *
 * Unlike skills, there's no external CLI to delegate to (no `npx agents add`
 * equivalent), so every install is a direct local-file copy. Only agents whose
 * AgentInfo declares a `subagents` dir (Claude Code today) can receive them.
 */
import { promises as fs } from 'node:fs';
import path from 'node:path';
import type { Action } from './actions';
import type { AgentInfo } from './agents';
import { assetsDir } from './catalog';
import type { SubagentEntry } from './catalog';
import { expandHome, pathExists, readText } from './fsx';

export type SubagentScope = 'user' | 'project';

export function localSubagentFile(entry: SubagentEntry): string {
  return path.join(assetsDir(), 'agents', entry.file);
}

export function hasLocalSubagent(entry: SubagentEntry): boolean {
  return pathExists(localSubagentFile(entry));
}

/** Copy a bundled subagent file (assets/agents/<file>) into the agent's subagents dir. */
export async function buildSubagentCopyAction(
  agent: AgentInfo,
  entry: SubagentEntry,
  scope: SubagentScope,
): Promise<Action> {
  const label = `Agent ${entry.label ?? entry.id} → ${agent.label}`;
  if (!agent.subagents) {
    return { kind: 'skip', label, reason: 'agent has no subagents dir' };
  }
  const srcFile = localSubagentFile(entry);
  if (!pathExists(srcFile)) {
    return {
      kind: 'note',
      level: 'warn',
      label,
      message: `No local file at assets/agents/${entry.file} — skipping.`,
    };
  }
  const destBase = expandHome(scope === 'user' ? agent.subagents.userDir : agent.subagents.projectDir);
  const dest = path.join(destBase, entry.file);
  const after = await fs.readFile(srcFile, 'utf8');
  return { kind: 'file', label, path: dest, before: await readText(dest), after };
}
