// What a press or a command does: expand a card, fold a section, open the
// panel, and the two-step cancel (ask, then stop the helpers' turns).
import type { EngineInterface } from 'claude-code'
import type { SavvyTaskStatus } from '../types'
import { cancelSavvyRun, isSavvyRunSettled } from './core/scheduler.ts'
import type { SavvyHandlers } from './render/context.ts'
import { changeSavvyRun, flushSavvyRun, type SavvyRuntimeSlot } from './runtime.ts'
import { SAVVY_PANE_ID, readSavvyRun, updateSavvyPrefs, updateSavvyRun } from './state.ts'

const toggle = <T>(list: readonly T[], item: T): T[] => (list.includes(item) ? list.filter(x => x !== item) : [...list, item])

export async function openSavvyPanel($: EngineInterface): Promise<void> {
  await updateSavvyPrefs($, prefs => ({ ...prefs, hidden: false }))
  await $.ui.open({ id: SAVVY_PANE_ID, title: 'Agents' })
}

/**
 * Marks the run cancelled (nothing more is handed out, planned tasks fail) and
 * aborts each running helper's current turn; their ends then settle as failed.
 */
export async function cancelSavvyRunNow($: EngineInterface, slot: SavvyRuntimeSlot): Promise<string> {
  const runtime = slot.current
  // Queued turn ids must land first, or a just-started helper would not be aborted.
  if (runtime !== null) await flushSavvyRun($, runtime)
  const run = await readSavvyRun($)
  if (run === null) return 'No savvy run to cancel.'
  const now = await $.clock.now()
  if (runtime !== null) await changeSavvyRun($, runtime, r => cancelSavvyRun(r, now), true)
  else await updateSavvyRun($, r => (r === null ? null : cancelSavvyRun(r, now)))
  const turns = run.tasks.filter(task => task.status === 'running' && task.turnId !== null).map(task => task.turnId as string)
  for (const turnId of turns) await $.turn.abort({ turnId }).catch(() => undefined)
  return `Cancelled "${run.name}": ${turns.length} running helper(s) stopped, nothing more will start.`
}

/** The handlers a drawing binds to its Buttons; each runs on the person's press. */
export function savvyHandlers($: EngineInterface, slot: SavvyRuntimeSlot): SavvyHandlers {
  return {
    toggleCard: id => void updateSavvyPrefs($, prefs => ({ ...prefs, expanded: toggle(prefs.expanded, id) })),
    toggleSection: (status: SavvyTaskStatus) => void updateSavvyPrefs($, prefs => ({ ...prefs, collapsed: toggle(prefs.collapsed, status) })),
    openPanel: () => void openSavvyPanel($),
    askCancel: () => void askCancel($),
    answerCancel: yes => void answerCancel($, slot, yes),
  }
}

/** A settled run has nothing to stop: ✕ just dismisses the band then. */
async function askCancel($: EngineInterface): Promise<void> {
  const run = await readSavvyRun($)
  if (run === null || run.cancelled || isSavvyRunSettled(run)) {
    await updateSavvyPrefs($, prefs => ({ ...prefs, hidden: true }))
    return
  }
  await updateSavvyPrefs($, prefs => ({ ...prefs, confirmCancel: true }))
}

async function answerCancel($: EngineInterface, slot: SavvyRuntimeSlot, yes: boolean): Promise<void> {
  await updateSavvyPrefs($, prefs => ({ ...prefs, confirmCancel: false }))
  if (yes) $.ui.toast(await cancelSavvyRunNow($, slot))
}
