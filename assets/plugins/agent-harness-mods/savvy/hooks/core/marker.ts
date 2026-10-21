// The marker ties an Agent call to a savvy task, and STEP lines report progress.
// The marker rides in the subagent's prompt (not its description) because the
// description is what the person sees in the task list.

const MARKER = /\[savvy:run=([A-Za-z0-9_-]{1,64}):task=(\d{1,2})\]/
const STEP_LINE = /^[ \t>*_-]*STEP\s+(\d{1,2})\s*\/\s*(\d{1,2})\s*:/gim

export type SavvyMarker = { runId: string; taskId: number }

/** @example encodeSavvyMarker('run-1', 2) // "[savvy:run=run-1:task=2]" */
export const encodeSavvyMarker = (runId: string, taskId: number): string => `[savvy:run=${runId}:task=${taskId}]`

export function parseSavvyMarker(prompt: string): SavvyMarker | null {
  const match = MARKER.exec(prompt)
  if (match === null) return null
  return { runId: match[1] as string, taskId: Number(match[2]) }
}

/**
 * The last step a text announces with `STEP n/N: name`, or null when it has none.
 * @example parseSavvyStep('STEP 1/4: read\nSTEP 2/4: write') // 2
 */
export function parseSavvyStep(text: string): number | null {
  let last: number | null = null
  for (const match of text.matchAll(STEP_LINE)) {
    const step = Number(match[1])
    if (step >= 1) last = step
  }
  return last
}
