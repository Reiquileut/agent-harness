#!/usr/bin/env node

// src/cli.ts
import { Command } from "commander";
import process8 from "process";

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
function isRecord(x) {
  return typeof x === "object" && x !== null && !Array.isArray(x);
}
function jsonStringify(value) {
  return `${JSON.stringify(value, null, 2)}
`;
}
function parseToml(text) {
  return parseTomlRaw(text);
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

// src/commands/init.ts
import process7 from "process";
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
import { existsSync as existsSync2 } from "fs";
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
    supports: { mcp: true, skills: true, plugins: true },
    mcpUserMethod: "claude-cli",
    projectMcpFile: ".mcp.json",
    globalInstructionsFile: "~/.claude/CLAUDE.md",
    skills: { userDir: "~/.claude/skills", projectDir: ".claude/skills" }
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
    supports: { mcp: true, skills: true, plugins: false },
    mcpUserMethod: "codex-toml",
    userMcpFile: "~/.codex/config.toml",
    globalInstructionsFile: "~/.codex/AGENTS.md",
    // Codex reads ~/.agents/skills (user) and .agents/skills (repo) per current docs.
    skills: { userDir: "~/.agents/skills", projectDir: ".agents/skills" }
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
    supports: { mcp: true, skills: true, plugins: false },
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
    for (const ext of exts) {
      try {
        if (existsSync2(path2.join(dir, bin + ext))) return true;
      } catch {
      }
    }
  }
  return false;
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
import process3 from "process";
import { z } from "zod";
var McpHttpSchema = z.object({
  id: z.string().min(1),
  label: z.string().min(1),
  transport: z.literal("http"),
  url: z.string().min(1),
  headers: z.record(z.string(), z.string()).default({}),
  env: z.array(z.string()).default([])
});
var McpStdioSchema = z.object({
  id: z.string().min(1),
  label: z.string().min(1),
  transport: z.literal("stdio"),
  command: z.string().min(1),
  args: z.array(z.string()).default([]),
  env: z.array(z.string()).default([])
});
var McpSchema = z.discriminatedUnion("transport", [McpHttpSchema, McpStdioSchema]);
var SkillSchema = z.object({
  id: z.string().min(1),
  label: z.string().optional(),
  /** owner/repo, URL, or local dir passed to `npx skills add`. */
  source: z.string().min(1),
  /** the specific skill name inside that source. */
  skill: z.string().min(1)
});
var PluginSchema = z.object({
  id: z.string().min(1),
  label: z.string().optional(),
  agent: z.string().default("claude-code"),
  /** owner/repo or git URL of the marketplace (used by `claude plugin marketplace add`). */
  marketplace: z.string().min(1),
  /**
   * The marketplace's declared name (its marketplace.json "name"), used in the
   * install ref `<plugin>@<name>`. Defaults to the last path segment of
   * `marketplace` when omitted — set it if they differ.
   */
  name: z.string().optional(),
  /** plugin names to install from that marketplace. */
  install: z.array(z.string()).default([])
});
var TemplatesSchema = z.object({
  claude_md: z.string().min(1),
  agents_md: z.string().min(1),
  memory: z.string().min(1)
});
var CatalogSchema = z.object({
  agents: z.array(z.string()).default([]),
  mcps: z.array(McpSchema).default([]),
  skills: z.array(SkillSchema).default([]),
  plugins: z.array(PluginSchema).default([]),
  templates: TemplatesSchema,
  /** Entries the `scaffold` command merges into the project .gitignore. */
  gitignore: z.array(z.string()).default([])
});
function packageRoot() {
  const here = path3.dirname(fileURLToPath(import.meta.url));
  return path3.resolve(here, "..");
}
function assetsDir() {
  return process3.env.AGENT_HARNESS_ASSETS ?? path3.join(packageRoot(), "assets");
}
function catalogPath() {
  return process3.env.AGENT_HARNESS_CATALOG ?? path3.join(assetsDir(), "catalog.json");
}
function assetPath(rel) {
  return path3.isAbsolute(rel) ? rel : path3.join(assetsDir(), rel);
}
async function loadCatalog() {
  const p = catalogPath();
  const text = await readText(p);
  if (text == null) {
    throw new Error(
      `Catalog not found at ${p}.
Set AGENT_HARNESS_CATALOG to point at your own catalog.json if needed.`
    );
  }
  let raw;
  try {
    raw = JSON.parse(text);
  } catch (err) {
    throw new Error(`Catalog at ${p} is not valid JSON: ${err.message}`);
  }
  const parsed = CatalogSchema.safeParse(raw);
  if (!parsed.success) {
    const details = parsed.error.issues.map((i) => `  \u2022 ${i.path.join(".") || "(root)"}: ${i.message}`).join("\n");
    throw new Error(`Catalog at ${p} failed validation:
${details}`);
  }
  return parsed.data;
}
function looksLikePlaceholder(value) {
  return /<[^>]+>/.test(value);
}

// src/core/plugins.ts
function marketplaceName(plugin) {
  if (plugin.name) return plugin.name;
  const seg = plugin.marketplace.split("/").pop() ?? plugin.marketplace;
  return seg.replace(/\.git$/, "");
}
function claudeAvailable() {
  return commandOnPath("claude");
}
function buildPluginActions(agent, plugin) {
  if (!agent.supports.plugins) {
    return [{ kind: "skip", label: `Plugins \u2192 ${agent.label}`, reason: "agent has no plugin system" }];
  }
  if (!claudeAvailable()) return [];
  const actions = [
    {
      kind: "exec",
      label: `Marketplace ${plugin.marketplace}`,
      cmd: "claude",
      args: ["plugin", "marketplace", "add", plugin.marketplace],
      timeout: 12e4,
      tolerant: true
    }
  ];
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
  const repo = plugin.marketplace.replace(/\.git$/, "");
  const ekm = isRecord(root.extraKnownMarketplaces) ? { ...root.extraKnownMarketplaces } : {};
  ekm[mpName] = { source: { source: "github", repo } };
  root.extraKnownMarketplaces = ekm;
  const enabled = isRecord(root.enabledPlugins) ? { ...root.enabledPlugins } : {};
  for (const name of plugin.install) enabled[`${name}@${mpName}`] = true;
  root.enabledPlugins = enabled;
  return { kind: "file", label, path: file, before: before ?? null, after: jsonStringify(root) };
}

// src/core/mcp.ts
import path4 from "path";
import process4 from "process";
import { execa as execa2 } from "execa";
var OPENCODE_SCHEMA = "https://opencode.ai/config.json";
function isRecord2(x) {
  return typeof x === "object" && x !== null && !Array.isArray(x);
}
function safeParseToml(text) {
  try {
    return parseToml(text);
  } catch {
    return null;
  }
}
function toClaudeServer(m) {
  if (m.transport === "http") {
    const v2 = { type: "http", url: m.url };
    if (Object.keys(m.headers).length) v2.headers = m.headers;
    return v2;
  }
  const v = { command: m.command, args: m.args };
  if (m.env.length) {
    v.env = Object.fromEntries(m.env.map((name) => [name, `\${${name}}`]));
  }
  return v;
}
function toCodexServer(m) {
  if (m.transport === "http") {
    const v2 = { url: m.url };
    if (Object.keys(m.headers).length) v2.http_headers = m.headers;
    return v2;
  }
  const v = { command: m.command, args: m.args };
  if (m.env.length) v.env_vars = m.env;
  return v;
}
function toOpencodeServer(m) {
  if (m.transport === "http") {
    const v2 = { type: "remote", url: m.url, enabled: true };
    if (Object.keys(m.headers).length) v2.headers = m.headers;
    return v2;
  }
  const v = {
    type: "local",
    command: [m.command, ...m.args],
    enabled: true
  };
  if (m.env.length) {
    v.environment = Object.fromEntries(m.env.map((name) => [name, `{env:${name}}`]));
  }
  return v;
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
async function buildClaudeUserMcp(m, label) {
  if (!isForce() && await claudeHasMcp(m.id)) {
    return { kind: "skip", label, reason: "already configured (claude mcp)" };
  }
  const base = ["mcp", "add", "--scope", "user"];
  let args;
  if (m.transport === "http") {
    args = [...base, "--transport", "http"];
    for (const [k, v] of Object.entries(m.headers)) args.push("--header", `${k}: ${v}`);
    args.push(m.id, m.url);
  } else {
    args = [...base, "--transport", "stdio"];
    for (const name of m.env) args.push("--env", `${name}=\${${name}}`);
    args.push(m.id, "--", m.command, ...m.args);
  }
  return { kind: "exec", label, cmd: "claude", args, timeout: 12e4 };
}
async function buildCodexUserMcp(agent, m, label) {
  const file = userMcpFileAbs(agent);
  if (!file) return { kind: "skip", label, reason: "no codex config path" };
  const before = await readText(file);
  const root = before && before.trim() ? safeParseToml(before) : {};
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
    return { kind: "skip", label, reason: `already in ${path4.basename(file)}` };
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
  const file = path4.isAbsolute(opts.file) ? opts.file : path4.resolve(opts.cwd ?? process4.cwd(), opts.file);
  const before = await readText(file);
  const name = path4.basename(file);
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

// src/core/skills.ts
import { promises as fs2 } from "fs";
import path5 from "path";
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
function localSkillDir(skill) {
  return path5.join(assetsDir(), "skills", skill.id);
}
function hasLocalSkill(skill) {
  return pathExists(localSkillDir(skill));
}
async function listFilesRecursive(dir) {
  const out = [];
  const entries = await fs2.readdir(dir, { withFileTypes: true });
  for (const e of entries) {
    const full = path5.join(dir, e.name);
    if (e.isDirectory()) out.push(...await listFilesRecursive(full));
    else if (e.isFile()) out.push(full);
  }
  return out;
}
async function buildSkillFallbackActions(agent, skill, scope) {
  const label = `Skill ${skill.skill} \u2192 ${agent.label} (fallback)`;
  const srcDir = localSkillDir(skill);
  if (!pathExists(srcDir)) {
    return [
      {
        kind: "note",
        level: "warn",
        label,
        message: `\`npx skills\` failed and no local copy at assets/skills/${skill.id}/ \u2014 install this skill manually.`
      }
    ];
  }
  const destBase = expandHome(scope === "user" ? agent.skills.userDir : agent.skills.projectDir);
  const destDir = path5.join(destBase, skill.skill);
  const files = await listFilesRecursive(srcDir);
  const actions = [];
  for (const file of files) {
    const rel = path5.relative(srcDir, file);
    const dest = path5.join(destDir, rel);
    const after = await fs2.readFile(file, "utf8");
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

// src/ui/prompts.ts
import {
  cancel,
  confirm,
  groupMultiselect,
  intro,
  isCancel,
  multiselect,
  note
} from "@clack/prompts";
import pc4 from "picocolors";

// src/commands/scaffold.ts
import process6 from "process";
import pc3 from "picocolors";

// src/core/templates.ts
import path6 from "path";
import process5 from "process";
var DEFAULT_GITIGNORE_ENTRIES = [".claude/settings.local.json"];
function resolveInCwd(rel, cwd) {
  return path6.isAbsolute(rel) ? rel : path6.resolve(cwd ?? process5.cwd(), rel);
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
  const list = entries.length ? entries : DEFAULT_GITIGNORE_ENTRIES;
  const file = resolveInCwd(".gitignore", cwd);
  const before = await readText(file);
  const { content, added } = mergeGitignore(before, list);
  if (added.length === 0) {
    return { kind: "skip", label: ".gitignore", reason: "all entries already present" };
  }
  const label = `.gitignore (+${added.length}: ${added.join(", ")})`;
  return { kind: "file", label, path: file, before, after: content };
}

// src/commands/scaffold.ts
var DEFAULT_MEMORY_DEST = ".claude/skills/memory/memory.md";
function planFromFlags(catalog, opts) {
  const memoryDest = opts.memoryDest ?? DEFAULT_MEMORY_DEST;
  if (opts.all) {
    return {
      withClaudeMd: true,
      withAgentsMd: true,
      withMemory: true,
      withOpencode: true,
      withGitignore: true,
      mcps: catalog.mcps,
      memoryDest
    };
  }
  const mcps = catalog.mcps.filter((m) => opts.mcp.includes(m.id));
  return {
    withClaudeMd: opts.withClaudeMd,
    withAgentsMd: opts.withAgentsMd,
    withMemory: opts.withMemory,
    withOpencode: opts.withOpencode,
    withGitignore: opts.gitignore,
    mcps,
    memoryDest
  };
}
function isInteractive(opts) {
  if (opts.yes) return false;
  const explicit = opts.all || opts.withClaudeMd || opts.withAgentsMd || opts.withMemory || opts.withOpencode || opts.mcp.length > 0;
  if (explicit) return false;
  return Boolean(process6.stdout.isTTY && process6.stdin.isTTY);
}
function isEmptyPlan(p) {
  return !p.withClaudeMd && !p.withAgentsMd && !p.withMemory && !p.withGitignore && p.mcps.length === 0;
}
async function runScaffoldCommand(opts) {
  const catalog = await loadCatalog();
  const plan = isInteractive(opts) ? await promptScaffoldSelection(catalog) : planFromFlags(catalog, opts);
  if (!plan) {
    log.warn("Nothing selected \u2014 aborting.");
    return;
  }
  if (isEmptyPlan(plan)) {
    log.warn(
      "Nothing to scaffold. Pass --with-claude-md / --with-agents-md / --with-memory / --mcp <id> / --all."
    );
    return;
  }
  const actions = [];
  if (plan.withClaudeMd) {
    actions.push(await buildTemplateCopyAction(catalog.templates.claude_md, "CLAUDE.md", "CLAUDE.md"));
  }
  if (plan.withAgentsMd) {
    actions.push(await buildTemplateCopyAction(catalog.templates.agents_md, "AGENTS.md", "AGENTS.md"));
  }
  if (plan.withMemory) {
    actions.push(
      await buildTemplateCopyAction(catalog.templates.memory, plan.memoryDest, `memory \u2192 ${plan.memoryDest}`)
    );
  }
  if (plan.mcps.length) {
    actions.push(await buildProjectMcpAction(plan.mcps, { file: ".mcp.json", format: "claude" }));
    if (plan.withOpencode) {
      actions.push(await buildProjectMcpAction(plan.mcps, { file: "opencode.json", format: "opencode" }));
    }
  }
  if (plan.withGitignore) {
    actions.push(await buildGitignoreMergeAction(catalog.gitignore));
  }
  log.plain("");
  log.info(`${isDryRun() ? pc3.yellow("Dry run \u2014 ") : ""}Scaffolding ${pc3.bold(process6.cwd())}`);
  log.plain("");
  await runActions(actions);
  log.plain("");
  log.success(isDryRun() ? "Dry run complete \u2014 nothing written." : "Scaffold complete.");
  log.plain(pc3.dim("  CLAUDE.md \u2192 Claude Code \xB7 AGENTS.md \u2192 Codex & OpenCode \xB7 .mcp.json is team-shared."));
}

// src/ui/prompts.ts
function toAgents(ids) {
  return ids.map(getAgent).filter((a) => Boolean(a));
}
function mcpHint(m) {
  return m.transport;
}
async function promptInitSelection(catalog) {
  intro(pc4.bgCyan(pc4.black(" agent-harness ")));
  const detected = new Set(detectInstalledAgentIds());
  const agentOptions = catalog.agents.map((id) => {
    const a = getAgent(id);
    return {
      value: id,
      label: a?.label ?? id,
      hint: detected.has(id) ? "detected" : void 0
    };
  });
  const agentSel = await multiselect({
    message: "Which agents do you want to configure?",
    options: agentOptions,
    initialValues: catalog.agents.filter((id) => detected.has(id)),
    required: true
  });
  if (isCancel(agentSel)) return abort();
  const options = {};
  if (catalog.mcps.length) {
    options["MCP servers"] = catalog.mcps.map((m) => ({
      value: `mcp:${m.id}`,
      label: m.label,
      hint: mcpHint(m)
    }));
  }
  if (catalog.skills.length) {
    options["Skills"] = catalog.skills.map((s) => ({
      value: `skill:${s.id}`,
      label: s.label ?? s.skill
    }));
  }
  if (catalog.plugins.length) {
    options["Plugins"] = catalog.plugins.map((p) => ({
      value: `plugin:${p.id}`,
      label: p.label ?? p.id,
      hint: p.agent
    }));
  }
  let chosen = [];
  if (Object.keys(options).length) {
    const picked = await groupMultiselect({
      message: "Select items to install (space to toggle, enter to confirm):",
      options,
      required: false,
      selectableGroups: true
    });
    if (isCancel(picked)) return abort();
    chosen = picked;
  }
  const has = (prefix) => chosen.filter((v) => v.startsWith(prefix)).map((v) => v.slice(prefix.length));
  const mcpIds = has("mcp:");
  const skillIds = has("skill:");
  const pluginIds = has("plugin:");
  const agents = toAgents(agentSel);
  note(
    [
      `Agents:  ${agents.map((a) => a.label).join(", ")}`,
      `MCPs:    ${mcpIds.length ? mcpIds.join(", ") : pc4.dim("none")}`,
      `Skills:  ${skillIds.length ? skillIds.join(", ") : pc4.dim("none")}`,
      `Plugins: ${pluginIds.length ? pluginIds.join(", ") : pc4.dim("none")}`
    ].join("\n"),
    "Summary"
  );
  const ok = await confirm({ message: "Proceed with installation?" });
  if (isCancel(ok) || !ok) return abort();
  return {
    agents,
    mcps: catalog.mcps.filter((m) => mcpIds.includes(m.id)),
    skills: catalog.skills.filter((s) => skillIds.includes(s.id)),
    plugins: catalog.plugins.filter((p) => pluginIds.includes(p.id))
  };
}
async function promptScaffoldSelection(catalog) {
  intro(pc4.bgCyan(pc4.black(" agent-harness scaffold ")));
  const artifacts = await multiselect({
    message: "What should I add to this repo?",
    options: [
      { value: "claude-md", label: "CLAUDE.md", hint: "Claude Code instructions" },
      { value: "agents-md", label: "AGENTS.md", hint: "Codex / OpenCode instructions" },
      { value: "memory", label: "Skill memory file", hint: DEFAULT_MEMORY_DEST },
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
      options: catalog.mcps.map((m) => ({ value: m.id, label: m.label, hint: mcpHint(m) })),
      required: false
    });
    if (isCancel(picked)) return abort();
    mcps = catalog.mcps.filter((m) => picked.includes(m.id));
  }
  const plan = {
    withClaudeMd: want("claude-md"),
    withAgentsMd: want("agents-md"),
    withMemory: want("memory"),
    withOpencode: want("opencode"),
    withGitignore: want("gitignore"),
    mcps,
    memoryDest: DEFAULT_MEMORY_DEST
  };
  note(
    [
      `Docs:     ${[plan.withClaudeMd && "CLAUDE.md", plan.withAgentsMd && "AGENTS.md", plan.withMemory && "memory"].filter(Boolean).join(", ") || pc4.dim("none")}`,
      `MCPs:     ${mcps.length ? mcps.map((m) => m.id).join(", ") : pc4.dim("none")}${plan.withOpencode ? pc4.dim(" (+opencode.json)") : ""}`,
      `gitignore: ${plan.withGitignore ? "merge" : pc4.dim("skip")}`
    ].join("\n"),
    "Summary"
  );
  const ok = await confirm({ message: "Scaffold these into the current directory?" });
  if (isCancel(ok) || !ok) return abort();
  return plan;
}
function abort() {
  cancel("Cancelled \u2014 nothing was changed.");
  return null;
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
    plugins: pick(catalog.plugins, opts.plugin)
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
  const explicit = opts.all || opts.agent.length > 0 || opts.mcp.length > 0 || opts.skill.length > 0 || opts.plugin.length > 0;
  if (explicit) return false;
  return Boolean(process7.stdout.isTTY && process7.stdin.isTTY);
}
async function runInitCommand(opts) {
  const catalog = await loadCatalog();
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
  log.plain("");
  log.info(
    `${isDryRun() ? pc5.yellow("Dry run \u2014 ") : ""}Configuring ${selection.agents.map((a) => pc5.bold(a.label)).join(", ")}`
  );
  for (const agent of selection.agents) {
    log.plain("");
    log.step(pc5.bold(agent.label));
    await configureAgent(agent, selection);
  }
  printAuthBlock(selection);
}
async function configureAgent(agent, sel) {
  if (agent.supports.mcp) {
    for (const m of sel.mcps) {
      await runAction(await buildUserMcpAction(agent, m));
    }
  } else if (sel.mcps.length) {
    log.plain(`   ${pc5.dim("\xB7 skip MCPs \u2014 unsupported")}`);
  }
  if (agent.supports.skills) {
    for (const s of sel.skills) {
      const res = await runAction(buildSkillAction(agent, s, "user"));
      if (res.status === "failed" && hasLocalSkill(s)) {
        log.plain(`   ${pc5.dim("\xB7 trying local fallback\u2026")}`);
        await runActions(await buildSkillFallbackActions(agent, s, "user"));
      }
    }
  } else if (sel.skills.length) {
    log.plain(`   ${pc5.dim("\xB7 skip skills \u2014 unsupported")}`);
  }
  if (agent.supports.plugins) {
    const forThisAgent = sel.plugins.filter((p) => p.agent === agent.id);
    for (const p of forThisAgent) {
      const actions = buildPluginActions(agent, p);
      if (actions.length === 0) {
        await runAction(await buildPluginSettingsFallbackAction(p));
      } else {
        await runActions(actions);
      }
    }
  } else if (sel.plugins.some((p) => p.agent === agent.id)) {
    log.plain(`   ${pc5.dim("\xB7 skip plugins \u2014 unsupported")}`);
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
  log.plain(pc5.dim("  MCPs with OAuth (Notion, Google\u2026) authenticate on first tool use."));
  const envs = requiredEnvVars(sel.mcps);
  if (envs.length) {
    log.plain(pc5.dim(`  MCPs needing API keys \u2014 export in your shell/.env: ${envs.join(", ")}`));
  }
  log.plain("");
}

// src/cli.ts
function collect(value, previous) {
  return previous.concat([value]);
}
var program = new Command();
program.name("agent-harness").description("Dotfiles-for-AI-agents bootstrapper \u2014 configure MCPs, skills, and plugins across Claude Code, Codex, and OpenCode.").version("0.1.0");
program.command("init").description("Configure agents on this machine (user-scope MCPs, skills, plugins), then print the login block.").option("-a, --agent <id>", "target agent (repeatable)", collect, []).option("--mcp <id>", "MCP to install (repeatable)", collect, []).option("--skill <id>", "skill to install (repeatable)", collect, []).option("--plugin <id>", "plugin to install (repeatable)", collect, []).option("--all", "select every catalog item", false).option("-y, --yes", "assume defaults, no prompts (CI)", false).option("--dry-run", "show actions without writing anything", false).option("--force", "overwrite existing entries instead of skipping", false).action(async (opts) => {
  setRunContext({ dryRun: !!opts.dryRun, force: !!opts.force, yes: !!opts.yes });
  await runInitCommand({
    agent: opts.agent,
    mcp: opts.mcp,
    skill: opts.skill,
    plugin: opts.plugin,
    all: !!opts.all,
    yes: !!opts.yes
  });
});
program.command("scaffold").description("Scaffold the current repo: CLAUDE.md, AGENTS.md, skill memory, project .mcp.json, and merge .gitignore.").option("--mcp <id>", "MCP to include in project config (repeatable)", collect, []).option("--with-claude-md", "write CLAUDE.md", false).option("--with-agents-md", "write AGENTS.md", false).option("--with-memory", "write the skill memory file", false).option("--with-opencode", "also write a project opencode.json", false).option("--memory-dest <path>", "destination path for the memory file").option("--no-gitignore", "do not merge .gitignore").option("--all", "scaffold all docs + all catalog MCPs", false).option("-y, --yes", "assume defaults, no prompts (CI)", false).option("--dry-run", "show actions without writing anything", false).option("--force", "overwrite existing template files", false).action(async (opts) => {
  setRunContext({ dryRun: !!opts.dryRun, force: !!opts.force, yes: !!opts.yes });
  await runScaffoldCommand({
    mcp: opts.mcp,
    withClaudeMd: !!opts.withClaudeMd,
    withAgentsMd: !!opts.withAgentsMd,
    withMemory: !!opts.withMemory,
    withOpencode: !!opts.withOpencode,
    gitignore: opts.gitignore !== false,
    memoryDest: opts.memoryDest,
    all: !!opts.all,
    yes: !!opts.yes
  });
});
program.parseAsync().catch((err) => {
  log.error(err instanceof Error ? err.message : String(err));
  process8.exit(1);
});
