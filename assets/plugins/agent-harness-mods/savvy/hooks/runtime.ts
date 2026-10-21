// SavvyRuntime: the session-scoped bookkeeping every hook group shares. It owns
// the write queue (events are batched and written at ui.dataFps, so a burst of
// token updates is one redraw), the data beat, and the terminal animation loop,
// which repaints mounted Rasters with `$.ui.blit` and never re-renders a tree.
// The engine refuses a module that stores `$` (it is always spelled
// `$.noun.call` and passed only to declared functions), so the runtime holds
// no `$`: every function below that touches the engine takes it first.
import type { EngineInterface, Timer } from 'claude-code'
import type { SavvyEffort, SavvyRun } from '../types'
import type { SavvyConfig } from './core/config.ts'
import { saveSavvyRun } from './archive.ts'
import { readSavvyEnv, readSavvyRun, updateSavvyBeat, updateSavvyPrefs, updateSavvyRun } from './state.ts'

export type SavvyRunChange = (run: SavvyRun) => SavvyRun

/** What a per-request hook needs about one of the run's subagents, without a state read. */
export type SavvyAgentLink = { taskId: number; effort: SavvyEffort }

/** One Raster the animation loop repaints: its frames are packed at draw time. */
export type SavvyRasterSlot = { requestId: string; key: string; frames: readonly string[]; divisor: number; lastIndex: number }

export class SavvyRuntime {
  pending: SavvyRunChange[] = []
  timers: Timer[] = []
  frame = 0
  readonly slots = new Map<string, SavvyRasterSlot>()
  /** agentId -> task link for the active run. */
  readonly agents = new Map<string, SavvyAgentLink>()
  /** The terminal's last measured viewport, to open the panel only where it docks. */
  viewport: { columns: number; isFullscreen: boolean } | null = null

  constructor(readonly config: SavvyConfig) {}

  /** Remembers a Raster to animate; drawing a site again replaces its slots. */
  animateRaster(slot: Omit<SavvyRasterSlot, 'lastIndex'>): void {
    if (slot.frames.length < 2) return
    this.slots.set(`${slot.requestId}\u0000${slot.key}`, { ...slot, lastIndex: 0 })
  }

  forgetSite(requestId: string): void {
    for (const [id, slot] of this.slots) if (slot.requestId === requestId) this.slots.delete(id)
  }

  stopTimers(): void {
    for (const timer of this.timers.splice(0)) timer.cancel()
  }
}

/** Filled at session.start; every hook group reads the runtime through it. */
export type SavvyRuntimeSlot = { current: SavvyRuntime | null }

/** Applies queued changes in order in one state write, then saves the run file. */
export async function flushSavvyRun($: EngineInterface, runtime: SavvyRuntime): Promise<void> {
  if (runtime.pending.length === 0) return
  const changes = runtime.pending.splice(0)
  const run = await updateSavvyRun($, current => (current === null ? null : changes.reduce((acc, fn) => fn(acc), current)))
  if (run !== null) await saveSavvyRun($, run).catch(() => undefined)
}

/** Queues a change; `urgent` writes now (spawn, end, cancel), else at the next beat. */
export async function changeSavvyRun($: EngineInterface, runtime: SavvyRuntime, fn: SavvyRunChange, urgent = false): Promise<void> {
  runtime.pending.push(fn)
  if (urgent) await flushSavvyRun($, runtime)
}

/** Replaces the active run (a new plan); a new run shows again even after `/savvy off`. */
export async function startSavvyRun($: EngineInterface, runtime: SavvyRuntime, run: SavvyRun): Promise<void> {
  runtime.pending = []
  runtime.agents.clear()
  await updateSavvyRun($, () => run)
  await updateSavvyPrefs($, prefs => ({ ...prefs, hidden: false, confirmCancel: false, expanded: [] }))
  await saveSavvyRun($, run).catch(() => undefined)
}

/** Rebuilds the agent index after a reload from the run in `$.state`. */
export async function restoreSavvyAgents($: EngineInterface, runtime: SavvyRuntime): Promise<void> {
  const run = await readSavvyRun($)
  for (const task of run?.tasks ?? []) if (task.agentId !== null) runtime.agents.set(task.agentId, { taskId: task.id, effort: task.effort })
}

export function startSavvyTimers($: EngineInterface, runtime: SavvyRuntime): void {
  const { dataFps, animFps } = runtime.config.ui
  runtime.timers.push($.clock.every(Math.round(1000 / dataFps), () => void savvyBeat($, runtime)))
  runtime.timers.push($.clock.every(Math.round(1000 / animFps), () => void savvyAnimate($, runtime)))
}

async function savvyBeat($: EngineInterface, runtime: SavvyRuntime): Promise<void> {
  await flushSavvyRun($, runtime)
  const run = await readSavvyRun($)
  if (run?.tasks.some(task => task.status === 'running') === true) await updateSavvyBeat($, n => n + 1)
}

async function savvyAnimate($: EngineInterface, runtime: SavvyRuntime): Promise<void> {
  if (runtime.slots.size === 0 || (await readSavvyEnv($)).reducedMotion) return
  runtime.frame += 1
  for (const [id, slot] of runtime.slots) {
    const index = Math.floor(runtime.frame / slot.divisor) % slot.frames.length
    if (index === slot.lastIndex) continue
    slot.lastIndex = index
    const answer = await $.ui.blit({ requestId: slot.requestId, key: slot.key, cells: slot.frames[index] as string })
    if (answer.deny !== undefined) runtime.slots.delete(id)
  }
}
