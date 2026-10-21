// Pure transitions of a SavvyRun. Each returns the same object when nothing
// changed, so the hooks can skip a state write (and a redraw) for no-op events.
import type { SavvyRun, SavvyTask, SavvyToolCall } from '../../types'
import type { SavvyConfig } from './config.ts'
import { savvyContextTokens, savvyCostUsd, type SavvyUsage } from './metrics.ts'
import { savvyModelSpec } from './config.ts'

const KEEP_TOOL_CALLS = 8
const WRITING_TOOLS = new Set(['Write', 'Edit', 'MultiEdit', 'NotebookEdit'])

const isSettled = (task: SavvyTask): boolean => task.status === 'finished' || task.status === 'failed'

function patchTask(run: SavvyRun, match: (task: SavvyTask) => boolean, patch: (task: SavvyTask) => SavvyTask | null): SavvyRun {
  let changed = false
  const tasks = run.tasks.map(task => {
    if (!match(task)) return task
    const next = patch(task)
    if (next === null || next === task) return task
    changed = true
    return next
  })
  return changed ? { ...run, tasks } : run
}

const byAgent = (agentId: string) => (task: SavvyTask): boolean => task.agentId === agentId

/** The task a subagent runs, if the subagent is one of this run's. */
export function findSavvyTaskByAgent(run: SavvyRun | null, agentId: string | undefined): SavvyTask | undefined {
  if (run === null || agentId === undefined) return undefined
  return run.tasks.find(byAgent(agentId))
}

/**
 * Tasks the model may launch now: planned, not handed out yet, every dep settled.
 * @example savvyReadyTasks(run).map(t => t.id) // [1, 2]
 */
export function savvyReadyTasks(run: SavvyRun): SavvyTask[] {
  if (run.cancelled) return []
  const settled = new Set(run.tasks.filter(isSettled).map(task => task.id))
  return run.tasks.filter(task => task.status === 'planned' && !task.dispatched && task.deps.every(dep => settled.has(dep)))
}

export function markSavvyDispatched(run: SavvyRun, ids: readonly number[]): SavvyRun {
  return patchTask(run, task => ids.includes(task.id), task => (task.dispatched ? null : { ...task, dispatched: true }))
}

/** The Agent call for a task started: the agent id ties every later event to it. */
export function markSavvySpawned(run: SavvyRun, taskId: number, agentId: string, now: number): SavvyRun {
  return patchTask(run, task => task.id === taskId, task =>
    task.status !== 'planned' ? null : { ...task, status: 'running', agentId, dispatched: true, startedAt: now },
  )
}

export function markSavvyTurn(run: SavvyRun, agentId: string, turnId: string): SavvyRun {
  return patchTask(run, byAgent(agentId), task => (task.turnId === turnId ? null : { ...task, turnId }))
}

/** A `STEP n/N` line arrived; steps only move forward and stay within the plan. */
export function markSavvyStep(run: SavvyRun, agentId: string, step: number): SavvyRun {
  return patchTask(run, byAgent(agentId), task => {
    const next = Math.min(Math.max(step, task.step), task.steps.length)
    return next === task.step || task.status !== 'running' ? null : { ...task, step: next }
  })
}

/** One model request of the subagent finished: add its cost, take its context size. */
export function recordSavvyUsage(run: SavvyRun, agentId: string, usage: SavvyUsage | null | undefined, config: SavvyConfig): SavvyRun {
  if (usage === null || usage === undefined) return run
  return patchTask(run, byAgent(agentId), task => {
    const spec = savvyModelSpec(config, task.model)
    const tokens = savvyContextTokens(usage)
    return { ...task, tokens, cost: task.cost + savvyCostUsd(usage, spec.price), ctxPct: (tokens / spec.contextWindow) * 100 }
  })
}

export function recordSavvyToolCall(run: SavvyRun, agentId: string, call: SavvyToolCall): SavvyRun {
  return patchTask(run, byAgent(agentId), task => {
    const writes = WRITING_TOOLS.has(call.tool) && call.detail !== '' && !task.files.includes(call.detail)
    return {
      ...task,
      toolCalls: [...task.toolCalls, call].slice(-KEEP_TOOL_CALLS),
      files: writes ? [...task.files, call.detail] : task.files,
    }
  })
}

export type SavvySettleOutcome = { ok: boolean; summary: string; now: number }

/** The subagent's run ended. Only a running task settles, so a late event is ignored. */
export function markSavvySettled(run: SavvyRun, agentId: string, outcome: SavvySettleOutcome): SavvyRun {
  return patchTask(run, byAgent(agentId), task =>
    task.status !== 'running'
      ? null
      : {
          ...task,
          status: outcome.ok ? 'finished' : 'failed',
          step: outcome.ok ? task.steps.length : task.step,
          summary: outcome.summary.trim(),
          endedAt: outcome.now,
        },
  )
}

/** Stops handing out tasks and fails the ones that never started. */
export function cancelSavvyRun(run: SavvyRun, now: number): SavvyRun {
  const cancelled = patchTask(run, task => task.status === 'planned', task => ({ ...task, status: 'failed', summary: 'Cancelled before it started.', endedAt: now }))
  return run.cancelled ? cancelled : { ...cancelled, cancelled: true }
}

export type SavvyProgress = { done: number; total: number; pct: number }

export function savvyProgress(run: SavvyRun): SavvyProgress {
  const done = run.tasks.filter(isSettled).length
  const total = run.tasks.length
  return { done, total, pct: total === 0 ? 0 : Math.round((done / total) * 100) }
}

export const isSavvyRunSettled = (run: SavvyRun): boolean => run.tasks.every(isSettled)
