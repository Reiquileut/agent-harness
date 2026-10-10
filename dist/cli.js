#!/usr/bin/env node

// src/cli.ts
import { Command } from "commander";
import process13 from "process";

// package.json
var package_default = {
  name: "@r2t/agent-harness",
  version: "1.6.0",
  description: "Dotfiles-for-AI-agents bootstrapper: one command to configure MCPs, skills, plugins, custom agents, settings presets and integrations across Claude Code, Codex, and OpenCode \u2014 with private overlays and a one-command Ubuntu bootstrap.",
  type: "module",
  bin: {
    "agent-harness": "dist/cli.js"
  },
  files: [
    "dist",
    "assets"
  ],
  engines: {
    node: ">=22"
  },
  scripts: {
    build: "tsup",
    dev: "tsup --watch",
    typecheck: "tsc",
    test: "bash scripts/ci-e2e.sh",
    prepack: "tsup",
    start: "node dist/cli.js",
    "test:hooks": "node --test assets/hooks/claude/bloquear-mencao-claude-commit.test.ts",
    guard: "node scripts/guard-no-private.mjs"
  },
  keywords: [
    "ai",
    "agents",
    "claude-code",
    "codex",
    "opencode",
    "mcp",
    "skills",
    "cli",
    "bootstrap",
    "dotfiles"
  ],
  author: "reiquileut",
  license: "MIT",
  publishConfig: {
    access: "public"
  },
  dependencies: {
    "@clack/prompts": "^1.6.0",
    commander: "^15.0.0",
    execa: "^9.6.1",
    picocolors: "^1.1.1",
    "smol-toml": "^1.7.0",
    zod: "^4.4.3"
  },
  devDependencies: {
    "@types/node": "^26.0.1",
    tsup: "^8.5.1",
    typescript: "^6.0.3"
  },
  pnpm: {
    onlyBuiltDependencies: [
      "esbuild"
    ],
    overrides: {
      esbuild: "^0.28.1"
    }
  }
};

// src/core/fsx.ts
import { existsSync, promises as fs } from "fs";
import os from "os";
import path from "path";
import process from "process";
import pc from "picocolors";
import { parse as parseTomlRaw, stringify as stringifyTomlRaw } from "smol-toml";
var ctx = { dryRun: false, force: false, yes: false };
function setRunContext(next) {
  ctx = { ...ctx, ...next };
}
var isDryRun = () => ctx.dryRun;
var isForce = () => ctx.force;
var log = {
  info: (m) => console.log(`${pc.blue("i")}  ${m}`),
  success: (m) => console.log(`${pc.green("\u2713")}  ${m}`),
  warn: (m) => console.log(`${pc.yellow("!")}  ${m}`),
  error: (m) => console.error(`${pc.red("\u2717")}  ${m}`),
  step: (m) => console.log(`${pc.cyan("\u2192")}  ${m}`),
  dim: (m) => console.log(pc.dim(m)),
  plain: (m) => console.log(m)
};
var dryTag = () => ctx.dryRun ? pc.yellow("[dry-run] ") : "";
var homeDir = () => os.homedir();
function expandHome(p) {
  if (p === "~") return homeDir();
  if (p.startsWith("~/") || p.startsWith("~\\")) return path.join(homeDir(), p.slice(2));
  return p;
}
var pathExists = (p) => existsSync(expandHome(p));
function tildify(p) {
  const abs = path.resolve(expandHome(p));
  const home = homeDir();
  return abs.startsWith(home) ? `~${abs.slice(home.length)}` : p;
}
async function readText(p) {
  try {
    return await fs.readFile(expandHome(p), "utf8");
  } catch (err) {
    if (err?.code === "ENOENT") return null;
    throw err;
  }
}
async function atomicWrite(p, content) {
  const target = expandHome(p);
  if (ctx.dryRun) return;
  await fs.mkdir(path.dirname(target), { recursive: true });
  const tmp = `${target}.${process.pid}.${Date.now()}.tmp`;
  await fs.writeFile(tmp, content, "utf8");
  await fs.rename(tmp, target);
}
async function readBytes(p) {
  try {
    return await fs.readFile(expandHome(p));
  } catch (err) {
    if (err?.code === "ENOENT") return null;
    throw err;
  }
}
async function atomicCopyFile(src, dest) {
  const target = expandHome(dest);
  if (ctx.dryRun) return;
  await fs.mkdir(path.dirname(target), { recursive: true });
  const tmp = `${target}.${process.pid}.${Date.now()}.tmp`;
  await fs.copyFile(expandHome(src), tmp);
  await fs.rename(tmp, target);
}
function isRecord(x) {
  return typeof x === "object" && x !== null && !Array.isArray(x);
}
function jsonStringify(value) {
  return `${JSON.stringify(value, null, 2)}
`;
}
function parseToml(text2) {
  return parseTomlRaw(text2);
}
function stringifyToml(value) {
  const out = stringifyTomlRaw(value);
  return out.endsWith("\n") ? out : `${out}
`;
}
var GITIGNORE_BEGIN = "# >>> agent-harness >>>";
var GITIGNORE_END = "# <<< agent-harness <<<";
function mergeGitignore(existing, entries) {
  const base = existing ?? "";
  const present = new Set(
    base.split(/\r?\n/).map((l) => l.trim()).filter(Boolean)
  );
  const toAdd = entries.map((e) => e.trim()).filter((e) => e && !present.has(e));
  if (toAdd.length === 0) return { content: base, added: [] };
  const hasBlock = base.includes(GITIGNORE_BEGIN);
  let content;
  if (hasBlock) {
    content = base.replace(GITIGNORE_END, `${toAdd.join("\n")}
${GITIGNORE_END}`);
  } else {
    const prefix = base.length === 0 || base.endsWith("\n") ? base : `${base}
`;
    const block = `${GITIGNORE_BEGIN}
${toAdd.join("\n")}
${GITIGNORE_END}
`;
    content = `${prefix}${prefix.length && !prefix.endsWith("\n\n") ? "\n" : ""}${block}`;
  }
  return { content, added: toAdd };
}
var MANIFEST_BEGIN = "<!-- BEGIN agent-harness -->";
var MANIFEST_END = "<!-- END agent-harness -->";
function mergeManagedBlock(existing, body, begin, end) {
  const base = existing ?? "";
  const block = `${begin}
${body.trim()}
${end}
`;
  const start = base.indexOf(begin);
  const stop = start === -1 ? -1 : base.indexOf(end, start + begin.length);
  if (start !== -1 && stop !== -1) {
    const before = base.slice(0, start);
    const after = base.slice(stop + end.length).replace(/^\r?\n/, "");
    return `${before}${block}${after}`;
  }
  const prefix = base.length === 0 || base.endsWith("\n") ? base : `${base}
`;
  const gap = prefix.length && !prefix.endsWith("\n\n") ? "\n" : "";
  return `${prefix}${gap}${block}`;
}

// src/commands/init.ts
import process12 from "process";
import pc5 from "picocolors";

// src/core/actions.ts
import { execa } from "execa";
import pc2 from "picocolors";
var INDENT = "   ";
async function runAction(action) {
  switch (action.kind) {
    case "skip":
      log.plain(`${INDENT}${pc2.dim("\xB7 skip")} ${action.label} \u2014 ${pc2.dim(action.reason)}`);
      return { status: "skipped", label: action.label, detail: action.reason };
    case "note":
      if (action.level === "warn") log.warn(`${INDENT}${action.message}`);
      else log.plain(`${INDENT}${pc2.dim("\xB7")} ${action.message}`);
      return { status: "skipped", label: action.label, detail: action.message };
    case "file": {
      if (action.before === action.after) {
        log.plain(`${INDENT}${pc2.dim("\xB7 already set")} ${action.label} ${pc2.dim(`(${tildify(action.path)})`)}`);
        return { status: "noop", label: action.label };
      }
      const verb = action.before == null ? "create" : "update";
      if (isDryRun()) {
        log.plain(`${INDENT}${dryTag()}${verb} ${tildify(action.path)} ${pc2.dim(`\u2014 ${action.label}`)}`);
        return { status: "written", label: action.label, detail: `${verb} ${action.path}` };
      }
      await atomicWrite(action.path, action.after);
      log.success(`${INDENT}${verb === "create" ? "created" : "updated"} ${tildify(action.path)} ${pc2.dim(`\u2014 ${action.label}`)}`);
      return { status: "written", label: action.label };
    }
    case "copy": {
      const srcBytes = await readBytes(action.src);
      if (srcBytes == null) {
        log.error(`${action.label} failed: source missing (${tildify(action.src)})`);
        return { status: "failed", label: action.label, detail: `missing ${action.src}` };
      }
      const destBytes = await readBytes(action.dest);
      if (destBytes != null && srcBytes.equals(destBytes)) {
        log.plain(`${INDENT}${pc2.dim("\xB7 already set")} ${action.label} ${pc2.dim(`(${tildify(action.dest)})`)}`);
        return { status: "noop", label: action.label };
      }
      const verb = destBytes == null ? "create" : "update";
      if (isDryRun()) {
        log.plain(`${INDENT}${dryTag()}${verb} ${tildify(action.dest)} ${pc2.dim(`\u2014 ${action.label}`)}`);
        return { status: "written", label: action.label, detail: `${verb} ${action.dest}` };
      }
      await atomicCopyFile(action.src, action.dest);
      log.success(`${INDENT}${verb === "create" ? "created" : "updated"} ${tildify(action.dest)} ${pc2.dim(`\u2014 ${action.label}`)}`);
      return { status: "written", label: action.label };
    }
    case "exec": {
      const printable = `${action.cmd} ${action.args.join(" ")}`.trim();
      if (isDryRun()) {
        log.plain(`${INDENT}${dryTag()}run: ${pc2.cyan(printable)} ${pc2.dim(`\u2014 ${action.label}`)}`);
        return { status: "ran", label: action.label, detail: printable };
      }
      try {
        await execa(action.cmd, action.args, {
          cwd: action.cwd,
          timeout: action.timeout ?? 12e4,
          stdin: "ignore",
          stdout: "pipe",
          stderr: "pipe"
        });
        log.success(`${INDENT}${action.label}`);
        return { status: "ran", label: action.label };
      } catch (err) {
        const first = (err instanceof Error ? err.message : String(err)).split("\n")[0] ?? "";
        if (action.tolerant) {
          log.plain(`${INDENT}${pc2.dim("\xB7 skip")} ${action.label} ${pc2.dim(`(${first})`)}`);
          return { status: "skipped", label: action.label, detail: first };
        }
        log.error(`${action.label} failed: ${first}`);
        return { status: "failed", label: action.label, detail: first };
      }
    }
  }
}
async function runActions(actions) {
  const results = [];
  for (const a of actions) results.push(await runAction(a));
  return results;
}

// src/core/agents.ts
import { accessSync, constants as fsConstants, existsSync as existsSync2 } from "fs";
import path2 from "path";
import process2 from "process";
var AGENTS = [
  {
    id: "claude-code",
    label: "Claude Code",
    skillAgentId: "claude-code",
    instructionsFile: "CLAUDE.md",
    login: { cmd: "claude", note: "OAuth on first run, or /login" },
    bin: "claude",
    detectDirs: ["~/.claude"],
    detectFiles: ["~/.claude.json"],
    supports: { mcp: true, skills: true, plugins: true, subagents: true },
    mcpUserMethod: "claude-cli",
    pluginMethod: "claude-cli",
    projectMcpFile: ".mcp.json",
    globalInstructionsFile: "~/.claude/CLAUDE.md",
    skills: { userDir: "~/.claude/skills", projectDir: ".claude/skills" },
    subagents: { userDir: "~/.claude/agents", projectDir: ".claude/agents", format: "md" }
  },
  {
    id: "codex",
    label: "Codex",
    skillAgentId: "codex",
    instructionsFile: "AGENTS.md",
    login: { cmd: "codex login" },
    bin: "codex",
    detectDirs: ["~/.codex"],
    detectFiles: ["~/.codex/config.toml"],
    supports: { mcp: true, skills: true, plugins: true, subagents: true },
    mcpUserMethod: "codex-toml",
    pluginMethod: "codex-toml",
    userMcpFile: "~/.codex/config.toml",
    globalInstructionsFile: "~/.codex/AGENTS.md",
    // Codex reads ~/.agents/skills (user) and .agents/skills (repo) per current docs.
    skills: { userDir: "~/.agents/skills", projectDir: ".agents/skills" },
    // Codex custom agents are TOML files under ~/.codex/agents (user) / .codex/agents (repo).
    subagents: { userDir: "~/.codex/agents", projectDir: ".codex/agents", format: "toml" }
  },
  {
    id: "opencode",
    label: "OpenCode",
    skillAgentId: "opencode",
    instructionsFile: "AGENTS.md",
    login: { cmd: "opencode auth login" },
    bin: "opencode",
    detectDirs: ["~/.config/opencode", "~/.opencode"],
    detectFiles: ["~/.config/opencode/opencode.json"],
    supports: { mcp: true, skills: true, plugins: false, subagents: false },
    mcpUserMethod: "opencode-json",
    userMcpFile: "~/.config/opencode/opencode.json",
    globalInstructionsFile: "~/.config/opencode/AGENTS.md",
    skills: { userDir: "~/.config/opencode/skills", projectDir: ".opencode/skills" }
  }
];
function getAgent(id) {
  return AGENTS.find((a) => a.id === id);
}
function commandOnPath(bin) {
  const rawPath = process2.env.PATH ?? process2.env.Path ?? "";
  if (!rawPath) return false;
  const sep = process2.platform === "win32" ? ";" : ":";
  const exts = process2.platform === "win32" ? (process2.env.PATHEXT ?? ".EXE;.CMD;.BAT;.COM").split(";").filter(Boolean) : [""];
  for (const dir of rawPath.split(sep)) {
    if (!dir) continue;
    if (exts.some((ext) => isRunnableFile(path2.join(dir, bin + ext)))) return true;
  }
  return false;
}
function isRunnableFile(candidate) {
  try {
    if (!existsSync2(candidate)) return false;
    if (process2.platform !== "win32") accessSync(candidate, fsConstants.X_OK);
    return true;
  } catch {
    return false;
  }
}
function isAgentInstalled(a) {
  if (a.detectDirs.some((d) => pathExists(d))) return true;
  if (a.detectFiles.some((f) => pathExists(f))) return true;
  return commandOnPath(a.bin);
}
function detectInstalledAgentIds() {
  return AGENTS.filter(isAgentInstalled).map((a) => a.id);
}
function userMcpFileAbs(a) {
  return a.userMcpFile ? expandHome(a.userMcpFile) : void 0;
}

// src/core/catalog.ts
import path3 from "path";
import { fileURLToPath } from "url";
import process4 from "process";
import { z as z2 } from "zod";

// src/core/platform.ts
import process3 from "process";
import { z } from "zod";
var PLATFORM_IDS = ["win32", "linux", "darwin"];
var PlatformsSchema = z.array(z.enum(PLATFORM_IDS)).min(1).optional();
function isPlatform(value) {
  return PLATFORM_IDS.includes(value);
}
function currentPlatform(env = process3.env) {
  const override = env.AGENT_HARNESS_PLATFORM;
  if (override === void 0 || override === "") return normalizeHostPlatform(process3.platform);
  if (isPlatform(override)) return override;
  throw new Error(
    `AGENT_HARNESS_PLATFORM=${JSON.stringify(override)} is invalid; expected one of ${PLATFORM_IDS.join(", ")}`
  );
}
function normalizeHostPlatform(host) {
  return isPlatform(host) ? host : "linux";
}
function platformAllows(platforms, current = currentPlatform()) {
  return !platforms || platforms.includes(current);
}
function platformSkipReason(platforms, current = currentPlatform()) {
  return `only on ${(platforms ?? []).join("/")} (current: ${current})`;
}

// src/core/catalog.ts
var OriginFields = {
  assetsRoot: z2.string().optional(),
  overlay: z2.string().optional()
};
var McpAgentOverrideSchema = z2.object({
  command: z2.string().min(1).optional(),
  args: z2.array(z2.string()).optional(),
  /** Raw keys merged into the rendered server entry for that agent. */
  extra: z2.record(z2.string(), z2.unknown()).default({})
});
var McpHttpSchema = z2.object({
  id: z2.string().min(1),
  label: z2.string().min(1),
  transport: z2.literal("http"),
  url: z2.string().min(1),
  headers: z2.record(z2.string(), z2.string()).default({}),
  env: z2.array(z2.string()).default([]),
  /** Restrict this MCP to specific agents (omit = all agents). */
  agents: z2.array(z2.string()).optional(),
  /** Restrict this MCP to specific OSes (omit = all). */
  platforms: PlatformsSchema,
  overrides: z2.record(z2.string(), McpAgentOverrideSchema).default({}),
  ...OriginFields
});
var McpStdioSchema = z2.object({
  id: z2.string().min(1),
  label: z2.string().min(1),
  transport: z2.literal("stdio"),
  command: z2.string().min(1),
  args: z2.array(z2.string()).default([]),
  env: z2.array(z2.string()).default([]),
  /** Restrict this MCP to specific agents (omit = all agents). */
  agents: z2.array(z2.string()).optional(),
  /** Restrict this MCP to specific OSes (omit = all), e.g. Pencil's Windows .exe. */
  platforms: PlatformsSchema,
  overrides: z2.record(z2.string(), McpAgentOverrideSchema).default({}),
  ...OriginFields
});
var McpSchema = z2.discriminatedUnion("transport", [McpHttpSchema, McpStdioSchema]);
var SkillInstallerSchema = z2.object({
  cmd: z2.string().min(1),
  args: z2.array(z2.string()).default([]),
  providers: z2.record(z2.string(), z2.string()).default({})
});
var SkillSchema = z2.object({
  id: z2.string().min(1),
  label: z2.string().optional(),
  /** owner/repo, URL, local dir, "local" (bundled in assets/skills/<id>/), or informational when `installer` is set. */
  source: z2.string().min(1),
  /** the specific skill name inside that source. */
  skill: z2.string().min(1),
  /** Restrict this skill to specific agents (omit = all agents). */
  agents: z2.array(z2.string()).optional(),
  /** External prerequisites the installer can't provide (listed in the manifest). */
  requires: z2.array(z2.string()).optional(),
  installer: SkillInstallerSchema.optional(),
  /** Restrict this skill to specific OSes (omit = all). */
  platforms: PlatformsSchema,
  ...OriginFields
});
var SubagentSchema = z2.object({
  id: z2.string().min(1),
  label: z2.string().optional(),
  /** Claude Code variant: filename inside assets/agents/ (Markdown + frontmatter), copied verbatim. */
  file: z2.string().min(1),
  /** Codex variant: filename inside assets/agents/ (TOML), copied verbatim. Omit = not offered to Codex. */
  codex_file: z2.string().optional(),
  ...OriginFields
});
var PluginSchemaRaw = z2.object({
  id: z2.string().min(1),
  label: z2.string().optional(),
  /** @deprecated single-agent form; use `agents`. */
  agent: z2.string().optional(),
  /** Restrict to specific agents (omit = every agent with a plugin system). */
  agents: z2.array(z2.string()).optional(),
  /** owner/repo or git URL of the marketplace. Empty allowed only when `builtin`. */
  marketplace: z2.string().default(""),
  /**
   * The marketplace's declared name (its marketplace.json "name"), used in the
   * install ref `<plugin>@<name>`. Defaults to the last path segment of
   * `marketplace` when omitted — set it if they differ.
   */
  name: z2.string().optional(),
  /** plugin names to install from that marketplace. */
  install: z2.array(z2.string()).default([]),
  /**
   * The agent app registers this marketplace itself (Codex `openai-curated`,
   * `openai-bundled`, …): skip the marketplace step and only enable the plugins.
   */
  builtin: z2.boolean().default(false),
  ...OriginFields
});
var PluginSchema = PluginSchemaRaw.transform((p) => ({
  ...p,
  agents: p.agents ?? (p.agent ? [p.agent] : void 0)
})).refine((p) => p.builtin || p.marketplace.length > 0, {
  message: "plugin needs a `marketplace` unless `builtin` is true"
}).refine((p) => p.builtin ? Boolean(p.name) : true, {
  message: "builtin plugins need an explicit marketplace `name`"
});
var PresetFileSchema = z2.object({
  op: z2.enum(["merge-json", "merge-toml", "copy", "ensure-prefix"]),
  /** asset path relative to assets/ */
  asset: z2.string().min(1),
  /** destination path; `~` expands to the home dir */
  dest: z2.string().min(1),
  /** Restrict this file to specific agents (omit = whenever the preset applies). */
  agents: z2.array(z2.string()).optional(),
  /** Restrict this file to specific OSes (omit = all), e.g. Codex `[windows]` tables. */
  platforms: PlatformsSchema,
  keep: z2.boolean().default(false),
  ...OriginFields
});
var PresetSchema = z2.object({
  id: z2.string().min(1),
  label: z2.string().optional(),
  /** Restrict this preset to specific agents (omit = all agents). */
  agents: z2.array(z2.string()).optional(),
  files: z2.array(PresetFileSchema).min(1),
  ...OriginFields
});
var IntegrationStepSchema = z2.object({
  cmd: z2.string().min(1),
  args: z2.array(z2.string()).default([])
});
var IntegrationSchema = z2.object({
  id: z2.string().min(1),
  label: z2.string().optional(),
  agents: z2.array(z2.string()).optional(),
  platforms: PlatformsSchema,
  /** Binary that must be on PATH before anything runs. */
  bin: z2.string().min(1),
  /** Shown when `bin` is missing (how to install it). */
  installHint: z2.string().optional(),
  /** Env var NAMES the tool reads (documented in the auth block / manifest). */
  env: z2.array(z2.string()).default([]),
  /** Env var NAMES that must be set, or the integration is skipped with a note. */
  requiredEnv: z2.array(z2.string()).default([]),
  /** Harness agent id → the tool's own name for that agent (`{agent}`). */
  agentNames: z2.record(z2.string(), z2.string()).default({}),
  perAgent: z2.array(IntegrationStepSchema).default([]),
  once: z2.array(IntegrationStepSchema).default([]),
  /** Config files merged before the commands run (same ops as presets). */
  files: z2.array(PresetFileSchema).default([]),
  ...OriginFields
});
var TemplatesSchema = z2.object({
  claude_md: z2.string().min(1),
  agents_md: z2.string().min(1),
  memory: z2.string().min(1)
});
var CatalogBaseSchema = z2.object({
  agents: z2.array(z2.string()).default([]),
  mcps: z2.array(McpSchema).default([]),
  skills: z2.array(SkillSchema).default([]),
  subagents: z2.array(SubagentSchema).default([]),
  plugins: z2.array(PluginSchema).default([]),
  presets: z2.array(PresetSchema).default([]),
  integrations: z2.array(IntegrationSchema).default([]),
  /** Entries the `scaffold` command merges into the project .gitignore. */
  gitignore: z2.array(z2.string()).default([])
});
var CatalogSchema = CatalogBaseSchema.extend({ templates: TemplatesSchema });
function packageRoot() {
  const here = path3.dirname(fileURLToPath(import.meta.url));
  return path3.resolve(here, "..");
}
function assetsDir() {
  return process4.env.AGENT_HARNESS_ASSETS ?? path3.join(packageRoot(), "assets");
}
function catalogPath() {
  return process4.env.AGENT_HARNESS_CATALOG ?? path3.join(assetsDir(), "catalog.json");
}
function assetPath(rel, root = assetsDir()) {
  return path3.isAbsolute(rel) ? rel : path3.join(root, rel);
}
async function parseCatalogFile(p, schema) {
  const text2 = await readText(p);
  if (text2 == null) throw new Error(`Catalog not found at ${p} (expected a catalog.json file).`);
  let raw;
  try {
    raw = JSON.parse(text2);
  } catch (err) {
    throw new Error(`Catalog at ${p} is not valid JSON: ${err.message}`);
  }
  const parsed = schema.safeParse(raw);
  if (parsed.success) return parsed.data;
  const details = parsed.error.issues.map((i) => `  \u2022 ${i.path.join(".") || "(root)"}: ${i.message}`).join("\n");
  throw new Error(`Catalog at ${p} failed validation:
${details}`);
}
var STAMPED_SECTIONS = ["mcps", "skills", "subagents", "plugins", "presets", "integrations"];
function stampCatalogOrigin(base, origin) {
  const targets = STAMPED_SECTIONS.flatMap((section) => base[section]);
  targets.push(...[...base.presets, ...base.integrations].flatMap((p) => p.files));
  for (const target of targets) {
    target.assetsRoot = origin.assetsRoot;
    target.overlay = origin.overlay;
  }
  return base;
}
async function loadCatalog() {
  const catalog = await parseCatalogFile(catalogPath(), CatalogSchema);
  return stampCatalogOrigin(catalog, {});
}
function looksLikePlaceholder(value) {
  return /<[^>]+>/.test(value);
}
function appliesToAgent(agents, agentId) {
  return !agents || agents.includes(agentId);
}
function mcpAppliesTo(mcp, agentId) {
  return appliesToAgent(mcp.agents, agentId) && platformAllows(mcp.platforms);
}
function skillAppliesTo(skill, agentId) {
  if (!appliesToAgent(skill.agents, agentId) || !platformAllows(skill.platforms)) return false;
  const providers = skill.installer?.providers;
  if (providers && Object.keys(providers).length) return agentId in providers;
  return true;
}
function pluginAppliesTo(plugin, agentId) {
  return appliesToAgent(plugin.agents, agentId);
}
function integrationAppliesTo(integration, agentId) {
  return appliesToAgent(integration.agents, agentId) && agentId in integration.agentNames;
}
function presetAppliesTo(preset, agentIds) {
  return agentIds.some((id) => appliesToAgent(preset.agents, id));
}

// src/core/plugins.ts
import path4 from "path";
function marketplaceName(plugin) {
  if (plugin.name) return plugin.name;
  const seg = plugin.marketplace.split("/").pop() ?? plugin.marketplace;
  return seg.replace(/\.git$/, "");
}
function marketplaceGitUrl(plugin) {
  const m = plugin.marketplace;
  if (/^(https?:|git@|ssh:)/.test(m)) return m;
  return `https://github.com/${m.replace(/\.git$/, "")}.git`;
}
function claudeAvailable() {
  return commandOnPath("claude");
}
async function buildPluginActions(agent, plugin) {
  if (!agent.supports.plugins || !agent.pluginMethod) {
    return [{ kind: "skip", label: `Plugins \u2192 ${agent.label}`, reason: "agent has no plugin system" }];
  }
  switch (agent.pluginMethod) {
    case "claude-cli":
      return buildClaudePluginActions(plugin);
    case "codex-toml":
      return [await buildCodexPluginAction(agent, plugin)];
  }
}
function buildClaudePluginActions(plugin) {
  if (!claudeAvailable()) return [];
  const actions = [];
  if (!plugin.builtin) {
    actions.push({
      kind: "exec",
      label: `Marketplace ${plugin.marketplace}`,
      cmd: "claude",
      args: ["plugin", "marketplace", "add", plugin.marketplace],
      timeout: 12e4,
      tolerant: true
    });
  }
  const mp = marketplaceName(plugin);
  for (const name of plugin.install) {
    const ref = `${name}@${mp}`;
    actions.push({
      kind: "exec",
      label: `Plugin ${ref}`,
      cmd: "claude",
      args: ["plugin", "install", ref, "--scope", "user"],
      timeout: 12e4,
      tolerant: true
    });
  }
  return actions;
}
async function buildPluginSettingsFallbackAction(plugin) {
  const file = expandHome("~/.claude/settings.json");
  const label = `Claude settings (plugins) \u2192 ${marketplaceName(plugin)}`;
  const before = await readText(file);
  let root = {};
  if (before && before.trim()) {
    try {
      const parsed = JSON.parse(before);
      if (isRecord(parsed)) root = parsed;
    } catch {
      return {
        kind: "note",
        level: "warn",
        label,
        message: `Could not parse ${tildify(file)}; configure the plugin manually.`
      };
    }
  }
  const mpName = marketplaceName(plugin);
  if (!plugin.builtin) {
    const repo = plugin.marketplace.replace(/\.git$/, "");
    const ekm = isRecord(root.extraKnownMarketplaces) ? { ...root.extraKnownMarketplaces } : {};
    ekm[mpName] = { source: { source: "github", repo } };
    root.extraKnownMarketplaces = ekm;
  }
  const enabled = isRecord(root.enabledPlugins) ? { ...root.enabledPlugins } : {};
  for (const name of plugin.install) enabled[`${name}@${mpName}`] = true;
  root.enabledPlugins = enabled;
  const after = jsonStringify(root);
  if (before === after) return { kind: "skip", label, reason: "already in settings.json" };
  return { kind: "file", label, path: file, before: before ?? null, after };
}
function safeParseToml(text2) {
  try {
    return parseToml(text2);
  } catch {
    return null;
  }
}
async function buildCodexPluginAction(agent, plugin) {
  const file = userMcpFileAbs(agent);
  const mpName = marketplaceName(plugin);
  const label = `Plugins ${plugin.install.map((p) => `${p}@${mpName}`).join(", ")} \u2192 ${agent.label}`;
  if (!file) return { kind: "skip", label, reason: "no codex config path" };
  const before = await readText(file);
  const root = before && before.trim() ? safeParseToml(before) : {};
  if (root === null) {
    return {
      kind: "note",
      level: "warn",
      label,
      message: `Could not parse ${tildify(file)}; add [marketplaces.${mpName}] / [plugins] manually.`
    };
  }
  const marketplaces = isRecord(root.marketplaces) ? root.marketplaces : {};
  const plugins = isRecord(root.plugins) ? root.plugins : {};
  const wantMarketplace = !plugin.builtin && !(mpName in marketplaces);
  const wantPlugins = plugin.install.map((p) => `${p}@${mpName}`).filter((ref) => {
    const cur = plugins[ref];
    if (!isRecord(cur)) return true;
    return isForce() && cur.enabled !== true;
  });
  if (!wantMarketplace && wantPlugins.length === 0) {
    return { kind: "skip", label, reason: `already in ${path4.basename(file)}` };
  }
  const patch = {};
  if (wantMarketplace) {
    patch.marketplaces = { [mpName]: { source_type: "git", source: marketplaceGitUrl(plugin) } };
  }
  if (wantPlugins.length) {
    patch.plugins = Object.fromEntries(wantPlugins.map((ref) => [ref, { enabled: true }]));
  }
  const mustRewrite = wantPlugins.some((ref) => isRecord(plugins[ref]));
  if (mustRewrite) {
    if (before?.includes("#")) {
      log.warn(`   rewriting ${tildify(file)} (TOML comments may be lost)`);
    }
    const next = { ...root };
    if (wantMarketplace) next.marketplaces = { ...marketplaces, ...patch.marketplaces };
    next.plugins = { ...plugins, ...patch.plugins };
    return { kind: "file", label, path: file, before: before ?? null, after: stringifyToml(next) };
  }
  let block = stringifyToml(patch);
  block = block.replace(/^\[(marketplaces|plugins)\]\s*\n+/gm, "");
  const after = before == null || before.trim() === "" ? block : `${before}${before.endsWith("\n") ? "" : "\n"}
${block}`;
  return { kind: "file", label, path: file, before: before ?? null, after };
}

// src/core/mcp.ts
import path5 from "path";
import process5 from "process";
import { execa as execa2 } from "execa";
var OPENCODE_SCHEMA = "https://opencode.ai/config.json";
function isRecord2(x) {
  return typeof x === "object" && x !== null && !Array.isArray(x);
}
function safeParseToml2(text2) {
  try {
    return parseToml(text2);
  } catch {
    return null;
  }
}
function resolveMcpForAgent(m, agentId) {
  const o = m.overrides[agentId];
  if (!o) return { entry: m, extra: {} };
  if (m.transport === "http") return { entry: m, extra: o.extra };
  return {
    entry: { ...m, command: o.command ?? m.command, args: o.args ?? m.args },
    extra: o.extra
  };
}
function toClaudeServer(src) {
  const { entry: m, extra } = resolveMcpForAgent(src, "claude-code");
  if (m.transport === "http") {
    const v2 = { type: "http", url: m.url };
    if (Object.keys(m.headers).length) v2.headers = m.headers;
    return { ...v2, ...extra };
  }
  const v = { command: m.command, args: m.args };
  if (m.env.length) {
    v.env = Object.fromEntries(m.env.map((name) => [name, `\${${name}}`]));
  }
  return { ...v, ...extra };
}
function toCodexServer(src) {
  const { entry: m, extra } = resolveMcpForAgent(src, "codex");
  if (m.transport === "http") {
    const v2 = { url: m.url };
    if (Object.keys(m.headers).length) v2.http_headers = m.headers;
    return { ...v2, ...extra };
  }
  const v = { command: m.command, args: m.args };
  if (m.env.length) v.env_vars = m.env;
  return { ...v, ...extra };
}
function toOpencodeServer(src) {
  const { entry: m, extra } = resolveMcpForAgent(src, "opencode");
  if (m.transport === "http") {
    const v2 = { type: "remote", url: m.url, enabled: true };
    if (Object.keys(m.headers).length) v2.headers = m.headers;
    return { ...v2, ...extra };
  }
  const v = {
    type: "local",
    command: [m.command, ...m.args],
    enabled: true
  };
  if (m.env.length) {
    v.environment = Object.fromEntries(m.env.map((name) => [name, `{env:${name}}`]));
  }
  return { ...v, ...extra };
}
async function buildUserMcpAction(agent, m) {
  const label = `MCP ${m.id} \u2192 ${agent.label}`;
  switch (agent.mcpUserMethod) {
    case "claude-cli":
      return buildClaudeUserMcp(m, label);
    case "codex-toml":
      return buildCodexUserMcp(agent, m, label);
    case "opencode-json":
      return buildOpencodeUserMcp(agent, m, label);
  }
}
async function claudeHasMcp(id) {
  if (!commandOnPath("claude")) return false;
  try {
    await execa2("claude", ["mcp", "get", id], {
      timeout: 15e3,
      stdin: "ignore",
      stdout: "ignore",
      stderr: "ignore"
    });
    return true;
  } catch {
    return false;
  }
}
async function buildClaudeUserMcp(src, label) {
  const { entry: m } = resolveMcpForAgent(src, "claude-code");
  if (!commandOnPath("claude")) {
    return {
      kind: "note",
      level: "warn",
      label,
      message: `Claude Code not on PATH \u2014 skipped ${m.id}. Install Claude, then re-run.`
    };
  }
  if (!isForce() && await claudeHasMcp(m.id)) {
    return { kind: "skip", label, reason: "already configured (claude mcp)" };
  }
  return { kind: "exec", label, cmd: "claude", args: claudeMcpAddArgs(m), timeout: 12e4 };
}
function claudeMcpAddArgs(m) {
  if (m.transport === "http") {
    const headers = Object.entries(m.headers).flatMap(([k, v]) => ["--header", `${k}: ${v}`]);
    return ["mcp", "add", m.id, m.url, "--scope", "user", "--transport", "http", ...headers];
  }
  const env = m.env.flatMap((name) => ["--env", `${name}=\${${name}}`]);
  return ["mcp", "add", m.id, "--scope", "user", "--transport", "stdio", ...env, "--", m.command, ...m.args];
}
async function buildCodexUserMcp(agent, m, label) {
  const file = userMcpFileAbs(agent);
  if (!file) return { kind: "skip", label, reason: "no codex config path" };
  const before = await readText(file);
  const root = before && before.trim() ? safeParseToml2(before) : {};
  if (root === null) {
    return {
      kind: "note",
      level: "warn",
      label,
      message: `Could not parse ${tildify(file)}; add [mcp_servers.${m.id}] manually.`
    };
  }
  const servers = isRecord2(root.mcp_servers) ? root.mcp_servers : {};
  const exists = m.id in servers;
  if (exists && !isForce()) {
    return { kind: "skip", label, reason: `already in ${path5.basename(file)}` };
  }
  if (exists && isForce()) {
    if (before?.includes("#")) {
      log.warn(`   rewriting ${tildify(file)} (TOML comments may be lost)`);
    }
    const next = { ...root, mcp_servers: { ...servers, [m.id]: toCodexServer(m) } };
    return { kind: "file", label, path: file, before: before ?? null, after: stringifyToml(next) };
  }
  let block = stringifyToml({ mcp_servers: { [m.id]: toCodexServer(m) } });
  block = block.replace(/^\[mcp_servers\]\s*\n+/, "");
  const after = before == null || before.trim() === "" ? block : `${before}${before.endsWith("\n") ? "" : "\n"}
${block}`;
  return { kind: "file", label, path: file, before: before ?? null, after };
}
async function buildOpencodeUserMcp(agent, m, label) {
  const file = userMcpFileAbs(agent);
  if (!file) return { kind: "skip", label, reason: "no opencode config path" };
  const before = await readText(file);
  let root = {};
  if (before && before.trim()) {
    try {
      const parsed = JSON.parse(before);
      if (isRecord2(parsed)) root = parsed;
    } catch {
      return {
        kind: "note",
        level: "warn",
        label,
        message: `Could not parse ${tildify(file)} as JSON; add mcp.${m.id} manually.`
      };
    }
  }
  if (!root.$schema) root.$schema = OPENCODE_SCHEMA;
  const mcp = isRecord2(root.mcp) ? root.mcp : {};
  if (m.id in mcp && !isForce()) {
    return { kind: "skip", label, reason: "already in opencode.json" };
  }
  root.mcp = { ...mcp, [m.id]: toOpencodeServer(m) };
  return { kind: "file", label, path: file, before: before ?? null, after: jsonStringify(root) };
}
async function buildProjectMcpAction(entries, opts) {
  const file = path5.isAbsolute(opts.file) ? opts.file : path5.resolve(opts.cwd ?? process5.cwd(), opts.file);
  const before = await readText(file);
  const name = path5.basename(file);
  const label = `project ${name} (${entries.length} MCP${entries.length === 1 ? "" : "s"})`;
  let root = {};
  if (before && before.trim()) {
    try {
      const parsed = JSON.parse(before);
      if (isRecord2(parsed)) root = parsed;
    } catch {
      return {
        kind: "note",
        level: "warn",
        label,
        message: `Could not parse ${tildify(file)} as JSON; edit it manually.`
      };
    }
  }
  let changed = false;
  if (opts.format === "claude") {
    const servers = isRecord2(root.mcpServers) ? { ...root.mcpServers } : {};
    for (const m of entries) {
      if (m.id in servers && !isForce()) continue;
      servers[m.id] = toClaudeServer(m);
      changed = true;
    }
    root.mcpServers = servers;
  } else {
    if (!root.$schema) {
      root.$schema = OPENCODE_SCHEMA;
      changed = true;
    }
    const mcp = isRecord2(root.mcp) ? { ...root.mcp } : {};
    for (const m of entries) {
      if (m.id in mcp && !isForce()) continue;
      mcp[m.id] = toOpencodeServer(m);
      changed = true;
    }
    root.mcp = mcp;
  }
  if (!changed && before != null) {
    return { kind: "skip", label, reason: "all selected MCPs already present" };
  }
  return { kind: "file", label, path: file, before: before ?? null, after: jsonStringify(root) };
}
function requiredEnvVars(entries) {
  const set = /* @__PURE__ */ new Set();
  for (const m of entries) for (const name of m.env) set.add(name);
  return [...set];
}

// src/core/presets.ts
function deepMergeUnion(base, patch) {
  if (Array.isArray(patch)) {
    const out2 = Array.isArray(base) ? [...base] : [];
    const seen = new Set(out2.map((x) => JSON.stringify(x)));
    for (const item of patch) {
      const key = JSON.stringify(item);
      if (!seen.has(key)) {
        seen.add(key);
        out2.push(item);
      }
    }
    return out2;
  }
  if (!isRecord(patch)) return patch;
  const out = isRecord(base) ? { ...base } : {};
  for (const [k, v] of Object.entries(patch)) out[k] = deepMergeUnion(out[k], v);
  return out;
}
function substitutePlaceholders(text2) {
  const home = homeDir().replace(/\\/g, "/");
  return text2.replaceAll("{{HOME}}", home);
}
function sameJson(a, b) {
  return JSON.stringify(a) === JSON.stringify(b);
}
async function readAsset(file) {
  const text2 = await readText(assetPath(file.asset, file.assetsRoot));
  return text2 == null ? null : substitutePlaceholders(text2);
}
async function buildCopy(file, label) {
  const after = await readAsset(file);
  if (after == null) return { kind: "note", level: "warn", label, message: `Preset asset missing: ${file.asset}` };
  const dest = expandHome(file.dest);
  const before = await readText(dest);
  if (before != null && file.keep && !isForce()) {
    return { kind: "skip", label, reason: `${tildify(dest)} exists (use --force to overwrite)` };
  }
  return { kind: "file", label, path: dest, before, after };
}
async function buildMergeJson(file, label) {
  const assetText = await readAsset(file);
  if (assetText == null) return { kind: "note", level: "warn", label, message: `Preset asset missing: ${file.asset}` };
  let patch;
  try {
    patch = JSON.parse(assetText);
  } catch (err) {
    return { kind: "note", level: "warn", label, message: `Preset asset ${file.asset} is not valid JSON: ${err.message}` };
  }
  const dest = expandHome(file.dest);
  const before = await readText(dest);
  let base = {};
  if (before && before.trim()) {
    try {
      base = JSON.parse(before);
    } catch {
      return { kind: "note", level: "warn", label, message: `Could not parse ${tildify(dest)} as JSON; merge it manually.` };
    }
  }
  const merged = deepMergeUnion(base, patch);
  if (before != null && sameJson(base, merged)) {
    return { kind: "skip", label, reason: `already merged into ${tildify(dest)}` };
  }
  return { kind: "file", label, path: dest, before, after: jsonStringify(merged) };
}
async function buildMergeToml(file, label) {
  const assetText = await readAsset(file);
  if (assetText == null) return { kind: "note", level: "warn", label, message: `Preset asset missing: ${file.asset}` };
  let patch;
  try {
    patch = parseToml(assetText);
  } catch (err) {
    return { kind: "note", level: "warn", label, message: `Preset asset ${file.asset} is not valid TOML: ${err.message}` };
  }
  const dest = expandHome(file.dest);
  const before = await readText(dest);
  let base = {};
  if (before && before.trim()) {
    try {
      base = parseToml(before);
    } catch {
      return { kind: "note", level: "warn", label, message: `Could not parse ${tildify(dest)} as TOML; merge it manually.` };
    }
  }
  const merged = deepMergeUnion(base, patch);
  if (before != null && sameJson(base, merged)) {
    return { kind: "skip", label, reason: `already merged into ${tildify(dest)}` };
  }
  if (before?.includes("#")) {
    log.warn(`   rewriting ${tildify(dest)} (TOML comments may be lost)`);
  }
  return { kind: "file", label, path: dest, before, after: stringifyToml(merged) };
}
async function buildEnsurePrefix(file, label) {
  const asset = await readAsset(file);
  if (asset == null) return { kind: "note", level: "warn", label, message: `Preset asset missing: ${file.asset}` };
  const dest = expandHome(file.dest);
  const before = await readText(dest);
  if (before == null) return { kind: "file", label, path: dest, before, after: asset };
  const marker = asset.split(/\r?\n/)[0]?.trim() ?? "";
  if (before.split(/\r?\n/).some((line) => line.trim() === marker)) {
    return { kind: "skip", label, reason: `${tildify(dest)} already starts with ${marker}` };
  }
  return { kind: "file", label, path: dest, before, after: `${asset.trimEnd()}

${before}` };
}
async function buildPresetFileAction(preset, file) {
  const label = `Preset ${preset.label ?? preset.id} \u2192 ${tildify(expandHome(file.dest))}`;
  if (!platformAllows(file.platforms)) {
    return { kind: "skip", label, reason: platformSkipReason(file.platforms) };
  }
  switch (file.op) {
    case "copy":
      return buildCopy(file, label);
    case "merge-json":
      return buildMergeJson(file, label);
    case "merge-toml":
      return buildMergeToml(file, label);
    case "ensure-prefix":
      return buildEnsurePrefix(file, label);
  }
}
function presetFilesFor(files, agentIds) {
  return files.filter((file) => !file.agents || agentIds.some((id) => appliesToAgent(file.agents, id)));
}
async function runPresetFiles(preset, files, agentIds) {
  const results = [];
  for (const file of presetFilesFor(files, agentIds)) {
    results.push(await runAction(await buildPresetFileAction(preset, file)));
  }
  return results;
}

// src/core/integrations.ts
import process6 from "process";
var defaultIntegrationDeps = { onPath: commandOnPath, env: process6.env };
function integrationLabel(entry) {
  return `Integration ${entry.label ?? entry.id}`;
}
function missingIntegrationEnv(entry, env) {
  return entry.requiredEnv.filter((name) => !env[name]);
}
function integrationBlocker(entry, agents, deps) {
  const label = integrationLabel(entry);
  if (!platformAllows(entry.platforms)) return { kind: "skip", label, reason: platformSkipReason(entry.platforms) };
  if (!agents.some((a) => integrationAppliesTo(entry, a.id))) {
    return { kind: "skip", label, reason: `no selected agent is supported (supported: ${Object.keys(entry.agentNames).join(", ")})` };
  }
  if (!deps.onPath(entry.bin)) {
    return { kind: "note", level: "warn", label, message: `${label}: \`${entry.bin}\` is not on PATH \u2014 skipped. ${entry.installHint ?? ""}`.trim() };
  }
  const missing = missingIntegrationEnv(entry, deps.env);
  if (!missing.length) return null;
  const message = `${label}: export ${missing.join(", ")} in your shell first, then re-run \u2014 skipped (values are read from the environment, never stored).`;
  return { kind: "note", level: "warn", label, message };
}
function expandIntegrationArgs(args, agentName) {
  return args.map((arg) => substitutePlaceholders(agentName ? arg.replaceAll("{agent}", agentName) : arg));
}
function stepAction(entry, step, who, agentName) {
  const args = expandIntegrationArgs(step.args, agentName);
  const label = `${entry.label ?? entry.id}: ${step.cmd} ${args[0] ?? ""} (${who})`;
  return { kind: "exec", label, cmd: step.cmd, args, timeout: 18e4 };
}
function buildIntegrationStepActions(entry, agents) {
  const actions = [];
  for (const agent of agents) {
    const agentName = entry.agentNames[agent.id];
    if (!agentName || !integrationAppliesTo(entry, agent.id)) {
      actions.push({ kind: "skip", label: `${integrationLabel(entry)} \u2192 ${agent.label}`, reason: `no mapping for ${agent.id}` });
      continue;
    }
    actions.push(...entry.perAgent.map((step) => stepAction(entry, step, agent.label, agentName)));
  }
  actions.push(...entry.once.map((step) => stepAction(entry, step, "once")));
  return actions;
}
async function runIntegration(entry, agents, deps = defaultIntegrationDeps) {
  const blocker = integrationBlocker(entry, agents, deps);
  if (blocker) return [await runAction(blocker)];
  const fileResults = await runPresetFiles(entry, entry.files, agents.map((a) => a.id));
  return [...fileResults, ...await runActions(buildIntegrationStepActions(entry, agents))];
}

// src/core/overlay.ts
import { existsSync as existsSync3, promises as fs2, rmSync, statSync } from "fs";
import os2 from "os";
import path6 from "path";
import process7 from "process";
import { execa as execa3 } from "execa";
var OVERLAY_ENV_NAME = "AGENT_HARNESS_OVERLAY";
var OVERLAY_TEMP_PREFIX = "agent-harness-overlay-";
var GIT_SPEC_PATTERN = /^(git@|https?:\/\/|ssh:\/\/|file:\/\/|github:)/;
var SAFE_NAME_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;
function parseOverlaySpecs(flags, envValue = process7.env[OVERLAY_ENV_NAME]) {
  const fromEnv = (envValue ?? "").split(/[;\n]/);
  const all = [...flags, ...fromEnv].map((s) => s.trim()).filter(Boolean);
  return [...new Set(all)];
}
function isGitOverlaySpec(spec) {
  return GIT_SPEC_PATTERN.test(spec);
}
function toOverlayGitUrl(spec) {
  return spec.startsWith("github:") ? `https://github.com/${spec.slice("github:".length)}.git` : spec;
}
function redactOverlaySecrets(text2) {
  return text2.replace(/(\/\/)[^/\s]*@/g, "$1***@").replace(/([?&](?:token|access_token|auth|key)=)[^&\s]+/gi, "$1***");
}
function defaultOverlayGitRunner(args) {
  const env = { ...process7.env, GIT_TERMINAL_PROMPT: "0" };
  return execa3("git", args, { env, stdin: "ignore", timeout: 12e4 }).then(() => void 0);
}
async function cloneOverlayRepo(spec, runGit) {
  const label = redactOverlaySecrets(spec);
  const dir = await fs2.mkdtemp(path6.join(os2.tmpdir(), OVERLAY_TEMP_PREFIX));
  const dispose = () => fs2.rm(dir, { recursive: true, force: true });
  try {
    await runGit(["clone", "--depth", "1", "--quiet", "--", toOverlayGitUrl(spec), dir]);
  } catch (err) {
    await dispose();
    const first = (err instanceof Error ? err.message : String(err)).split("\n")[0] ?? "";
    throw new Error(`Overlay ${label}: git clone failed \u2014 ${redactOverlaySecrets(first)}`);
  }
  return { dir, label, dispose };
}
function resolveLocalOverlay(spec) {
  const dir = path6.resolve(expandHome(spec));
  if (!existsSync3(dir) || !statSync(dir).isDirectory()) {
    throw new Error(`Overlay ${JSON.stringify(spec)} is not a directory (expected a dir containing catalog.json, or a git URL).`);
  }
  return { dir, label: path6.basename(dir), dispose: async () => {
  } };
}
async function resolveOverlaySpec(spec, runGit = defaultOverlayGitRunner) {
  if (spec.startsWith("-")) {
    throw new Error(`Overlay spec ${JSON.stringify(redactOverlaySecrets(spec))} starts with "-"; expected a dir path or a git URL.`);
  }
  return isGitOverlaySpec(spec) ? cloneOverlayRepo(spec, runGit) : resolveLocalOverlay(spec);
}
function assertSafeOverlayName(value, field, label) {
  if (SAFE_NAME_PATTERN.test(value) && !value.includes("..")) return;
  throw new Error(`Overlay ${label}: ${field} ${JSON.stringify(value)} is not a plain name (expected letters, digits, . _ -).`);
}
function assertSafeOverlayAsset(value, field, label) {
  const segments = value.split(/[\\/]/);
  if (!path6.isAbsolute(value) && !segments.includes("..")) return;
  throw new Error(`Overlay ${label}: ${field} ${JSON.stringify(value)} escapes the overlay dir (expected a relative path without "..").`);
}
function validateOverlayPaths(base, label) {
  for (const s of base.skills) {
    assertSafeOverlayName(s.id, `skill id`, label);
    assertSafeOverlayName(s.skill, `skill name`, label);
  }
  for (const a of base.subagents) {
    for (const f of [a.file, a.codex_file].filter((x) => Boolean(x))) assertSafeOverlayName(f, "subagent file", label);
  }
  for (const f of [...base.presets, ...base.integrations].flatMap((p) => p.files)) {
    assertSafeOverlayAsset(f.asset, "preset asset", label);
  }
}
async function loadOverlayCatalog(overlay) {
  const base = await parseCatalogFile(path6.join(overlay.dir, "catalog.json"), CatalogBaseSchema);
  validateOverlayPaths(base, overlay.label);
  return stampCatalogOrigin(base, { assetsRoot: overlay.dir, overlay: overlay.label });
}
function mergeOverlaySection(base, extra, section, notes, label) {
  const out = [...base];
  for (const entry of extra) {
    const at = out.findIndex((x) => x.id === entry.id);
    if (at === -1) {
      out.push(entry);
      continue;
    }
    notes.push(`overlay "${label}" overrides ${section} id "${entry.id}"`);
    out[at] = entry;
  }
  return out;
}
function mergeOverlayCatalog(base, overlay, label, notes) {
  return {
    ...base,
    mcps: mergeOverlaySection(base.mcps, overlay.mcps, "mcp", notes, label),
    skills: mergeOverlaySection(base.skills, overlay.skills, "skill", notes, label),
    subagents: mergeOverlaySection(base.subagents, overlay.subagents, "subagent", notes, label),
    plugins: mergeOverlaySection(base.plugins, overlay.plugins, "plugin", notes, label),
    presets: mergeOverlaySection(base.presets, overlay.presets, "preset", notes, label),
    integrations: mergeOverlaySection(base.integrations, overlay.integrations, "integration", notes, label),
    gitignore: [.../* @__PURE__ */ new Set([...base.gitignore, ...overlay.gitignore])]
  };
}
function removeClonesOnSignal(resolved) {
  const onSignal = () => {
    for (const r of resolved) if (r.dir.includes(OVERLAY_TEMP_PREFIX)) rmSync(r.dir, { recursive: true, force: true });
    process7.exit(130);
  };
  process7.once("SIGINT", onSignal);
  process7.once("SIGTERM", onSignal);
  return () => {
    process7.off("SIGINT", onSignal);
    process7.off("SIGTERM", onSignal);
  };
}
async function applyOverlays(base, specs, runGit = defaultOverlayGitRunner) {
  const resolved = [];
  const releaseSignals = removeClonesOnSignal(resolved);
  const dispose = async () => {
    releaseSignals();
    await Promise.all(resolved.map((r) => r.dispose()));
  };
  const notes = [];
  let catalog = base;
  try {
    for (const spec of specs) {
      const overlay = await resolveOverlaySpec(spec, runGit);
      resolved.push(overlay);
      catalog = mergeOverlayCatalog(catalog, await loadOverlayCatalog(overlay), overlay.label, notes);
    }
  } catch (err) {
    await dispose();
    throw err;
  }
  return { catalog, notes, dispose };
}
async function loadCatalogWithOverlays(flags) {
  return applyOverlays(await loadCatalog(), parseOverlaySpecs(flags));
}

// src/core/skills.ts
import { promises as fs3 } from "fs";
import path7 from "path";
function isLocalSkill(skill) {
  return skill.source === "local";
}
function hasInstaller(skill) {
  return Boolean(skill.installer);
}
function buildSkillAction(agent, skill, scope) {
  const label = `Skill ${skill.skill} \u2192 ${agent.label}`;
  const args = [
    "--yes",
    "skills",
    "add",
    skill.source,
    "--skill",
    skill.skill,
    "-a",
    agent.skillAgentId,
    "-y"
  ];
  if (scope === "user") args.push("-g");
  return { kind: "exec", label, cmd: "npx", args, timeout: 18e4 };
}
function buildInstallerSkillAction(agents, skill, scope) {
  const inst = skill.installer;
  const applicable = agents.filter((a) => a.supports.skills && skillAppliesTo(skill, a.id));
  const label = `Skill ${skill.skill} \u2192 ${applicable.map((a) => a.label).join(", ") || "no agent"}`;
  if (!inst) {
    return { kind: "skip", label, reason: "no installer declared" };
  }
  const providers = applicable.map((a) => inst.providers[a.id]).filter((p) => Boolean(p));
  if (providers.length === 0) {
    return { kind: "skip", label, reason: "no selected agent supported by this installer" };
  }
  const scopeWord = scope === "user" ? "global" : "project";
  const args = inst.args.map(
    (a) => a.replaceAll("{provider}", providers.join(",")).replaceAll("{scope}", scopeWord)
  );
  const cwd = scope === "user" ? homeDir() : void 0;
  return { kind: "exec", label, cmd: inst.cmd, args, cwd, timeout: 3e5 };
}
function localSkillDir(skill) {
  return path7.join(skill.assetsRoot ?? assetsDir(), "skills", skill.id);
}
function hasLocalSkill(skill) {
  return pathExists(localSkillDir(skill));
}
async function listFilesRecursive(dir) {
  const out = [];
  const entries = await fs3.readdir(dir, { withFileTypes: true });
  for (const e of entries) {
    const full = path7.join(dir, e.name);
    if (e.isDirectory()) out.push(...await listFilesRecursive(full));
    else if (e.isFile()) out.push(full);
  }
  return out;
}
var BINARY_EXTENSIONS = /* @__PURE__ */ new Set([
  ".png",
  ".jpg",
  ".jpeg",
  ".gif",
  ".webp",
  ".ico",
  ".avif",
  ".pdf",
  ".zip",
  ".gz",
  ".tar",
  ".woff",
  ".woff2",
  ".ttf",
  ".otf",
  ".eot",
  ".mp3",
  ".mp4",
  ".webm",
  ".wasm"
]);
function isBinaryFile(file) {
  return BINARY_EXTENSIONS.has(path7.extname(file).toLowerCase());
}
async function buildLocalSkillCopyActions(agent, skill, scope) {
  const label = `Skill ${skill.skill} \u2192 ${agent.label} (local copy)`;
  const srcDir = localSkillDir(skill);
  if (!pathExists(srcDir)) {
    return [
      {
        kind: "note",
        level: "warn",
        label,
        message: `No local copy at ${srcDir} \u2014 install this skill manually.`
      }
    ];
  }
  const destBase = expandHome(scope === "user" ? agent.skills.userDir : agent.skills.projectDir);
  const destDir = path7.join(destBase, skill.skill);
  const files = await listFilesRecursive(srcDir);
  const actions = [];
  for (const file of files) {
    const rel = path7.relative(srcDir, file);
    const dest = path7.join(destDir, rel);
    if (isBinaryFile(file)) {
      actions.push({ kind: "copy", label: `copy ${rel} \u2192 ${agent.label}`, src: file, dest });
      continue;
    }
    const after = await fs3.readFile(file, "utf8");
    actions.push({
      kind: "file",
      label: `copy ${rel} \u2192 ${agent.label}`,
      path: dest,
      before: await readText(dest),
      after
    });
  }
  return actions;
}

// src/core/manifest.ts
var list = (names) => [...names].sort().join(", ");
function prerequisiteLines(skills) {
  const byRequirement = /* @__PURE__ */ new Map();
  for (const s of skills) {
    for (const req of s.requires ?? []) {
      const users = byRequirement.get(req) ?? [];
      users.push(s.id);
      byRequirement.set(req, users);
    }
  }
  return [...byRequirement.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([req, users]) => `- ${req} \u2014 ${list(users)}`);
}
function renderManifest(agent, sel, version) {
  const skills = agent.supports.skills ? sel.skills.filter((s) => skillAppliesTo(s, agent.id)) : [];
  const mcps = agent.supports.mcp ? sel.mcps.filter((m) => mcpAppliesTo(m, agent.id)) : [];
  const plugins = agent.supports.plugins ? sel.plugins.filter((p) => pluginAppliesTo(p, agent.id)) : [];
  const subagents = agent.supports.subagents ? sel.subagents : [];
  const presets = sel.presets.filter((p) => appliesToAgent(p.agents, agent.id));
  const integrations = (sel.integrations ?? []).filter((i) => integrationAppliesTo(i, agent.id));
  const lines = [
    `## Provisioned by agent-harness v${version}`,
    "",
    `This environment was set up by \`agent-harness init\`. Available to ${agent.label}:`,
    ""
  ];
  if (skills.length) {
    lines.push(`**Skills** (\`${agent.skills.userDir}\`) \u2014 ${list(skills.map((s) => s.skill))}`);
  }
  if (mcps.length) lines.push(`**MCPs** \u2014 ${list(mcps.map((m) => m.id))}`);
  if (subagents.length) {
    lines.push(
      `**Subagents** (\`${agent.subagents?.userDir}\`) \u2014 ${list(subagents.map((s) => s.id))}`
    );
  }
  if (plugins.length) lines.push(`**Plugins** \u2014 ${list(plugins.map((p) => p.id))}`);
  if (presets.length) lines.push(`**Presets** \u2014 ${list(presets.map((p) => p.id))}`);
  if (integrations.length) lines.push(`**Integrations** \u2014 ${list(integrations.map((i) => i.id))}`);
  const prereqs = prerequisiteLines(skills);
  const envs = [.../* @__PURE__ */ new Set([...requiredEnvVars(mcps), ...integrations.flatMap((i) => i.env)])].sort();
  if (prereqs.length || envs.length) {
    lines.push("", "**Prerequisites the installer doesn't provide:**", ...prereqs);
    if (envs.length) lines.push(`- Env vars \u2014 ${envs.join(", ")}`);
  }
  lines.push(
    "",
    "MCPs and plugins only take effect after restarting the agent. This block is",
    "generated \u2014 re-run the installer to refresh it, don't hand-edit."
  );
  return lines.join("\n");
}
async function buildManifestAction(agent, sel, version) {
  const file = agent.globalInstructionsFile;
  const label = `${agent.instructionsFile} (agent-harness block)`;
  if (!file) {
    return { kind: "skip", label, reason: `no global instructions file for ${agent.id}` };
  }
  const before = await readText(file);
  const after = mergeManagedBlock(
    before,
    renderManifest(agent, sel, version),
    MANIFEST_BEGIN,
    MANIFEST_END
  );
  return { kind: "file", label: `${tildify(file)} (agent-harness block)`, path: file, before, after };
}

// src/core/subagents.ts
import { promises as fs4 } from "fs";
import path8 from "path";
function subagentFileFor(entry, agent) {
  if (!agent.subagents) return void 0;
  return agent.subagents.format === "toml" ? entry.codex_file : entry.file;
}
function localSubagentFile(entry, file) {
  return path8.join(entry.assetsRoot ?? assetsDir(), "agents", file);
}
function hasSubagentFor(entry, agent) {
  const file = subagentFileFor(entry, agent);
  return Boolean(file && pathExists(localSubagentFile(entry, file)));
}
async function buildSubagentCopyAction(agent, entry, scope) {
  const label = `Agent ${entry.label ?? entry.id} \u2192 ${agent.label}`;
  if (!agent.subagents) {
    return { kind: "skip", label, reason: "agent has no subagents dir" };
  }
  const file = subagentFileFor(entry, agent);
  if (!file) {
    return { kind: "skip", label, reason: `no ${agent.subagents.format} variant bundled` };
  }
  const srcFile = localSubagentFile(entry, file);
  if (!pathExists(srcFile)) {
    return {
      kind: "note",
      level: "warn",
      label,
      message: `No local file at ${srcFile} \u2014 skipping.`
    };
  }
  const destBase = expandHome(scope === "user" ? agent.subagents.userDir : agent.subagents.projectDir);
  const dest = path8.join(destBase, file);
  const after = await fs4.readFile(srcFile, "utf8");
  return { kind: "file", label, path: dest, before: await readText(dest), after };
}

// src/commands/scaffold.ts
import process11 from "process";
import pc4 from "picocolors";

// src/core/aimemory.ts
import path9 from "path";
import process8 from "process";
var AI_MEMORY_MARKER_FILE = ".ai-memory.toml";
var DEFAULT_AI_MEMORY_IGNORES = [".env", ".env.*", "*.pem", "*.key", "*.tfstate", "*.tfstate.*"];
function withDoubleStarVariants(globs) {
  const out = globs.flatMap((g) => {
    const bare = g.replace(/^(\*\*\/)+/, "");
    return [bare, `**/${bare}`];
  });
  return [...new Set(out)];
}
function defaultAiMemoryProject(cwd = process8.cwd()) {
  return path9.basename(cwd).trim().toLowerCase().replace(/\s+/g, "-");
}
function renderAiMemoryToml(workspace, project, ignores = DEFAULT_AI_MEMORY_IGNORES) {
  const globs = withDoubleStarVariants(ignores).map((g) => `  ${JSON.stringify(g)},`);
  return [
    "# ai-memory scope for this repo (https://github.com/akitaonrails/ai-memory).",
    "# Written by agent-harness scaffold --with-ai-memory. Pins workspace/project so",
    "# captures land in the same memory on every machine.",
    `workspace = ${JSON.stringify(workspace)}`,
    `project = ${JSON.stringify(project)}`,
    "",
    "[capture]",
    "# Secrets never become memory. Each glob appears bare AND with **/ because",
    "# ai-memory's leading **/ does not match zero dirs (root .env would leak).",
    "ignore_paths = [",
    ...globs,
    "]",
    ""
  ].join("\n");
}
async function buildAiMemoryTomlAction(workspace, project, cwd = process8.cwd()) {
  const label = AI_MEMORY_MARKER_FILE;
  if (!workspace) {
    return { kind: "note", level: "warn", label, message: `${label}: pass --ai-memory-workspace <name> (and optionally --ai-memory-project) \u2014 skipped.` };
  }
  const dest = path9.join(cwd, AI_MEMORY_MARKER_FILE);
  const before = await readText(dest);
  if (before != null && !isForce()) {
    return { kind: "skip", label, reason: `${tildify(dest)} exists (use --force to overwrite)` };
  }
  const after = renderAiMemoryToml(workspace, project || defaultAiMemoryProject(cwd));
  return { kind: "file", label, path: dest, before, after };
}

// src/core/templates.ts
import path10 from "path";
import process9 from "process";
var DEFAULT_GITIGNORE_ENTRIES = [".claude/settings.local.json"];
function resolveInCwd(rel, cwd) {
  return path10.isAbsolute(rel) ? rel : path10.resolve(cwd ?? process9.cwd(), rel);
}
async function buildTemplateCopyAction(assetRel, destRel, label, cwd) {
  const dest = resolveInCwd(destRel, cwd);
  const after = await readText(assetPath(assetRel));
  if (after == null) {
    return { kind: "note", level: "warn", label, message: `Template asset missing: ${assetRel}` };
  }
  const before = await readText(dest);
  if (before != null && !isForce()) {
    return { kind: "skip", label, reason: `${tildify(dest)} exists (use --force to overwrite)` };
  }
  return { kind: "file", label, path: dest, before, after };
}
async function buildGitignoreMergeAction(entries, cwd) {
  const list2 = entries.length ? entries : DEFAULT_GITIGNORE_ENTRIES;
  const file = resolveInCwd(".gitignore", cwd);
  const before = await readText(file);
  const { content, added } = mergeGitignore(before, list2);
  if (added.length === 0) {
    return { kind: "skip", label: ".gitignore", reason: "all entries already present" };
  }
  const label = `.gitignore (+${added.length}: ${added.join(", ")})`;
  return { kind: "file", label, path: file, before, after: content };
}

// src/ui/prompts.ts
import path11 from "path";
import process10 from "process";
import {
  cancel,
  confirm,
  groupMultiselect,
  intro,
  isCancel,
  multiselect,
  note,
  text
} from "@clack/prompts";
import pc3 from "picocolors";
function toAgents(ids) {
  return ids.map(getAgent).filter((a) => Boolean(a));
}
function mcpHint(m) {
  return m.agents ? `${m.transport} \xB7 ${m.agents.join("/")} only` : m.transport;
}
function menuLabel(entry, label) {
  const tagged = entry.overlay ? `${label} \xB7 privado` : label;
  return platformAllows(entry.platforms) ? tagged : pc3.dim(tagged);
}
function menuHint(entry, hint) {
  return platformAllows(entry.platforms) ? hint : `${hint} \xB7 indispon\xEDvel em ${currentPlatform()}`;
}
function integrationHint(i) {
  return `${Object.keys(i.agentNames).join("/")} \xB7 env ${i.requiredEnv.join(", ") || "\u2014"}`;
}
function skillHint(s, scope) {
  const who = s.installer?.providers ? Object.keys(s.installer.providers) : s.agents;
  return who ? `${who.join("/")} \xB7 ${scope}` : scope;
}
function subagentHint(a, scope) {
  return `${a.codex_file ? "claude/codex" : "claude only"} \xB7 ${scope}`;
}
function pluginHint(p) {
  return p.agents ? p.agents.join("/") : "claude/codex";
}
function presetHint(p) {
  return p.agents ? p.agents.join("/") : "all agents";
}
function buildUnifiedGroups(catalog) {
  const groups = {};
  const machine = [];
  for (const m of catalog.mcps) machine.push({ value: `mcp:${m.id}`, label: menuLabel(m, m.label), hint: menuHint(m, mcpHint(m)) });
  for (const p of catalog.plugins) machine.push({ value: `plugin:${p.id}`, label: menuLabel(p, p.label ?? p.id), hint: pluginHint(p) });
  for (const s of catalog.skills) machine.push({ value: `mskill:${s.id}`, label: menuLabel(s, s.label ?? s.skill), hint: menuHint(s, skillHint(s, "global")) });
  for (const a of catalog.subagents) machine.push({ value: `magent:${a.id}`, label: menuLabel(a, a.label ?? a.id), hint: subagentHint(a, "global") });
  for (const p of catalog.presets) machine.push({ value: `preset:${p.id}`, label: menuLabel(p, p.label ?? p.id), hint: presetHint(p) });
  for (const i of catalog.integrations) machine.push({ value: `integ:${i.id}`, label: menuLabel(i, i.label ?? i.id), hint: menuHint(i, integrationHint(i)) });
  if (machine.length) groups["Nesta m\xE1quina (todos os projetos)"] = machine;
  const repo = [
    { value: "doc:agents", label: "AGENTS.md", hint: "can\xF4nico \xB7 Codex / OpenCode" },
    { value: "doc:claude", label: "CLAUDE.md", hint: "@AGENTS.md import \xB7 Claude Code (inclui AGENTS.md)" },
    { value: "doc:memory", label: "Skill memory", hint: DEFAULT_MEMORY_DEST },
    { value: "doc:aimemory", label: ".ai-memory.toml", hint: "escopo do ai-memory (pede workspace)" }
  ];
  for (const s of catalog.skills) repo.push({ value: `pskill:${s.id}`, label: menuLabel(s, s.label ?? s.skill), hint: menuHint(s, skillHint(s, "repo")) });
  for (const a of catalog.subagents) repo.push({ value: `pagent:${a.id}`, label: menuLabel(a, a.label ?? a.id), hint: subagentHint(a, "repo") });
  if (catalog.mcps.length) repo.push({ value: "projmcp", label: ".mcp.json + opencode.json", hint: "as MCPs marcadas acima" });
  repo.push({ value: "gitignore", label: "Merge .gitignore", hint: "agent caches" });
  groups[`Neste reposit\xF3rio (${path11.basename(process10.cwd())})`] = repo;
  return groups;
}
function parseUnifiedSelection(catalog, agents, values) {
  const has = (v) => values.includes(v);
  const ids = (prefix) => values.filter((v) => v.startsWith(prefix)).map((v) => v.slice(prefix.length));
  const mcps = catalog.mcps.filter((m) => ids("mcp:").includes(m.id));
  const repoSkillIds = ids("pskill:");
  const repoSubagentIds = ids("pagent:");
  const wantRepo = has("doc:claude") || has("doc:agents") || has("doc:memory") || has("doc:aimemory") || repoSkillIds.length > 0 || repoSubagentIds.length > 0 || has("projmcp");
  const repo = wantRepo ? {
    withClaudeMd: has("doc:claude"),
    withAgentsMd: has("doc:agents") || has("doc:claude"),
    withMemory: has("doc:memory"),
    withOpencode: has("projmcp"),
    withGitignore: has("gitignore"),
    withAiMemory: has("doc:aimemory"),
    mcps: has("projmcp") ? mcps : [],
    skills: catalog.skills.filter((s) => repoSkillIds.includes(s.id)),
    subagents: catalog.subagents.filter((a) => repoSubagentIds.includes(a.id)),
    memoryDest: DEFAULT_MEMORY_DEST
  } : void 0;
  return {
    agents,
    mcps,
    skills: catalog.skills.filter((s) => ids("mskill:").includes(s.id)),
    plugins: catalog.plugins.filter((p) => ids("plugin:").includes(p.id)),
    subagents: catalog.subagents.filter((a) => ids("magent:").includes(a.id)),
    presets: catalog.presets.filter((p) => ids("preset:").includes(p.id)),
    integrations: catalog.integrations.filter((i) => ids("integ:").includes(i.id)),
    repo
  };
}
function unifiedSummary(sel) {
  const names = (arr) => arr.length ? arr.map((x) => x.id).join(", ") : pc3.dim("none");
  const lines = [
    `Agentes:  ${sel.agents.map((a) => a.label).join(", ")}`,
    `M\xE1quina:  MCPs ${names(sel.mcps)} \xB7 skills ${names(sel.skills)} \xB7 plugins ${names(sel.plugins)}`,
    `          agentes custom ${names(sel.subagents)} \xB7 presets ${names(sel.presets)}`,
    `          integra\xE7\xF5es ${names(sel.integrations)}`
  ];
  if (sel.repo) {
    const docs = [sel.repo.withClaudeMd && "CLAUDE.md", sel.repo.withAgentsMd && "AGENTS.md", sel.repo.withMemory && "memory", sel.repo.withAiMemory && ".ai-memory.toml"].filter(Boolean).join(", ") || pc3.dim("none");
    lines.push(
      `Repo:     ${docs} \xB7 skills ${names(sel.repo.skills)} \xB7 agentes custom ${names(sel.repo.subagents)}${sel.repo.mcps.length ? " \xB7 .mcp.json" : ""}`
    );
  }
  return lines.join("\n");
}
async function promptInitSelection(catalog) {
  intro(pc3.bgCyan(pc3.black(" agent-harness ")));
  const detected = new Set(detectInstalledAgentIds());
  const agentSel = await multiselect({
    message: "Quais agentes configurar?",
    options: catalog.agents.map((id) => ({
      value: id,
      label: getAgent(id)?.label ?? id,
      hint: detected.has(id) ? "detected" : void 0
    })),
    initialValues: catalog.agents.filter((id) => detected.has(id)),
    required: true
  });
  if (isCancel(agentSel)) return abort();
  const agents = toAgents(agentSel);
  const groups = buildUnifiedGroups(catalog);
  let chosen = [];
  if (Object.keys(groups).length) {
    const picked = await groupMultiselect({
      message: "Marque o que instalar (espa\xE7o alterna, enter confirma):",
      options: groups,
      required: false,
      selectableGroups: false
    });
    if (isCancel(picked)) return abort();
    chosen = picked;
  }
  const sel = parseUnifiedSelection(catalog, agents, chosen);
  if (sel.repo?.withAiMemory && !await promptAiMemoryScope(sel.repo)) return abort();
  note(unifiedSummary(sel), "Resumo");
  const ok = await confirm({ message: "Prosseguir com a instala\xE7\xE3o?" });
  if (isCancel(ok) || !ok) return abort();
  return sel;
}
async function promptScaffoldSelection(catalog) {
  intro(pc3.bgCyan(pc3.black(" agent-harness scaffold ")));
  const artifacts = await multiselect({
    message: "What should I add to this repo?",
    options: [
      { value: "agents-md", label: "AGENTS.md", hint: "canonical instructions (Codex / OpenCode)" },
      { value: "claude-md", label: "CLAUDE.md", hint: "@AGENTS.md import for Claude Code (brings AGENTS.md)" },
      { value: "memory", label: "Skill memory file", hint: DEFAULT_MEMORY_DEST },
      { value: "ai-memory", label: ".ai-memory.toml", hint: "ai-memory workspace/project + secret capture excludes" },
      { value: "skills", label: "Skills", hint: "install into the repo (project-scoped)" },
      { value: "agents", label: "Custom agents", hint: "custom Claude Code / Codex subagents (repo-scoped)" },
      { value: "mcp", label: "Project .mcp.json", hint: "Claude project MCPs" },
      { value: "opencode", label: "Project opencode.json", hint: "OpenCode project MCPs" },
      { value: "gitignore", label: "Merge .gitignore", hint: "agent caches" }
    ],
    initialValues: ["claude-md", "agents-md", "gitignore"],
    required: false
  });
  if (isCancel(artifacts)) return abort();
  const want = (v) => artifacts.includes(v);
  let mcps = [];
  if ((want("mcp") || want("opencode")) && catalog.mcps.length) {
    const picked = await multiselect({
      message: "Which MCPs for the project config?",
      options: catalog.mcps.map((m) => ({ value: m.id, label: menuLabel(m, m.label), hint: menuHint(m, mcpHint(m)) })),
      required: false
    });
    if (isCancel(picked)) return abort();
    mcps = catalog.mcps.filter((m) => picked.includes(m.id));
  }
  let skills = [];
  if (want("skills") && catalog.skills.length) {
    const picked = await multiselect({
      message: "Which skills to install into the repo?",
      options: catalog.skills.map((s) => ({
        value: s.id,
        label: menuLabel(s, s.label ?? s.skill),
        hint: s.agents ? `${s.agents.join("/")} only` : void 0
      })),
      required: false
    });
    if (isCancel(picked)) return abort();
    skills = catalog.skills.filter((s) => picked.includes(s.id));
  }
  let subagents = [];
  if (want("agents") && catalog.subagents.length) {
    const picked = await multiselect({
      message: "Which custom agents to install into the repo?",
      options: catalog.subagents.map((a) => ({ value: a.id, label: menuLabel(a, a.label ?? a.id), hint: subagentHint(a, "repo") })),
      required: false
    });
    if (isCancel(picked)) return abort();
    subagents = catalog.subagents.filter((a) => picked.includes(a.id));
  }
  const plan = {
    withClaudeMd: want("claude-md"),
    withAgentsMd: want("agents-md") || want("claude-md"),
    withMemory: want("memory"),
    withOpencode: want("opencode"),
    withGitignore: want("gitignore"),
    withAiMemory: want("ai-memory"),
    mcps,
    skills,
    subagents,
    memoryDest: DEFAULT_MEMORY_DEST
  };
  note(
    [
      `Docs:     ${[plan.withClaudeMd && "CLAUDE.md", plan.withAgentsMd && "AGENTS.md", plan.withMemory && "memory", plan.withAiMemory && ".ai-memory.toml"].filter(Boolean).join(", ") || pc3.dim("none")}`,
      `Skills:   ${skills.length ? skills.map((s) => s.id).join(", ") : pc3.dim("none")}`,
      `Agents:   ${subagents.length ? subagents.map((a) => a.id).join(", ") : pc3.dim("none")}`,
      `MCPs:     ${mcps.length ? mcps.map((m) => m.id).join(", ") : pc3.dim("none")}${plan.withOpencode ? pc3.dim(" (+opencode.json)") : ""}`,
      `gitignore: ${plan.withGitignore ? "merge" : pc3.dim("skip")}`
    ].join("\n"),
    "Summary"
  );
  if (plan.withAiMemory && !await promptAiMemoryScope(plan)) return abort();
  const ok = await confirm({ message: "Scaffold these into the current directory?" });
  if (isCancel(ok) || !ok) return abort();
  return plan;
}
async function promptAiMemoryScope(plan) {
  const workspace = await text({ message: "ai-memory workspace (ex.: pessoal, nome do cliente):", placeholder: "pessoal" });
  if (isCancel(workspace)) return false;
  const project = await text({ message: "ai-memory project:", defaultValue: defaultAiMemoryProject(), placeholder: defaultAiMemoryProject() });
  if (isCancel(project)) return false;
  plan.aiMemoryWorkspace = workspace.trim() || void 0;
  plan.aiMemoryProject = project.trim() || void 0;
  return true;
}
function abort() {
  cancel("Cancelled \u2014 nothing was changed.");
  return null;
}

// src/commands/scaffold.ts
var DEFAULT_MEMORY_DEST = ".claude/skills/memory/memory.md";
function planFromFlags(catalog, opts) {
  const aiMemory = { aiMemoryWorkspace: opts.aiMemoryWorkspace, aiMemoryProject: opts.aiMemoryProject };
  const memoryDest = opts.memoryDest ?? DEFAULT_MEMORY_DEST;
  if (opts.all) {
    return {
      withClaudeMd: true,
      withAgentsMd: true,
      withMemory: true,
      withOpencode: true,
      withGitignore: true,
      withAiMemory: true,
      ...aiMemory,
      mcps: catalog.mcps,
      skills: catalog.skills,
      subagents: catalog.subagents,
      memoryDest
    };
  }
  return {
    withClaudeMd: opts.withClaudeMd,
    withAgentsMd: opts.withAgentsMd || opts.withClaudeMd,
    withMemory: opts.withMemory,
    withOpencode: opts.withOpencode,
    withGitignore: opts.gitignore,
    withAiMemory: opts.withAiMemory,
    ...aiMemory,
    mcps: catalog.mcps.filter((m) => opts.mcp.includes(m.id)),
    skills: catalog.skills.filter((s) => opts.skill.includes(s.id)),
    subagents: catalog.subagents.filter((s) => opts.subagent.includes(s.id)),
    memoryDest
  };
}
function isInteractive(opts) {
  if (opts.yes) return false;
  const explicit = opts.all || opts.withClaudeMd || opts.withAgentsMd || opts.withMemory || opts.withOpencode || opts.withAiMemory || opts.mcp.length > 0 || opts.skill.length > 0 || opts.subagent.length > 0;
  if (explicit) return false;
  return Boolean(process11.stdout.isTTY && process11.stdin.isTTY);
}
function isEmptyPlan(p) {
  return !p.withClaudeMd && !p.withAgentsMd && !p.withMemory && !p.withGitignore && !p.withAiMemory && p.mcps.length === 0 && p.skills.length === 0 && p.subagents.length === 0;
}
async function skillActions(skills) {
  const actions = [];
  for (const skill of skills) {
    if (hasInstaller(skill)) {
      actions.push(buildInstallerSkillAction(AGENTS, skill, "project"));
      continue;
    }
    for (const agent of AGENTS) {
      if (!agent.supports.skills || !skillAppliesTo(skill, agent.id)) continue;
      if (isLocalSkill(skill)) {
        actions.push(...await buildLocalSkillCopyActions(agent, skill, "project"));
      } else {
        actions.push(buildSkillAction(agent, skill, "project"));
      }
    }
  }
  return actions;
}
async function subagentActions(subagents) {
  const actions = [];
  for (const entry of subagents) {
    for (const agent of AGENTS) {
      if (!agent.supports.subagents || !hasSubagentFor(entry, agent)) continue;
      actions.push(await buildSubagentCopyAction(agent, entry, "project"));
    }
  }
  return actions;
}
async function buildScaffoldActions(catalog, plan) {
  const actions = [];
  if (plan.withAgentsMd || plan.withClaudeMd) {
    actions.push(await buildTemplateCopyAction(catalog.templates.agents_md, "AGENTS.md", "AGENTS.md (canonical)"));
  }
  if (plan.withClaudeMd) {
    actions.push(await buildTemplateCopyAction(catalog.templates.claude_md, "CLAUDE.md", "CLAUDE.md (@AGENTS.md import)"));
  }
  if (plan.withMemory) {
    actions.push(
      await buildTemplateCopyAction(catalog.templates.memory, plan.memoryDest, `memory \u2192 ${plan.memoryDest}`)
    );
  }
  if (plan.skills.length) {
    actions.push(...await skillActions(plan.skills));
  }
  if (plan.subagents.length) {
    actions.push(...await subagentActions(plan.subagents));
  }
  if (plan.mcps.length) {
    const claudeMcps = plan.mcps.filter((m) => mcpAppliesTo(m, "claude-code"));
    if (claudeMcps.length) {
      actions.push(await buildProjectMcpAction(claudeMcps, { file: ".mcp.json", format: "claude" }));
    }
    if (plan.withOpencode) {
      const opencodeMcps = plan.mcps.filter((m) => mcpAppliesTo(m, "opencode"));
      if (opencodeMcps.length) {
        actions.push(await buildProjectMcpAction(opencodeMcps, { file: "opencode.json", format: "opencode" }));
      }
    }
  }
  if (plan.withAiMemory) {
    actions.push(await buildAiMemoryTomlAction(plan.aiMemoryWorkspace, plan.aiMemoryProject));
  }
  if (plan.withGitignore) {
    actions.push(await buildGitignoreMergeAction(catalog.gitignore));
  }
  return actions;
}
async function runScaffoldCommand(opts) {
  const loaded = await loadCatalogWithOverlays(opts.overlay);
  try {
    for (const note2 of loaded.notes) log.warn(note2);
    await runScaffoldWithCatalog(loaded.catalog, opts);
  } finally {
    await loaded.dispose();
  }
}
async function runScaffoldWithCatalog(catalog, opts) {
  const plan = isInteractive(opts) ? await promptScaffoldSelection(catalog) : planFromFlags(catalog, opts);
  if (!plan) {
    log.warn("Nothing selected \u2014 aborting.");
    return;
  }
  if (isEmptyPlan(plan)) {
    log.warn(
      "Nothing to scaffold. Pass --with-claude-md / --with-agents-md / --with-memory / --with-ai-memory / --skill <id> / --mcp <id> / --all."
    );
    return;
  }
  const actions = await buildScaffoldActions(catalog, plan);
  log.plain("");
  log.info(`${isDryRun() ? pc4.yellow("Dry run \u2014 ") : ""}Scaffolding ${pc4.bold(process11.cwd())}`);
  log.plain("");
  await runActions(actions);
  log.plain("");
  log.success(isDryRun() ? "Dry run complete \u2014 nothing written." : "Scaffold complete.");
  log.plain(pc4.dim("  AGENTS.md \u2192 canonical (Codex & OpenCode read it) \xB7 CLAUDE.md \u2192 @AGENTS.md import for Claude Code \xB7 skills \u2192 project skill dirs."));
}

// src/commands/init.ts
function selectionFromFlags(catalog, opts) {
  const agentIds = opts.agent.length ? opts.agent : opts.all ? catalog.agents : detectInstalledAgentIds();
  const agents = uniqueAgents(agentIds);
  const pick = (all, ids) => opts.all ? all : all.filter((x) => ids.includes(x.id));
  return {
    agents,
    mcps: pick(catalog.mcps, opts.mcp),
    skills: pick(catalog.skills, opts.skill),
    plugins: pick(catalog.plugins, opts.plugin),
    subagents: pick(catalog.subagents, opts.subagent),
    presets: pick(catalog.presets, opts.preset),
    integrations: pick(catalog.integrations, opts.integration)
  };
}
function uniqueAgents(ids) {
  const seen = /* @__PURE__ */ new Set();
  const out = [];
  for (const id of ids) {
    if (seen.has(id)) continue;
    seen.add(id);
    const a = getAgent(id);
    if (a) out.push(a);
    else log.warn(`Unknown agent "${id}" \u2014 skipping (known: ${AGENTS.map((x) => x.id).join(", ")})`);
  }
  return out;
}
function isInteractive2(opts) {
  if (opts.yes) return false;
  const explicit = opts.all || opts.agent.length > 0 || opts.mcp.length > 0 || opts.skill.length > 0 || opts.plugin.length > 0 || opts.subagent.length > 0 || opts.preset.length > 0 || opts.integration.length > 0;
  if (explicit) return false;
  return Boolean(process12.stdout.isTTY && process12.stdin.isTTY);
}
async function runInitCommand(opts) {
  const loaded = await loadCatalogWithOverlays(opts.overlay);
  try {
    for (const note2 of loaded.notes) log.warn(note2);
    await runInitWithCatalog(loaded.catalog, opts);
  } finally {
    await loaded.dispose();
  }
}
async function runInitWithCatalog(catalog, opts) {
  const selection = isInteractive2(opts) ? await promptInitSelection(catalog) : selectionFromFlags(catalog, opts);
  if (!selection) {
    log.warn("Nothing selected \u2014 aborting.");
    return;
  }
  if (selection.agents.length === 0) {
    log.warn("No agents selected or detected. Pass --agent <id> or install an agent first.");
    return;
  }
  warnPlaceholders(selection);
  logPlatformSkips(selection);
  log.plain("");
  log.info(
    `${isDryRun() ? pc5.yellow("Dry run \u2014 ") : ""}Configuring ${selection.agents.map((a) => pc5.bold(a.label)).join(", ")}`
  );
  await runPresets(selection);
  await runIntegrations(selection);
  for (const agent of selection.agents) {
    log.plain("");
    log.step(pc5.bold(agent.label));
    await configureAgent(agent, selection, opts);
  }
  await runInstallerSkills(selection);
  if (selection.repo) {
    const repoActions = await buildScaffoldActions(catalog, selection.repo);
    if (repoActions.length) {
      log.plain("");
      log.step(pc5.bold(`Neste reposit\xF3rio (${process12.cwd()})`));
      await runActions(repoActions);
    }
  }
  printAuthBlock(selection);
}
async function configureAgent(agent, sel, opts) {
  if (agent.supports.mcp) {
    const applicable = sel.mcps.filter((m) => mcpAppliesTo(m, agent.id));
    for (const m of applicable) {
      await runAction(await buildUserMcpAction(agent, m));
    }
    const scopedOut = sel.mcps.length - applicable.length;
    if (scopedOut > 0) {
      log.plain(`   ${pc5.dim(`\xB7 ${scopedOut} MCP(s) not scoped to ${agent.id}`)}`);
    }
  } else if (sel.mcps.length) {
    log.plain(`   ${pc5.dim("\xB7 skip MCPs \u2014 unsupported")}`);
  }
  if (agent.supports.skills) {
    for (const s of sel.skills.filter((skill) => skillAppliesTo(skill, agent.id))) {
      if (hasInstaller(s)) continue;
      if (isLocalSkill(s)) {
        await runActions(await buildLocalSkillCopyActions(agent, s, "user"));
        continue;
      }
      const res = await runAction(buildSkillAction(agent, s, "user"));
      if (res.status === "failed" && hasLocalSkill(s)) {
        log.plain(`   ${pc5.dim("\xB7 trying local fallback\u2026")}`);
        await runActions(await buildLocalSkillCopyActions(agent, s, "user"));
      }
    }
  } else if (sel.skills.length) {
    log.plain(`   ${pc5.dim("\xB7 skip skills \u2014 unsupported")}`);
  }
  const pluginsHere = sel.plugins.filter((p) => pluginAppliesTo(p, agent.id));
  if (agent.supports.plugins) {
    for (const p of pluginsHere) {
      const actions = await buildPluginActions(agent, p);
      if (actions.length === 0) {
        await runAction(await buildPluginSettingsFallbackAction(p));
      } else {
        await runActions(actions);
      }
    }
  } else if (pluginsHere.length) {
    log.plain(`   ${pc5.dim("\xB7 skip plugins \u2014 unsupported")}`);
  }
  if (agent.supports.subagents) {
    for (const s of sel.subagents) {
      await runAction(await buildSubagentCopyAction(agent, s, "user"));
    }
  } else if (sel.subagents.length) {
    log.plain(`   ${pc5.dim("\xB7 skip agents \u2014 unsupported")}`);
  }
  if (opts.manifest) {
    await runAction(await buildManifestAction(agent, sel, opts.version));
  }
}
async function runInstallerSkills(sel) {
  const installers = sel.skills.filter(hasInstaller);
  if (!installers.length) return;
  log.plain("");
  log.step(pc5.bold("Skills com instalador pr\xF3prio"));
  for (const s of installers) {
    await runAction(buildInstallerSkillAction(sel.agents, s, "user"));
  }
}
async function runPresets(sel) {
  const agentIds = sel.agents.map((a) => a.id);
  const applicable = sel.presets.filter((p) => presetAppliesTo(p, agentIds));
  if (!applicable.length) return;
  log.plain("");
  log.step(pc5.bold("Presets (settings / config)"));
  for (const p of applicable) {
    await runPresetFiles(p, p.files, agentIds);
  }
}
async function runIntegrations(sel) {
  if (!sel.integrations.length) return;
  log.plain("");
  log.step(pc5.bold("Integra\xE7\xF5es"));
  for (const integration of sel.integrations) {
    await runIntegration(integration, sel.agents);
  }
}
function logPlatformSkips(sel) {
  const blocked = [...sel.mcps, ...sel.skills].filter((entry) => !platformAllows(entry.platforms));
  for (const entry of blocked) {
    log.plain(`   ${pc5.dim("\xB7 skip")} ${entry.id} \u2014 ${pc5.dim(platformSkipReason(entry.platforms))}`);
  }
}
function warnPlaceholders(sel) {
  const offenders = [];
  for (const m of sel.mcps) {
    if (m.transport === "stdio" && m.args.some(looksLikePlaceholder)) offenders.push(`mcp:${m.id}`);
  }
  for (const s of sel.skills) {
    if (looksLikePlaceholder(s.source) || looksLikePlaceholder(s.skill)) offenders.push(`skill:${s.id}`);
  }
  for (const p of sel.plugins) {
    if (looksLikePlaceholder(p.marketplace) || p.install.some(looksLikePlaceholder))
      offenders.push(`plugin:${p.id}`);
  }
  if (offenders.length) {
    log.warn(
      `Catalog placeholders detected (${offenders.join(", ")}). Edit assets/catalog.json with real values.`
    );
  }
}
function printAuthBlock(sel) {
  log.plain("");
  log.plain(pc5.bold(isDryRun() ? "\u2014 Auth block (preview) \u2014" : "\u2705 Installed. Run these logins once:"));
  log.plain("");
  const width = Math.max(...sel.agents.map((a) => a.label.length), 0);
  for (const a of sel.agents) {
    const note2 = a.login.note ? pc5.dim(`  (${a.login.note})`) : "";
    log.plain(`  ${a.label.padEnd(width)}  \u2192  ${pc5.cyan(a.login.cmd)}${note2}`);
  }
  log.plain("");
  log.plain(pc5.dim("  MCPs with OAuth (Figma, Notion, Google\u2026) authenticate on first tool use."));
  const envs = requiredEnvVars([...sel.mcps, ...sel.repo?.mcps ?? []]);
  if (envs.length) {
    log.plain(pc5.dim(`  MCPs needing API keys \u2014 export in your shell/.env: ${envs.join(", ")}`));
  }
  const integrationEnvs = [...new Set(sel.integrations.flatMap((i) => i.env))];
  if (integrationEnvs.length) {
    log.plain(pc5.dim(`  Integrations read from your environment: ${integrationEnvs.join(", ")}`));
  }
  if (sel.skills.some((s) => s.id === "impeccable")) {
    log.plain(pc5.dim("  Impeccable: type /impeccable init inside the agent chat to set up design context."));
  }
  log.plain("");
}

// src/cli.ts
function collect(value, previous) {
  return previous.concat([value]);
}
var program = new Command();
program.name("agent-harness").description("Dotfiles-for-AI-agents bootstrapper \u2014 configure MCPs, skills, plugins, custom agents and settings presets across Claude Code, Codex, and OpenCode.").version(package_default.version);
program.command("init", { isDefault: true }).description("Configure agents on this machine (user-scope MCPs, skills, plugins, custom agents, presets), then print the login block.").option("-a, --agent <id>", "target agent (repeatable)", collect, []).option("--mcp <id>", "MCP to install (repeatable)", collect, []).option("--skill <id>", "skill to install (repeatable)", collect, []).option("--plugin <id>", "plugin to install (repeatable)", collect, []).option("--subagent <id>", "custom agent to install (repeatable)", collect, []).option("--preset <id>", "settings/config preset to apply (repeatable)", collect, []).option("--integration <id>", "integration to run, e.g. ai-memory (repeatable)", collect, []).option("--overlay <dir|git-url>", 'private overlay catalog to add (repeatable; also AGENT_HARNESS_OVERLAY, ";"-separated)', collect, []).option("--all", "select every catalog item", false).option("--no-manifest", "do not record what was installed in the agent's global instructions file").option("-y, --yes", "assume defaults, no prompts (CI)", false).option("--dry-run", "show actions without writing anything", false).option("--force", "overwrite existing entries instead of skipping", false).action(async (opts) => {
  setRunContext({ dryRun: !!opts.dryRun, force: !!opts.force, yes: !!opts.yes });
  await runInitCommand({
    agent: opts.agent,
    mcp: opts.mcp,
    skill: opts.skill,
    plugin: opts.plugin,
    subagent: opts.subagent,
    preset: opts.preset,
    integration: opts.integration,
    overlay: opts.overlay,
    all: !!opts.all,
    manifest: opts.manifest !== false,
    yes: !!opts.yes,
    version: package_default.version
  });
});
program.command("scaffold").description("Scaffold the current repo: AGENTS.md (canonical) + CLAUDE.md (@AGENTS.md import), skill memory, project-scoped skills, project .mcp.json, .ai-memory.toml, and merge .gitignore.").option("--mcp <id>", "MCP to include in project config (repeatable)", collect, []).option("--skill <id>", "skill to install into the repo, project-scoped (repeatable)", collect, []).option("--subagent <id>", "custom agent to install into the repo, project-scoped (repeatable)", collect, []).option("--with-claude-md", "write CLAUDE.md", false).option("--with-agents-md", "write AGENTS.md", false).option("--with-memory", "write the skill memory file", false).option("--with-opencode", "also write a project opencode.json", false).option("--with-ai-memory", "write .ai-memory.toml (needs --ai-memory-workspace)", false).option("--ai-memory-workspace <name>", "ai-memory workspace for .ai-memory.toml").option("--ai-memory-project <name>", "ai-memory project (default: the directory name)").option("--overlay <dir|git-url>", "private overlay catalog to add (repeatable; also AGENT_HARNESS_OVERLAY)", collect, []).option("--memory-dest <path>", "destination path for the memory file").option("--no-gitignore", "do not merge .gitignore").option("--all", "scaffold all docs + all catalog MCPs", false).option("-y, --yes", "assume defaults, no prompts (CI)", false).option("--dry-run", "show actions without writing anything", false).option("--force", "overwrite existing template files", false).action(async (opts) => {
  setRunContext({ dryRun: !!opts.dryRun, force: !!opts.force, yes: !!opts.yes });
  await runScaffoldCommand({
    mcp: opts.mcp,
    skill: opts.skill,
    subagent: opts.subagent,
    withClaudeMd: !!opts.withClaudeMd,
    withAgentsMd: !!opts.withAgentsMd,
    withMemory: !!opts.withMemory,
    withOpencode: !!opts.withOpencode,
    withAiMemory: !!opts.withAiMemory,
    aiMemoryWorkspace: opts.aiMemoryWorkspace,
    aiMemoryProject: opts.aiMemoryProject,
    overlay: opts.overlay,
    gitignore: opts.gitignore !== false,
    memoryDest: opts.memoryDest,
    all: !!opts.all,
    yes: !!opts.yes
  });
});
program.parseAsync().catch((err) => {
  log.error(err instanceof Error ? err.message : String(err));
  process13.exit(1);
});
