// What the savvy tests share: one four-task plan, the calls that walk a helper
// through a turn, and the two sites (pane and band) a test mounts.
import type { Engine } from 'claude-code/testing'

export const SAVVY_TEST_STEPS = ['Read the code', 'Write the change', 'Run the tests']
const steps = SAVVY_TEST_STEPS

export const SAVVY_TEST_PLAN = {
  tool: 'mcp__savvy__plan', tool_use_id: 'plan-1', name: 'auth api', request: 'add auth',
  tasks: [
    { title: 'Login endpoint', profile: 'medium', steps },
    { title: 'Token store', profile: 'heavy', steps },
    { title: 'Docs', profile: 'light', steps },
    { title: 'Review', profile: 'careful', steps, deps: [1, 2, 3] },
  ],
}

const spawnInput = (prompt: string) => ({
  tool_use_id: 'agent-call', prompt, description: 'savvy', subagentType: 'general-purpose',
  provider: { plugin: 'engine', tier: 'core' }, parentModel: 'claude-opus-5-5', background: false, fork: false,
}) as never

/** The `[savvy:run=…:task=N]` marker of task `task` in a plan or ready answer, or ''. */
export const savvyTestMarkerOf = (text: string, task: number): string =>
  (text.match(new RegExp(`\\[savvy:run=[^:]+:task=${task}\\]`)) ?? [''])[0]

/**
 * Spawns helper `n`, runs one model step and one Write call; answers its agent id.
 * @example const agentId = await runSavvyTestHelper($, savvyTestMarkerOf(planText, 1), 1)
 */
export async function runSavvyTestHelper($: Engine, marker: string, n: number): Promise<string> {
  const spawned = await $.agent.spawn(spawnInput(`${marker}\nwork`))
  const agentId = spawned.agentId as string
  await $.turn.start({ text: '', turnId: `turn-${n}`, agentId })
  for await (const _ of $.turn.step({ turnId: `turn-${n}`, index: 0, model: 'claude-opus-5-5', messageCount: 1, agentId } as never)) void _
  await $.tool.call({ tool: 'Write', tool_use_id: `w-${n}`, file_path: `src/f${n}.ts`, content: 'x', agentId } as never)
  return agentId
}

/** Ends helper `n`'s turn with its last step and a summary. */
export const finishSavvyTestHelper = ($: Engine, agentId: string, n: number) =>
  $.turn.complete({ answer: `STEP 3/3: Run the tests\nSUMMARY:\nDid task ${n}.`, durationMs: 10, isAborted: false, turnId: `turn-${n}`, agentId, reason: 'answer' } as never)

/** The docked "Agents" pane, `bodyColumns` cells across. */
export const savvyTestPane = (bodyColumns: number) => ({
  plugin: 'savvy', component: 'Pane', requestId: 'savvy-agents',
  props: { title: 'Agents', isFocused: false, bodyColumns, placement: 'dock', scroll: { offset: 0, bodyRows: 40 }, view: {} },
}) as const

/** The band above the prompt, `bodyColumns` cells across. */
export const savvyTestBand = (bodyColumns: number) => ({
  plugin: 'savvy', component: 'AbovePrompt', requestId: 'band',
  props: { hasSurvey: false, isWorking: true, maxRows: 4, bodyColumns, scroll: { offset: 0, bodyRows: 4 }, view: {} },
}) as const
