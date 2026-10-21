// FakeSavvyEngine: the hooks a test registers beneath the plugin, standing for
// the parts of Claude Code savvy calls (registrations, fs, theme, the Agent
// tool's spawn, model requests, tool calls). The plugin's own hooks run for
// real above it, through the engine's chain.
import type { On, RenderSurface } from 'claude-code'

export type FakeSavvyRecord = {
  files: Map<string, string>
  spawns: Array<{ model: string | undefined; background: boolean }>
  aborted: string[]
  opened: string[]
  blits: number
}

const usage = { input_tokens: 1200, output_tokens: 3000, cache_read_input_tokens: 30000, cache_creation_input_tokens: 4000 }

export const FAKE_SAVVY_USAGE = usage

/** Installs the stand-ins and answers what the plugin asks of the engine. */
export function installFakeSavvyEngine(on: On, surface: RenderSurface): FakeSavvyRecord {
  const record: FakeSavvyRecord = { files: new Map(), spawns: [], aborted: [], opened: [], blits: 0 }
  let agents = 0
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('tool.register', (_, e) => ({ value: { tool: `mcp__savvy__${e.name}` } }))
  on('command.register', (_, e) => ({ value: { command: e.name } }))
  on('config.list', () => ({ value: [{ key: 'theme', label: 'Theme', kind: 'choice', value: 'dark', provider: { plugin: 'engine', tier: 'core' }, isLocked: false }] as never }))
  on('session.surface', () => ({ value: surface }))
  on('fs.read', (_, e) => (record.files.has(e.path) ? { value: record.files.get(e.path) as string } : { deny: `ENOENT ${e.path}` }))
  on('fs.write', (_, e) => (record.files.set(e.path, e.text), { value: undefined }))
  on('fs.list', (_, e) => ({
    // The engine hands hooks absolute paths with the platform's separator.
    value: [...record.files.keys()]
      .filter(path => path.startsWith(`${e.path}/`) || path.startsWith(`${e.path}\\`))
      .map(path => ({ name: path.slice(e.path.length + 1), kind: 'file', size: 1, mtimeMs: 0, isLink: false })) as never,
  }))
  on('ui.open', (_, e) => (record.opened.push(e.id), { value: { isPlaced: true } as never }))
  on('ui.close', () => ({ value: undefined }))
  on('ui.blit', () => (record.blits++, { value: {} }))
  on('ui.toast', () => ({ value: undefined }))
  on('turn.abort', (_, e) => (record.aborted.push(e.turnId), { value: undefined }))
  on('agent.spawn', (_, e) => (record.spawns.push({ model: e.model, background: e.background }), { model: e.model ?? 'x', agentId: `agent-${++agents}` }))
  on('tool.call', () => ({ result: {} as never }))
  on('turn.start', (_, e) => ({ turnId: e.turnId }))
  on('turn.complete', (_, e) => ({ text: e.answer }))
  // The engine's own drawing, where savvy hands a site back with next(e).
  on('ui.render', ($, e) => h($.ui.resolve(e).Text, null, 'engine') as never)
  return record
}

/** One model request of a helper, streaming `text`, ending with FAKE_SAVVY_USAGE. */
export function installFakeSavvyStep(on: On, text: string): void {
  on('turn.step', async function* (_, e) {
    yield { kind: 'text', index: 0, text, ref: 0 } as never
    return { turnId: e.turnId, index: e.index, answer: text, toolUses: [], stopReason: 'end_turn', usage: { ...usage, model: 'claude-opus-5-5' } } as never
  })
}
