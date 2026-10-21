/** A prompt the gate held because the session's cache had likely expired. */
export type HeldPrompt = {
  text: string
  /** The prompt's PromptSubmitAttachment list, kept as received (the contract may not import). */
  attachments?: readonly unknown[]
  idleMinutes: number
  /** Input tokens the next request re-sends (the live context window), when known. */
  contextTokens?: number
}

/** One subagent the keep-alive follows. Times are epoch milliseconds. */
export type SubagentCacheTrack = {
  id: string
  model: string
  lastRequestAt: number
  /** Last spawn, real resume or real turn end; pings never move it. */
  lastRealActivityAt: number
  isRunning: boolean
  isPingInFlight: boolean
  pings: number
}

/** A subagent whose next task-notification (a keep-alive reply) is dropped until `expiresAt`. */
export type SilencedNotice = { agentId: string; expiresAt: number }

declare module 'claude-code' {
  interface PluginState {
    'cache-tax': {
      lastMainRequestAt: number | null
      heldPrompt: HeldPrompt | null
      mainPings: number
      subagentTracks: SubagentCacheTrack[]
      /** Keep-alive pings whose task-notification must not wake the main loop; each expires. */
      silencedNotices: SilencedNotice[]
    }
  }
}
