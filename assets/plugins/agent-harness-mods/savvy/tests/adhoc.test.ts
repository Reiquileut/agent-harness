// Ad-hoc agents: an Agent call that carries no savvy marker still shows in the
// panel. Written before the code (failure list first): no run yet, a run already
// running, a planned run in progress, a settled or cancelled run, an empty
// description, model aliases, effort left alone, and a spawn that started nothing.
import { expect, mock, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import { installFakeSavvyEngine, installFakeSavvyStep } from './fakeEngine.ts'

const steps = ['Read', 'Write', 'Check']
const PLAN = {
  tool: 'mcp__savvy__plan', tool_use_id: 'plan-1', name: 'planned run', request: 'x',
  tasks: [{ title: 'A', profile: 'medium', steps }, { title: 'B', profile: 'light', steps }, { title: 'Review', profile: 'careful', steps, deps: [1, 2] }],
}

const adhoc = (description: string, model?: string, prompt = 'do the thing') => ({
  tool_use_id: 'agent-call', prompt, description, subagentType: 'general-purpose', model,
  provider: { plugin: 'engine', tier: 'core' }, parentModel: 'claude-opus-5-5', background: false, fork: false,
}) as never

type Run = { id: string; name: string; cancelled: boolean; tasks: Array<{ title: string; status: string; model: string; agentId: string | null; summary: string; adhoc?: boolean }> }
let files: Map<string, string> = new Map()
/** The run savvy saved last: every change is written to .claude/savvy/<run-id>.json. */
const readRun = async (_: Engine): Promise<Run | null> => {
  const runs = [...files.entries()].filter(([path]) => path.includes('savvy') && path.endsWith('.json')).map(([, text]) => JSON.parse(text) as Run & { createdAt: number })
  if (runs.length === 0) return null
  const latest = runs.sort((a, b) => b.createdAt - a.createdAt || b.id.localeCompare(a.id))[0] as Run
  return latest
}

const finish = ($: Engine, agentId: string, answer = 'SUMMARY:\nDone.') =>
  $.turn.complete({ answer, durationMs: 1, isAborted: false, turnId: `t-${agentId}`, agentId, reason: 'answer' } as never)

type TestOn = Parameters<typeof installFakeSavvyEngine>[0]
/** `before` adds hooks beneath the plugin first: the test kit takes them only before the first $ call. */
async function boot($: Engine, on: TestOn, before: (on: TestOn) => void = () => undefined, step = true, spawnsAgents = true, mockClock = true) {
  const clock = mockClock ? mock.clock(on) : null
  before(on)
  const fake = installFakeSavvyEngine(on, 'terminal', spawnsAgents)
  if (step) installFakeSavvyStep(on, 'working\n')
  files = fake.files
  await $.session.start({ cwd: '/proj', surface: 'terminal', isInteractive: true })
  return Object.assign(fake, { clock: clock as ReturnType<typeof mock.clock> })
}

test('an ad-hoc agent with no run yet opens an "Agentes avulsos" run, model and background untouched', async ($, on) => {
  const fake = await boot($, on)
  const spawned = await $.agent.spawn(adhoc('Fact review', 'sonnet'))
  expect(fake.spawns[0]).toEqual({ model: 'sonnet', background: false })
  const run = await readRun($)
  expect(run?.name).toBe('Agentes avulsos')
  expect(run?.tasks).toHaveLength(1)
  expect(run?.tasks[0]).toMatchObject({ title: 'Fact review', status: 'running', model: 'sonnet', agentId: spawned.agentId, adhoc: true })
})

test('a second ad-hoc agent joins the same run, and each settles on its own', async ($, on) => {
  await boot($, on)
  const a = await $.agent.spawn(adhoc('first'))
  const b = await $.agent.spawn(adhoc('second', 'haiku'))
  await finish($, a.agentId as string)
  const run = await readRun($)
  expect(run?.tasks.map(t => [t.title, t.status, t.model])).toEqual([['first', 'finished', 'opus'], ['second', 'running', 'haiku']])
  expect(run?.tasks[0]?.summary).toBe('Done.')
  void b
})

test('an ad-hoc agent during a planned run joins that run without touching its planned tasks', async ($, on) => {
  await boot($, on)
  await $.tool.call(PLAN as never)
  await $.agent.spawn(adhoc('side job'))
  const run = await readRun($)
  expect(run?.name).toBe('planned run')
  expect(run?.tasks.map(t => t.status)).toEqual(['planned', 'planned', 'planned', 'running'])
  const ready = await $.tool.call({ tool: 'mcp__savvy__ready', tool_use_id: 'r-1' } as never)
  expect(String(ready.result)).not.toContain('side job')
})

test('a settled or cancelled run is replaced by a new ad-hoc run', async ($, on) => {
  const { clock } = await boot($, on)
  const a = await $.agent.spawn(adhoc('old'))
  await finish($, a.agentId as string)
  await $.agent.spawn(adhoc('new'))
  expect((await readRun($))?.tasks.map(t => t.title)).toEqual(['old', 'new'])

  await clock.advance(60_000)
  await $.tool.call(PLAN as never)
  await $.command.run({ command: 'savvy', args: 'cancel' } as never)
  expect((await readRun($))?.cancelled).toBe(true)
  await clock.advance(60_000)
  await $.agent.spawn(adhoc('after cancel'))
  const run = await readRun($)
  expect(run?.name).toBe('Agentes avulsos')
  expect(run?.tasks.map(t => t.title)).toEqual(['after cancel'])
})

test('an empty description takes the first line of the prompt, cut to 60 characters', async ($, on) => {
  await boot($, on)
  await $.agent.spawn(adhoc('', undefined, `${'x'.repeat(80)}\nsecond line`))
  expect((await readRun($))?.tasks[0]?.title).toBe('x'.repeat(60))
})

test('an ad-hoc agent keeps the effort its own call chose', async ($, on) => {
  const seen: Array<string | undefined> = []
  await boot($, on, o => o('turn.step', async function* (_, e) {
    seen.push((e as { effort?: string }).effort)
    return { turnId: e.turnId, index: e.index, answer: '', toolUses: [], stopReason: 'end_turn' } as never
  }), false)
  const a = await $.agent.spawn(adhoc('x'))
  for await (const _ of $.turn.step({ turnId: 't', index: 0, model: 'm', messageCount: 1, agentId: a.agentId, effort: 'low' } as never)) void _
  expect(seen).toEqual(['low'])
})

test('a spawn that started no agent adds no task', async ($, on) => {
  await boot($, on, undefined, true, false)
  await $.agent.spawn(adhoc('nothing started'))
  expect(await readRun($)).toBeNull()
})

// fix 2026-10-21: in a real session the clock.every beat stopped flushing, so ad-hoc
// cards sat at 0 tokens until the next spawn forced a write. Events must flush on
// their own, at most once per beat period, with the beat gone.
test('with the beat timer dead, an agent tool calls and tokens still reach the run', async ($, on) => {
  let t = 1_000
  await boot($, on, o => {
    o('clock.now', () => ({ value: t }))
    o('clock.every', () => ({ deny: 'the interval stopped' }) as never)
    o('clock.after', () => ({ deny: 'no timers' }) as never)
  }, true, true, false)
  const a = await $.agent.spawn(adhoc('long review'))
  const agentId = a.agentId as string
  t += 1_000
  await $.tool.call({ tool: 'Read', tool_use_id: 'r-1', file_path: 'a.txt', agentId } as never)
  t += 1_000
  for await (const _ of $.turn.step({ turnId: 't-1', index: 0, model: 'claude-opus-5-5', messageCount: 1, agentId } as never)) void _
  t += 1_000
  await $.tool.call({ tool: 'Read', tool_use_id: 'r-2', file_path: 'b.txt', agentId } as never)
  const task = (await readRun($))?.tasks[0] as unknown as { tokens: number; cost: number; toolCalls: unknown[] }
  expect(task.toolCalls.length).toBeGreaterThanOrEqual(1)
  expect(task.tokens).toBeGreaterThan(0)
  expect(task.cost).toBeGreaterThan(0)
})
