import type { Register } from 'claude-code'

import { registerSkinCommand } from './skin-command'
import { registerToolRow } from './tool-row'

/**
 * tool-skins: tool call rows with an icon per tool, a color per kind of work
 * (read, edit, create, ...) and three skins switched live with /skin.
 */
export const register: Register = on => {
  registerSkinCommand(on)
  registerToolRow(on)
}
