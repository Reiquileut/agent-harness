// The "Agents" panel on the terminal: run name, three total cards, collapsible
// sections and one card per agent. Used docked (fullscreen, >= 110 columns)
// and inline under `/savvy`, with the same tree.
import { savvyNode as n, type SavvyDrawContext } from './context.ts'
import type { SavvyCardView, SavvySectionView } from './viewModel.ts'
import { fitSavvyText, termBar, termColor, termMascot, termStatusGlyph, termTitleColor, SAVVY_SPRITE_COLUMNS } from './termParts.ts'

const PADDING = 1
const GAP = 1
const WIDE_CARD = 58

function totalsCard(ctx: SavvyDrawContext, label: string, value: string, width: number): unknown {
  return n(ctx, 'Box', { flexDirection: 'column', borderStyle: 'round', borderColor: termColor(ctx, ctx.palette.border), paddingX: 1, width },
    n(ctx, 'Text', { dimColor: true }, label),
    n(ctx, 'Text', { bold: true }, value.padStart(width - 4)),
  )
}

/** Cost | Tokens | Time side by side from ui.sideBySideMinColumns, stacked below. */
function totalsRow(ctx: SavvyDrawContext, width: number): unknown {
  const sideBySide = width >= ctx.config.ui.sideBySideMinColumns
  const cardWidth = sideBySide ? Math.floor((width - 2 * GAP) / 3) : width
  const { cost, tokens, time } = ctx.view.totals
  return n(ctx, 'Box', { flexDirection: sideBySide ? 'row' : 'column', gap: sideBySide ? GAP : 0 },
    totalsCard(ctx, 'Cost', cost, cardWidth), totalsCard(ctx, 'Tokens', tokens, cardWidth), totalsCard(ctx, 'Time', time, cardWidth))
}

function header(ctx: SavvyDrawContext, width: number): unknown {
  const { done, total, pct } = ctx.view.progress
  const right = ctx.view.cancelled ? 'cancelled' : `${done}/${total} · ${pct}%`
  return n(ctx, 'Box', { flexDirection: 'row', justifyContent: 'space-between' },
    n(ctx, 'Text', { bold: true }, fitSavvyText(ctx.view.name, width - right.length - 2)),
    n(ctx, 'Text', { dimColor: true }, right))
}

function cardTitleRow(ctx: SavvyDrawContext, card: SavvyCardView, inner: number): unknown {
  const wide = inner >= WIDE_CARD
  const chevron = card.expanded ? '▾ ' : '▸ '
  const room = wide ? inner - card.metricsText.length - 3 : inner - 2
  const title = n(ctx, 'Button', { key: `card-${card.id}`, plain: true, onPress: () => ctx.handlers.toggleCard(card.id) },
    n(ctx, 'Text', { dimColor: true }, chevron),
    n(ctx, 'Text', { bold: true, color: termTitleColor(ctx, card) }, fitSavvyText(card.title, room)))
  if (!wide) return title
  return n(ctx, 'Box', { flexDirection: 'row', justifyContent: 'space-between' }, title, n(ctx, 'Text', { dimColor: true }, card.metricsText))
}

function cardLines(ctx: SavvyDrawContext, card: SavvyCardView, inner: number): unknown[] {
  const color = termColor(ctx, ctx.palette[card.profile])
  const progress = card.status === 'planned' && card.waitingText !== '' ? `◷ ${card.waitingText}` : card.stepText
  return [
    cardTitleRow(ctx, card, inner),
    n(ctx, 'Text', null, n(ctx, 'Text', { color }, card.profile), n(ctx, 'Text', { dimColor: true }, ` ${card.metaText}`)),
    inner >= WIDE_CARD ? null : n(ctx, 'Text', { dimColor: true }, card.metricsText),
    n(ctx, 'Text', { dimColor: true }, fitSavvyText(progress, inner)),
    n(ctx, 'Box', { flexDirection: 'row', gap: 1 },
      termBar(ctx, { key: `bar-${card.id}`, width: inner - 2, fraction: card.fraction, hex: ctx.palette[card.profile] }),
      termStatusGlyph(ctx, card)),
  ]
}

function expandedLines(ctx: SavvyDrawContext, card: SavvyCardView, inner: number): unknown {
  const marks = { done: ['✓', ctx.palette.success], current: ['▶', ctx.palette[card.profile]], todo: ['○', ctx.palette.dim] } as const
  const steps = card.steps.map((step, i) => {
    const [glyph, hex] = marks[card.stepMarks[i] ?? 'todo']
    return n(ctx, 'Text', null, n(ctx, 'Text', { color: termColor(ctx, hex) }, `${glyph} `), fitSavvyText(step, inner - 2))
  })
  const tools = card.toolCalls.map(call => n(ctx, 'Text', { dimColor: true }, fitSavvyText(`› ${call.tool}  ${call.detail}`, inner)))
  return n(ctx, 'Box', { flexDirection: 'column', paddingLeft: SAVVY_SPRITE_COLUMNS + GAP },
    ...steps,
    tools.length > 0 ? n(ctx, 'Text', { dimColor: true, bold: true }, 'Recent tools') : null, ...tools,
    card.summary === '' ? null : n(ctx, 'Text', { dimColor: true, bold: true }, 'Summary'),
    card.summary === '' ? null : n(ctx, 'Text', { wrap: 'wrap' }, card.summary.slice(0, 600)))
}

function agentCard(ctx: SavvyDrawContext, card: SavvyCardView, width: number): unknown {
  const inner = width - SAVVY_SPRITE_COLUMNS - GAP
  const row = n(ctx, 'Box', { flexDirection: 'row', gap: GAP },
    termMascot(ctx, `sprite-${card.id}`, card.profile, card.status === 'running'),
    n(ctx, 'Box', { flexDirection: 'column', width: inner }, ...cardLines(ctx, card, inner)))
  return n(ctx, 'Box', { flexDirection: 'column' }, row, card.expanded ? expandedLines(ctx, card, inner) : null)
}

function section(ctx: SavvyDrawContext, view: SavvySectionView, width: number): unknown {
  const toggle = n(ctx, 'Button', { key: `section-${view.status}`, plain: true, onPress: () => ctx.handlers.toggleSection(view.status) },
    n(ctx, 'Text', { dimColor: true }, view.collapsed ? '▸ ' : '▾ '),
    n(ctx, 'Text', { bold: true }, view.label),
    n(ctx, 'Text', { dimColor: true }, ` · ${view.count}`))
  const cards = view.collapsed ? [] : view.cards.map(card => agentCard(ctx, card, width))
  return n(ctx, 'Box', { flexDirection: 'column', gap: 1 }, toggle, ...cards)
}

/**
 * The whole panel, `ctx.columns` wide; `framed` adds the rounded outer border
 * used when `/savvy` prints the panel into the conversation.
 */
export function savvyTerminalPanel(ctx: SavvyDrawContext, framed: boolean): unknown {
  const width = ctx.columns - 2 * PADDING - (framed ? 2 : 0)
  return n(ctx, 'Box', {
    flexDirection: 'column', gap: 1, paddingX: PADDING,
    ...(framed ? { borderStyle: 'round', borderColor: termColor(ctx, ctx.palette.border) } : {}),
  }, header(ctx, width), totalsRow(ctx, width), ...ctx.view.sections.map(view => section(ctx, view, width)))
}
