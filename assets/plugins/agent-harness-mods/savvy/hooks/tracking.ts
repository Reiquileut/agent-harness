// Follows the run's subagents through the engine's events: the Agent call's
// spawn (matched by marker; model and background enforced), each model request
// (effort enforced, usage and STEP lines read), each tool call, and the end.
import type { AgentSpawnInput, EngineInterface, HookOf, On } from 'claude-code'
import { saveSavvyRun } from './archive.ts'
import { addSavvyAdhocTask, SAVVY_ADHOC_RUN_NAME } from './core/adhoc.ts'
import { parseSavvyMarker, parseSavvyStep } from './core/marker.ts'
import * as S from './core/scheduler.ts'
import { changeSavvyRun, flushSavvyRun, type SavvyRuntime, type SavvyRuntimeSlot } from './runtime.ts'
import { readSavvyRun, updateSavvyPrefs, updateSavvyRun } from './state.ts'
import { openPanelIfDocked, savvyRunId } from './tools.ts'

const SUMMARY_LINE = /^\s*\**SUMMARY:?\**\s*:?/im
const DETAIL_FIELDS = ['file_path', 'notebook_path', 'command', 'pattern', 'url', 'query', 'description', 'path'] as const
const MAX_DETAIL = 80

/** The helper's report: what follows "SUMMARY:", else the tail of its answer. */
export function extractSavvySummary(answer: string): string {
  const match = SUMMARY_LINE.exec(answer)
  const text = match === null ? answer.slice(-800) : answer.slice(match.index + match[0].length)
  return text.trim().slice(0, 1500)
}

/** The one argument that says what a tool call did (its path, command, pattern...). */
export function savvyToolDetail(input: Record<string, unknown>): string {
  for (const field of DETAIL_FIELDS) {
    const value = input[field]
    if (typeof value === 'string' && value.trim() !== '') return value.trim().replace(/\s+/g, ' ').slice(0, MAX_DETAIL)
  }
  return ''
}

const linkOf = (slot: SavvyRuntimeSlot, agentId: string | undefined) =>
  agentId === undefined || slot.current === null ? undefined : { runtime: slot.current, link: slot.current.agents.get(agentId) }

export function registerSavvyTracking(on: On, slot: SavvyRuntimeSlot): void {
  on('agent.spawn', async ($, e, next) => {
    const runtime = slot.current
    const marker = parseSavvyMarker(e.prompt)
    if (runtime === null) return next(e)
    if (marker === null) return trackSavvyAdhocSpawn($, slot, runtime, e, next)
    const run = await readSavvyRun($)
    const task = run?.id === marker.runId ? run.tasks.find(t => t.id === marker.taskId) : undefined
    if (task === undefined || task.status !== 'planned' || run?.cancelled === true) return next(e)
    const spawned = await next({ ...e, model: task.modelId, background: true })
    const agentId = spawned.agentId
    if (agentId === undefined) return spawned
    runtime.agents.set(agentId, { taskId: task.id, effort: task.effort })
    const now = await $.clock.now()
    await changeSavvyRun($, runtime, r => S.markSavvySpawned(r, task.id, agentId, now), true)
    return spawned
  })

  on('turn.start', async ($, e, next) => {
    const found = linkOf(slot, e.agentId)
    if (found?.link !== undefined && e.agentId !== undefined) {
      const agentId = e.agentId
      await changeSavvyRun($, found.runtime, r => S.markSavvyTurn(r, agentId, e.turnId))
    }
    return next(e)
  })

  on('turn.step', async function* ($, e, next) {
    const found = linkOf(slot, e.agentId)
    if (found?.link === undefined || e.agentId === undefined) return yield* next(e)
    const { runtime, link } = found
    const agentId = e.agentId
    const stream = next(link.effort === null ? e : { ...e, effort: link.effort })[Symbol.asyncIterator]()
    let text = ''
    for (;;) {
      const item = await stream.next()
      if (item.done === true) {
        await recordStepEnd($, runtime, agentId, item.value.usage ?? null, text + item.value.answer)
        return item.value
      }
      if (item.value.kind === 'text') text = trackStepText($, runtime, agentId, text, item.value.text)
      yield item.value
    }
  })

  on('tool.call', async ($, e, next) => {
    const found = linkOf(slot, e.agentId)
    if (found?.link !== undefined && e.agentId !== undefined) {
      const agentId = e.agentId
      const call = { tool: String(e.tool), detail: savvyToolDetail(e as unknown as Record<string, unknown>), at: await $.clock.now() }
      await changeSavvyRun($, found.runtime, r => S.recordSavvyToolCall(r, agentId, call))
    }
    return next(e)
  })

  on('turn.complete', async ($, e, next) => {
    const answered = await next(e)
    const found = linkOf(slot, e.agentId)
    if (found?.link === undefined || e.agentId === undefined) return answered
    const agentId = e.agentId
    const ok = e.reason === 'answer'
    const summary = ok ? extractSavvySummary(e.answer) : `Ended: ${e.reason}. ${extractSavvySummary(e.answer)}`.trim()
    const now = await $.clock.now()
    await changeSavvyRun($, found.runtime, r => S.markSavvySettled(r, agentId, { ok, summary, now }), true)
    return answered
  })
}

type SpawnInput = AgentSpawnInput
type SpawnNext = Parameters<HookOf<'agent.spawn'>>[2]

/**
 * An Agent call savvy did not plan: spawn it exactly as asked, then give it a
 * card (in the live run, or a new "Agentes avulsos" run) so the panel shows it.
 */
async function trackSavvyAdhocSpawn($: EngineInterface, slot: SavvyRuntimeSlot, runtime: SavvyRuntime, e: SpawnInput, next: SpawnNext) {
  const spawned = await next(e)
  const agentId = spawned.agentId
  if (agentId === undefined) return spawned
  const now = await $.clock.now()
  await flushSavvyRun($, runtime)
  const before = await readSavvyRun($)
  const spawn = { description: e.description, prompt: e.prompt, model: e.model, agentId, now }
  const run = await updateSavvyRun($, current => addSavvyAdhocTask(current, spawn, runtime.config, savvyRunId(SAVVY_ADHOC_RUN_NAME, now)))
  if (run === null) return spawned
  await saveSavvyRun($, run).catch(() => undefined)
  if (run.id !== before?.id) {
    runtime.agents.clear()
    for (const task of run.tasks) if (task.agentId !== null) runtime.agents.set(task.agentId, { taskId: task.id, effort: task.adhoc === true ? null : task.effort })
    await updateSavvyPrefs($, prefs => ({ ...prefs, hidden: false, confirmCancel: false }))
    await openPanelIfDocked(slot, $)
  } else {
    const task = run.tasks.find(t => t.agentId === agentId)
    if (task !== undefined) runtime.agents.set(agentId, { taskId: task.id, effort: null })
  }
  return spawned
}

/** Accumulates streamed text and queues a step change whenever a STEP line lands. */
function trackStepText($: EngineInterface, runtime: SavvyRuntime, agentId: string, text: string, chunk: string): string {
  const next = text + chunk
  if (!chunk.includes('\n') && !/STEP/i.test(chunk)) return next
  const step = parseSavvyStep(next)
  if (step !== null) void changeSavvyRun($, runtime, r => S.markSavvyStep(r, agentId, step))
  return next.length > 4000 ? next.slice(-2000) : next
}

async function recordStepEnd($: EngineInterface, runtime: SavvyRuntime, agentId: string, usage: Parameters<typeof S.recordSavvyUsage>[2], text: string): Promise<void> {
  const step = parseSavvyStep(text)
  if (step !== null) await changeSavvyRun($, runtime, r => S.markSavvyStep(r, agentId, step))
  await changeSavvyRun($, runtime, r => S.recordSavvyUsage(r, agentId, usage, runtime.config))
}
