import { atom, read, update } from 'claude-code'
import type { EngineInterface, On } from 'claude-code'

import type { HeldPrompt } from '../types'
import { formatTokens } from './cache-clock'

// Declared in each file that reads it: `claude plugin validate` only follows atoms
// made in the same module.
const lastMainRequestAtom = atom({ plugin: 'cache-tax', key: 'lastMainRequestAt' } as const, null as number | null)
const heldPromptAtom = atom({ plugin: 'cache-tax', key: 'heldPrompt' } as const, null as HeldPrompt | null)

const PREVIEW_CHARS = 70

async function releaseHeld($: EngineInterface): Promise<HeldPrompt | null> {
  const held = await read($, heldPromptAtom)
  await update($, heldPromptAtom, () => null)
  return held
}

async function sendAnyway($: EngineInterface): Promise<void> {
  const held = await releaseHeld($)
  // Resubmitted with a plugin origin, which the gate never holds: no loop.
  if (held) await $.prompt.submit({ text: held.text, attachments: held.attachments as never, asUser: true })
}

async function startFresh($: EngineInterface): Promise<void> {
  const held = await releaseHeld($)
  await $.command.run({ command: 'clear' })
  await update($, lastMainRequestAtom, () => null)
  if (held) await $.prompt.fill({ text: held.text })
}

async function cancelHeld($: EngineInterface): Promise<void> {
  const held = await releaseHeld($)
  if (held) await $.prompt.fill({ text: held.text })
}

function preview(text: string): string {
  const flat = text.replace(/\s+/g, ' ').trim()
  return flat.length > PREVIEW_CHARS ? `${flat.slice(0, PREVIEW_CHARS)}…` : flat
}

/**
 * Draws the held prompt's band: idle time, tokens to re-process, three choices.
 * @example registerHeldBand(on)
 */
export function registerHeldBand(on: On): void {
  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const held = await read($, heldPromptAtom)
    if (held === null || e.props.hasSurvey) return next(e)
    const { Box, Button, Text } = $.ui.resolve(e)
    const tokens = held.contextTokens === undefined ? 'todo o contexto' : `~${formatTokens(held.contextTokens)} tokens de entrada`
    return (
      <Box flexDirection="column">
        <Text>
          <Text color="warning" bold>◷ Cache provavelmente expirado</Text>
          <Text color="subtle"> · {held.idleMinutes} min sem requests</Text>
        </Text>
        <Text color="subtle">Enviar agora reprocessa <Text color="claude" bold>{tokens}</Text> sem cache.</Text>
        <Text color="subtle" wrap="truncate-end">› {preview(held.text)}</Text>
        <Box gap={1}>
          <Button key="send-anyway" label="Enviar mesmo assim" hotkey="1" variant="primary" onPress={() => sendAnyway($)} />
          <Button key="start-fresh" label="Começar conversa nova" hotkey="2" onPress={() => startFresh($)} />
          <Button key="cancel" label="Cancelar" hotkey="3" onPress={() => cancelHeld($)} />
        </Box>
      </Box>
    )
  })
}
