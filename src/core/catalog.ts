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
const McpHttpSchema = z.object({
  id: z.string().min(1),
  label: z.string().min(1),
  transport: z.literal('http'),
  url: z.string().min(1),
  headers: z.record(z.string(), z.string()).default({}),
  env: z.array(z.string()).default([]),
});

const McpStdioSchema = z.object({
  id: z.string().min(1),
  label: z.string().min(1),
  transport: z.literal('stdio'),
  command: z.string().min(1),
  args: z.array(z.string()).default([]),
  env: z.array(z.string()).default([]),
});

const McpSchema = z.discriminatedUnion('transport', [McpHttpSchema, McpStdioSchema]);

const SkillSchema = z.object({
  id: z.string().min(1),
  label: z.string().optional(),
  /** owner/repo, URL, or local dir passed to `npx skills add`. */
  source: z.string().min(1),
  /** the specific skill name inside that source. */
  skill: z.string().min(1),
});

const PluginSchema = z.object({
  id: z.string().min(1),
  label: z.string().optional(),
  agent: z.string().default('claude-code'),
  /** owner/repo or git URL of the marketplace (used by `claude plugin marketplace add`). */
  marketplace: z.string().min(1),
  /**
   * The marketplace's declared name (its marketplace.json "name"), used in the
   * install ref `<plugin>@<name>`. Defaults to the last path segment of
   * `marketplace` when omitted — set it if they differ.
   */
  name: z.string().optional(),
  /** plugin names to install from that marketplace. */
  install: z.array(z.string()).default([]),
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
  plugins: z.array(PluginSchema).default([]),
  templates: TemplatesSchema,
  /** Entries the `scaffold` command merges into the project .gitignore. */
  gitignore: z.array(z.string()).default([]),
});

export type McpEntry = z.infer<typeof McpSchema>;
export type SkillEntry = z.infer<typeof SkillSchema>;
export type PluginEntry = z.infer<typeof PluginSchema>;
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
