// Persists runs to <cwd>/.claude/savvy/<run-id>.json and lists them for
// `/savvy runs`. Tests answer the `fs.*` events with a FakeSavvyFs beneath.
import type { EngineInterface } from 'claude-code'
import type { SavvyRun } from '../types'
import { fmtSavvyCost } from './core/metrics.ts'
import { savvyProgress } from './core/scheduler.ts'

export const SAVVY_RUNS_DIR = '.claude/savvy'

/** Writes the run in the spec's JSON shape (plus savvy's bookkeeping fields). */
export async function saveSavvyRun($: EngineInterface, run: SavvyRun): Promise<void> {
  await $.fs.write(`${SAVVY_RUNS_DIR}/${run.id}.json`, `${JSON.stringify(run, null, 2)}\n`)
}

async function loadSavvyRun($: EngineInterface, runId: string): Promise<SavvyRun | null> {
  const text = await $.fs.read(`${SAVVY_RUNS_DIR}/${runId}.json`).catch(() => null)
  return typeof text === 'string' ? (JSON.parse(text) as SavvyRun) : null
}

/** Every saved run, newest first; an unreadable file is skipped, not fatal. */
export async function listSavvyRuns($: EngineInterface): Promise<SavvyRun[]> {
  const entries = await $.fs.list(SAVVY_RUNS_DIR).catch(() => [])
  const names = entries.filter(entry => entry.kind === 'file' && entry.name.endsWith('.json')).map(entry => entry.name.slice(0, -5))
  const runs: SavvyRun[] = []
  for (const name of names) {
    const run = await loadSavvyRun($, name).catch(() => null)
    if (run !== null) runs.push(run)
  }
  return runs.sort((a, b) => b.createdAt - a.createdAt)
}

/** The `/savvy runs` table, markdown, newest first. */
export function savvyRunsTable(runs: readonly SavvyRun[]): string {
  if (runs.length === 0) return 'No savvy runs yet in this project. Start one with `/savvy-flow <request>`.'
  const rows = runs.map(run => {
    const { done, total } = savvyProgress(run)
    const cost = fmtSavvyCost(run.tasks.reduce((sum, task) => sum + task.cost, 0))
    const state = run.cancelled ? 'cancelled' : done === total ? 'done' : 'in progress'
    const when = new Date(run.createdAt).toISOString().slice(0, 16).replace('T', ' ')
    return `| ${run.name} | \`${run.id}\` | ${when} | ${done}/${total} | ${state} | ${cost} |`
  })
  return ['| Run | Id | Started (UTC) | Tasks | State | Cost |', '|---|---|---|---|---|---|', ...rows].join('\n')
}
