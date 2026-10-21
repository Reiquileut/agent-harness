// The view model both surfaces draw from: every string is formatted here once,
// so the terminal and the desktop show the same numbers in the same columns.
import type { SavvyProfile, SavvyRun, SavvyTask, SavvyTaskStatus, SavvyToolCall, SavvyUiPrefs } from '../../types'
import type { SavvyConfig } from '../core/config.ts'
import { savvyModelSpec } from '../core/config.ts'
import { fmtSavvyCost, fmtSavvyDuration, fmtSavvyTokens, savvyRunTotals, savvyTaskElapsed } from '../core/metrics.ts'
import { savvyProgress, type SavvyProgress } from '../core/scheduler.ts'

export type SavvyStepMark = 'done' | 'current' | 'todo'

export type SavvyCardView = {
  id: number
  title: string
  profile: SavvyProfile
  status: SavvyTaskStatus
  metaText: string
  stepText: string
  metricsText: string
  fraction: number
  waitingText: string
  expanded: boolean
  steps: readonly string[]
  stepMarks: SavvyStepMark[]
  toolCalls: readonly SavvyToolCall[]
  summary: string
}

export type SavvySectionView = { status: SavvyTaskStatus; label: string; count: number; collapsed: boolean; cards: SavvyCardView[] }

export type SavvyPanelView = {
  runId: string
  name: string
  totals: { cost: string; tokens: string; time: string }
  progress: SavvyProgress
  isActive: boolean
  cancelled: boolean
  profiles: SavvyProfile[]
  sections: SavvySectionView[]
}

const SECTION_ORDER: ReadonlyArray<[SavvyTaskStatus, string]> = [
  ['running', 'Running'], ['finished', 'Finished'], ['planned', 'Planned'], ['failed', 'Failed'],
]

function stepText(task: SavvyTask): string {
  const n = task.steps.length
  if (task.status === 'finished') return `${n}/${n} · done`
  if (task.status === 'planned') return `0/${n} · waiting`
  if (task.status === 'failed') return `${task.step}/${n} · failed`
  return task.step === 0 ? `0/${n} · starting` : `${task.step}/${n} · ${task.steps[task.step - 1] ?? ''}`
}

function barFraction(task: SavvyTask): number {
  const n = Math.max(1, task.steps.length)
  if (task.status === 'finished') return 1
  if (task.status === 'running' && task.step > 0) return (task.step - 0.5) / n
  return task.step / n
}

function stepMarks(task: SavvyTask): SavvyStepMark[] {
  return task.steps.map((_, i) => {
    if (task.status === 'finished' || i + 1 < task.step) return 'done'
    return i + 1 === task.step && task.status === 'running' ? 'current' : 'todo'
  })
}

/** "ctx  4% ·  38k  ≈$0.05  0:25": every field padded so columns never jump. */
export function savvyMetricsText(task: SavvyTask, now: number): string {
  const ctx = `${Math.round(task.ctxPct)}%`.padStart(4)
  const tokens = fmtSavvyTokens(task.tokens).padStart(5)
  const cost = fmtSavvyCost(task.cost).padStart(7)
  const time = fmtSavvyDuration(savvyTaskElapsed(task, now)).padStart(5)
  return `ctx ${ctx} ·${tokens} ${cost} ${time}`
}

function cardView(task: SavvyTask, now: number, config: SavvyConfig, prefs: SavvyUiPrefs): SavvyCardView {
  return {
    id: task.id,
    title: task.title,
    profile: task.profile,
    status: task.status,
    metaText: `${savvyModelSpec(config, task.model).label} · ${task.effort}`,
    stepText: stepText(task),
    metricsText: savvyMetricsText(task, now),
    fraction: barFraction(task),
    waitingText: task.status === 'planned' && task.deps.length > 0 ? `after ${task.deps.join(',')}` : task.status === 'planned' ? 'ready' : '',
    expanded: prefs.expanded.includes(task.id),
    steps: task.steps,
    stepMarks: stepMarks(task),
    toolCalls: task.toolCalls.slice(-5),
    summary: task.summary,
  }
}

export type SavvyViewInput = { run: SavvyRun; now: number; config: SavvyConfig; prefs: SavvyUiPrefs }

/**
 * Everything the panel, the band and the conversation tree show for a run.
 * @example buildSavvyPanelView({ run, now: Date.now(), config, prefs })
 */
export function buildSavvyPanelView(input: SavvyViewInput): SavvyPanelView {
  const { run, now, config, prefs } = input
  const totals = savvyRunTotals(run, now)
  const sections = SECTION_ORDER.map(([status, label]) => {
    const cards = run.tasks.filter(task => task.status === status).map(task => cardView(task, now, config, prefs))
    return { status, label, count: cards.length, collapsed: prefs.collapsed.includes(status), cards }
  }).filter(section => section.count > 0)
  return {
    runId: run.id,
    name: run.name,
    totals: { cost: fmtSavvyCost(totals.cost), tokens: fmtSavvyTokens(totals.tokens), time: fmtSavvyDuration(totals.elapsedMs) },
    progress: savvyProgress(run),
    isActive: run.tasks.some(task => task.status === 'running'),
    cancelled: run.cancelled,
    profiles: run.tasks.map(task => task.profile),
    sections,
  }
}
