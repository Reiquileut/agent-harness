// savvy.config.json: profiles -> model + effort, model prices and windows, the
// palette and UI knobs. The defaults below mirror plugin/savvy.config.json so the
// plugin still runs (and tests stay hermetic) when the file cannot be read.
import type { SavvyEffort, SavvyProfile, SavvyThemeMode } from '../../types'

export type SavvyModelPrice = { input: number; output: number; cacheRead: number; cacheWrite: number }
export type SavvyModelSpec = { id: string; label: string; contextWindow: number; price: SavvyModelPrice }
export type SavvyProfileSpec = { model: string; effort: SavvyEffort }
export type SavvyPaletteTokens = {
  light: string; medium: string; careful: string; heavy: string
  text: string; dim: string; border: string; track: string
  success: string; error: string; surface: string
}
export type SavvyUiConfig = {
  reducedMotion: boolean
  icons: 'sprite' | 'ascii'
  colorDepth: 'auto' | 'truecolor' | 'ansi256' | 'ansi16'
  dataFps: number
  animFps: number
  spriteFps: number
  dockMinColumns: number
  sideBySideMinColumns: number
}
export type SavvyConfig = {
  profiles: Record<SavvyProfile, SavvyProfileSpec>
  models: Record<string, SavvyModelSpec>
  palette: Record<SavvyThemeMode, SavvyPaletteTokens>
  ui: SavvyUiConfig
}

export const SAVVY_EFFORTS: readonly SavvyEffort[] = ['low', 'medium', 'high', 'xhigh', 'max']

const opus = (id: string, label: string, price: SavvyModelPrice): SavvyModelSpec => ({ id, label, contextWindow: 1_000_000, price })

export const DEFAULT_SAVVY_CONFIG: SavvyConfig = {
  profiles: {
    light: { model: 'opus', effort: 'low' },
    medium: { model: 'opus', effort: 'medium' },
    careful: { model: 'opus', effort: 'high' },
    heavy: { model: 'opus', effort: 'xhigh' },
  },
  models: {
    opus: opus('claude-opus-5-5', 'Opus', { input: 4, output: 20, cacheRead: 0.2, cacheWrite: 5 }),
    sonnet: opus('claude-sonnet-5-5', 'Sonnet', { input: 2, output: 10, cacheRead: 0.2, cacheWrite: 2.5 }),
    haiku: opus('claude-haiku-5-5', 'Haiku', { input: 0.1, output: 0.5, cacheRead: 0.01, cacheWrite: 0.125 }),
    fable: opus('claude-fable-5-1', 'Fable', { input: 10, output: 50, cacheRead: 0.25, cacheWrite: 12.5 }),
  },
  palette: {
    dark: {
      light: '#3fb950', medium: '#4c8dff', careful: '#e3a03a', heavy: '#a8714f',
      text: '#e6edf3', dim: '#7d8590', border: '#3d444d', track: '#30363d',
      success: '#3fb950', error: '#f85149', surface: '#161b22',
    },
    light: {
      light: '#2da44e', medium: '#3b7ae8', careful: '#c4861d', heavy: '#8b5a3c',
      text: '#1f2328', dim: '#656d76', border: '#d0d7de', track: '#e6e9ed',
      success: '#1a7f37', error: '#cf222e', surface: '#f6f8fa',
    },
  },
  ui: {
    reducedMotion: false, icons: 'sprite', colorDepth: 'auto',
    dataFps: 2, animFps: 8, spriteFps: 4, dockMinColumns: 110, sideBySideMinColumns: 44,
  },
}

type Loose = Record<string, unknown>
const isLoose = (v: unknown): v is Loose => typeof v === 'object' && v !== null && !Array.isArray(v)

/** Deep-merges plain objects; arrays and scalars from `patch` replace. */
export function mergeSavvyObjects<T>(base: T, patch: unknown): T {
  if (!isLoose(base) || !isLoose(patch)) return (patch === undefined ? base : patch) as T
  const merged: Loose = { ...base }
  for (const [key, value] of Object.entries(patch)) {
    if (key.startsWith('$')) continue
    merged[key] = mergeSavvyObjects(merged[key], value)
  }
  return merged as T
}

/**
 * Parses one or more config texts (plugin file, then project override) over the
 * defaults and checks that every profile names a known model and effort.
 * @example parseSavvyConfig([pluginText, projectText])
 */
export function parseSavvyConfig(texts: ReadonlyArray<string | undefined>): SavvyConfig {
  let config = DEFAULT_SAVVY_CONFIG
  for (const text of texts) {
    if (text === undefined || text.trim() === '') continue
    config = mergeSavvyObjects(config, JSON.parse(text) as unknown)
  }
  assertSavvyConfig(config)
  return config
}

function assertSavvyConfig(config: SavvyConfig): void {
  for (const [profile, spec] of Object.entries(config.profiles)) {
    if (config.models[spec.model] === undefined) {
      throw new Error(`savvy.config.json: profile "${profile}" names model ${JSON.stringify(spec.model)}, expected one of ${Object.keys(config.models).join(', ')}`)
    }
    if (!SAVVY_EFFORTS.includes(spec.effort)) {
      throw new Error(`savvy.config.json: profile "${profile}" has effort ${JSON.stringify(spec.effort)}, expected one of ${SAVVY_EFFORTS.join(', ')}`)
    }
  }
}

/** The model spec behind a model key, falling back to the first model when unknown. */
export function savvyModelSpec(config: SavvyConfig, modelKey: string): SavvyModelSpec {
  const spec = config.models[modelKey] ?? Object.values(config.models)[0]
  if (spec === undefined) throw new Error(`savvy config has no models; received key ${JSON.stringify(modelKey)}`)
  return spec
}
