// savvy: the /savvy-flow orchestrator's tools plus the savvy-progress mod
// (band, Agents pane, conversation tree). This file only wires the groups;
// each group lives in its own module.
import type { EngineInterface, Register } from 'claude-code'
import { registerSavvyCommand, registerSavvyCommandHandler } from './commands.ts'
import { detectSavvyEnvironment, loadSavvyConfig, savvyThemeFromSetting } from './environment.ts'
import { flushSavvyRun, restoreSavvyAgents, SavvyRuntime, startSavvyTimers, type SavvyRuntimeSlot } from './runtime.ts'
import { registerSavvySites } from './sites.ts'
import { updateSavvyEnv } from './state.ts'
import { registerSavvyToolHandlers, registerSavvyTools } from './tools.ts'
import { registerSavvyTracking } from './tracking.ts'

async function startSavvy($: EngineInterface, slot: SavvyRuntimeSlot): Promise<void> {
  slot.current?.stopTimers()
  const config = await loadSavvyConfig($)
  const runtime = new SavvyRuntime(config)
  slot.current = runtime
  await updateSavvyEnv($, () => ({ theme: 'dark', colorDepth: 'truecolor', reducedMotion: config.ui.reducedMotion }))
  const env = await detectSavvyEnvironment($, config)
  await updateSavvyEnv($, () => env)
  await restoreSavvyAgents($, runtime)
  await registerSavvyTools($)
  await registerSavvyCommand($)
  startSavvyTimers($, runtime)
}

export const register: Register = on => {
  const slot: SavvyRuntimeSlot = { current: null }

  on('session.start', async ($, e, next) => {
    await startSavvy($, slot)
    return next(e)
  })

  on('session.end', async ($, e, next) => {
    const runtime = slot.current
    if (runtime !== null) {
      await flushSavvyRun($, runtime)
      runtime.stopTimers()
    }
    return next(e)
  })

  // The panel follows the theme the person picks in /config.
  on('config.set', { key: 'theme' }, async ($, e, next) => {
    const answer = await next(e)
    await updateSavvyEnv($, env => ({ ...env, theme: savvyThemeFromSetting(e.value) }))
    return answer
  })

  registerSavvyTracking(on, slot)
  registerSavvyToolHandlers(on, slot)
  registerSavvyCommandHandler(on, slot)
  registerSavvySites(on, slot)
}
