// What every savvy component receives: the surface's element table, the view
// model, the palette for the theme, and the handlers presses call. Components
// are plain functions over this, so the preview script can call them with a
// fake element table and print the result without an engine.
import type { SavvyEnvironment, SavvyIconMode, SavvyTaskStatus } from '../../types'
import type { SavvyConfig, SavvyPaletteTokens } from '../core/config.ts'
import type { SavvyPanelView } from './viewModel.ts'

/** An element constructor as `$.ui.resolve(e)` hands them out (props in, node out). */
export type SavvyElement = (props: never) => unknown
export type SavvyElementTable = Record<string, SavvyElement>

export type SavvyHandlers = {
  toggleCard: (id: number) => void
  toggleSection: (status: SavvyTaskStatus) => void
  openPanel: () => void
  askCancel: () => void
  answerCancel: (yes: boolean) => void
}

/** A Raster the animation loop should repaint (terminal only). */
export type SavvyAnimatedRaster = { key: string; frames: readonly string[]; divisor: number }

export type SavvyDrawContext = {
  el: SavvyElementTable
  view: SavvyPanelView
  env: SavvyEnvironment
  palette: SavvyPaletteTokens
  config: SavvyConfig
  icons: SavvyIconMode
  columns: number
  beat: number
  confirmCancel: boolean
  handlers: SavvyHandlers
  animate: (raster: SavvyAnimatedRaster) => void
}

/** `h` over an element of the table; children are flattened by the factory. */
export function savvyNode(ctx: SavvyDrawContext, name: string, props: Record<string, unknown> | null, ...children: unknown[]): unknown {
  const element = ctx.el[name]
  if (element === undefined) throw new Error(`savvy: the surface has no ${JSON.stringify(name)} element, expected one of ${Object.keys(ctx.el).join(', ')}`)
  return h(element as never, props, ...children)
}

export const isSavvyMotionOn = (ctx: SavvyDrawContext): boolean => !ctx.env.reducedMotion

/** Title brightness for the running pulse: a triangle wave over 4 data beats. */
export function savvyPulseLevel(beat: number): number {
  const phase = ((beat % 4) + 4) % 4
  return phase <= 2 ? phase / 2 : (4 - phase) / 2
}
