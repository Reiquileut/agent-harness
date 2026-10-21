// Raster cells for the terminal: half-block sprites, eighth-cell bars and the
// spinner. A Raster is one element per grid (never a Box per cell), and
// `$.ui.blit` repaints one without a render pass, which is how animation runs.

export type SavvyCell = { ch: string; fg: number; bg: number }

/** Bit 24 alone: the terminal's own default colour (RasterProps). */
export const SAVVY_DEFAULT_COLOR = 0x01000000
export const SAVVY_EIGHTHS = ['', '▏', '▎', '▍', '▌', '▋', '▊', '▉'] as const
export const SAVVY_SPINNER = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'] as const

const isWidthOneBmp = (ch: string): boolean => {
  const code = ch.codePointAt(0) ?? 0
  const wide = (code >= 0x1100 && code <= 0x115f) || (code >= 0x2e80 && code <= 0xa4cf) || (code >= 0xac00 && code <= 0xd7a3) || (code >= 0xf900 && code <= 0xfaff) || (code >= 0xff00 && code <= 0xff60)
  return ch.length === 1 && code >= 0x20 && !wide
}

/**
 * Base64 of little-endian u32 triplets [codePoint, fg, bg], row-major.
 * @example packSavvyCells([{ ch: '█', fg: 0xff8800, bg: SAVVY_DEFAULT_COLOR }])
 */
export function packSavvyCells(cells: readonly SavvyCell[]): string {
  const words = new Uint32Array(cells.length * 3)
  cells.forEach((cell, i) => {
    if (!isWidthOneBmp(cell.ch)) throw new Error(`savvy raster cell ${i}: received ${JSON.stringify(cell.ch)}, expected one printable width-1 BMP character`)
    words.set([cell.ch.codePointAt(0) as number, cell.fg >>> 0, cell.bg >>> 0], i * 3)
  })
  const bytes = new Uint8Array(words.buffer)
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary)
}

const toColor = (hex: string | null): number => (hex === null ? SAVVY_DEFAULT_COLOR : Number.parseInt(hex.slice(1), 16))

/**
 * Two pixel rows per cell: ▀ painted in the top pixel's colour over the bottom
 * pixel's; ▄ when only the bottom is set; a blank when neither is.
 */
export function savvyHalfBlockCells(pixels: ReadonlyArray<ReadonlyArray<string | null>>): SavvyCell[][] {
  if (pixels.length % 2 !== 0) throw new Error(`savvy sprite: received ${pixels.length} pixel rows, expected an even count`)
  const rows: SavvyCell[][] = []
  for (let y = 0; y < pixels.length; y += 2) {
    const top = pixels[y] ?? []
    const bottom = pixels[y + 1] ?? []
    rows.push(top.map((upper, x) => halfBlock(upper, bottom[x] ?? null)))
  }
  return rows
}

function halfBlock(upper: string | null, lower: string | null): SavvyCell {
  if (upper === null && lower === null) return { ch: ' ', fg: SAVVY_DEFAULT_COLOR, bg: SAVVY_DEFAULT_COLOR }
  if (upper === null) return { ch: '▄', fg: toColor(lower), bg: SAVVY_DEFAULT_COLOR }
  return { ch: '▀', fg: toColor(upper), bg: toColor(lower) }
}

export type SavvyBarSpec = { width: number; fraction: number; fg: number; track: number; caps?: boolean; capColor?: number }

/** A bar `width` cells wide (caps included) filled to `fraction` in eighths of a cell. */
export function savvyBarCells(spec: SavvyBarSpec): SavvyCell[] {
  if (spec.width <= 0) return []
  const inner = spec.caps === true ? Math.max(0, spec.width - 2) : spec.width
  const fraction = Number.isFinite(spec.fraction) ? Math.min(1, Math.max(0, spec.fraction)) : 0
  const eighths = Math.round(fraction * inner * 8)
  const cells: SavvyCell[] = []
  for (let i = 0; i < inner; i++) {
    const filled = Math.min(8, Math.max(0, eighths - i * 8))
    if (filled === 8) cells.push({ ch: '█', fg: spec.fg, bg: SAVVY_DEFAULT_COLOR })
    else if (filled > 0) cells.push({ ch: SAVVY_EIGHTHS[filled] as string, fg: spec.fg, bg: SAVVY_DEFAULT_COLOR })
    else cells.push({ ch: '░', fg: spec.track, bg: SAVVY_DEFAULT_COLOR })
  }
  if (spec.caps !== true) return cells
  const cap = spec.capColor ?? spec.track
  return [{ ch: '▕', fg: cap, bg: SAVVY_DEFAULT_COLOR }, ...cells, { ch: '▏', fg: cap, bg: SAVVY_DEFAULT_COLOR }]
}

/** One spinner cell for animation frame `frame`. */
export const savvySpinnerCell = (frame: number, fg: number): SavvyCell => ({
  ch: SAVVY_SPINNER[((frame % SAVVY_SPINNER.length) + SAVVY_SPINNER.length) % SAVVY_SPINNER.length] as string,
  fg,
  bg: SAVVY_DEFAULT_COLOR,
})
