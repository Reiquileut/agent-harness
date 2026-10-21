import { test, expect } from 'claude-code/testing'
import { register, AI_MEMORY_FIRST_READ_INSTRUCTION } from './register'

type CapturedHook = (...args: unknown[]) => unknown
function captureHooks(): Map<string, CapturedHook> {
  const hooks = new Map<string, CapturedHook>()
  const fakeOn = ((event: string, hook: CapturedHook) => { hooks.set(event, hook) }) as never
  register(fakeOn, {} as never)
  return hooks
}
const passThrough = (e: unknown) => e
const prompt = (kind: string) => ({ text: 'oi', wait: false, origin: { kind } })

test('injeta a instrução só na primeira mensagem do usuário', async () => {
  const submit = captureHooks().get('prompt.submit')!
  const first = (await submit({}, prompt('composer'), passThrough)) as { context?: string[] }
  const second = (await submit({}, prompt('composer'), passThrough)) as { context?: string[] }
  expect(first.context).toEqual([AI_MEMORY_FIRST_READ_INSTRUCTION])
  expect(second.context).toBeUndefined()
})

test('ignora notificações e não consome a primeira injeção', async () => {
  const submit = captureHooks().get('prompt.submit')!
  const notice = (await submit({}, prompt('task-notification'), passThrough)) as { context?: string[] }
  const user = (await submit({}, prompt('composer'), passThrough)) as { context?: string[] }
  expect(notice.context).toBeUndefined()
  expect(user.context).toEqual([AI_MEMORY_FIRST_READ_INSTRUCTION])
})
