/**
 * manifest — write a short inventory of what was installed into the agent's
 * GLOBAL instructions file (~/.claude/CLAUDE.md, ~/.codex/AGENTS.md, …).
 *
 * `init` otherwise leaves no durable trace: skills are auto-discovered from
 * their frontmatter, but nothing tells the agent which MCPs/plugins exist, or
 * which skills need a binary or API key that the installer cannot provide. The
 * auth block prints that once and scrolls away; this is the persistent copy.
 *
 * The file belongs to the user, so we only own the marker-delimited block.
 */
import type { Action } from './actions';
import type { AgentInfo } from './agents';
import {
  type McpEntry,
  type PluginEntry,
  type PresetEntry,
  type SkillEntry,
  appliesToAgent,
  mcpAppliesTo,
  pluginAppliesTo,
  skillAppliesTo,
} from './catalog';
import { MANIFEST_BEGIN, MANIFEST_END, mergeManagedBlock, readText, tildify } from './fsx';
import { requiredEnvVars } from './mcp';

/** The slice of a Selection the manifest reports on (see commands/init.ts). */
export interface ManifestInput {
  mcps: McpEntry[];
  skills: SkillEntry[];
  plugins: PluginEntry[];
  subagents: { id: string }[];
  presets: PresetEntry[];
}

const list = (names: string[]): string => [...names].sort().join(', ');

/** Group prerequisites so each one names the skills that need it. */
function prerequisiteLines(skills: SkillEntry[]): string[] {
  const byRequirement = new Map<string, string[]>();
  for (const s of skills) {
    for (const req of s.requires ?? []) {
      const users = byRequirement.get(req) ?? [];
      users.push(s.id);
      byRequirement.set(req, users);
    }
  }
  return [...byRequirement.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([req, users]) => `- ${req} — ${list(users)}`);
}

/** Render the managed block for one agent. Pure — no IO. */
export function renderManifest(agent: AgentInfo, sel: ManifestInput, version: string): string {
  const skills = agent.supports.skills ? sel.skills.filter((s) => skillAppliesTo(s, agent.id)) : [];
  const mcps = agent.supports.mcp ? sel.mcps.filter((m) => mcpAppliesTo(m, agent.id)) : [];
  const plugins = agent.supports.plugins ? sel.plugins.filter((p) => pluginAppliesTo(p, agent.id)) : [];
  const subagents = agent.supports.subagents ? sel.subagents : [];
  const presets = sel.presets.filter((p) => appliesToAgent(p.agents, agent.id));

  const lines: string[] = [
    `## Provisioned by agent-harness v${version}`,
    '',
    `This environment was set up by \`agent-harness init\`. Available to ${agent.label}:`,
    '',
  ];

  if (skills.length) {
    lines.push(`**Skills** (\`${agent.skills.userDir}\`) — ${list(skills.map((s) => s.skill))}`);
  }
  if (mcps.length) lines.push(`**MCPs** — ${list(mcps.map((m) => m.id))}`);
  if (subagents.length) {
    lines.push(
      `**Subagents** (\`${agent.subagents?.userDir}\`) — ${list(subagents.map((s) => s.id))}`,
    );
  }
  if (plugins.length) lines.push(`**Plugins** — ${list(plugins.map((p) => p.id))}`);
  if (presets.length) lines.push(`**Presets** — ${list(presets.map((p) => p.id))}`);

  const prereqs = prerequisiteLines(skills);
  const envs = requiredEnvVars(mcps);
  if (prereqs.length || envs.length) {
    lines.push('', "**Prerequisites the installer doesn't provide:**", ...prereqs);
    if (envs.length) lines.push(`- Env vars — ${envs.join(', ')}`);
  }

  lines.push(
    '',
    'MCPs and plugins only take effect after restarting the agent. This block is',
    "generated — re-run the installer to refresh it, don't hand-edit.",
  );

  return lines.join('\n');
}

/**
 * Merge the manifest block into the agent's global instructions file.
 * Content outside the markers is preserved; re-running is a noop.
 */
export async function buildManifestAction(
  agent: AgentInfo,
  sel: ManifestInput,
  version: string,
): Promise<Action> {
  const file = agent.globalInstructionsFile;
  const label = `${agent.instructionsFile} (agent-harness block)`;
  if (!file) {
    return { kind: 'skip', label, reason: `no global instructions file for ${agent.id}` };
  }

  const before = await readText(file);
  const after = mergeManagedBlock(
    before,
    renderManifest(agent, sel, version),
    MANIFEST_BEGIN,
    MANIFEST_END,
  );
  return { kind: 'file', label: `${tildify(file)} (agent-harness block)`, path: file, before, after };
}
