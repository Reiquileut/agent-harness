/** The three bundled skins; `off` hands the rows back to the engine's own drawing. */
export type SkinName = 'neon' | 'minimal' | 'contraste'
export type SkinChoice = SkinName | 'off'

/** What a tool does to the user's files or world; each category has its own color. */
export type ToolCategory = 'read' | 'edit' | 'create' | 'shell' | 'web' | 'agent' | 'other'

declare module 'claude-code' {
  interface PluginState {
    'tool-skins': { activeSkin: SkinChoice }
  }
}
