import { atom, read, update } from 'claude-code'
import type { EngineInterface, PromptSubmitInput, Register } from 'claude-code'

import type { HeldPrompt, SilencedNotice, SubagentCacheTrack } from '../types'
import { readCacheTaxConfig } from './cache-config'
import type { CacheTaxConfig } from './cache-config'
import { MINUTE_MS, isCacheLikelyCold, isMainPingDue, isSubagentPingDue } from './cache-clock'
import { registerHeldBand } from './prompt-gate'

// Every hook and every helper that takes `$` lives in this one file: the validator
// follows `$` only into functions of the file that registered the hook, and refuses
// two unmatched hooks on one event. Pure rules are in cache-clock.ts / cache-config.ts.

const lastMainRequestAtom = atom({ plugin: 'cache-tax', key: 'lastMainRequestAt' } as const, null as number | null)
const heldPromptAtom = atom({ plugin: 'cache-tax', key: 'heldPrompt' } as const, null as HeldPrompt | null)
const mainPingsAtom = atom({ plugin: 'cache-tax', key: 'mainPings' } as const, 0)
const subagentTracksAtom = atom({ plugin: 'cache-tax', key: 'subagentTracks' } as const, [] as SubagentCacheTrack[])
const silencedNoticesAtom = atom({ plugin: 'cache-tax', key: 'silencedNotices' } as const, [] as SilencedNotice[])

// One timer drives both keep-alives; a tick is a few state reads when nothing is due.
const KEEP_ALIVE_TICK_MS = 30_000
const NOTICE_SILENCE_MS = 3 * MINUTE_MS
const MAIN_PING_PROMPT = '[cache-tax keep-alive] Não faça nada. Responda apenas: ok'
// Resuming a finished subagent is the only way the engine offers to touch its
// cache: the message runs one short turn in it, re-reading its cached prefix.
const SUBAGENT_PING_TEXT = '[cache-tax keep-alive] Não faça nada e não use ferramentas. Responda apenas: ok'
const HELD_REASON = 'cache-tax: o cache provavelmente expirou; escolha na faixa acima do prompt'
const NOTICE_REASON = 'cache-tax: resposta de keep-alive de subagente'

type TrackChange = (track: SubagentCacheTrack) => SubagentCacheTrack

let isMainBusy = false

// ── main session ─────────────────────────────────────────────────────────────

async function recordMainRequest($: EngineInterface): Promise<void> {
  const now = await $.clock.now()
  await update($, lastMainRequestAtom, () => now)
}

async function pingMainIfDue($: EngineInterface, config: CacheTaxConfig): Promise<void> {
  if (!config.keepAlive || isMainBusy) return
  if ((await read($, mainPingsAtom)) >= config.keepAliveMaxPings) return
  const now = await $.clock.now()
  if (!isMainPingDue(await read($, lastMainRequestAtom), now, config.cacheTtlMinutes)) return
  // Counted before the call, so a failing fork cannot retry past the limit.
  await update($, mainPingsAtom, pings => pings + 1)
  const reply = await $.model.fork({ prompt: MAIN_PING_PROMPT })
  if (reply.isAnswered) await update($, lastMainRequestAtom, () => now)
}

/** Holds a typed prompt for the band when the main cache has likely expired; true = drop it. */
async function holdIfCold($: EngineInterface, e: PromptSubmitInput, config: CacheTaxConfig): Promise<boolean> {
  if (e.origin.kind !== 'composer') return false
  const lastRequestAt = await read($, lastMainRequestAtom)
  const now = await $.clock.now()
  if (lastRequestAt === null || !isCacheLikelyCold(lastRequestAt, now, config.cacheTtlMinutes)) return false
  const usage = await $.session.usage()
  const idleMinutes = Math.floor((now - lastRequestAt) / MINUTE_MS)
  const held: HeldPrompt = { text: e.text, attachments: e.attachments, idleMinutes, contextTokens: usage.context.tokens }
  await update($, heldPromptAtom, () => held)
  return true
}

// ── subagents ────────────────────────────────────────────────────────────────

async function changeTrack($: EngineInterface, id: string, change: TrackChange): Promise<void> {
  await update($, subagentTracksAtom, tracks => tracks.map(track => (track.id === id ? change(track) : track)))
}

async function trackSpawnedSubagent($: EngineInterface, id: string, model: string): Promise<void> {
  const now = await $.clock.now()
  const track: SubagentCacheTrack = { id, model, lastRequestAt: now, lastRealActivityAt: now, isRunning: true, isPingInFlight: false, pings: 0 }
  await update($, subagentTracksAtom, tracks => [...tracks.filter(one => one.id !== id), track])
}

async function recordSubagentStep($: EngineInterface, id: string, model: string | undefined): Promise<void> {
  const now = await $.clock.now()
  await changeTrack($, id, track => ({ ...track, isRunning: true, lastRequestAt: now, model: model ?? track.model }))
}

async function recordSubagentTurnEnd($: EngineInterface, id: string): Promise<void> {
  const now = await $.clock.now()
  // A ping's own turn must not extend the window it is bounded by.
  await changeTrack($, id, track => ({ ...track, isRunning: false, isPingInFlight: false, lastRealActivityAt: track.isPingInFlight ? track.lastRealActivityAt : now }))
}

async function pingSubagent($: EngineInterface, id: string, now: number): Promise<void> {
  await changeTrack($, id, track => ({ ...track, isPingInFlight: true, lastRequestAt: now, pings: track.pings + 1 }))
  await update($, silencedNoticesAtom, list => [...list, { agentId: id, expiresAt: now + NOTICE_SILENCE_MS }])
  const sent = await $.session.send({ to: { agentId: id }, text: SUBAGENT_PING_TEXT })
  if (sent.isDelivered) return
  await changeTrack($, id, track => ({ ...track, isPingInFlight: false }))
  await update($, silencedNoticesAtom, list => list.filter(one => one.agentId !== id))
}

async function pingDueSubagents($: EngineInterface, config: CacheTaxConfig): Promise<void> {
  if (!config.subagentKeepAlive) return
  const now = await $.clock.now()
  const rules = { ttlMinutes: config.subagentTtlMinutes, windowMinutes: config.subagentKeepAliveWindowMinutes }
  const due = (await read($, subagentTracksAtom)).filter(track => isSubagentPingDue(track, now, rules))
  for (const track of due) await pingSubagent($, track.id, now)
}

/** True (and consumed) when a task-notification is a keep-alive reply's, so it never wakes the main loop. */
async function isKeepAliveNotice($: EngineInterface, e: PromptSubmitInput, config: CacheTaxConfig): Promise<boolean> {
  if (e.origin.kind !== 'task-notification' || !config.subagentKeepAlive) return false
  const now = await $.clock.now()
  const live = (await read($, silencedNoticesAtom)).filter(one => one.expiresAt > now)
  const match = live.find(one => e.text.includes(one.agentId))
  await update($, silencedNoticesAtom, () => live.filter(one => one !== match))
  return match !== undefined
}

/**
 * cache-tax: holds a prompt sent after the cache likely expired and shows what
 * re-processing it costs; optional keep-alive for the session and for idle
 * sonnet/haiku subagents.
 */
export const register: Register = (on, options) => {
  const config = readCacheTaxConfig(options)

  on('session.start', async ($, e, next) => {
    $.clock.every(KEEP_ALIVE_TICK_MS, () => {
      void pingMainIfDue($, config)
      void pingDueSubagents($, config)
    })
    return next(e)
  })

  on('turn.start', ($, e, next) => {
    isMainBusy = true
    return next(e)
  })

  on('turn.step', async function* ($, e, next) {
    const response = yield* next(e)
    if (e.agentId === undefined && response.usage) await recordMainRequest($)
    if (e.agentId !== undefined) await recordSubagentStep($, e.agentId, response.usage?.model)
    return response
  })

  on('turn.complete', async ($, e, next) => {
    const answered = await next(e)
    if (e.agentId === undefined) isMainBusy = false
    else await recordSubagentTurnEnd($, e.agentId)
    return answered
  })

  on('agent.spawn', async ($, e, next) => {
    const spawned = await next(e)
    if ('agentId' in spawned && spawned.agentId !== undefined) await trackSpawnedSubagent($, spawned.agentId, spawned.model)
    return spawned
  }).catch(($, e, next) => next(e))

  on('prompt.submit', async ($, e, next) => {
    if (await isKeepAliveNotice($, e, config)) return { drop: NOTICE_REASON }
    if (await holdIfCold($, e, config)) return { drop: HELD_REASON }
    return next(e)
  }).catch(($, e, next) => next(e))

  registerHeldBand(on)
}
