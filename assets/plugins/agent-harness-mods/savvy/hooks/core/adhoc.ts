// Ad-hoc agents: an Agent call with no savvy marker still gets a card in the
// panel (user decision, 2026-10-21: "always see agents that way"). It joins the
// active run while that run is live, else opens an "Agentes avulsos" run. The
// card only observes: model, background and effort stay as the call chose.
import type { SavvyProfile, SavvyRun, SavvyTask } from '../../types'
import type { SavvyConfig } from './config.ts'
import { isSavvyRunSettled } from './scheduler.ts'

export const SAVVY_ADHOC_RUN_NAME = 'Agentes avulsos'
const MAX_TITLE = 60
const ADHOC_STEPS = ['Executar o pedido']

/** What the spawn event says about the agent, as the card needs it. */
export type SavvyAdhocSpawn = { description: string; prompt: string; model: string | undefined; agentId: string; now: number }

const PROFILE_BY_MODEL: Record<string, SavvyProfile> = { haiku: 'light', sonnet: 'medium', opus: 'careful', fable: 'heavy' }

/**
 * The config key for the Agent call's `model` (alias or id); no model means the
 * agent inherits the orchestrator, which runs on opus.
 * @example savvyAdhocModelKey('claude-haiku-5-5', config) // "haiku"
 */
export function savvyAdhocModelKey(model: string | undefined, config: SavvyConfig): string {
  if (model === undefined || model.trim() === '') return 'opus'
  const wanted = model.trim().toLowerCase()
  for (const [key, spec] of Object.entries(config.models)) {
    if (wanted === key || wanted === spec.id || wanted.includes(key)) return key
  }
  return 'opus'
}

/** The card title: the call's description, else the prompt's first line, cut to 60. */
export function savvyAdhocTitle(description: string, prompt: string): string {
  const text = description.trim() || prompt.trim().split(/\r?\n/)[0]?.trim() || 'Agente'
  return text.slice(0, MAX_TITLE)
}

/** A live run keeps taking cards; a settled or cancelled one gives way to a new run. */
const takesCards = (run: SavvyRun | null): run is SavvyRun => run !== null && !run.cancelled && !isSavvyRunSettled(run)

/**
 * Adds a running card for an unmarked agent, to the live run or to a new one.
 * @example addSavvyAdhocTask(null, spawn, config, 'agentes-avulsos-20261021-1200').name // "Agentes avulsos"
 */
export function addSavvyAdhocTask(run: SavvyRun | null, spawn: SavvyAdhocSpawn, config: SavvyConfig, newRunId: string): SavvyRun {
  const base: SavvyRun = takesCards(run) || isAdhocRun(run)
    ? (run as SavvyRun)
    : { id: newRunId, name: SAVVY_ADHOC_RUN_NAME, request: '', createdAt: spawn.now, cancelled: false, tasks: [] }
  const id = base.tasks.reduce((max, task) => Math.max(max, task.id), 0) + 1
  return { ...base, tasks: [...base.tasks, adhocTask(id, spawn, config)] }
}

/** An earlier ad-hoc run that is not cancelled keeps collecting this session's cards. */
const isAdhocRun = (run: SavvyRun | null): boolean =>
  run !== null && !run.cancelled && run.name === SAVVY_ADHOC_RUN_NAME && run.tasks.every(task => task.adhoc === true)

function adhocTask(id: number, spawn: SavvyAdhocSpawn, config: SavvyConfig): SavvyTask {
  const model = savvyAdhocModelKey(spawn.model, config)
  const spec = config.models[model]
  return {
    id, title: savvyAdhocTitle(spawn.description, spawn.prompt), profile: PROFILE_BY_MODEL[model] ?? 'medium',
    model, modelId: spec?.id ?? model, effort: 'medium',
    steps: ADHOC_STEPS, deps: [], status: 'running', step: 0,
    tokens: 0, cost: 0, ctxPct: 0, startedAt: spawn.now, endedAt: null, summary: '',
    dispatched: true, agentId: spawn.agentId, turnId: null, toolCalls: [], files: [], adhoc: true,
  }
}
