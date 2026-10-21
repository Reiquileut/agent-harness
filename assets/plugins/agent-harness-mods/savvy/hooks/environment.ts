// Reads savvy.config.json (the plugin's, then the project's override) and the
// facts the drawing depends on: theme, colour depth, reduced motion.
import type { EngineInterface } from 'claude-code'
import type { SavvyEnvironment, SavvyThemeMode } from '../types'
import { DEFAULT_SAVVY_CONFIG, parseSavvyConfig, type SavvyConfig } from './core/config.ts'
import { detectSavvyColorDepth, type SavvyTermEnv } from './render/palette.ts'

export const SAVVY_PROJECT_CONFIG = '.claude/savvy.config.json'

function readOptional($: EngineInterface, path: string): Promise<string | undefined> {
  return $.fs.read(path).then(text => (typeof text === 'string' ? text : undefined), () => undefined)
}

/**
 * The merged config; a broken file is reported once and the defaults stand.
 * @example const config = await loadSavvyConfig($)
 */
export async function loadSavvyConfig($: EngineInterface): Promise<SavvyConfig> {
  const texts = [await readOptional($, `${$.plugin.root}/savvy.config.json`), await readOptional($, SAVVY_PROJECT_CONFIG)]
  try {
    return parseSavvyConfig(texts)
  } catch (error) {
    $.ui.toast(`savvy: ${error instanceof Error ? error.message : String(error)}; using the defaults`)
    return DEFAULT_SAVVY_CONFIG
  }
}

/** Claude Code's theme names say light or dark (`light`, `dark-daltonized`, ...). */
export function savvyThemeFromSetting(value: unknown): SavvyThemeMode {
  return typeof value === 'string' && value.toLowerCase().includes('light') ? 'light' : 'dark'
}

async function readTheme($: EngineInterface): Promise<SavvyThemeMode> {
  const rows = await $.config.list().catch(() => [])
  return savvyThemeFromSetting(rows.find(row => row.key === 'theme')?.value)
}

/**
 * Theme from /config, colour depth from the terminal's variables, reduced
 * motion from the config or SAVVY_REDUCED_MOTION=1 (the API exposes no OS flag).
 */
export async function detectSavvyEnvironment($: EngineInterface, config: SavvyConfig): Promise<SavvyEnvironment> {
  // Literal names only: the engine lists every variable a module reads.
  const termEnv: SavvyTermEnv = {
    COLORTERM: await $.env.get('COLORTERM').catch(() => undefined),
    TERM: await $.env.get('TERM').catch(() => undefined),
    WT_SESSION: await $.env.get('WT_SESSION').catch(() => undefined),
    TERM_PROGRAM: await $.env.get('TERM_PROGRAM').catch(() => undefined),
  }
  const reducedFlag = await $.env.get('SAVVY_REDUCED_MOTION').catch(() => undefined)
  return {
    theme: await readTheme($),
    colorDepth: detectSavvyColorDepth(termEnv, config.ui.colorDepth),
    reducedMotion: config.ui.reducedMotion || reducedFlag === '1' || reducedFlag === 'true',
  }
}
