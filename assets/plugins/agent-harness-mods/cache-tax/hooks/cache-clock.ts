import type { SubagentCacheTrack } from '../types'

export const MINUTE_MS = 60_000

// Ping this long before the TTL lapses, so the request lands while the entry is warm.
const MAIN_PING_LEAD_MS = 3 * MINUTE_MS
const SUBAGENT_PING_LEAD_MS = 1 * MINUTE_MS
// A ping whose reply never came (lost, refused) stops blocking the next one after this.
const PING_STALE_MS = 2 * MINUTE_MS

export type SubagentPingRules = { ttlMinutes: number; windowMinutes: number }

/**
 * True when the last request is at least `ttlMinutes` old; false before any request.
 * @example isCacheLikelyCold(0, 60 * 60_000, 60) // true
 */
export function isCacheLikelyCold(lastRequestAt: number | null, now: number, ttlMinutes: number): boolean {
  return lastRequestAt !== null && now - lastRequestAt >= ttlMinutes * MINUTE_MS
}

/**
 * True when the main cache is within the lead time of lapsing (but not yet lapsed).
 * @example isMainPingDue(0, 57 * 60_000, 60) // true
 */
export function isMainPingDue(lastRequestAt: number | null, now: number, ttlMinutes: number): boolean {
  if (lastRequestAt === null) return false
  const idle = now - lastRequestAt
  return idle >= ttlMinutes * MINUTE_MS - MAIN_PING_LEAD_MS && idle < ttlMinutes * MINUTE_MS
}

/**
 * Only the cheaper tiers are worth warming: an idle Opus subagent is rare and
 * its pings cost as much as they save.
 * @example isWarmableSubagentModel('claude-haiku-5-5') // true
 */
export function isWarmableSubagentModel(model: string): boolean {
  return /sonnet|haiku/i.test(model)
}

/**
 * Whether an idle subagent needs a keep-alive ping now: warmable model, idle,
 * no live ping, cache close to its TTL, and still inside the window that
 * started at its last real activity.
 * @example isSubagentPingDue(track, now, { ttlMinutes: 5, windowMinutes: 30 })
 */
export function isSubagentPingDue(track: SubagentCacheTrack, now: number, rules: SubagentPingRules): boolean {
  if (track.isRunning || !isWarmableSubagentModel(track.model)) return false
  const idle = now - track.lastRequestAt
  if (track.isPingInFlight && idle < PING_STALE_MS) return false
  const isNearExpiry = idle >= rules.ttlMinutes * MINUTE_MS - SUBAGENT_PING_LEAD_MS && idle < rules.ttlMinutes * MINUTE_MS
  const isInWindow = now - track.lastRealActivityAt < rules.windowMinutes * MINUTE_MS
  return isNearExpiry && isInWindow
}

/**
 * Compact token count.
 * @example formatTokens(123456) // '123.5k'
 */
export function formatTokens(count: number): string {
  if (count < 1000) return String(count)
  if (count < 1_000_000) return `${(count / 1000).toFixed(1)}k`
  return `${(count / 1_000_000).toFixed(2)}M`
}
