/**
 * integrations — external tools that ship their own installer CLI and wire
 * themselves into each agent. First user: ai-memory (`install-mcp` +
 * `install-hooks` per agent, `install-instructions` once into the global
 * AGENTS.md). See the `integrations` section of assets/catalog.json.
 *
 * Secrets stay out of the harness: the steps inherit the user's environment
 * (AI_MEMORY_AUTH_TOKEN etc.), so token values never appear in our args, logs
 * or files — the catalog only names the variables. A missing binary or a
 * missing required variable is a warning + skip, never a failed run.
 *
 * Ordering (enforced by commands/init.ts): presets → integrations → per-agent
 * loop. The global AGENTS.md template must exist before `install-instructions`
 * appends its block, and the agent-harness manifest block lands after it.
 */
import process from 'node:process';
import { type Action, type ApplyResult, runAction, runActions } from './actions';
import { type AgentInfo, commandOnPath } from './agents';
import { type IntegrationEntry, type IntegrationStep, integrationAppliesTo } from './catalog';
import { runPresetFiles, substitutePlaceholders } from './presets';
import { platformAllows, platformSkipReason } from './platform';

/** Injected so tests (and the e2e fake binary) control what "installed" means. */
export interface IntegrationDeps {
  onPath: (bin: string) => boolean;
  env: NodeJS.ProcessEnv;
}

const defaultIntegrationDeps: IntegrationDeps = { onPath: commandOnPath, env: process.env };

function integrationLabel(entry: IntegrationEntry): string {
  return `Integration ${entry.label ?? entry.id}`;
}

/** Env var NAMES from `requiredEnv` that are unset or empty. Example: ['AI_MEMORY_SERVER_URL']. */
export function missingIntegrationEnv(entry: IntegrationEntry, env: NodeJS.ProcessEnv): string[] {
  return entry.requiredEnv.filter((name) => !env[name]);
}

/**
 * Why this integration cannot run right now (platform, no agent, binary, env),
 * as a skip/note action — or null when it can run.
 */
export function integrationBlocker(entry: IntegrationEntry, agents: AgentInfo[], deps: IntegrationDeps): Action | null {
  const label = integrationLabel(entry);
  if (!platformAllows(entry.platforms)) return { kind: 'skip', label, reason: platformSkipReason(entry.platforms) };
  if (!agents.some((a) => integrationAppliesTo(entry, a.id))) {
    return { kind: 'skip', label, reason: `no selected agent is supported (supported: ${Object.keys(entry.agentNames).join(', ')})` };
  }
  if (!deps.onPath(entry.bin)) {
    return { kind: 'note', level: 'warn', label, message: `${label}: \`${entry.bin}\` is not on PATH — skipped. ${entry.installHint ?? ''}`.trim() };
  }
  const missing = missingIntegrationEnv(entry, deps.env);
  if (!missing.length) return null;
  const message = `${label}: export ${missing.join(', ')} in your shell first, then re-run — skipped (values are read from the environment, never stored).`;
  return { kind: 'note', level: 'warn', label, message };
}

/** Expand `{agent}` and `{{HOME}}` in a step's args. Example: ['--client','{agent}'] → ['--client','codex']. */
export function expandIntegrationArgs(args: string[], agentName?: string): string[] {
  return args.map((arg) => substitutePlaceholders(agentName ? arg.replaceAll('{agent}', agentName) : arg));
}

function stepAction(entry: IntegrationEntry, step: IntegrationStep, who: string, agentName?: string): Action {
  const args = expandIntegrationArgs(step.args, agentName);
  const label = `${entry.label ?? entry.id}: ${step.cmd} ${args[0] ?? ''} (${who})`;
  return { kind: 'exec', label, cmd: step.cmd, args, timeout: 180_000 };
}

/** One exec per (perAgent step × supported agent), then each `once` step a single time. */
export function buildIntegrationStepActions(entry: IntegrationEntry, agents: AgentInfo[]): Action[] {
  const actions: Action[] = [];
  for (const agent of agents) {
    const agentName = entry.agentNames[agent.id];
    if (!agentName || !integrationAppliesTo(entry, agent.id)) {
      actions.push({ kind: 'skip', label: `${integrationLabel(entry)} → ${agent.label}`, reason: `no mapping for ${agent.id}` });
      continue;
    }
    actions.push(...entry.perAgent.map((step) => stepAction(entry, step, agent.label, agentName)));
  }
  actions.push(...entry.once.map((step) => stepAction(entry, step, 'once')));
  return actions;
}

/**
 * Run one integration: blocker check, then its config files (merged like
 * presets), then its commands. Example: `await runIntegration(aiMemory, agents)`.
 */
export async function runIntegration(
  entry: IntegrationEntry,
  agents: AgentInfo[],
  deps: IntegrationDeps = defaultIntegrationDeps,
): Promise<ApplyResult[]> {
  const blocker = integrationBlocker(entry, agents, deps);
  if (blocker) return [await runAction(blocker)];
  const fileResults = await runPresetFiles(entry, entry.files, agents.map((a) => a.id));
  return [...fileResults, ...(await runActions(buildIntegrationStepActions(entry, agents)))];
}
