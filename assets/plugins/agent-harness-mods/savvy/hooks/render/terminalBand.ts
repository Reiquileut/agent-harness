// The terminal's band above the prompt and the tree under the plan's tool row:
// "● run  ▕████▌░░░▏ 2/4 · 50%  ▀▀▀×4  ⠋ 0:26  ✕"
import { savvyNode as n, savvyPulseLevel, isSavvyMotionOn, type SavvyDrawContext } from './context.ts'
import { mixSavvyHex } from './palette.ts'
import { fitSavvyText, termBar, termColor, termMiniMascot, termSpinner } from './termParts.ts'

const BAR_WIDTH = 18
const FIXED_BAND_CELLS = 52

function runningProfileHex(ctx: SavvyDrawContext): string {
  const running = ctx.view.sections.find(section => section.status === 'running')?.cards[0]
  return ctx.palette[running?.profile ?? 'medium']
}

function confirmRow(ctx: SavvyDrawContext): unknown {
  return n(ctx, 'Box', { flexDirection: 'row', gap: 1 },
    n(ctx, 'Text', { color: termColor(ctx, ctx.palette.careful) }, 'Cancel this run? Running helpers are stopped.'),
    n(ctx, 'Button', { key: 'cancel-yes', label: 'Yes, cancel', hotkey: 'y', variant: 'primary', onPress: () => ctx.handlers.answerCancel(true) }),
    n(ctx, 'Button', { key: 'cancel-no', label: 'No', hotkey: 'n', onPress: () => ctx.handlers.answerCancel(false) }))
}

function dot(ctx: SavvyDrawContext): unknown {
  const hex = ctx.view.isActive && isSavvyMotionOn(ctx)
    ? mixSavvyHex(ctx.palette.dim, ctx.palette.success, 0.4 + 0.6 * savvyPulseLevel(ctx.beat))
    : ctx.view.isActive ? ctx.palette.success : ctx.palette.dim
  return n(ctx, 'Text', { color: termColor(ctx, hex) }, '●')
}

/** One row; the run name opens the panel, ✕ asks before cancelling. */
export function savvyTerminalBand(ctx: SavvyDrawContext): unknown {
  if (ctx.confirmCancel) return confirmRow(ctx)
  const { done, total, pct } = ctx.view.progress
  const name = fitSavvyText(ctx.view.name, Math.max(8, ctx.columns - FIXED_BAND_CELLS))
  const profile = ctx.view.sections.find(s => s.status === 'running')?.cards[0]?.profile ?? ctx.view.profiles[0] ?? 'medium'
  return n(ctx, 'Box', { flexDirection: 'row', gap: 1 },
    dot(ctx),
    n(ctx, 'Button', { key: 'open-panel', plain: true, onPress: () => ctx.handlers.openPanel() }, n(ctx, 'Text', { bold: true }, name)),
    termBar(ctx, { key: 'band-bar', width: BAR_WIDTH, fraction: pct / 100, hex: runningProfileHex(ctx), caps: true }),
    n(ctx, 'Text', null, `${done}/${total}`, n(ctx, 'Text', { dimColor: true }, ` · ${String(pct).padStart(3)}%`)),
    n(ctx, 'Box', { flexDirection: 'row' }, termMiniMascot(ctx, 'band-mascot', profile), n(ctx, 'Text', { dimColor: true }, `×${total}`)),
    ctx.view.isActive ? termSpinner(ctx, 'band-spin', ctx.palette.text) : n(ctx, 'Text', { dimColor: true }, '·'),
    n(ctx, 'Text', null, ctx.view.totals.time.padStart(5)),
    n(ctx, 'Button', { key: 'cancel', plain: true, label: '✕', onPress: () => ctx.handlers.askCancel() }))
}

/** Under the plan's tool row: the header line and one branch per launched helper. */
export function savvyTerminalTree(ctx: SavvyDrawContext): unknown {
  const { done, total } = ctx.view.progress
  const launched = ctx.view.sections.flatMap(s => s.cards).filter(card => card.status !== 'planned').sort((a, b) => a.id - b.id)
  const branches = launched.map((card, i) => {
    const glyph = card.status === 'finished' ? '✓' : card.status === 'failed' ? '✗' : '•'
    return n(ctx, 'Text', null,
      n(ctx, 'Text', { dimColor: true }, i === launched.length - 1 ? '└ ' : '├ '),
      n(ctx, 'Text', { color: termColor(ctx, ctx.palette[card.profile]) }, `${glyph} `),
      fitSavvyText(card.title, ctx.columns - 6))
  })
  const plural = launched.length === 1 ? 'agent' : 'agents'
  return n(ctx, 'Box', { flexDirection: 'column' },
    n(ctx, 'Text', null, n(ctx, 'Text', { bold: true }, 'savvy-progress'), n(ctx, 'Text', { dimColor: true }, ' · progress · '), `Tasks ${done}/${total}`),
    n(ctx, 'Text', { dimColor: true }, `${launched.length} background ${plural} launched`),
    ...branches)
}
