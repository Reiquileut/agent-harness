// The desktop (and vscode / mobile) drawing: the same tree shape as the
// terminal, with SVG mascots, rounded bars and a pulsing running indicator.
import { savvyNode as n, isSavvyMotionOn, type SavvyDrawContext } from './context.ts'
import type { SavvyCardView, SavvySectionView } from './viewModel.ts'
import { savvyBarSvg, savvyMascotSvg, savvyPulseSvg, savvySpinnerSvg, savvyStatusSvg } from './svg.ts'

const PX_PER_COLUMN = 7
const MASCOT_PX = 32

const pxFor = (ctx: SavvyDrawContext, columns: number, min: number, max: number): number =>
  Math.round(Math.min(max, Math.max(min, columns * PX_PER_COLUMN)))

function svgNode(ctx: SavvyDrawContext, source: string, alt: string, animated: boolean): unknown {
  return n(ctx, 'Svg', { source, alt, ...(animated && isSavvyMotionOn(ctx) ? { isInteractive: true } : {}) })
}

function statusNode(ctx: SavvyDrawContext, card: SavvyCardView): unknown {
  if (card.status === 'running') return svgNode(ctx, savvySpinnerSvg(ctx.palette[card.profile], ctx.palette.track, isSavvyMotionOn(ctx)), 'running', true)
  return svgNode(ctx, savvyStatusSvg(card.status, ctx.palette), card.status, false)
}

function totalsCard(ctx: SavvyDrawContext, label: string, value: string): unknown {
  return n(ctx, 'Box', { flexDirection: 'column', flexGrow: 1, borderStyle: 'round', borderColor: ctx.palette.border, backgroundColor: ctx.palette.surface, padding: 'sm' },
    n(ctx, 'Text', { size: 'caption', dimColor: true }, label),
    n(ctx, 'Text', { size: 'heading', weight: 'semibold', tabular: true }, value))
}

function header(ctx: SavvyDrawContext): unknown {
  const { done, total, pct } = ctx.view.progress
  return n(ctx, 'Box', { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
    n(ctx, 'Box', { flexDirection: 'row', gap: 'xs', alignItems: 'center' },
      svgNode(ctx, savvyPulseSvg(ctx.view.isActive ? ctx.palette.success : ctx.palette.dim, ctx.view.isActive && isSavvyMotionOn(ctx)), 'run status', ctx.view.isActive),
      n(ctx, 'Text', { size: 'title', weight: 'semibold' }, ctx.view.name)),
    n(ctx, 'Text', { size: 'footnote', dimColor: true, tabular: true }, ctx.view.cancelled ? 'cancelled' : `${done}/${total} · ${pct}%`))
}

function cardBody(ctx: SavvyDrawContext, card: SavvyCardView): unknown[] {
  const color = ctx.palette[card.profile]
  const title = n(ctx, 'Button', { key: `card-${card.id}`, plain: true, onPress: () => ctx.handlers.toggleCard(card.id) },
    n(ctx, 'Text', { weight: 'semibold', color: card.status === 'running' ? color : undefined }, card.title))
  const progress = card.status === 'planned' && card.waitingText !== '' ? `◷ ${card.waitingText}` : card.stepText
  // The bar sits alone on its row: an Svg with no width prop shrinks to the slot.
  return [
    n(ctx, 'Box', { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 'sm' },
      title,
      n(ctx, 'Box', { flexDirection: 'row', gap: 'xs', alignItems: 'center' },
        n(ctx, 'Text', { size: 'caption', dimColor: true, tabular: true, mono: true }, card.metricsText), statusNode(ctx, card))),
    n(ctx, 'Text', { size: 'footnote' }, n(ctx, 'Text', { color, weight: 'medium' }, card.profile), n(ctx, 'Text', { dimColor: true }, ` ${card.metaText}`)),
    n(ctx, 'Text', { size: 'footnote', dimColor: true }, progress),
    n(ctx, 'Svg', {
      source: savvyBarSvg({ width: pxFor(ctx, ctx.columns, 160, 520), fraction: card.fraction, color, track: ctx.palette.track, animated: card.status === 'running' && isSavvyMotionOn(ctx) }),
      alt: `${Math.round(card.fraction * 100)}% of the steps`,
      ...(card.status === 'running' && isSavvyMotionOn(ctx) ? { isInteractive: true } : {}),
    }),
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
  const mascot = svgNode(ctx, savvyMascotSvg({ profile: card.profile, palette: ctx.palette, px: MASCOT_PX, animated: card.status === 'running' && isSavvyMotionOn(ctx) }), `${card.profile} helper`, card.status === 'running')
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
  return n(ctx, 'Box', { flexDirection: 'row', gap: 'sm', alignItems: 'center' },
    svgNode(ctx, savvyPulseSvg(ctx.view.isActive ? ctx.palette.success : ctx.palette.dim, motion), 'status', ctx.view.isActive),
    n(ctx, 'Button', { key: 'open-panel', plain: true, onPress: () => ctx.handlers.openPanel() }, n(ctx, 'Text', { weight: 'semibold' }, ctx.view.name)),
    svgNode(ctx, savvyBarSvg({ width: 140, fraction: pct / 100, color: ctx.palette[profile], track: ctx.palette.track, animated: motion }), `${pct}%`, ctx.view.isActive),
    n(ctx, 'Text', { tabular: true }, `${done}/${total}`, n(ctx, 'Text', { dimColor: true }, ` · ${pct}%`)),
    svgNode(ctx, savvyMascotSvg({ profile, palette: ctx.palette, px: 18, animated: false }), 'helper', false),
    n(ctx, 'Text', { dimColor: true }, `×${total}`),
    ctx.view.isActive ? svgNode(ctx, savvySpinnerSvg(ctx.palette.text, ctx.palette.track, motion), 'working', true) : null,
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
