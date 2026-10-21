// The four places savvy draws: the band above the prompt, the docked "Agents"
// pane, the plan's tool row in the conversation, and `/savvy`'s output row.
// Each reads `$.state`, so only the sites reading a changed value redraw.
import type { EngineInterface, On, RenderInput } from 'claude-code'
import { savvyHandlers } from './actions.ts'
import { SAVVY_COMMAND, SAVVY_INLINE_MARK } from './commands.ts'
import type { SavvyDrawContext, SavvyElementTable } from './render/context.ts'
import { savvyDesktopBand, savvyDesktopPanel, savvyDesktopTree } from './render/desktop.ts'
import { savvyTerminalBand, savvyTerminalTree } from './render/terminalBand.ts'
import { savvyTerminalPanel } from './render/terminalPanel.ts'
import { buildSavvyPanelView } from './render/viewModel.ts'
import type { SavvyRuntimeSlot } from './runtime.ts'
import { SAVVY_PANE_ID, SAVVY_PLAN_TOOL_FULL, readSavvyBeat, readSavvyEnv, readSavvyPrefs, readSavvyRun } from './state.ts'

/** Everything a component needs, or null when there is no run or savvy is hidden. */
async function drawContext($: EngineInterface, slot: SavvyRuntimeSlot, e: RenderInput, columns: number, ignoreHidden = false): Promise<SavvyDrawContext | null> {
  const runtime = slot.current
  const run = await readSavvyRun($)
  const prefs = await readSavvyPrefs($)
  if (runtime === null || run === null || (prefs.hidden && !ignoreHidden)) return null
  const env = await readSavvyEnv($)
  const beat = await readSavvyBeat($)
  const now = await $.clock.now()
  if (e.surface === 'terminal' && e.viewport !== undefined) runtime.viewport = { columns: e.viewport.columns, isFullscreen: e.viewport.isFullscreen === true }
  runtime.forgetSite(e.requestId)
  return {
    el: $.ui.resolve(e) as unknown as SavvyElementTable,
    view: buildSavvyPanelView({ run, now, config: runtime.config, prefs }),
    env, palette: runtime.config.palette[env.theme], config: runtime.config,
    icons: prefs.icons, columns, beat, confirmCancel: prefs.confirmCancel,
    handlers: savvyHandlers($, slot),
    animate: raster => runtime.animateRaster({ requestId: e.requestId, ...raster }),
  }
}

const asNode = (tree: unknown) => tree as ReturnType<typeof h> & object

export function registerSavvySites(on: On, slot: SavvyRuntimeSlot): void {
  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (e.props.hasSurvey) return next(e)
    const ctx = await drawContext($, slot, e, e.props.bodyColumns)
    if (ctx === null) return next(e)
    return asNode(e.surface === 'terminal' ? savvyTerminalBand(ctx) : savvyDesktopBand(ctx))
  })

  on('ui.render', { component: 'Pane', requestId: SAVVY_PANE_ID }, async ($, e) => {
    const ctx = await drawContext($, slot, e, e.props.bodyColumns, true)
    if (ctx === null) {
      const { Text } = $.ui.resolve(e)
      return h(Text, { dimColor: true }, 'No savvy run yet. Start one with /savvy-flow <request>.') as ReturnType<typeof h> & object
    }
    return asNode(e.surface === 'terminal' ? savvyTerminalPanel(ctx, false) : savvyDesktopPanel(ctx))
  })

  on('ui.render', { component: 'ToolUse', props: { tool: SAVVY_PLAN_TOOL_FULL } }, async ($, e, next) => {
    if (e.props.isExpanded === true || e.props.isRunning || e.props.isErrored) return next(e)
    const run = await readSavvyRun($)
    if (run === null || !String(e.props.output ?? '').includes(run.id)) return next(e)
    const ctx = await drawContext($, slot, e, e.viewport?.columns ?? 80)
    if (ctx === null) return next(e)
    return asNode(e.surface === 'terminal' ? savvyTerminalTree(ctx) : savvyDesktopTree(ctx))
  })

  on('ui.render', { component: 'CommandOutput', props: { command: SAVVY_COMMAND } }, async ($, e, next) => {
    if (!e.props.text.startsWith(SAVVY_INLINE_MARK)) return next(e)
    const ctx = await drawContext($, slot, e, Math.min(e.viewport?.columns ?? 80, 100), true)
    if (ctx === null) return next(e)
    return asNode(e.surface === 'terminal' ? savvyTerminalPanel(ctx, true) : savvyDesktopPanel(ctx))
  })
}
