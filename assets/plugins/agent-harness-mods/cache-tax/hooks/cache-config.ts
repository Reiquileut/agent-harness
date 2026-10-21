import type { PluginOptions } from 'claude-code'

export type CacheTaxConfig = {
  cacheTtlMinutes: number
  keepAlive: boolean
  keepAliveMaxPings: number
  subagentKeepAlive: boolean
  subagentTtlMinutes: number
  subagentKeepAliveWindowMinutes: number
}

// Defaults mirror plugin.json's userConfig. Main TTL 60 min: this account's main
// session runs on the 1-hour prompt cache. Subagents: 5-min TTL, kept warm up to
// 30 min (user decision 2026-10-13, matches the cache-discipline rule in AGENTS.md).
export const CACHE_TAX_DEFAULTS: CacheTaxConfig = {
  cacheTtlMinutes: 60,
  keepAlive: false,
  keepAliveMaxPings: 3,
  subagentKeepAlive: true,
  subagentTtlMinutes: 5,
  subagentKeepAliveWindowMinutes: 30,
}

function positiveNumber(candidate: unknown, fallback: number): number {
  return typeof candidate === 'number' && Number.isFinite(candidate) && candidate > 0 ? candidate : fallback
}

function flag(candidate: unknown, fallback: boolean): boolean {
  return typeof candidate === 'boolean' ? candidate : fallback
}

/**
 * Reads the mod's userConfig values, any missing or invalid one replaced by its default.
 * @example readCacheTaxConfig({ cacheTtlMinutes: 30 }).cacheTtlMinutes // 30
 */
export function readCacheTaxConfig(options: Partial<PluginOptions>): CacheTaxConfig {
  const d = CACHE_TAX_DEFAULTS
  return {
    cacheTtlMinutes: positiveNumber(options.cacheTtlMinutes, d.cacheTtlMinutes),
    keepAlive: flag(options.keepAlive, d.keepAlive),
    keepAliveMaxPings: Math.floor(positiveNumber(options.keepAliveMaxPings, d.keepAliveMaxPings)),
    subagentKeepAlive: flag(options.subagentKeepAlive, d.subagentKeepAlive),
    subagentTtlMinutes: positiveNumber(options.subagentTtlMinutes, d.subagentTtlMinutes),
    subagentKeepAliveWindowMinutes: positiveNumber(options.subagentKeepAliveWindowMinutes, d.subagentKeepAliveWindowMinutes),
  }
}
