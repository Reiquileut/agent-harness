// The mascot: one base body, two frames (blink + step), and an accessory per
// profile drawn over it: green cap, blue headband, yellow hard hat, brown hat.
// 8x8 for the terminal (half-blocks, 8x4 cells), 16x16 for the desktop (SVG).
// Legend: . clear, o outline, b body, w eye white, k dark, c cheek,
//         a accessory, A accessory shade.
import type { SavvyProfile } from '../../types'
import type { SavvyPaletteTokens } from '../core/config.ts'

export const SAVVY_PROFILES: readonly SavvyProfile[] = ['light', 'medium', 'careful', 'heavy']
export type SavvySpriteSize = 8 | 16
type Grid = readonly string[]

const BODY_8: readonly [Grid, Grid] = [
  ['........', '........', '.obbbbo.', 'obwbbwbo', 'obkbbkbo', 'obcbbcbo', '.obbbbo.', '.o....o.'],
  ['........', '........', '.obbbbo.', 'obbbbbbo', 'obkbbkbo', 'obcbbcbo', '.obbbbo.', '..o..o..'],
]
const BODY_16: readonly [Grid, Grid] = [
  [
    '................', '................', '................', '................',
    '.....oooooo.....', '...oobbbbbboo...', '..obbbbbbbbbbo..', '..obbwwbbwwbbo..',
    '.obbbwkbbwkbbbo.', '.obbbwkbbwkbbbo.', '.obccbbbbbbccbo.', '.obbbbbkkbbbbbo.',
    '..obbbbbbbbbbo..', '...oobbbbbboo...', '....oo....oo....', '....oo....oo....',
  ],
  [
    '................', '................', '................', '................',
    '.....oooooo.....', '...oobbbbbboo...', '..obbbbbbbbbbo..', '..obbbbbbbbbbo..',
    '.obbbbbbbbbbbbo.', '.obbbkkbbkkbbbo.', '.obccbbbbbbccbo.', '.obbbbbkkbbbbbo.',
    '..obbbbbbbbbbo..', '...oobbbbbboo...', '...oo......oo...', '...oo......oo...',
  ],
]

const ACCESSORY_8: Record<SavvyProfile, Grid> = {
  light: ['........', '..aaaa..', '.aaaaaAA'],
  medium: ['........', '......a.', 'oAAAAAAa'],
  careful: ['...aa...', '.aaaaaa.', 'AAAAAAAA'],
  heavy: ['..aaaa..', '..AAAA..', 'aaaaaaaa'],
}
const ACCESSORY_16: Record<SavvyProfile, Grid> = {
  light: ['................', '................', '.....aaaaaa.....', '....aaaaaaaa....', '...aaaaaaaaaa...', '..aaaaaaaaaaAAAA'],
  medium: ['................', '................', '................', '................', '................', '................', '..oAAAAAAAAAAoaa', '..............a.'],
  careful: ['................', '......aaaa......', '....aaaaaaaa....', '...aaaaAAaaaa...', '...aaaaaaaaaa...', '.AAAAAAAAAAAAAA.'],
  heavy: ['................', '.....aaaaaa.....', '.....aaaaaa.....', '.....AAAAAA.....', '.....aaaaaa.....', 'aaaaaaaaaaaaaaaa'],
}

/** Overlays `top` on `base` row by row; '.' in the overlay keeps the base pixel. */
function overlay(base: Grid, top: Grid): string[] {
  return base.map((row, y) => {
    const over = top[y]
    if (over === undefined) return row
    return [...row].map((ch, x) => (over[x] === undefined || over[x] === '.' ? ch : (over[x] as string))).join('')
  })
}

const SHADE = 0.72

function darken(hex: string, k: number): string {
  const n = Number.parseInt(hex.slice(1), 16)
  const channel = (shift: number): string => Math.round(((n >> shift) & 255) * k).toString(16).padStart(2, '0')
  return `#${channel(16)}${channel(8)}${channel(0)}`
}

function pixelColors(profile: SavvyProfile, palette: SavvyPaletteTokens): Record<string, string | null> {
  const accent = palette[profile]
  return { '.': null, o: '#2b3036', b: '#eef1f4', w: '#ffffff', k: '#1b1f24', c: '#f0a8a8', a: accent, A: darken(accent, SHADE) }
}

export type SavvySpriteRequest = { profile: SavvyProfile; frame: number; size: SavvySpriteSize; palette: SavvyPaletteTokens }

/**
 * The mascot as rows of #rrggbb (null = clear) for a profile and animation frame.
 * @example savvySpritePixels({ profile: 'careful', frame: 0, size: 8, palette })
 */
export function savvySpritePixels(request: SavvySpriteRequest): (string | null)[][] {
  const bodies = request.size === 8 ? BODY_8 : BODY_16
  const accessories = request.size === 8 ? ACCESSORY_8 : ACCESSORY_16
  const grid = overlay(bodies[Math.abs(request.frame) % 2] as Grid, accessories[request.profile])
  const colors = pixelColors(request.profile, request.palette)
  return grid.map(row => [...row].map(ch => colors[ch] ?? null))
}

/** A one-cell-per-glyph stand-in for `/savvy icons ascii`, drawn in the profile colour. */
export const SAVVY_ASCII_ICON = '[•‿•]'
