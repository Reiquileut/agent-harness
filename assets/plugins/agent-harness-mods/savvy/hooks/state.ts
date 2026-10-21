// The values savvy keeps in `$.state` (they survive a hot reload; module
// variables do not). Drawings read them, which subscribes the drawing, so a
// write redraws exactly the sites that read the changed value.
// Every read/update of these atoms lives in this file: `claude plugin validate`
// only follows an atom defined in the same file as the call, so an atom
// imported into another module fails the scan ("a source the scan can read").
import type { EngineInterface } from 'claude-code'
import { atom, read, update } from 'claude-code'
import type { SavvyEnvironment, SavvyRun, SavvyUiPrefs } from '../types'

export const SAVVY_PANE_ID = 'savvy-agents'
export const SAVVY_PLAN_TOOL = 'plan'
export const SAVVY_READY_TOOL = 'ready'
export const SAVVY_PLAN_TOOL_FULL = 'mcp__savvy__plan'
export const SAVVY_READY_TOOL_FULL = 'mcp__savvy__ready'

export const SAVVY_DEFAULT_PREFS: SavvyUiPrefs = { hidden: false, icons: 'sprite', expanded: [], collapsed: [], confirmCancel: false }
export const SAVVY_DEFAULT_ENV: SavvyEnvironment = { theme: 'dark', colorDepth: 'truecolor', reducedMotion: false }

const savvyRunAtom = atom({ plugin: 'savvy', key: 'run' } as const, null)
const savvyPrefsAtom = atom({ plugin: 'savvy', key: 'prefs' } as const, SAVVY_DEFAULT_PREFS)
const savvyEnvAtom = atom({ plugin: 'savvy', key: 'env' } as const, SAVVY_DEFAULT_ENV)
const savvyBeatAtom = atom({ plugin: 'savvy', key: 'beat' } as const, 0)

/** Reads the active run; inside a ui.render hook this subscribes the drawing. */
export function readSavvyRun($: EngineInterface): Promise<SavvyRun | null> {
  return read($, savvyRunAtom)
}
/** Read-apply-write with `ifVersion`; resolves to the value written. */
export function updateSavvyRun($: EngineInterface, change: (run: SavvyRun | null) => SavvyRun | null): Promise<SavvyRun | null> {
  return update($, savvyRunAtom, change)
}

export function readSavvyPrefs($: EngineInterface): Promise<SavvyUiPrefs> {
  return read($, savvyPrefsAtom)
}
export function updateSavvyPrefs($: EngineInterface, change: (prefs: SavvyUiPrefs) => SavvyUiPrefs): Promise<SavvyUiPrefs> {
  return update($, savvyPrefsAtom, change)
}

export function readSavvyEnv($: EngineInterface): Promise<SavvyEnvironment> {
  return read($, savvyEnvAtom)
}
export function updateSavvyEnv($: EngineInterface, change: (env: SavvyEnvironment) => SavvyEnvironment): Promise<SavvyEnvironment> {
  return update($, savvyEnvAtom, change)
}

export function readSavvyBeat($: EngineInterface): Promise<number> {
  return read($, savvyBeatAtom)
}
export function updateSavvyBeat($: EngineInterface, change: (beat: number) => number): Promise<number> {
  return update($, savvyBeatAtom, change)
}
