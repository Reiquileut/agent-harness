// The two tools the orchestrating model calls: `plan` (validate, persist, and
// hand back the first launch list) and `ready` (what to launch next, or the
// consolidation brief once every task settled).
import type { EngineInterface, On } from 'claude-code'
import { buildSavvyRun, SavvyPlanError, SAVVY_PROFILE_NAMES } from './core/plan.ts'
import { savvyPlanHeadline, savvyReadyText } from './core/prompts.ts'
import { markSavvyDispatched, savvyReadyTasks } from './core/scheduler.ts'
import { changeSavvyRun, flushSavvyRun, startSavvyRun, type SavvyRuntimeSlot } from './runtime.ts'
import { SAVVY_PANE_ID, SAVVY_PLAN_TOOL, SAVVY_PLAN_TOOL_FULL, SAVVY_READY_TOOL, SAVVY_READY_TOOL_FULL, readSavvyRun } from './state.ts'

const PLAN_SCHEMA = {
  type: 'object',
  required: ['name', 'tasks'],
  properties: {
    name: { type: 'string', description: 'Short run name (a few words) shown in the panel.' },
    request: { type: 'string', description: "The person's request, verbatim." },
    tasks: {
      type: 'array', minItems: 3, maxItems: 6,
      items: {
        type: 'object', required: ['title', 'profile', 'steps'],
        properties: {
          title: { type: 'string', maxLength: 60 },
          profile: { type: 'string', enum: SAVVY_PROFILE_NAMES },
          steps: { type: 'array', minItems: 3, maxItems: 5, items: { type: 'string' } },
          deps: { type: 'array', items: { type: 'integer' }, description: '1-based numbers of the tasks this one waits for.' },
        },
      },
    },
  },
}

const PLAN_DESCRIPTION = [
  'Registers a savvy run: 3 to 6 tasks, each with a short title, a profile (light | medium | careful | heavy: how hard the task is),',
  '3 to 5 steps and the 1-based numbers of the tasks it depends on. The last task must be a review that depends on all the others',
  '(one is added if missing). Answers the plan headline and the exact Agent calls to make now.',
].join(' ')

const READY_DESCRIPTION = 'Call after a savvy helper finishes (its task notification arrived). Answers the Agent calls to make next, that nothing is ready yet, or, once every task settled, the summaries and files to consolidate.'

/** A run id that sorts by time and reads as the run: `auth-api-20261020-1432`. */
export function savvyRunId(name: string, now: number): string {
  const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 24) || 'run'
  const stamp = new Date(now).toISOString().replace(/[-:T]/g, '').slice(0, 12)
  return `${slug}-${stamp.slice(0, 8)}-${stamp.slice(8)}`
}

export async function registerSavvyTools($: EngineInterface): Promise<void> {
  await $.tool.register({ name: SAVVY_PLAN_TOOL, description: PLAN_DESCRIPTION, inputSchema: PLAN_SCHEMA, isDeferred: false })
  await $.tool.register({
    name: SAVVY_READY_TOOL, description: READY_DESCRIPTION, isDeferred: false,
    inputSchema: { type: 'object', properties: { runId: { type: 'string' } } },
  })
}

/** Opens the panel unasked only where it becomes a sidebar (desktop, or a wide fullscreen terminal). */
async function openPanelIfDocked(slot: SavvyRuntimeSlot, $: EngineInterface): Promise<void> {
  const runtime = slot.current
  const surface = await $.session.surface().catch(() => null)
  const viewport = runtime?.viewport
  const docks = surface === 'desktop' || (viewport?.isFullscreen === true && viewport.columns >= (runtime?.config.ui.dockMinColumns ?? 110))
  if (docks) await $.ui.open({ id: SAVVY_PANE_ID, title: 'Agents' }).catch(() => undefined)
}

export function registerSavvyToolHandlers(on: On, slot: SavvyRuntimeSlot): void {
  on('tool.call', { tool: SAVVY_PLAN_TOOL_FULL }, async ($, e) => {
    const runtime = slot.current
    if (runtime === null) return { deny: 'savvy is still starting; try again in a moment.' }
    const input = e as unknown as Record<string, unknown>
    const now = await $.clock.now()
    try {
      const planned = buildSavvyRun(input, runtime.config, now, savvyRunId(String(input.name ?? ''), now))
      const launch = savvyReadyTasks(planned)
      const run = markSavvyDispatched(planned, launch.map(task => task.id))
      await startSavvyRun($, runtime, run)
      await openPanelIfDocked(slot, $)
      const text = [savvyPlanHeadline(planned), `Run id: ${run.id}`, savvyReadyText(run, launch)].join('\n\n')
      return { result: text }
    } catch (error) {
      if (error instanceof SavvyPlanError) return { deny: `${error.message}. Fix the plan and call plan again.` }
      throw error
    }
  })

  on('tool.call', { tool: SAVVY_READY_TOOL_FULL }, async $ => {
    const runtime = slot.current
    if (runtime === null) return { deny: 'savvy is still starting; try again in a moment.' }
    await flushSavvyRun($, runtime)
    const run = await readSavvyRun($)
    if (run === null) return { deny: 'No savvy run is active. Start one with the plan tool.' }
    const launch = savvyReadyTasks(run)
    if (launch.length > 0) await changeSavvyRun($, runtime, r => markSavvyDispatched(r, launch.map(task => task.id)), true)
    return { result: savvyReadyText((await readSavvyRun($)) ?? run, launch) }
  })
}
