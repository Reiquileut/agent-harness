import type { ToolCategory } from '../types'

export type ToolLook = { icon: string; category: ToolCategory; label: string }

// Icons are single-width Unicode symbols present in the common terminal fonts
// (Cascadia, Consolas, Menlo, JetBrains Mono); no emoji, which draw double-wide
// or as tofu boxes on Windows Terminal.
const BUILTIN_TOOL_LOOKS: Readonly<Record<string, Omit<ToolLook, 'label'>>> = {
  Bash: { icon: '❯', category: 'shell' },
  PowerShell: { icon: '❯', category: 'shell' },
  Read: { icon: '◫', category: 'read' },
  Grep: { icon: '⌕', category: 'read' },
  Glob: { icon: '⁂', category: 'read' },
  NotebookRead: { icon: '◫', category: 'read' },
  Edit: { icon: '✎', category: 'edit' },
  MultiEdit: { icon: '✎', category: 'edit' },
  NotebookEdit: { icon: '✎', category: 'edit' },
  Write: { icon: '✚', category: 'create' },
  WebFetch: { icon: '⇣', category: 'web' },
  WebSearch: { icon: '◎', category: 'web' },
  Agent: { icon: '◆', category: 'agent' },
  Task: { icon: '◆', category: 'agent' },
  Skill: { icon: '★', category: 'agent' },
  TodoWrite: { icon: '☑', category: 'other' },
  TaskCreate: { icon: '☐', category: 'other' },
  TaskUpdate: { icon: '☑', category: 'other' },
}

const MCP_TOOL_ICON = '⧉'
const UNKNOWN_TOOL_ICON = '•'

// Which input field names the call's target, per tool; first present wins.
const SUMMARY_FIELDS: Readonly<Record<string, readonly string[]>> = {
  Bash: ['command'],
  PowerShell: ['command'],
  Grep: ['pattern'],
  Glob: ['pattern'],
  WebFetch: ['url'],
  WebSearch: ['query'],
  Agent: ['description'],
  Task: ['description'],
  Skill: ['skill'],
}
const PATH_FIELDS = ['file_path', 'notebook_path', 'path'] as const

/**
 * Icon, category and display label of a tool; MCP tools read as `server · tool`.
 * @example describeTool('Edit') // { icon: '✎', category: 'edit', label: 'Edit' }
 */
export function describeTool(tool: string): ToolLook {
  const builtin = BUILTIN_TOOL_LOOKS[tool]
  if (builtin) return { ...builtin, label: tool }
  const mcp = /^mcp__(.+?)__(.+)$/.exec(tool)
  if (mcp) return { icon: MCP_TOOL_ICON, category: 'other', label: `${mcp[1]} · ${mcp[2]}` }
  return { icon: UNKNOWN_TOOL_ICON, category: 'other', label: tool }
}

/**
 * One line naming what the call works on: a file as `name  dir`, a command's
 * first line, a pattern or URL; '' when the input has nothing recognizable.
 * @example summarizeToolInput('Read', { file_path: '/a/b.ts' }) // 'b.ts  /a'
 */
export function summarizeToolInput(tool: string, input: unknown): string {
  if (typeof input !== 'object' || input === null) return ''
  const fields = input as Record<string, unknown>
  const path = PATH_FIELDS.map(key => fields[key]).find(isText)
  if (path) return splitPath(path)
  const named = (SUMMARY_FIELDS[tool] ?? []).map(key => fields[key]).find(isText)
  return named ? firstLine(named) : ''
}

function isText(candidate: unknown): candidate is string {
  return typeof candidate === 'string' && candidate.length > 0
}

function firstLine(text: string): string {
  const [head = '', ...rest] = text.split('\n')
  return rest.length > 0 ? `${head} …` : head
}

function splitPath(path: string): string {
  const cut = Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\'))
  return cut < 0 ? path : `${path.slice(cut + 1)}  ${path.slice(0, cut)}`
}
