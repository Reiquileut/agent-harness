// End to end through the engine's chain: plan -> launch -> steps, tokens and
// tool calls -> settle -> ready -> review -> cancel, then every drawing on the
// terminal and the desktop. Only the engine beneath the plugin is faked.
import { expect, mock, test } from 'claude-code/testing'
import { installFakeSavvyEngine, installFakeSavvyStep } from './fakeEngine.ts'
import { SAVVY_TEST_PLAN as PLAN, SAVVY_TEST_STEPS, finishSavvyTestHelper as finish, runSavvyTestHelper as runHelper, savvyTestBand, savvyTestMarkerOf as markerOf, savvyTestPane } from './savvyRunFixture.ts'

const SURFACES = ['terminal', 'desktop'] as const
const PANE = savvyTestPane(72)
const BAND = savvyTestBand(100)

test('a run from plan to review, drawn on both surfaces', async ($, on) => {
  const clock = mock.clock(on)
  mock.env(on, { COLORTERM: 'truecolor' })
  const fake = installFakeSavvyEngine(on, 'terminal')
  installFakeSavvyStep(on, 'STEP 1/3: Read the code\nSTEP 2/3: Write the change\n')
  await $.session.start({ cwd: '/proj', surface: 'terminal', isInteractive: true })

  const planned = await $.tool.call(PLAN as never)
  const planText = String(planned.result)
  expect(planText).toStartWith("Here's the plan: 4 tasks. 3 helpers start now, and a reviewer checks it all once they finish.")
  expect(markerOf(planText, 4)).toBe('')

  const agent1 = await runHelper($, markerOf(planText, 1), 1)
  expect(fake.spawns[0]).toEqual({ model: 'claude-opus-5-5', background: true })
  await clock.advance(600)

  for (const surface of SURFACES) {
    const ui = await $.ui.mount({ ...PANE, surface } as never)
    expect((await ui.find({ text: /auth api/ }))?.text).toContain('auth api')
    expect((await ui.find({ text: /2\/3 · Write the change/ })), 'check 1').toBeDefined()
    expect((await ui.find({ text: /ctx\s+4% ·\s+38k\s+≈\$0\.09/ })), 'check 2').toBeDefined()
    expect((await ui.find({ text: /after 1,2,3/ })), 'check 3').toBeDefined()
    expect(await ui.find({ type: surface === 'terminal' ? 'Raster' : 'Svg' }), 'check 4').toBeDefined()
    await ui.press({ key: 'card-1' })
    expect(await ui.find({ text: /src\/f1\.ts/ }), 'check 5').toBeDefined()
    await ui.press({ key: 'card-1' })
    await ui.unmount()
  }

  await finish($, agent1, 1)
  const waiting = await $.tool.call({ tool: 'mcp__savvy__ready', tool_use_id: 'r1' } as never)
  expect(String(waiting.result)).toMatch(/Nothing to launch yet/)

  for (const n of [2, 3]) await finish($, await runHelper($, markerOf(planText, n), n), n)
  const ready = await $.tool.call({ tool: 'mcp__savvy__ready', tool_use_id: 'r2' } as never)
  const reviewMarker = markerOf(String(ready.result), 4)
  expect(reviewMarker).not.toBe('')
  expect(String(ready.result)).toMatch(/#1 Login endpoint \(finished\): Did task 1\./)

  await runHelper($, reviewMarker, 4)
  for (const surface of SURFACES) {
    const band = await $.ui.mount({ ...BAND, surface } as never)
    expect(await band.find({ text: /3\/4/ }), 'check 6').toBeDefined()
    await band.press({ key: 'cancel' })
    expect(await band.find({ text: /Cancel this run\?/ }), 'check 7').toBeDefined()
    await band.press({ key: 'cancel-no' })
    expect(await band.find({ text: /Cancel this run\?/ })).toBeUndefined()
    await band.unmount()
  }
  const band = await $.ui.mount({ ...BAND, surface: 'terminal' } as never)
  await band.press({ key: 'cancel' })
  await band.press({ key: 'cancel-yes' })
  expect(fake.aborted).toEqual(['turn-4'])
  await band.unmount()

  const saved = [...fake.files.keys()].find(path => /[\\/]\.claude[\\/]savvy[\\/][^\\/]+\.json$/.test(path))
  expect(saved).toBeDefined()
  const json = JSON.parse(fake.files.get(saved as string) as string)
  expect(json.cancelled).toBe(true)
  expect(json.tasks.map((t: { status: string }) => t.status)).toEqual(['finished', 'finished', 'finished', 'running'])
})

test('/savvy prints the panel inline on a narrow terminal, and lists runs', async ($, on) => {
  mock.clock(on)
  installFakeSavvyEngine(on, 'terminal')
  await $.session.start({ cwd: '/proj', surface: 'terminal', isInteractive: true })
  await $.tool.call(PLAN as never)

  const shown = await $.command.run({ command: 'savvy', args: '', presentation: { isFullscreen: false, columns: 80 } } as never)
  expect(String(shown.text)).toStartWith('savvy panel')
  const row = await $.ui.mount({ plugin: 'savvy', surface: 'terminal', component: 'CommandOutput', requestId: 'cmd', props: { command: 'savvy', args: '', text: String(shown.text), isErrored: false } } as never)
  expect(await row.find({ text: /Planned/ }), 'check 8').toBeDefined()
  expect(await row.find({ text: /Tokens/ }), 'check 9').toBeDefined()
  await row.unmount()

  const runs = await $.command.run({ command: 'savvy', args: 'runs', presentation: { isFullscreen: false, columns: 80 } } as never)
  expect(String(runs.text)).toMatch(/\| auth api \|/)

  const off = await $.command.run({ command: 'savvy', args: 'off', presentation: { isFullscreen: false, columns: 80 } } as never)
  expect(String(off.text)).toMatch(/hidden/)
  const band = await $.ui.mount({ ...BAND, surface: 'terminal' } as never)
  expect(await band.find({ text: /auth api/ })).toBeUndefined()
  await band.unmount()
})

test('a malformed plan is refused with the offending value', async ($, on) => {
  mock.clock(on)
  installFakeSavvyEngine(on, 'desktop')
  await $.session.start({ cwd: '/proj', surface: 'desktop', isInteractive: true })
  const refused = await $.tool.call({ ...PLAN, tasks: [{ title: 'x', profile: 'turbo', steps: SAVVY_TEST_STEPS }] } as never)
  expect(String(refused.deny)).toMatch(/"turbo"/)
})
