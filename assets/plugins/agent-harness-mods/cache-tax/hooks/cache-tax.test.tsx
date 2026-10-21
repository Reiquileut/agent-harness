// Failure list written before the code (AGENTS.md §7):
// config
// - option missing, zero, negative, NaN or a string → its default
// gate
// - no request yet in the session → never holds
// - idle shorter than the TTL → passes; exactly the TTL → holds
// - a prompt from a notification or a plugin (not typed) → never held
// - held prompt: band shows idle minutes and context tokens; no tokens known → says so
// - "Enviar mesmo assim" → resubmits the same text once and clears the band
// - "Começar conversa nova" → runs /clear, puts the text back in the box, clears the band
// main keep-alive
// - off by default → never forks
// - on: forks once just before the TTL; never while a turn runs; stops at the ping limit
// subagent keep-alive
// - only sonnet/haiku, only idle ones, only after ~TTL-1min of quiet
// - stops once the window since the last real activity is over
// - the ping's own task-notification is dropped, a real one is not
import { expect, mock, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import type { On, TurnStepResult } from 'claude-code'

import { readCacheTaxConfig } from './cache-config'
import { isCacheLikelyCold, isSubagentPingDue, isWarmableSubagentModel } from './cache-clock'

const MINUTE = 60_000
const BAND = { component: 'AbovePrompt', props: { hasSurvey: false, bodyColumns: 80 } } as const

function stepAnswer(model: string, agentId?: string): ($: unknown, e: { agentId?: string }) => AsyncGenerator<never, TurnStepResult> {
  return async function* () {
    return { turnId: 't', index: 0, answer: '', toolUses: [], stopReason: 'end_turn', usage: { model, input_tokens: 1, output_tokens: 1, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 } } as TurnStepResult
  }
}

async function runStep($: Engine, agentId?: string): Promise<void> {
  const stream = $.turn.step({ turnId: 't', index: 0, model: 'm', messageCount: 1, agentId })
  for await (const _chunk of stream) void _chunk
  await stream.result
}

function answerEngine(on: On, model = 'claude-opus-5-5'): { submitted: string[]; commands: string[]; filled: string[]; forks: number; sends: string[] } {
  const seen = { submitted: [] as string[], commands: [] as string[], filled: [] as string[], forks: 0, sends: [] as string[] }
  on('session.start', ($, e) => ({ cwd: e.cwd }))
  on('turn.step', stepAnswer(model) as never)
  on('turn.complete', () => ({ text: '' }))
  on('session.usage', () => ({ value: { startedAt: 0, context: { tokens: 123_456, window: 200_000 } } as never }))
  on('prompt.submit', ($, e) => (seen.submitted.push(e.text), { text: e.text }))
  on('command.run', ($, e) => (seen.commands.push(e.command), { text: '' }))
  on('prompt.fill', ($, e) => (seen.filled.push(e.text), { isFilled: true } as never))
  on('model.fork', () => (seen.forks++, { value: { isAnswered: true, text: 'ok', usage: { input_tokens: 0, output_tokens: 1, cache_read_input_tokens: 9, cache_creation_input_tokens: 0 } } } as never))
  on('session.send', ($, e) => (seen.sends.push(JSON.stringify(e.to)), { isDelivered: true } as never))
  on('ui.render', { component: 'AbovePrompt' }, ($, e) => {
    const { Text } = $.ui.resolve(e)
    return <Text>engine band</Text>
  })
  return seen
}

function typed(text: string) {
  return { text, wait: false, origin: { kind: 'composer' } } as never
}

async function bandText($: Engine): Promise<string> {
  const ui = await $.ui.mount({ plugin: 'cache-tax', surface: 'terminal', ...BAND } as never)
  const text = (await ui.findAll({ type: 'Text' })).map(one => one.text ?? '').join(' ')
  await ui.unmount()
  return text
}

test('config falls back to defaults on bad values', () => {
  const config = readCacheTaxConfig({ cacheTtlMinutes: -5, keepAliveMaxPings: 'x' as never, subagentTtlMinutes: 0 })
  expect(config.cacheTtlMinutes).toBe(60)
  expect(config.keepAlive).toBe(false)
  expect(config.keepAliveMaxPings).toBe(3)
  expect(config.subagentKeepAlive).toBe(true)
  expect(config.subagentTtlMinutes).toBe(5)
  expect(config.subagentKeepAliveWindowMinutes).toBe(30)
})

test('clock helpers', () => {
  expect(isCacheLikelyCold(null, 10 * MINUTE, 60)).toBe(false)
  expect(isCacheLikelyCold(0, 59 * MINUTE, 60)).toBe(false)
  expect(isCacheLikelyCold(0, 60 * MINUTE, 60)).toBe(true)
  expect(isWarmableSubagentModel('claude-haiku-5-5')).toBe(true)
  expect(isWarmableSubagentModel('claude-sonnet-5-5')).toBe(true)
  expect(isWarmableSubagentModel('claude-opus-5-5')).toBe(false)
  const track = { id: 'a', model: 'claude-haiku-5-5', lastRequestAt: 0, lastRealActivityAt: 0, isRunning: false, isPingInFlight: false, pings: 0 }
  const rules = { ttlMinutes: 5, windowMinutes: 30 }
  expect(isSubagentPingDue(track, 3 * MINUTE, rules)).toBe(false)
  expect(isSubagentPingDue(track, 4 * MINUTE, rules)).toBe(true)
  expect(isSubagentPingDue({ ...track, isRunning: true }, 4 * MINUTE, rules)).toBe(false)
  expect(isSubagentPingDue({ ...track, isPingInFlight: true, lastRequestAt: 3 * MINUTE }, 4 * MINUTE, rules)).toBe(false)
  // a ping with no reply for 2+ min no longer blocks the next one
  expect(isSubagentPingDue({ ...track, isPingInFlight: true }, 4 * MINUTE, rules)).toBe(true)
  expect(isSubagentPingDue({ ...track, model: 'claude-opus-5-5' }, 4 * MINUTE, rules)).toBe(false)
  expect(isSubagentPingDue({ ...track, lastRequestAt: 27 * MINUTE }, 31 * MINUTE, rules)).toBe(false)
})

test('gate holds a typed prompt after the TTL and resends on demand', async ($, on) => {
  const clock = mock.clock(on)
  const seen = answerEngine(on)
  await $.prompt.submit(typed('first'))
  expect(seen.submitted).toEqual(['first'])
  await runStep($)
  await clock.advance(30 * MINUTE)
  await $.prompt.submit(typed('soon'))
  expect(seen.submitted).toEqual(['first', 'soon'])
  await clock.advance(61 * MINUTE)
  const held = await $.prompt.submit(typed('late'))
  expect((held as { drop?: string }).drop).toBeDefined()
  expect(seen.submitted).toEqual(['first', 'soon'])
  await $.prompt.submit({ text: 'from plugin', wait: false, origin: { kind: 'task-notification' } } as never)
  expect(seen.submitted).toContain('from plugin')

  const ui = await $.ui.mount({ plugin: 'cache-tax', surface: 'terminal', ...BAND } as never)
  const text = (await ui.findAll({ type: 'Text' })).map(one => one.text ?? '').join(' ')
  expect(text).toMatch(/91 min/)
  expect(text).toMatch(/123\.5k/)
  await ui.press({ key: 'send-anyway' })
  await ui.unmount()
  expect(seen.submitted.filter(one => one === 'late')).toHaveLength(1)
  expect(await bandText($)).toMatch(/engine band/)
})

test('gate starts a new conversation with the held text', async ($, on) => {
  const clock = mock.clock(on)
  const seen = answerEngine(on)
  await runStep($)
  await clock.advance(90 * MINUTE)
  await $.prompt.submit(typed('later'))
  const ui = await $.ui.mount({ plugin: 'cache-tax', surface: 'terminal', ...BAND } as never)
  await ui.press({ key: 'start-fresh' })
  await ui.unmount()
  expect(seen.commands).toEqual(['clear'])
  expect(seen.filled).toEqual(['later'])
  expect(seen.submitted).not.toContain('later')
})

test('main keep-alive is off by default', async ($, on) => {
  const clock = mock.clock(on)
  const seen = answerEngine(on)
  await $.session.start({ cwd: '.', surface: 'terminal', isInteractive: true } as never)
  await runStep($)
  await clock.advance(120 * MINUTE)
  expect(seen.forks).toBe(0)
})

test('main keep-alive pings before the TTL up to the limit', { options: { keepAlive: true, keepAliveMaxPings: 2 } }, async ($, on) => {
  const clock = mock.clock(on)
  const seen = answerEngine(on)
  await $.session.start({ cwd: '.', surface: 'terminal', isInteractive: true } as never)
  await runStep($)
  await clock.advance(55 * MINUTE)
  expect(seen.forks).toBe(0)
  await clock.advance(4 * MINUTE)
  expect(seen.forks).toBe(1)
  await clock.advance(300 * MINUTE)
  expect(seen.forks).toBe(2)
})

test('idle haiku subagent is kept warm inside the window and its ping notice is dropped', async ($, on) => {
  const clock = mock.clock(on)
  const seen = answerEngine(on, 'claude-haiku-5-5')
  on('agent.spawn', () => ({ model: 'claude-haiku-5-5', agentId: 'sub1' }))
  await $.session.start({ cwd: '.', surface: 'terminal', isInteractive: true } as never)
  await $.agent.spawn({ tool_use_id: 'x', prompt: 'p', description: 'd', subagentType: 'Explore', provider: { plugin: 'engine', tier: 'core' }, parentModel: 'm', background: true, fork: false } as never)
  await runStep($, 'sub1')
  await $.turn.complete({ answer: '', durationMs: 1, isAborted: false, turnId: 't', agentId: 'sub1', reason: 'answer' })
  await clock.advance(3 * MINUTE)
  expect(seen.sends).toHaveLength(0)
  await clock.advance(2 * MINUTE)
  expect(seen.sends).toHaveLength(1)
  const notice = await $.prompt.submit({ text: '<task-notification><task-id>sub1</task-id>', wait: false, origin: { kind: 'task-notification' } } as never)
  expect((notice as { drop?: string }).drop).toBeDefined()
  await runStep($, 'sub1')
  await $.turn.complete({ answer: 'ok', durationMs: 1, isAborted: false, turnId: 't', agentId: 'sub1', reason: 'answer' })
  await clock.advance(60 * MINUTE)
  expect(seen.sends.length).toBeLessThanOrEqual(8)
  const real = await $.prompt.submit({ text: '<task-notification><task-id>sub1</task-id>', wait: false, origin: { kind: 'task-notification' } } as never)
  expect((real as { drop?: string }).drop).toBeUndefined()
})
