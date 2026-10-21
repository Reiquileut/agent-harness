import { atom, read } from 'claude-code'
import type { On } from 'claude-code'

import type { SkinChoice } from '../types'
import { DEFAULT_SKIN, SKIN_THEMES } from './skin-themes'
import type { SkinTheme } from './skin-themes'
import { describeTool, summarizeToolInput } from './tool-catalog'

// Declared in each file that reads it: `claude plugin validate` only follows atoms
// made in the same module.
const activeSkinAtom = atom({ plugin: 'tool-skins', key: 'activeSkin' } as const, DEFAULT_SKIN as SkinChoice)

type CallState = { isRunning: boolean; isErrored: boolean; isInterrupted: boolean }

function callStateWord(call: CallState, theme: SkinTheme): { word: string; color: string } | undefined {
  if (call.isInterrupted) return { word: '⏸ interrompido', color: theme.muted }
  if (call.isErrored) return { word: '✗ erro', color: theme.danger }
  if (call.isRunning) return { word: '… rodando', color: theme.muted }
  return undefined
}

/**
 * Redraws every tool call's header row in the active skin: icon and name in the
 * category color, a category chip, the call's target and its state. With the
 * skin `off` the engine draws its own row; the result block below is untouched.
 * @example registerToolRow(on)
 */
export function registerToolRow(on: On): void {
  on('ui.render', { component: 'ToolUse' }, async ($, e, next) => {
    const skin = await read($, activeSkinAtom)
    if (skin === 'off') return next(e)

    const { Box, Text } = $.ui.resolve(e)
    const theme = SKIN_THEMES[skin]
    const look = describeTool(e.props.tool)
    const paint = theme.categories[look.category]
    const target = summarizeToolInput(e.props.tool, e.props.input)
    const state = callStateWord(e.props, theme)
    const chip = theme.hasChips
      ? <Text backgroundColor={paint.color} color={theme.chipText} bold> {paint.label} </Text>
      : <Text color={paint.color}>{paint.label}</Text>

    return (
      <Box gap={1}>
        <Text color={paint.color} bold={theme.isBold}>{look.icon} {look.label}</Text>
        {chip}
        {target !== '' && <Text color={theme.muted} wrap="truncate-end">{target}</Text>}
        {state && <Text color={state.color}>{state.word}</Text>}
      </Box>
    )
  })
}
