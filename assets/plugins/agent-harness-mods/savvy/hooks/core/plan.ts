// Turns the plan the model sends to `savvy_plan` into a SavvyRun, refusing every
// malformed plan with the offending value so the model can correct itself.
import type { SavvyProfile, SavvyRun, SavvyTask } from '../../types'
import type { SavvyConfig } from './config.ts'
import { savvyModelSpec } from './config.ts'

export class SavvyPlanError extends Error {
  override name = 'SavvyPlanError'
}

export const SAVVY_PROFILE_NAMES: readonly SavvyProfile[] = ['light', 'medium', 'careful', 'heavy']
const MIN_TASKS = 3
const MAX_TASKS = 6
const MAX_TITLE = 60
const REVIEW_STEPS = ['Read every helper summary', 'Check the changes against the request', 'Fix or flag what is wrong', 'Write the final verdict']

type DraftTask = { title: string; profile: SavvyProfile; steps: string[]; deps: number[] }
const show = (v: unknown): string => JSON.stringify(v) ?? String(v)
const fail = (what: string, got: unknown, expected: string): never => {
  throw new SavvyPlanError(`${what}: received ${show(got)}, expected ${expected}`)
}
const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)

/**
 * Validates a plan and builds the run, appending a review task when none depends
 * on all the others and moving the review last.
 * @example buildSavvyRun({ name: 'auth', tasks }, config, Date.now(), 'run-1')
 */
export function buildSavvyRun(input: unknown, config: SavvyConfig, now: number, runId: string): SavvyRun {
  if (!isRecord(input)) return fail('plan', input, 'an object { name, request?, tasks }')
  const name = typeof input.name === 'string' ? input.name.trim() : ''
  if (name === '') fail('plan name', input.name, 'a non-empty string')
  if (!Array.isArray(input.tasks)) fail('plan tasks', input.tasks, 'an array of 3 to 6 tasks')
  const drafts = withReviewLast(withReview((input.tasks as unknown[]).map(parseDraftTask)))
  assertSavvyDeps(drafts)
  return {
    id: runId,
    name: name.slice(0, MAX_TITLE),
    request: typeof input.request === 'string' ? input.request : '',
    createdAt: now,
    cancelled: false,
    tasks: drafts.map((draft, index) => toSavvyTask(draft, index + 1, config)),
  }
}

function parseDraftTask(raw: unknown, index: number): DraftTask {
  const where = `task ${index + 1}`
  if (!isRecord(raw)) return fail(where, raw, 'an object { title, profile, steps, deps? }')
  const title = typeof raw.title === 'string' ? raw.title.trim() : ''
  if (title === '' || title.length > MAX_TITLE) fail(`${where} title`, raw.title, `1 to ${MAX_TITLE} characters`)
  if (!SAVVY_PROFILE_NAMES.includes(raw.profile as SavvyProfile)) fail(`${where} profile`, raw.profile, SAVVY_PROFILE_NAMES.join(' | '))
  const steps = Array.isArray(raw.steps) ? raw.steps : []
  if (steps.length < 3 || steps.length > 5) fail(`${where} steps`, raw.steps, 'an array of 3 to 5 steps')
  const cleanSteps = steps.map((step, i) => parseStep(step, `${where} step ${i + 1}`))
  return { title, profile: raw.profile as SavvyProfile, steps: cleanSteps, deps: parseDeps(raw.deps, where) }
}

function parseStep(step: unknown, where: string): string {
  const text = typeof step === 'string' ? step.trim() : ''
  if (text === '') fail(where, step, 'a non-empty string')
  return text.slice(0, 80)
}

function parseDeps(raw: unknown, where: string): number[] {
  if (raw === undefined || raw === null) return []
  if (!Array.isArray(raw)) return fail(`${where} deps`, raw, 'an array of task numbers (1-based)')
  for (const dep of raw) {
    if (!Number.isInteger(dep)) fail(`${where} dep`, dep, 'a task number (1-based integer)')
  }
  return [...new Set(raw as number[])]
}

const isReview = (task: DraftTask, all: DraftTask[]): boolean =>
  all.length > 1 && all.every((other, i) => other === task || task.deps.includes(i + 1))

function withReview(tasks: DraftTask[]): DraftTask[] {
  const hasReview = tasks.some(task => isReview(task, tasks))
  const next = hasReview ? tasks : [...tasks, { title: 'Review', profile: 'careful' as const, steps: REVIEW_STEPS, deps: tasks.map((_, i) => i + 1) }]
  if (next.length < MIN_TASKS || next.length > MAX_TASKS) fail('plan tasks', `${next.length} tasks (review included)`, '3 to 6 tasks, the review included')
  return next
}

/** Moves the review to the end and renumbers every dep to the new order. */
function withReviewLast(tasks: DraftTask[]): DraftTask[] {
  const reviewIndex = tasks.findIndex(task => isReview(task, tasks))
  if (reviewIndex === tasks.length - 1) return tasks
  const order = [...tasks.keys()].filter(i => i !== reviewIndex).concat(reviewIndex)
  const newId = new Map(order.map((oldIndex, newIndex) => [oldIndex + 1, newIndex + 1]))
  return order.map(i => {
    const task = tasks[i] as DraftTask
    return { ...task, deps: task.deps.map(dep => newId.get(dep) ?? dep).sort((a, b) => a - b) }
  })
}

function assertSavvyDeps(tasks: DraftTask[]): void {
  tasks.forEach((task, i) => {
    for (const dep of task.deps) {
      if (dep === i + 1) fail(`task ${i + 1} deps`, task.deps, 'tasks other than itself')
      if (dep < 1 || dep > tasks.length) fail(`task ${i + 1} dep`, dep, `a task number from 1 to ${tasks.length}`)
    }
  })
  const visiting = new Set<number>()
  const done = new Set<number>()
  const visit = (id: number): void => {
    if (done.has(id)) return
    if (visiting.has(id)) fail('plan deps', `a cycle through task ${id}`, 'dependencies without a cycle')
    visiting.add(id)
    for (const dep of tasks[id - 1]?.deps ?? []) visit(dep)
    visiting.delete(id)
    done.add(id)
  }
  tasks.forEach((_, i) => visit(i + 1))
}

function toSavvyTask(draft: DraftTask, id: number, config: SavvyConfig): SavvyTask {
  const profile = config.profiles[draft.profile]
  return {
    id, title: draft.title, profile: draft.profile,
    model: profile.model, modelId: savvyModelSpec(config, profile.model).id, effort: profile.effort,
    steps: draft.steps, deps: draft.deps, status: 'planned', step: 0,
    tokens: 0, cost: 0, ctxPct: 0, startedAt: null, endedAt: null, summary: '',
    dispatched: false, agentId: null, turnId: null, toolCalls: [], files: [],
  }
}
