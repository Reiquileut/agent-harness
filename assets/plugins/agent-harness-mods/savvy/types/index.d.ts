// The savvy plugin's type contract: the run state it persists to
// .claude/savvy/<run-id>.json and the values it keeps in `$.state`.
// Self-contained on purpose (no imports): `claude plugin validate` reads it alone.

export type SavvyProfile = 'light' | 'medium' | 'careful' | 'heavy'
export type SavvyEffort = 'low' | 'medium' | 'high' | 'xhigh' | 'max'
export type SavvyTaskStatus = 'planned' | 'running' | 'finished' | 'failed'
export type SavvyThemeMode = 'dark' | 'light'
export type SavvyIconMode = 'sprite' | 'ascii'

/** One tool call a subagent made, kept for the expanded card (last few only). */
export type SavvyToolCall = { tool: string; detail: string; at: number }

/** One task of a run; the fields named in the spec plus the bookkeeping the hooks need. */
export type SavvyTask = {
  id: number
  title: string
  profile: SavvyProfile
  /** Config key of the model ("opus"); `modelId` is what the Agent call runs on. */
  model: string
  modelId: string
  effort: SavvyEffort
  steps: string[]
  deps: number[]
  status: SavvyTaskStatus
  /** 0 before the first `STEP` line, then the 1-based step the agent announced last. */
  step: number
  /** Context tokens after the agent's latest model request (input + cache + output). */
  tokens: number
  cost: number
  ctxPct: number
  startedAt: number | null
  endedAt: number | null
  summary: string
  /** True once `savvy_ready`/`savvy_plan` handed the task to the model to launch. */
  dispatched: boolean
  agentId: string | null
  /** The subagent's current turn, so a cancel can abort it. */
  turnId: string | null
  toolCalls: SavvyToolCall[]
  files: string[]
}

export type SavvyRun = {
  id: string
  name: string
  request: string
  createdAt: number
  cancelled: boolean
  tasks: SavvyTask[]
}

/** Per-session display preferences, changed by /savvy and the panel's controls. */
export type SavvyUiPrefs = {
  hidden: boolean
  icons: SavvyIconMode
  expanded: number[]
  collapsed: SavvyTaskStatus[]
  confirmCancel: boolean
}

/** Facts about where the plugin draws, refreshed at session start and on change. */
export type SavvyEnvironment = {
  theme: SavvyThemeMode
  colorDepth: 'truecolor' | 'ansi256' | 'ansi16'
  reducedMotion: boolean
}

declare module 'claude-code' {
  interface PluginState {
    savvy: {
      run: SavvyRun | null
      prefs: SavvyUiPrefs
      env: SavvyEnvironment
      /**
       * Data beat: bumped at ui.dataFps (2/s) while a task runs, so timers and
       * the title pulse redraw at that rate and no faster.
       */
      beat: number
    }
  }
}
