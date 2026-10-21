// The texts the orchestrating model and its helpers read. The launch list is
// explicit (one Agent call per task, exact fields) because the model, not the
// plugin, makes the Agent calls: the plugin then recognises them by marker.
import type { SavvyRun, SavvyTask } from '../../types'
import { encodeSavvyMarker } from './marker.ts'
import { savvyReadyTasks, isSavvyRunSettled } from './scheduler.ts'

const isReviewer = (run: SavvyRun, task: SavvyTask): boolean =>
  run.tasks.length > 1 && run.tasks.every(other => other === task || task.deps.includes(other.id))

/** @example "Here's the plan: 4 tasks. 3 helpers start now, and a reviewer checks it all once they finish." */
export function savvyPlanHeadline(run: SavvyRun): string {
  const now = savvyReadyTasks(run).length
  const helpers = now === 1 ? '1 helper starts' : `${now} helpers start`
  return `Here's the plan: ${run.tasks.length} tasks. ${helpers} now, and a reviewer checks it all once they finish.`
}

function dependencyNotes(run: SavvyRun, task: SavvyTask): string {
  if (task.deps.length === 0) return ''
  const lines = task.deps.map(dep => {
    const done = run.tasks.find(t => t.id === dep)
    if (done === undefined) return ''
    const state = done.status === 'failed' ? 'FAILED' : 'finished'
    return `- #${done.id} ${done.title} (${state}): ${done.summary || '(no summary)'}`
  })
  return `\nWhat the tasks you depend on reported:\n${lines.join('\n')}\n`
}

/** The prompt one helper runs with; the first line is the marker the hooks match. */
export function buildSavvyAgentPrompt(run: SavvyRun, task: SavvyTask): string {
  const n = task.steps.length
  const role = isReviewer(run, task) ? 'the reviewer' : `helper #${task.id}`
  return [
    encodeSavvyMarker(run.id, task.id),
    `You are ${role} of the savvy run "${run.name}".`,
    run.request === '' ? '' : `The overall request: ${run.request}`,
    `Your task: ${task.title}`,
    'Steps, in order:',
    task.steps.map((step, i) => `${i + 1}. ${step}`).join('\n'),
    dependencyNotes(run, task),
    'Protocol, followed exactly:',
    `- Before you start each step, write one line on its own: STEP k/${n}: <step name>`,
    '- Do only this task; other helpers own the rest of the request.',
    '- End with a line "SUMMARY:" and 3 to 6 lines: what you did, the files you created or changed, anything left open.',
  ].filter(line => line !== '').join('\n')
}

/** One block per task: the exact Agent call the orchestrator should make. */
export function savvyLaunchText(run: SavvyRun, tasks: readonly SavvyTask[]): string {
  const blocks = tasks.map(task => {
    const prompt = buildSavvyAgentPrompt(run, task).replace(/^/gm, '    ')
    return [`--- task ${task.id} ---`, `description: "savvy #${task.id} · ${task.title}"`, 'subagent_type: general-purpose', `model: ${task.model}`, 'run_in_background: true', 'prompt: |', prompt].join('\n')
  })
  return [`Launch these ${tasks.length} now, all in ONE message, each with the Agent tool:`, ...blocks].join('\n')
}

function waitingLine(run: SavvyRun): string {
  const parts = run.tasks.flatMap(task => {
    if (task.status === 'running') return [`#${task.id} running`]
    if (task.status === 'planned') return [`#${task.id} after ${task.deps.join(',')}`]
    return []
  })
  return `Nothing to launch yet: ${parts.join('; ')}. Call ready again when the next helper's notification arrives.`
}

function doneText(run: SavvyRun): string {
  const summaries = run.tasks.map(task => `#${task.id} ${task.title} [${task.status}]\n${task.summary || '(no summary)'}`)
  const files = [...new Set(run.tasks.flatMap(task => task.files))]
  return [
    `All ${run.tasks.length} tasks settled. Consolidate now: tell the person what was done, by task, and what failed, then list the files below.`,
    ...summaries,
    `Files created or changed:\n${files.length === 0 ? '(none recorded)' : files.map(file => `- ${file}`).join('\n')}`,
  ].join('\n\n')
}

/** What `ready` answers: launch list, wait, cancelled, or the consolidation brief. */
export function savvyReadyText(run: SavvyRun, launch: readonly SavvyTask[]): string {
  if (run.cancelled) return 'This savvy run was cancelled by the person. Launch nothing more; report what finished.'
  if (launch.length > 0) return savvyLaunchText(run, launch)
  return isSavvyRunSettled(run) ? doneText(run) : waitingLine(run)
}
