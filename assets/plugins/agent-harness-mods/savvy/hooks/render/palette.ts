// Colour depth detection and quantising. The terminal gets truecolor when the
// terminal says so (COLORTERM), else the xterm 256 palette, else the 16 ANSI
// colours; Raster cells take RGB only, so they are snapped to the same palette.
import type { SavvyEnvironment } from '../../types'
import type { SavvyUiConfig } from '../core/config.ts'

export type SavvyColorDepth = SavvyEnvironment['colorDepth']
export type SavvyTermEnv = Partial<Record<'COLORTERM' | 'TERM' | 'WT_SESSION' | 'TERM_PROGRAM', string>>

/**
 * COLORTERM=truecolor|24bit wins; Windows Terminal (WT_SESSION) and the VS Code
 * terminal draw 24-bit colour without setting COLORTERM, so they count too.
 * @example detectSavvyColorDepth({ TERM: 'xterm-256color' }, 'auto') // 'ansi256'
 */
export function detectSavvyColorDepth(env: SavvyTermEnv, override: SavvyUiConfig['colorDepth']): SavvyColorDepth {
  if (override !== 'auto') return override
  const colorterm = (env.COLORTERM ?? '').toLowerCase()
  if (colorterm === 'truecolor' || colorterm === '24bit') return 'truecolor'
  if (env.WT_SESSION !== undefined || env.TERM_PROGRAM === 'vscode') return 'truecolor'
  if ((env.TERM ?? '').includes('256')) return 'ansi256'
  return 'ansi16'
}

type Rgb = [number, number, number]

// VGA-style values for the 16 colours, named as Ink/chalk names them.
const ANSI16: ReadonlyArray<[string, string]> = [
  ['black', '#000000'], ['red', '#aa0000'], ['green', '#00aa00'], ['yellow', '#aa5500'],
  ['blue', '#0000aa'], ['magenta', '#aa00aa'], ['cyan', '#00aaaa'], ['white', '#aaaaaa'],
  ['blackBright', '#555555'], ['redBright', '#ff5555'], ['greenBright', '#55ff55'], ['yellowBright', '#ffff55'],
  ['blueBright', '#5555ff'], ['magentaBright', '#ff55ff'], ['cyanBright', '#55ffff'], ['whiteBright', '#ffffff'],
]
const CUBE = [0, 95, 135, 175, 215, 255]

export function parseSavvyHex(hex: string): Rgb {
  const match = /^#([0-9a-f]{6})$/i.exec(hex)
  if (match === null) throw new Error(`savvy colour: received ${JSON.stringify(hex)}, expected #rrggbb`)
  const n = Number.parseInt(match[1] as string, 16)
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
}

const toHex = ([r, g, b]: Rgb): string => `#${[r, g, b].map(v => Math.round(v).toString(16).padStart(2, '0')).join('')}`
const distance = (a: Rgb, b: Rgb): number => (a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2 + (a[2] - b[2]) ** 2
const nearestLevel = (v: number): number => CUBE.reduce((best, level, i) => (Math.abs(level - v) < Math.abs((CUBE[best] as number) - v) ? i : best), 0)

/** xterm-256 index and colour nearest to `rgb`, from the 6x6x6 cube or the grey ramp. */
function nearest256(rgb: Rgb): { index: number; rgb: Rgb } {
  const [r, g, b] = rgb.map(nearestLevel) as Rgb
  const cube: Rgb = [CUBE[r] as number, CUBE[g] as number, CUBE[b] as number]
  const greyStep = Math.min(23, Math.max(0, Math.round(((rgb[0] + rgb[1] + rgb[2]) / 3 - 8) / 10)))
  const grey: Rgb = [8 + greyStep * 10, 8 + greyStep * 10, 8 + greyStep * 10]
  return distance(rgb, grey) < distance(rgb, cube)
    ? { index: 232 + greyStep, rgb: grey }
    : { index: 16 + 36 * r + 6 * g + b, rgb: cube }
}

function nearest16(rgb: Rgb): [string, string] {
  return ANSI16.reduce((best, entry) => (distance(rgb, parseSavvyHex(entry[1])) < distance(rgb, parseSavvyHex(best[1])) ? entry : best))
}

/** The colour the terminal will really show at `depth`, as #rrggbb. */
export function quantizeSavvyHex(hex: string, depth: SavvyColorDepth): string {
  const rgb = parseSavvyHex(hex)
  if (depth === 'truecolor') return hex.toLowerCase()
  return depth === 'ansi256' ? toHex(nearest256(rgb).rgb) : nearest16(rgb)[1]
}

/** A Text `color` prop for `depth`: hex, `ansi256(n)` or an ANSI colour name. */
export function savvyTextColor(hex: string, depth: SavvyColorDepth): string {
  if (depth === 'truecolor') return hex
  const rgb = parseSavvyHex(hex)
  return depth === 'ansi256' ? `ansi256(${nearest256(rgb).index})` : nearest16(rgb)[0]
}

/** Raster cells take 0xRRGGBB; this is the quantised colour as that number. */
export const savvyCellColor = (hex: string, depth: SavvyColorDepth): number => Number.parseInt(quantizeSavvyHex(hex, depth).slice(1), 16)

/** Linear blend from `a` to `b`, t in 0..1, for the running pulse. */
export function mixSavvyHex(a: string, b: string, t: number): string {
  const x = parseSavvyHex(a)
  const y = parseSavvyHex(b)
  const k = Math.min(1, Math.max(0, t))
  return toHex([x[0] + (y[0] - x[0]) * k, x[1] + (y[1] - x[1]) * k, x[2] + (y[2] - x[2]) * k])
}
