// Failure list written before the code (AGENTS.md §7):
// - catalog: unknown tool, MCP tool (mcp__server__tool), each built-in category
// - summary: input not an object, missing field, multi-line Bash command, Windows path
// - skin names: alias ("escuro-neon"), case/whitespace, unknown name → undefined
// - /skin with no args → lists skins and the current one, changes nothing
// - /skin bogus → error naming the value and the valid names, changes nothing
// - /skin minimal → state switches now and the store remembers it
// - session.start: stored skin restored; corrupt stored value → default neon
// - /skin off → the engine draws its own row
// - row: running, errored and interrupted calls each say so
import { expect, mock, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import type { On } from 'claude-code'

import { resolveSkinName } from './skin-themes'
import { describeTool, summarizeToolInput } from './tool-catalog'

const SKIN_STORE_KEY = 'activeSkin'

function answerEngine(on: On): void {
  on('command.register', ($, e) => ({ value: { command: e.name } }))
  on('session.start', ($, e) => ({ cwd: e.cwd }))
  on('ui.render', { component: 'ToolUse' }, ($, e) => {
    const { Text } = $.ui.resolve(e)
    return <Text>engine row</Text>
  })
}

async function runSkin($: Engine, args: string): Promise<string> {
  const ran = await $.command.run({ command: 'skin', args } as never)
  return (ran as { text?: string }).text ?? ''
}

async function startSession($: Engine): Promise<void> {
  await $.session.start({ cwd: '.', surface: 'terminal', isInteractive: true } as never)
}

async function rowText($: Engine, props: Record<string, unknown>): Promise<string> {
  const base = { tool_use_id: 't1', tool: 'Read', input: {}, isRunning: false, isErrored: false, isInterrupted: false }
  const ui = await $.ui.mount({ plugin: 'tool-skins', surface: 'terminal', component: 'ToolUse', requestId: 't1', props: { ...base, ...props } } as never)
  const text = (await ui.findAll({ type: 'Text' })).map(one => one.text ?? '').join(' ')
  await ui.unmount()
  return text
}

test('catalog sorts tools into categories', () => {
  expect(describeTool('Read').category).toBe('read')
  expect(describeTool('Grep').category).toBe('read')
  expect(describeTool('Edit').category).toBe('edit')
  expect(describeTool('Write').category).toBe('create')
  expect(describeTool('Bash').category).toBe('shell')
  expect(describeTool('WebFetch').category).toBe('web')
  expect(describeTool('Agent').category).toBe('agent')
  expect(describeTool('mcp__github__get_me').label).toBe('github · get_me')
  expect(describeTool('SomethingNew').category).toBe('other')
})

test('summaries survive odd inputs', () => {
  expect(summarizeToolInput('Read', null)).toBe('')
  expect(summarizeToolInput('Read', {})).toBe('')
  expect(summarizeToolInput('Bash', { command: 'ls -la\nrm x' })).toBe('ls -la …')
  expect(summarizeToolInput('Read', { file_path: 'C:\\Users\\me\\app\\main.ts' })).toBe('main.ts  C:\\Users\\me\\app')
  expect(summarizeToolInput('Grep', { pattern: 'TODO' })).toBe('TODO')
})

test('skin names resolve aliases and refuse unknowns', () => {
  expect(resolveSkinName('  Escuro-Neon ')).toBe('neon')
  expect(resolveSkinName('claro')).toBe('minimal')
  expect(resolveSkinName('alto-contraste')).toBe('contraste')
  expect(resolveSkinName('off')).toBe('off')
  expect(resolveSkinName('rosa')).toBeUndefined()
})

test('/skin lists, refuses and switches, remembering the choice', async ($, on) => {
  answerEngine(on)
  mock.store(on)
  expect(await runSkin($, '')).toMatch(/atual: neon/)
  expect(await runSkin($, 'rosa')).toMatch(/"rosa".*neon.*minimal.*contraste/)
  expect(await rowText($, {})).not.toMatch(/engine row/)
  expect(await runSkin($, 'minimal')).toMatch(/minimal/)
  await startSession($)
  expect(await runSkin($, '')).toMatch(/atual: minimal/)
  expect(await runSkin($, 'off')).toMatch(/off/)
  expect(await rowText($, {})).toMatch(/engine row/)
})

test('session.start restores the stored skin', async ($, on) => {
  answerEngine(on)
  mock.store(on, { [SKIN_STORE_KEY]: 'off' })
  await startSession($)
  expect(await rowText($, {})).toMatch(/engine row/)
})

test('session.start ignores a corrupt stored skin', async ($, on) => {
  answerEngine(on)
  mock.store(on, { [SKIN_STORE_KEY]: 42 })
  await startSession($)
  expect(await runSkin($, '')).toMatch(/atual: neon/)
})

test('rows show tool, target and call state', async ($, on) => {
  answerEngine(on)
  mock.store(on)
  const read = await rowText($, { tool: 'Read', input: { file_path: '/repo/src/app.ts' } })
  expect(read).toMatch(/Read/)
  expect(read).toMatch(/app\.ts/)
  expect(await rowText($, { tool: 'Bash', input: { command: 'npm test' }, isRunning: true })).toMatch(/rodando/)
  expect(await rowText($, { tool: 'Edit', isErrored: true })).toMatch(/erro/)
  expect(await rowText($, { tool: 'Write', isInterrupted: true })).toMatch(/interrompido/)
})
