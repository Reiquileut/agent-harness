import { atom, read, update } from 'claude-code'
import type { EngineInterface, On } from 'claude-code'

import type { SkinChoice } from '../types'
import { DEFAULT_SKIN, SKIN_NAMES, SKIN_THEMES, resolveSkinName, storedSkinChoice } from './skin-themes'

// Declared in each file that reads it: `claude plugin validate` only follows atoms
// made in the same module. $.state redraws every tool row the moment it changes;
// $.store (below) is what carries the choice into the next session.
const activeSkinAtom = atom({ plugin: 'tool-skins', key: 'activeSkin' } as const, DEFAULT_SKIN as SkinChoice)

const SKIN_STORE_KEY = 'activeSkin'

function skinMenu(current: SkinChoice): string {
  const lines = SKIN_NAMES.map(name => `  ${name === current ? '●' : '○'} ${name} — ${SKIN_THEMES[name].title}`)
  return [`Skin atual: ${current}`, ...lines, `  ${current === 'off' ? '●' : '○'} off — visual padrão do Claude Code`, 'Uso: /skin <nome>'].join('\n')
}

async function applySkin($: EngineInterface, choice: SkinChoice): Promise<string> {
  await update($, activeSkinAtom, () => choice)
  await $.store.set(SKIN_STORE_KEY, choice)
  return choice === 'off' ? 'Skin desligada (off): linhas no visual padrão.' : `Skin trocada para ${choice} (${SKIN_THEMES[choice].title}).`
}

/**
 * Answers `/skin [nome]`: no name lists the skins, a known one switches now
 * and is remembered across sessions, an unknown one is refused.
 * @example await answerSkinCommand($, 'claro') // 'Skin trocada para minimal (claro minimalista).'
 */
export async function answerSkinCommand($: EngineInterface, args: string): Promise<string> {
  if (args.trim() === '') return skinMenu(await read($, activeSkinAtom))
  const choice = resolveSkinName(args)
  if (choice === undefined) return `Skin desconhecida: "${args.trim()}". Use uma de: ${[...SKIN_NAMES, 'off'].join(', ')}.`
  return applySkin($, choice)
}

/**
 * Registers /skin and restores the skin saved by an earlier session.
 * @example registerSkinCommand(on)
 */
export function registerSkinCommand(on: On): void {
  on('session.start', async ($, e, next) => {
    await $.command.register({ name: 'skin', description: 'Troca o visual das linhas de ferramenta', argumentHint: '[neon|minimal|contraste|off]' })
    const stored = storedSkinChoice(await $.store.get(SKIN_STORE_KEY))
    await update($, activeSkinAtom, () => stored ?? DEFAULT_SKIN)
    return next(e)
  })

  on('command.run', { command: 'skin' }, async ($, e) => ({ text: await answerSkinCommand($, e.args) }))
}
