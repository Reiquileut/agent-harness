// SVG sources for the desktop surface. Animation is SMIL inside the markup
// (the Svg element runs it in a sandboxed frame when `isInteractive`), so the
// desktop animates with no redraw at all; reduced motion drops the <animate>s.
import type { SavvyProfile } from '../../types'
import type { SavvyPaletteTokens } from '../core/config.ts'
import { savvySpritePixels } from './sprites.ts'

const svg = (w: number, h: number, viewBox: string, body: string): string =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="${viewBox}" shape-rendering="crispEdges">${body}</svg>`

/** One <rect> per horizontal run of equal pixels, so a 16x16 sprite stays small. */
function pixelRects(pixels: ReadonlyArray<ReadonlyArray<string | null>>): string {
  const rects: string[] = []
  pixels.forEach((row, y) => {
    let x = 0
    while (x < row.length) {
      const color = row[x]
      let end = x + 1
      while (end < row.length && row[end] === color) end++
      if (color !== null && color !== undefined) rects.push(`<rect x="${x}" y="${y}" width="${end - x}" height="1" fill="${color}"/>`)
      x = end
    }
  })
  return rects.join('')
}

const blink = (values: string, begin: string): string =>
  `<animate attributeName="visibility" values="${values}" dur="0.5s" begin="${begin}" repeatCount="indefinite" calcMode="discrete"/>`

export type SavvyMascotSvg = { profile: SavvyProfile; palette: SavvyPaletteTokens; px: number; animated: boolean }

/** The 16x16 mascot at `px` CSS pixels; two frames swapped at 4 fps while animated. */
export function savvyMascotSvg(spec: SavvyMascotSvg): string {
  const frame = (i: number) => pixelRects(savvySpritePixels({ profile: spec.profile, frame: i, size: 16, palette: spec.palette }))
  if (!spec.animated) return svg(spec.px, spec.px, '0 0 16 16', frame(0))
  const a = `<g>${blink('visible;hidden', '0s')}${frame(0)}</g>`
  const b = `<g visibility="hidden">${blink('hidden;visible', '0s')}${frame(1)}</g>`
  return svg(spec.px, spec.px, '0 0 16 16', a + b)
}

export type SavvyBarSvg = { width: number; fraction: number; color: string; track: string; animated: boolean; height?: number }

/** A rounded bar; a soft highlight sweeps across the fill while animated. */
export function savvyBarSvg(spec: SavvyBarSvg): string {
  const h = spec.height ?? 6
  const r = h / 2
  const fill = Math.max(0, Math.min(1, Number.isFinite(spec.fraction) ? spec.fraction : 0)) * spec.width
  const shine = spec.animated && fill > 0
    ? `<defs><linearGradient id="s"><stop offset="0" stop-color="#fff" stop-opacity="0"/><stop offset="0.5" stop-color="#fff" stop-opacity="0.35"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></linearGradient><clipPath id="c"><rect width="${fill}" height="${h}" rx="${r}"/></clipPath></defs><rect clip-path="url(#c)" y="0" width="${h * 6}" height="${h}" fill="url(#s)"><animate attributeName="x" from="${-h * 6}" to="${fill}" dur="1.6s" repeatCount="indefinite"/></rect>`
    : ''
  const body = `<rect width="${spec.width}" height="${h}" rx="${r}" fill="${spec.track}"/>` +
    (fill > 0 ? `<rect width="${Math.max(fill, h)}" height="${h}" rx="${r}" fill="${spec.color}"/>` : '') + shine
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${spec.width}" height="${h}" viewBox="0 0 ${spec.width} ${h}" preserveAspectRatio="none">${body}</svg>`
}

/** The running indicator: a dot whose halo pulses (static under reduced motion). */
export function savvyPulseSvg(color: string, animated: boolean): string {
  const halo = animated
    ? `<circle cx="7" cy="7" r="4" fill="${color}" opacity="0.35"><animate attributeName="r" values="3.5;6.5;3.5" dur="1.6s" repeatCount="indefinite"/><animate attributeName="opacity" values="0.45;0;0.45" dur="1.6s" repeatCount="indefinite"/></circle>`
    : ''
  return `<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 14 14">${halo}<circle cx="7" cy="7" r="3.5" fill="${color}"/></svg>`
}

/** A small rotating arc, the desktop's spinner. */
export function savvySpinnerSvg(color: string, track: string, animated: boolean): string {
  const spin = animated ? '<animateTransform attributeName="transform" type="rotate" from="0 7 7" to="360 7 7" dur="0.9s" repeatCount="indefinite"/>' : ''
  return `<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 14 14"><circle cx="7" cy="7" r="5" fill="none" stroke="${track}" stroke-width="2"/><path d="M7 2 a5 5 0 0 1 5 5" fill="none" stroke="${color}" stroke-width="2" stroke-linecap="round">${spin}</path></svg>`
}

/** Status glyphs as tiny SVGs so they keep their colour in any theme. */
export function savvyStatusSvg(kind: 'finished' | 'failed' | 'planned', palette: SavvyPaletteTokens): string {
  const paths = {
    finished: `<path d="M3 7.5l2.5 2.5 5.5-6" fill="none" stroke="${palette.success}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>`,
    failed: `<path d="M4 4l6 6M10 4l-6 6" stroke="${palette.error}" stroke-width="2" stroke-linecap="round"/>`,
    planned: `<circle cx="7" cy="7" r="5" fill="none" stroke="${palette.dim}" stroke-width="1.5"/><path d="M7 4v3l2 1.5" fill="none" stroke="${palette.dim}" stroke-width="1.5" stroke-linecap="round"/>`,
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 14 14">${paths[kind]}</svg>`
}
