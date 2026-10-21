// Terminal building blocks: half-block mascots, eighth-cell bars, the braille
// spinner and status glyphs. Every grid is one Raster; animated ones register
// their packed frames so the runtime repaints them with `$.ui.blit`.
import type { SavvyProfile } from '../../types'
import { packSavvyCells, savvyBarCells, savvyHalfBlockCells, savvySpinnerCell, SAVVY_SPINNER, type SavvyCell } from './cells.ts'
import { mixSavvyHex, quantizeSavvyHex, savvyCellColor, savvyTextColor } from './palette.ts'
import { savvySpritePixels, SAVVY_ASCII_ICON } from './sprites.ts'
import { isSavvyMotionOn, savvyNode as n, savvyPulseLevel, type SavvyDrawContext } from './context.ts'
import type { SavvyCardView } from './viewModel.ts'

export const SAVVY_SPRITE_COLUMNS = 8
export const SAVVY_SPRITE_ROWS = 4

export const termColor = (ctx: SavvyDrawContext, hex: string): string => savvyTextColor(hex, ctx.env.colorDepth)
const cellColor = (ctx: SavvyDrawContext, hex: string): number => savvyCellColor(hex, ctx.env.colorDepth)

function raster(ctx: SavvyDrawContext, key: string, rows: readonly SavvyCell[][]): unknown {
  return n(ctx, 'Raster', { key, columns: rows[0]?.length ?? 1, rows: rows.length, cells: packSavvyCells(rows.flat()) })
}

function spriteFrame(ctx: SavvyDrawContext, profile: SavvyProfile, frame: number): SavvyCell[][] {
  const pixels = savvySpritePixels({ profile, frame, size: 8, palette: ctx.palette })
  const quantized = pixels.map(row => row.map(px => (px === null ? null : quantizeSavvyHex(px, ctx.env.colorDepth))))
  return savvyHalfBlockCells(quantized)
}

/**
 * The 8x4-cell mascot (8x8 pixels); two frames at ui.spriteFps while `isAnimated`.
 * `/savvy icons ascii` draws a one-line face in the profile colour instead.
 */
export function termMascot(ctx: SavvyDrawContext, key: string, profile: SavvyProfile, isAnimated: boolean): unknown {
  if (ctx.icons === 'ascii') return n(ctx, 'Text', { color: termColor(ctx, ctx.palette[profile]) }, SAVVY_ASCII_ICON)
  const frames = [spriteFrame(ctx, profile, 0), spriteFrame(ctx, profile, 1)]
  if (isAnimated && isSavvyMotionOn(ctx)) {
    const divisor = Math.max(1, Math.round(ctx.config.ui.animFps / ctx.config.ui.spriteFps))
    ctx.animate({ key, frames: frames.map(rows => packSavvyCells(rows.flat())), divisor })
  }
  return raster(ctx, key, frames[0] as SavvyCell[][])
}

/** A 3x1-cell mascot head for the band: hat on top, face below. */
export function termMiniMascot(ctx: SavvyDrawContext, key: string, profile: SavvyProfile): unknown {
  const hat = quantizeSavvyHex(ctx.palette[profile], ctx.env.colorDepth)
  const face = quantizeSavvyHex('#eef1f4', ctx.env.colorDepth)
  const eye = quantizeSavvyHex('#1b1f24', ctx.env.colorDepth)
  return raster(ctx, key, savvyHalfBlockCells([[hat, hat, hat], [face, eye, face]]))
}

export type SavvyTermBar = { key: string; width: number; fraction: number; hex: string; caps?: boolean }

export function termBar(ctx: SavvyDrawContext, bar: SavvyTermBar): unknown {
  const cells = savvyBarCells({
    width: Math.max(3, bar.width),
    fraction: bar.fraction,
    fg: cellColor(ctx, bar.hex),
    // ░ covers a quarter of its cell, so the raw track colour reads as black.
    track: cellColor(ctx, mixSavvyHex(ctx.palette.track, ctx.palette.dim, 0.55)),
    caps: bar.caps === true,
    capColor: cellColor(ctx, ctx.palette.dim),
  })
  return raster(ctx, bar.key, [cells])
}

/** The braille spinner (8 fps); a static dot under reduced motion. */
export function termSpinner(ctx: SavvyDrawContext, key: string, hex: string): unknown {
  const fg = cellColor(ctx, hex)
  if (!isSavvyMotionOn(ctx)) return n(ctx, 'Text', { color: termColor(ctx, hex) }, '●')
  ctx.animate({ key, frames: SAVVY_SPINNER.map((_, i) => packSavvyCells([savvySpinnerCell(i, fg)])), divisor: 1 })
  return raster(ctx, key, [[savvySpinnerCell(0, fg)]])
}

/** ✓ green, ✗ red, ◷ dim, or the spinner while running. */
export function termStatusGlyph(ctx: SavvyDrawContext, card: SavvyCardView): unknown {
  if (card.status === 'running') return termSpinner(ctx, `spin-${card.id}`, ctx.palette[card.profile])
  if (card.status === 'finished') return n(ctx, 'Text', { color: termColor(ctx, ctx.palette.success) }, '✓')
  if (card.status === 'failed') return n(ctx, 'Text', { color: termColor(ctx, ctx.palette.error) }, '✗')
  return n(ctx, 'Text', { dimColor: true }, '◷')
}

/** Running titles breathe between the text colour and the profile colour. */
export function termTitleColor(ctx: SavvyDrawContext, card: SavvyCardView): string {
  if (card.status !== 'running' || !isSavvyMotionOn(ctx)) return termColor(ctx, ctx.palette.text)
  return termColor(ctx, mixSavvyHex(ctx.palette.text, ctx.palette[card.profile], savvyPulseLevel(ctx.beat) * 0.7))
}

/** Cuts `text` to `width` cells with an ellipsis. */
export const fitSavvyText = (text: string, width: number): string =>
  width <= 1 ? text.slice(0, Math.max(0, width)) : text.length <= width ? text : `${text.slice(0, width - 1)}…`
