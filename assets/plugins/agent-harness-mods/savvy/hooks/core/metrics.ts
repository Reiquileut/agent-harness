// Cost, context and time maths plus the fixed-shape formatters every surface uses.
import type { SavvyRun } from '../../types'
import type { SavvyModelPrice } from './config.ts'

/** The four token counts of one model request, as the engine's ModelUsage spells them. */
export type SavvyUsage = {
  input_tokens: number
  output_tokens: number
  cache_read_input_tokens: number
  cache_creation_input_tokens: number
}

const PER_MILLION = 1_000_000

/** USD of one request: each kind of token at its own per-million price. */
export function savvyCostUsd(usage: SavvyUsage, price: SavvyModelPrice): number {
  return (
    usage.input_tokens * price.input +
    usage.output_tokens * price.output +
    usage.cache_read_input_tokens * price.cacheRead +
    usage.cache_creation_input_tokens * price.cacheWrite
  ) / PER_MILLION
}

/** What the request's context held: every input token, cached or not, plus the reply. */
export const savvyContextTokens = (usage: SavvyUsage): number =>
  usage.input_tokens + usage.cache_read_input_tokens + usage.cache_creation_input_tokens + usage.output_tokens

/** @example fmtSavvyTokens(254_321) // "254k" */
export function fmtSavvyTokens(tokens: number): string {
  if (tokens < 1000) return String(Math.max(0, Math.round(tokens)))
  if (tokens < 1_000_000) return `${Math.round(tokens / 1000)}k`
  return `${(tokens / 1_000_000).toFixed(1)}M`
}

/** @example fmtSavvyCost(0.2549) // "≈$0.25" */
export function fmtSavvyCost(usd: number): string {
  if (usd > 0 && usd < 0.005) return '<$0.01'
  return `≈$${usd.toFixed(2)}`
}

const two = (n: number): string => String(n).padStart(2, '0')

/** @example fmtSavvyDuration(26_400) // "0:26" */
export function fmtSavvyDuration(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000))
  const hours = Math.floor(total / 3600)
  const minutes = Math.floor((total % 3600) / 60)
  const seconds = total % 60
  return hours > 0 ? `${hours}:${two(minutes)}:${two(seconds)}` : `${minutes}:${two(seconds)}`
}

/** A task's elapsed time: to now while it runs, to its end once settled. */
export function savvyTaskElapsed(task: { startedAt: number | null; endedAt: number | null }, now: number): number {
  if (task.startedAt === null) return 0
  return (task.endedAt ?? now) - task.startedAt
}

export type SavvyRunTotals = { cost: number; tokens: number; elapsedMs: number }

/** Totals for the panel's three cards; time spans the started tasks only. */
export function savvyRunTotals(run: SavvyRun, now: number): SavvyRunTotals {
  const started = run.tasks.filter(task => task.startedAt !== null)
  const cost = run.tasks.reduce((sum, task) => sum + task.cost, 0)
  const tokens = run.tasks.reduce((sum, task) => sum + task.tokens, 0)
  if (started.length === 0) return { cost, tokens, elapsedMs: 0 }
  const first = Math.min(...started.map(task => task.startedAt as number))
  const isRunning = started.some(task => task.endedAt === null)
  const last = isRunning ? now : Math.max(...started.map(task => task.endedAt as number))
  return { cost, tokens, elapsedMs: last - first }
}
