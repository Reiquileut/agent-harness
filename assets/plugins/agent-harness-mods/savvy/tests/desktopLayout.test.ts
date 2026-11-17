// Every way the desktop drawing was (or could be) cut off, driven through the
// engine's chain: plan -> one running helper -> the pane and the band mounted.
// Fix 2026-11-17: the desktop app draws an `isInteractive` Svg in an iframe and
// sizes it ONLY from the `width`/`height` props (the markup's own size is not
// read), so a running card's mascot, bar and spinner each came out at the
// browser default of 300x150 CSS px and pushed the text out of the panel.
import { expect, mock, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import { installFakeSavvyEngine, installFakeSavvyStep } from './fakeEngine.ts'
import { SAVVY_TEST_PLAN, runSavvyTestHelper, savvyTestBand, savvyTestMarkerOf, savvyTestPane } from './savvyRunFixture.ts'

/** The narrowest a desktop cell is drawn; `bodyColumns` is the box's px over the cell's. */
const CELL_PX = 7
const MASCOT_PX = 32
/** Below this a bar says nothing, so the drawing keeps it even in a box that cannot hold it. */
const BAR_FLOOR_PX = 64

type SvgSize = { alt: string; width: unknown; height: unknown; isInteractive: boolean }

async function startRunWithOneHelper($: Engine, on: Parameters<typeof installFakeSavvyEngine>[0]): Promise<void> {
  mock.clock(on)
  installFakeSavvyEngine(on, 'desktop')
  installFakeSavvyStep(on, 'STEP 1/3: Read the code\nSTEP 2/3: Write the change\n')
  await $.session.start({ cwd: '/proj', surface: 'desktop', isInteractive: true })
  const planned = await $.tool.call(SAVVY_TEST_PLAN as never)
  await runSavvyTestHelper($, savvyTestMarkerOf(String(planned.result), 1), 1)
}

async function svgSizes($: Engine, site: ReturnType<typeof savvyTestPane> | ReturnType<typeof savvyTestBand>): Promise<SvgSize[]> {
  const ui = await $.ui.mount({ ...site, surface: 'desktop' } as never)
  const found = await ui.findAll({ type: 'Svg' })
  await ui.unmount()
  return found.map(svg => ({ alt: String(svg.props.alt), width: svg.props.width, height: svg.props.height, isInteractive: svg.props.isInteractive === true }))
}

const isPositivePx = (px: unknown): px is number => typeof px === 'number' && Number.isFinite(px) && px > 0

test('every desktop Svg carries its own width and height, animated ones included', async ($, on) => {
  await startRunWithOneHelper($, on)
  for (const site of [savvyTestPane(72), savvyTestBand(100)]) {
    const sizes = await svgSizes($, site)
    expect(sizes.length, `${site.component}: no Svg drawn`).toBeGreaterThan(2)
    expect(sizes.some(svg => svg.isInteractive), `${site.component}: no animated Svg, the iframe path is not covered`).toBe(true)
    for (const svg of sizes) {
      expect(isPositivePx(svg.width), `${site.component} Svg "${svg.alt}": width ${JSON.stringify(svg.width)}, expected CSS px > 0`).toBe(true)
      expect(isPositivePx(svg.height), `${site.component} Svg "${svg.alt}": height ${JSON.stringify(svg.height)}, expected CSS px > 0`).toBe(true)
    }
  }
})

test('no Svg of a card is wider than the room beside the mascot, at any pane width', async ($, on) => {
  await startRunWithOneHelper($, on)
  for (const columns of [0, 12, 30, 48, 72, 200]) {
    const room = Math.max(BAR_FLOOR_PX, columns * CELL_PX - MASCOT_PX)
    for (const svg of await svgSizes($, savvyTestPane(columns))) {
      expect(isPositivePx(svg.width) && svg.width <= room, `pane of ${columns} columns, Svg "${svg.alt}": width ${JSON.stringify(svg.width)}, expected 1..${room}`).toBe(true)
    }
  }
})

test('the band keeps at least half its width for text, at any band width', async ($, on) => {
  await startRunWithOneHelper($, on)
  for (const columns of [30, 60, 100, 240]) {
    const drawn = (await svgSizes($, savvyTestBand(columns))).reduce((sum, svg) => sum + (isPositivePx(svg.width) ? svg.width : Number.POSITIVE_INFINITY), 0)
    expect(drawn <= (columns * CELL_PX) / 2, `band of ${columns} columns: Svgs take ${drawn}px, expected at most ${(columns * CELL_PX) / 2}`).toBe(true)
  }
})

test('a card title has its row to itself: the metrics sit on their own line', async ($, on) => {
  await startRunWithOneHelper($, on)
  const ui = await $.ui.mount({ ...savvyTestPane(48), surface: 'desktop' } as never)
  const boxes = await ui.findAll({ type: 'Box', text: /Login endpoint/ })
  const titleRow = boxes.reduce((innermost, box) => (box.text.length < innermost.text.length ? box : innermost))
  expect(titleRow.text).not.toMatch(/ctx/)
  expect(await ui.find({ type: 'Text', text: /ctx\s+\d+% ·/ }), 'the metrics line is still drawn').toBeDefined()
  await ui.unmount()
})
