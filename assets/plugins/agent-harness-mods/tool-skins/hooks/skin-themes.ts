import type { SkinChoice, SkinName, ToolCategory } from '../types'

export type CategoryPaint = { color: string; label: string }

export type SkinTheme = {
  title: string
  /** Category label drawn as a filled chip (true) or as plain colored text. */
  hasChips: boolean
  /** Text color inside a chip; the chip's fill is the category color. */
  chipText: string
  isBold: boolean
  muted: string
  danger: string
  categories: Record<ToolCategory, CategoryPaint>
}

export const DEFAULT_SKIN: SkinName = 'neon'
export const SKIN_NAMES: readonly SkinName[] = ['neon', 'minimal', 'contraste']

// Category labels are shared; only colors differ per skin.
const CATEGORY_LABELS: Record<ToolCategory, string> = {
  read: 'leitura',
  edit: 'edição',
  create: 'criação',
  shell: 'shell',
  web: 'web',
  agent: 'agente',
  other: 'outro',
}

function paint(colors: Record<ToolCategory, string>): Record<ToolCategory, CategoryPaint> {
  const entries = Object.entries(colors) as [ToolCategory, string][]
  return Object.fromEntries(entries.map(([key, color]) => [key, { color, label: CATEGORY_LABELS[key] }])) as Record<ToolCategory, CategoryPaint>
}

export const SKIN_THEMES: Record<SkinName, SkinTheme> = {
  neon: {
    title: 'escuro neon',
    hasChips: true,
    chipText: '#0b0b14',
    isBold: true,
    muted: '#6b7280',
    danger: '#ff3860',
    categories: paint({ read: '#00e5ff', edit: '#ff2bd6', create: '#39ff14', shell: '#ffb000', web: '#a78bfa', agent: '#ff7a45', other: '#94a3b8' }),
  },
  minimal: {
    title: 'claro minimalista',
    hasChips: false,
    chipText: '#ffffff',
    isBold: false,
    muted: '#9ca3af',
    danger: '#dc2626',
    categories: paint({ read: '#2563eb', edit: '#b45309', create: '#15803d', shell: '#4b5563', web: '#7c3aed', agent: '#c2410c', other: '#6b7280' }),
  },
  contraste: {
    title: 'alto contraste',
    hasChips: true,
    chipText: '#000000',
    isBold: true,
    muted: '#ffffff',
    danger: '#ff0000',
    categories: paint({ read: '#00ffff', edit: '#ffff00', create: '#00ff00', shell: '#ffffff', web: '#ff80ff', agent: '#ff8000', other: '#c0c0c0' }),
  },
}

const SKIN_ALIASES: Readonly<Record<string, SkinChoice>> = {
  neon: 'neon',
  'escuro-neon': 'neon',
  escuro: 'neon',
  minimal: 'minimal',
  minimalista: 'minimal',
  claro: 'minimal',
  'claro-minimalista': 'minimal',
  contraste: 'contraste',
  'alto-contraste': 'contraste',
  off: 'off',
  padrao: 'off',
  'padrão': 'off',
}

/**
 * Resolves what the person typed (any case, spaces or hyphens) to a skin.
 * @example resolveSkinName(' Alto Contraste ') // 'contraste'
 */
export function resolveSkinName(typed: string): SkinChoice | undefined {
  return SKIN_ALIASES[typed.trim().toLowerCase().replace(/\s+/g, '-')]
}

/**
 * Accepts only a known skin from storage; anything else (an old or corrupt value) is undefined.
 * @example storedSkinChoice('minimal') // 'minimal'
 */
export function storedSkinChoice(stored: unknown): SkinChoice | undefined {
  return typeof stored === 'string' && (stored === 'off' || SKIN_NAMES.includes(stored as SkinName))
    ? (stored as SkinChoice)
    : undefined
}
