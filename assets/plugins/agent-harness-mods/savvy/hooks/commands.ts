// `/savvy` and its subcommands. Bare `/savvy` docks the panel where the
// surface docks one (desktop; terminal fullscreen >= ui.dockMinColumns) and
// otherwise prints the whole panel into the conversation (drawn by sites.ts
// on the command's output row).
import type { CommandRunInput, EngineInterface, On } from 'claude-code'
import type { SavvyUiPrefs } from '../types'
import { listSavvyRuns, savvyRunsTable } from './archive.ts'
import { cancelSavvyRunNow, openSavvyPanel } from './actions.ts'
import type { SavvyRuntimeSlot } from './runtime.ts'
import { SAVVY_PANE_ID, readSavvyRun, updateSavvyPrefs } from './state.ts'

export const SAVVY_COMMAND = 'savvy'
export const SAVVY_INLINE_MARK = 'savvy panel'

const HELP = [
  '`/savvy` opens the Agents panel (or prints it here when the terminal cannot dock it)',
  '`/savvy runs` lists this project\'s runs · `/savvy off` hides everything · `/savvy on` shows it again',
  '`/savvy icons ascii|sprite` switches the mascots · `/savvy cancel` stops the active run',
].join('\n')

export async function registerSavvyCommand($: EngineInterface): Promise<void> {
  await $.command.register({ name: SAVVY_COMMAND, description: 'savvy: Agents panel, run history, hide/show', argumentHint: '[runs|off|on|icons ascii|icons sprite|cancel]' })
}

async function panel($: EngineInterface, slot: SavvyRuntimeSlot, e: CommandRunInput): Promise<{ text: string }> {
  const run = await readSavvyRun($)
  if (run === null) return { text: 'No savvy run yet. Start one with `/savvy-flow <request>`.' }
  const surface = await $.session.surface().catch(() => null)
  const minColumns = slot.current?.config.ui.dockMinColumns ?? 110
  if (surface !== 'terminal' || (e.presentation?.isFullscreen === true && e.presentation.columns >= minColumns)) {
    await openSavvyPanel($)
    return { text: `Agents panel opened for "${run.name}".` }
  }
  await updateSavvyPrefs($, prefs => ({ ...prefs, hidden: false }))
  return { text: `${SAVVY_INLINE_MARK}: ${run.name}` }
}

async function setPrefs($: EngineInterface, change: (prefs: SavvyUiPrefs) => SavvyUiPrefs, text: string): Promise<{ text: string }> {
  await updateSavvyPrefs($, change)
  return { text }
}

/** Routes `/savvy <args>`; every answer is the command's own output row. */
export async function runSavvyCommand($: EngineInterface, slot: SavvyRuntimeSlot, e: CommandRunInput): Promise<{ text: string }> {
  const args = e.args.trim().toLowerCase().split(/\s+/).filter(Boolean)
  switch (args[0]) {
    case undefined: return panel($, slot, e)
    case 'runs': return { text: savvyRunsTable(await listSavvyRuns($)) }
    case 'off':
      await $.ui.close({ id: SAVVY_PANE_ID }).catch(() => undefined)
      return setPrefs($, prefs => ({ ...prefs, hidden: true }), 'savvy is hidden. `/savvy on` shows it again.')
    case 'on': return setPrefs($, prefs => ({ ...prefs, hidden: false }), 'savvy is shown.')
    case 'icons': {
      const mode = args[1] === 'ascii' ? 'ascii' : 'sprite'
      return setPrefs($, prefs => ({ ...prefs, icons: mode }), `Mascots: ${mode}.`)
    }
    case 'cancel': return { text: await cancelSavvyRunNow($, slot) }
    default: return { text: `Unknown /savvy option ${JSON.stringify(e.args)}.\n\n${HELP}` }
  }
}

export function registerSavvyCommandHandler(on: On, slot: SavvyRuntimeSlot): void {
  on('command.run', { command: SAVVY_COMMAND }, async ($, e) => runSavvyCommand($, slot, e))
}
