// The desktop (and vscode / mobile) drawing: the same tree shape as the
// terminal, with SVG mascots, rounded bars and a pulsing running indicator.
import { savvyNode as n, isSavvyMotionOn, type SavvyDrawContext } from './context.ts'
import type { SavvyCardView, SavvySectionView } from './viewModel.ts'
import { SAVVY_BAR_HEIGHT_PX, SAVVY_ICON_PX, savvyBarSvg, savvyMascotSvg, savvyPulseSvg, savvySpinnerSvg, savvyStatusSvg } from './svg.ts'

// The app measures `bodyColumns` as the box's CSS px over its cell width. That width
// is not exposed, so 7 is an estimate on the low side; where it is still too high,
// the app's own `max-width:100%` on every Svg keeps a bar inside its box.
const PX_PER_COLUMN = 7
const MASCOT_PX = 32
const BAND_MASCOT_PX = 18
/** What a card's bar cannot use: the pane's padding, the card's border and padding, the mascot and its gap. */
const CARD_CHROME_PX = MASCOT_PX + 56
const CARD_BAR_PX = { min: 64, max: 520 } as const
const BAND_BAR_PX = { min: 40, max: 140 } as const
/** The band's bar takes a fifth of the band, so the name, the counts and the time keep theirs. */
const BAND_BAR_SHARE = 0.2

type SavvySvgBox = { width: number; height: number }
type SavvyPxRange = { min: number; max: number }

const squareBox = (px: number): SavvySvgBox => ({ width: px, height: px })
const ICON_BOX = squareBox(SAVVY_ICON_PX)

/** `px` rounded into `range`; a width that is not a number takes the minimum. */
const clampPx = (px: number, range: SavvyPxRange): number =>
  Math.round(Math.min(range.max, Math.max(range.min, Number.isFinite(px) ? px : range.min)))

/**
 * One Svg, ALWAYS with `width` and `height`. Fix 2026-11-17: the desktop app sizes
 * the element from these two props alone (`width:…px;height:…px;max-width:100%`),
 * and an `isInteractive` one is an iframe, which without them is the browser's
 * default 300x150: every running card's mascot, bar and spinner came out huge
 * and the band was cut. The markup's own width/height only size the plain image.
 */
function svgNode(ctx: SavvyDrawContext, source: string, alt: string, box: SavvySvgBox, animated: boolean): unknown {
  return n(ctx, 'Svg', { source, alt, width: box.width, height: box.height, ...(animated && isSavvyMotionOn(ctx) ? { isInteractive: true } : {}) })
}

type SavvyBarNode = { width: number; fraction: number; color: string; alt: string; animated: boolean }

function barNode(ctx: SavvyDrawContext, bar: SavvyBarNode): unknown {
  const animated = bar.animated && isSavvyMotionOn(ctx)
  const source = savvyBarSvg({ width: bar.width, fraction: bar.fraction, color: bar.color, track: ctx.palette.track, animated })
  return svgNode(ctx, source, bar.alt, { width: bar.width, height: SAVVY_BAR_HEIGHT_PX }, bar.animated)
}

function statusNode(ctx: SavvyDrawContext, card: SavvyCardView): unknown {
  if (card.status === 'running') return svgNode(ctx, savvySpinnerSvg(ctx.palette[card.profile], ctx.palette.track, isSavvyMotionOn(ctx)), 'running', ICON_BOX, true)
  return svgNode(ctx, savvyStatusSvg(card.status, ctx.palette), card.status, ICON_BOX, false)
}

function totalsCard(ctx: SavvyDrawContext, label: string, value: string): unknown {
  return n(ctx, 'Box', { flexDirection: 'column', flexGrow: 1, borderStyle: 'round', borderColor: ctx.palette.border, backgroundColor: ctx.palette.surface, padding: 'sm' },
    n(ctx, 'Text', { size: 'caption', dimColor: true }, label),
    n(ctx, 'Text', { size: 'heading', weight: 'semibold', tabular: true }, value))
}

function header(ctx: SavvyDrawContext): unknown {
  const { done, total, pct } = ctx.view.progress
  return n(ctx, 'Box', { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 'sm' },
    n(ctx, 'Box', { flexDirection: 'row', gap: 'xs', alignItems: 'center' },
      svgNode(ctx, savvyPulseSvg(ctx.view.isActive ? ctx.palette.success : ctx.palette.dim, ctx.view.isActive && isSavvyMotionOn(ctx)), 'run status', ICON_BOX, ctx.view.isActive),
      n(ctx, 'Text', { size: 'title', weight: 'semibold' }, ctx.view.name)),
    n(ctx, 'Text', { size: 'footnote', dimColor: true, tabular: true }, ctx.view.cancelled ? 'cancelled' : `${done}/${total} · ${pct}%`))
}

function cardBody(ctx: SavvyDrawContext, card: SavvyCardView): unknown[] {
  const color = ctx.palette[card.profile]
  const title = n(ctx, 'Button', { key: `card-${card.id}`, plain: true, onPress: () => ctx.handlers.toggleCard(card.id) },
    n(ctx, 'Text', { weight: 'semibold', color: card.status === 'running' ? color : undefined }, card.title))
  const progress = card.status === 'planned' && card.waitingText !== '' ? `◷ ${card.waitingText}` : card.stepText
  const barWidth = clampPx(ctx.columns * PX_PER_COLUMN - CARD_CHROME_PX, CARD_BAR_PX)
  // The title shares its row with the status mark only: beside the padded metrics
  // (28 mono characters) a narrow pane left it a few characters wide (2026-11-17).
  return [
    n(ctx, 'Box', { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', gap: 'sm' }, title, statusNode(ctx, card)),
    n(ctx, 'Text', { size: 'footnote' }, n(ctx, 'Text', { color, weight: 'medium' }, card.profile), n(ctx, 'Text', { dimColor: true }, ` ${card.metaText}`)),
    n(ctx, 'Text', { size: 'footnote', dimColor: true }, progress),
    barNode(ctx, { width: barWidth, fraction: card.fraction, color, alt: `${Math.round(card.fraction * 100)}% of the steps`, animated: card.status === 'running' }),
    n(ctx, 'Text', { size: 'caption', dimColor: true, tabular: true, mono: true }, card.metricsText),
  ]
}

function expanded(ctx: SavvyDrawContext, card: SavvyCardView): unknown {
  const marks = { done: ['✓', ctx.palette.success], current: ['▶', ctx.palette[card.profile]], todo: ['○', ctx.palette.dim] } as const
  const steps = card.steps.map((step, i) => {
    const [glyph, hex] = marks[card.stepMarks[i] ?? 'todo']
    return n(ctx, 'Text', { size: 'footnote' }, n(ctx, 'Text', { color: hex }, `${glyph}  `), step)
  })
  const tools = card.toolCalls.map(call => n(ctx, 'Text', { size: 'caption', mono: true, dimColor: true }, `› ${call.tool}  ${call.detail}`))
  return n(ctx, 'Box', { flexDirection: 'column', gap: 'xs', paddingLeft: 'xl' },
    ...steps,
    tools.length > 0 ? n(ctx, 'Text', { size: 'caption', weight: 'semibold', dimColor: true }, 'Recent tools') : null, ...tools,
    card.summary === '' ? null : n(ctx, 'Text', { size: 'caption', weight: 'semibold', dimColor: true }, 'Summary'),
    card.summary === '' ? null : n(ctx, 'Markdown', { text: card.summary.slice(0, 1500) }))
}

function agentCard(ctx: SavvyDrawContext, card: SavvyCardView): unknown {
  const mascot = svgNode(ctx, savvyMascotSvg({ profile: card.profile, palette: ctx.palette, px: MASCOT_PX, animated: card.status === 'running' && isSavvyMotionOn(ctx) }), `${card.profile} helper`, squareBox(MASCOT_PX), card.status === 'running')
  return n(ctx, 'Box', { flexDirection: 'column', gap: 'xs', borderStyle: 'round', borderColor: ctx.palette.border, padding: 'sm' },
    n(ctx, 'Box', { flexDirection: 'row', gap: 'sm' }, mascot, n(ctx, 'Box', { flexDirection: 'column', flexGrow: 1, gap: 'xs' }, ...cardBody(ctx, card))),
    card.expanded ? expanded(ctx, card) : null)
}

function section(ctx: SavvyDrawContext, view: SavvySectionView): unknown {
  const toggle = n(ctx, 'Button', { key: `section-${view.status}`, plain: true, onPress: () => ctx.handlers.toggleSection(view.status) },
    n(ctx, 'Text', { dimColor: true }, view.collapsed ? '▸ ' : '▾ '),
    n(ctx, 'Text', { weight: 'semibold' }, view.label), n(ctx, 'Text', { dimColor: true }, ` · ${view.count}`))
  return n(ctx, 'Box', { flexDirection: 'column', gap: 'sm' }, toggle, ...(view.collapsed ? [] : view.cards.map(card => agentCard(ctx, card))))
}

/** The docked "Agents" panel. */
export function savvyDesktopPanel(ctx: SavvyDrawContext): unknown {
  const { cost, tokens, time } = ctx.view.totals
  return n(ctx, 'Box', { flexDirection: 'column', gap: 'md', padding: 'sm' },
    header(ctx),
    n(ctx, 'Box', { flexDirection: 'row', gap: 'sm' }, totalsCard(ctx, 'Cost', cost), totalsCard(ctx, 'Tokens', tokens), totalsCard(ctx, 'Time', time)),
    ...ctx.view.sections.map(view => section(ctx, view)))
}

/** The band above the prompt: name opens the panel, ✕ asks before cancelling. */
export function savvyDesktopBand(ctx: SavvyDrawContext): unknown {
  if (ctx.confirmCancel) {
    return n(ctx, 'Box', { flexDirection: 'row', gap: 'sm', alignItems: 'center' },
      n(ctx, 'Text', { color: ctx.palette.careful }, 'Cancel this run? Running helpers are stopped.'),
      n(ctx, 'Button', { key: 'cancel-yes', label: 'Yes, cancel', variant: 'primary', onPress: () => ctx.handlers.answerCancel(true) }),
      n(ctx, 'Button', { key: 'cancel-no', label: 'No', onPress: () => ctx.handlers.answerCancel(false) }))
  }
  const { done, total, pct } = ctx.view.progress
  const profile = ctx.view.sections.find(s => s.status === 'running')?.cards[0]?.profile ?? ctx.view.profiles[0] ?? 'medium'
  const motion = ctx.view.isActive && isSavvyMotionOn(ctx)
  const barWidth = clampPx(ctx.columns * PX_PER_COLUMN * BAND_BAR_SHARE, BAND_BAR_PX)
  return n(ctx, 'Box', { flexDirection: 'row', gap: 'sm', alignItems: 'center' },
    svgNode(ctx, savvyPulseSvg(ctx.view.isActive ? ctx.palette.success : ctx.palette.dim, motion), 'status', ICON_BOX, ctx.view.isActive),
    n(ctx, 'Button', { key: 'open-panel', plain: true, onPress: () => ctx.handlers.openPanel() }, n(ctx, 'Text', { weight: 'semibold' }, ctx.view.name)),
    barNode(ctx, { width: barWidth, fraction: pct / 100, color: ctx.palette[profile], alt: `${pct}%`, animated: ctx.view.isActive }),
    n(ctx, 'Text', { tabular: true }, `${done}/${total}`, n(ctx, 'Text', { dimColor: true }, ` · ${pct}%`)),
    svgNode(ctx, savvyMascotSvg({ profile, palette: ctx.palette, px: BAND_MASCOT_PX, animated: false }), 'helper', squareBox(BAND_MASCOT_PX), false),
    n(ctx, 'Text', { dimColor: true }, `×${total}`),
    ctx.view.isActive ? svgNode(ctx, savvySpinnerSvg(ctx.palette.text, ctx.palette.track, motion), 'working', ICON_BOX, true) : null,
    n(ctx, 'Text', { tabular: true }, ctx.view.totals.time),
    n(ctx, 'Button', { key: 'cancel', plain: true, label: '✕', onPress: () => ctx.handlers.askCancel() }))
}

/** Under the plan's tool row on the desktop. */
export function savvyDesktopTree(ctx: SavvyDrawContext): unknown {
  const { done, total } = ctx.view.progress
  const launched = ctx.view.sections.flatMap(s => s.cards).filter(card => card.status !== 'planned').sort((a, b) => a.id - b.id)
  const branches = launched.map((card, i) => n(ctx, 'Text', { size: 'footnote' },
    n(ctx, 'Text', { dimColor: true }, i === launched.length - 1 ? '└ ' : '├ '),
    n(ctx, 'Text', { color: ctx.palette[card.profile] }, card.status === 'finished' ? '✓ ' : card.status === 'failed' ? '✗ ' : '• '),
    card.title))
  return n(ctx, 'Box', { flexDirection: 'column', gap: 'xs' },
    n(ctx, 'Text', null, n(ctx, 'Text', { weight: 'semibold' }, 'savvy-progress'), n(ctx, 'Text', { dimColor: true }, ' · progress · '), `Tasks ${done}/${total}`),
    n(ctx, 'Text', { size: 'footnote', dimColor: true }, `${launched.length} background ${launched.length === 1 ? 'agent' : 'agents'} launched`),
    ...branches)
}
