/**
 * catalog — load and validate assets/catalog.json (the data-driven source of
 * truth for what the menus offer and what gets installed).
 *
 * MCP entries are stored in a transport-neutral shape; core/mcp.ts translates
 * them per agent. Users edit catalog.json without touching code; an override
 * path can be supplied via AGENT_HARNESS_CATALOG.
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import process from 'node:process';
import { z } from 'zod';
import { readText } from './fsx';

// ---------------------------------------------------------------------------
// Schema
// ---------------------------------------------------------------------------

/**
 * Per-agent tweaks for one MCP entry, keyed by agent id. Lets a single catalog
 * entry describe a server whose launch differs per agent (e.g. Pencil takes
 * `--agent claudeCodeCLI` / `codexCLI` / `openCodeCLI`) or that needs
 * agent-native keys we don't model neutrally (Codex `startup_timeout_sec`,
 * per-tool `approval_mode`, …) via `extra`.
 */
const McpAgentOverrideSchema = z.object({
  command: z.string().min(1).optional(),
  args: z.array(z.string()).optional(),
  /** Raw keys merged into the rendered server entry for that agent. */
  extra: z.record(z.string(), z.unknown()).default({}),
});

const McpHttpSchema = z.object({
  id: z.string().min(1),
  label: z.string().min(1),
  transport: z.literal('http'),
  url: z.string().min(1),
  headers: z.record(z.string(), z.string()).default({}),
  env: z.array(z.string()).default([]),
  /** Restrict this MCP to specific agents (omit = all agents). */
  agents: z.array(z.string()).optional(),
  overrides: z.record(z.string(), McpAgentOverrideSchema).default({}),
});

const McpStdioSchema = z.object({
  id: z.string().min(1),
  label: z.string().min(1),
  transport: z.literal('stdio'),
  command: z.string().min(1),
  args: z.array(z.string()).default([]),
  env: z.array(z.string()).default([]),
  /** Restrict this MCP to specific agents (omit = all agents). */
  agents: z.array(z.string()).optional(),
  overrides: z.record(z.string(), McpAgentOverrideSchema).default({}),
});

const McpSchema = z.discriminatedUnion('transport', [McpHttpSchema, McpStdioSchema]);

/**
 * A skill that ships its own installer CLI (e.g. `npx impeccable install`)
 * instead of the generic `npx skills add`. `{provider}` in args is replaced by
 * the comma-joined provider names of the selected agents (per `providers`),
 * `{scope}` by `global` or `project`. Agents missing from `providers` skip.
 */
const SkillInstallerSchema = z.object({
  cmd: z.string().min(1),
  args: z.array(z.string()).default([]),
  providers: z.record(z.string(), z.string()).default({}),
});

const SkillSchema = z.object({
  id: z.string().min(1),
  label: z.string().optional(),
  /** owner/repo, URL, local dir, "local" (bundled in assets/skills/<id>/), or informational when `installer` is set. */
  source: z.string().min(1),
  /** the specific skill name inside that source. */
  skill: z.string().min(1),
  /** Restrict this skill to specific agents (omit = all agents). */
  agents: z.array(z.string()).optional(),
  /** External prerequisites the installer can't provide (listed in the manifest). */
  requires: z.array(z.string()).optional(),
  installer: SkillInstallerSchema.optional(),
});

const SubagentSchema = z.object({
  id: z.string().min(1),
  label: z.string().optional(),
  /** Claude Code variant: filename inside assets/agents/ (Markdown + frontmatter), copied verbatim. */
  file: z.string().min(1),
  /** Codex variant: filename inside assets/agents/ (TOML), copied verbatim. Omit = not offered to Codex. */
  codex_file: z.string().optional(),
});

const PluginSchemaRaw = z.object({
  id: z.string().min(1),
  label: z.string().optional(),
  /** @deprecated single-agent form; use `agents`. */
  agent: z.string().optional(),
  /** Restrict to specific agents (omit = every agent with a plugin system). */
  agents: z.array(z.string()).optional(),
  /** owner/repo or git URL of the marketplace. Empty allowed only when `builtin`. */
  marketplace: z.string().default(''),
  /**
   * The marketplace's declared name (its marketplace.json "name"), used in the
   * install ref `<plugin>@<name>`. Defaults to the last path segment of
   * `marketplace` when omitted — set it if they differ.
   */
  name: z.string().optional(),
  /** plugin names to install from that marketplace. */
  install: z.array(z.string()).default([]),
  /**
   * The agent app registers this marketplace itself (Codex `openai-curated`,
   * `openai-bundled`, …): skip the marketplace step and only enable the plugins.
   */
  builtin: z.boolean().default(false),
});

const PluginSchema = PluginSchemaRaw.transform((p) => ({
  ...p,
  agents: p.agents ?? (p.agent ? [p.agent] : undefined),
})).refine((p) => p.builtin || p.marketplace.length > 0, {
  message: 'plugin needs a `marketplace` unless `builtin` is true',
}).refine((p) => p.builtin ? Boolean(p.name) : true, {
  message: 'builtin plugins need an explicit marketplace `name`',
});

/**
 * Presets — merge/copy config files into the agents' home dirs (settings,
 * status line, global instructions). `merge-json` / `merge-toml` deep-merge the
 * asset into the destination (arrays union, so re-runs never duplicate);
 * `copy` writes the asset verbatim (`keep` = never overwrite an existing file
 * unless --force). `{{HOME}}` inside an asset expands to the user's home dir.
 */
const PresetFileSchema = z.object({
  op: z.enum(['merge-json', 'merge-toml', 'copy']),
  /** asset path relative to assets/ */
  asset: z.string().min(1),
  /** destination path; `~` expands to the home dir */
  dest: z.string().min(1),
  /** Restrict this file to specific agents (omit = whenever the preset applies). */
  agents: z.array(z.string()).optional(),
  keep: z.boolean().default(false),
});

const PresetSchema = z.object({
  id: z.string().min(1),
  label: z.string().optional(),
  /** Restrict this preset to specific agents (omit = all agents). */
  agents: z.array(z.string()).optional(),
  files: z.array(PresetFileSchema).min(1),
});

const TemplatesSchema = z.object({
  claude_md: z.string().min(1),
  agents_md: z.string().min(1),
  memory: z.string().min(1),
});

const CatalogSchema = z.object({
  agents: z.array(z.string()).default([]),
  mcps: z.array(McpSchema).default([]),
  skills: z.array(SkillSchema).default([]),
  subagents: z.array(SubagentSchema).default([]),
  plugins: z.array(PluginSchema).default([]),
  presets: z.array(PresetSchema).default([]),
  templates: TemplatesSchema,
  /** Entries the `scaffold` command merges into the project .gitignore. */
  gitignore: z.array(z.string()).default([]),
});

export type McpEntry = z.infer<typeof McpSchema>;
export type McpAgentOverride = z.infer<typeof McpAgentOverrideSchema>;
export type SkillEntry = z.infer<typeof SkillSchema>;
export type SubagentEntry = z.infer<typeof SubagentSchema>;
export type PluginEntry = z.infer<typeof PluginSchema>;
export type PresetEntry = z.infer<typeof PresetSchema>;
export type PresetFile = z.infer<typeof PresetFileSchema>;
export type CatalogTemplates = z.infer<typeof TemplatesSchema>;
export type CatalogData = z.infer<typeof CatalogSchema>;

// ---------------------------------------------------------------------------
// Asset resolution (relative to the bundled dist/, or env override)
// ---------------------------------------------------------------------------
function packageRoot(): string {
  // import.meta.url points at the bundled dist/cli.js; the package root (which
  // also contains assets/, per package.json "files") is its parent dir.
  const here = path.dirname(fileURLToPath(import.meta.url));
  return path.resolve(here, '..');
}

export function assetsDir(): string {
  return process.env.AGENT_HARNESS_ASSETS ?? path.join(packageRoot(), 'assets');
}

export function catalogPath(): string {
  return process.env.AGENT_HARNESS_CATALOG ?? path.join(assetsDir(), 'catalog.json');
}

/** Resolve a catalog-relative asset path (e.g. "templates/CLAUDE.md"). */
export function assetPath(rel: string): string {
  return path.isAbsolute(rel) ? rel : path.join(assetsDir(), rel);
}

// ---------------------------------------------------------------------------
// Loader
// ---------------------------------------------------------------------------
export async function loadCatalog(): Promise<CatalogData> {
  const p = catalogPath();
  const text = await readText(p);
  if (text == null) {
    throw new Error(
      `Catalog not found at ${p}.\n` +
        `Set AGENT_HARNESS_CATALOG to point at your own catalog.json if needed.`,
    );
  }
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (err) {
    throw new Error(`Catalog at ${p} is not valid JSON: ${(err as Error).message}`);
  }
  const parsed = CatalogSchema.safeParse(raw);
  if (!parsed.success) {
    const details = parsed.error.issues
      .map((i) => `  • ${i.path.join('.') || '(root)'}: ${i.message}`)
      .join('\n');
    throw new Error(`Catalog at ${p} failed validation:\n${details}`);
  }
  return parsed.data;
}

/** A placeholder value still looks like `<something>` — used to warn the user. */
export function looksLikePlaceholder(value: string): boolean {
  return /<[^>]+>/.test(value);
}

/** True when an optional agents-allowlist permits this agent (omit = all). */
export function appliesToAgent(agents: string[] | undefined, agentId: string): boolean {
  return !agents || agents.includes(agentId);
}

/** True when an MCP entry should be installed for the given agent. */
export function mcpAppliesTo(mcp: McpEntry, agentId: string): boolean {
  return appliesToAgent(mcp.agents, agentId);
}

/** True when a skill entry should be installed for the given agent. */
export function skillAppliesTo(skill: SkillEntry, agentId: string): boolean {
  if (!appliesToAgent(skill.agents, agentId)) return false;
  const providers = skill.installer?.providers;
  if (providers && Object.keys(providers).length) return agentId in providers;
  return true;
}

/** True when a plugin entry should be installed for the given agent. */
export function pluginAppliesTo(plugin: PluginEntry, agentId: string): boolean {
  return appliesToAgent(plugin.agents, agentId);
}

/** True when a preset should be applied given the selected agents. */
export function presetAppliesTo(preset: PresetEntry, agentIds: string[]): boolean {
  return agentIds.some((id) => appliesToAgent(preset.agents, id));
}
