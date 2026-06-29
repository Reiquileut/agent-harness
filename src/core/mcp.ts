/**
 * mcp — translate a transport-neutral catalog MCP entry into the install
 * action for a specific agent.
 *
 * Secret-free by design: the catalog stores env var *names* only. We never
 * write secret values; instead each agent format gets a passthrough reference
 * to the same-named environment variable:
 *   - Claude:   --env NAME=${NAME}      (Claude expands ${VAR} at runtime)
 *   - Codex:    env_vars = ["NAME"]     (shell passthrough list)
 *   - OpenCode: environment.NAME = "{env:NAME}"
 *
 * Strategy per agent (see plan):
 *   - Claude  user  -> exec `claude mcp add ... --scope user` (flag form; avoids
 *                      hand-editing the fragile ~/.claude.json)
 *   - Codex   user  -> merge ~/.codex/config.toml [mcp_servers.<id>] (append-safe)
 *   - OpenCode user -> merge ~/.config/opencode/opencode.json mcp.<id>
 *   - project (.mcp.json / opencode.json) -> file merge, used by scaffold
 */
import path from 'node:path';
import process from 'node:process';
import { execa } from 'execa';
import type { Action } from './actions';
import type { AgentInfo } from './agents';
import { commandOnPath, userMcpFileAbs } from './agents';
import type { McpEntry } from './catalog';
import {
  isForce,
  jsonStringify,
  log,
  parseToml,
  readText,
  stringifyToml,
  tildify,
} from './fsx';

const OPENCODE_SCHEMA = 'https://opencode.ai/config.json';

function isRecord(x: unknown): x is Record<string, unknown> {
  return typeof x === 'object' && x !== null && !Array.isArray(x);
}

function safeParseToml(text: string): Record<string, unknown> | null {
  try {
    return parseToml(text);
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Translations (neutral -> agent shape)
// ---------------------------------------------------------------------------

/** Claude `.mcp.json` server value (also the shape for project scope). */
export function toClaudeServer(m: McpEntry): Record<string, unknown> {
  if (m.transport === 'http') {
    const v: Record<string, unknown> = { type: 'http', url: m.url };
    if (Object.keys(m.headers).length) v.headers = m.headers;
    return v;
  }
  const v: Record<string, unknown> = { command: m.command, args: m.args };
  if (m.env.length) {
    v.env = Object.fromEntries(m.env.map((name) => [name, `\${${name}}`]));
  }
  return v;
}

/** Codex `[mcp_servers.<id>]` table value. */
export function toCodexServer(m: McpEntry): Record<string, unknown> {
  if (m.transport === 'http') {
    const v: Record<string, unknown> = { url: m.url };
    if (Object.keys(m.headers).length) v.http_headers = m.headers;
    return v;
  }
  const v: Record<string, unknown> = { command: m.command, args: m.args };
  if (m.env.length) v.env_vars = m.env; // shell passthrough by name
  return v;
}

/** OpenCode `mcp.<id>` value. */
export function toOpencodeServer(m: McpEntry): Record<string, unknown> {
  if (m.transport === 'http') {
    const v: Record<string, unknown> = { type: 'remote', url: m.url, enabled: true };
    if (Object.keys(m.headers).length) v.headers = m.headers;
    return v;
  }
  const v: Record<string, unknown> = {
    type: 'local',
    command: [m.command, ...m.args],
    enabled: true,
  };
  if (m.env.length) {
    v.environment = Object.fromEntries(m.env.map((name) => [name, `{env:${name}}`]));
  }
  return v;
}

// ---------------------------------------------------------------------------
// User-scope install action (init)
// ---------------------------------------------------------------------------
export async function buildUserMcpAction(agent: AgentInfo, m: McpEntry): Promise<Action> {
  const label = `MCP ${m.id} → ${agent.label}`;
  switch (agent.mcpUserMethod) {
    case 'claude-cli':
      return buildClaudeUserMcp(m, label);
    case 'codex-toml':
      return buildCodexUserMcp(agent, m, label);
    case 'opencode-json':
      return buildOpencodeUserMcp(agent, m, label);
  }
}

async function claudeHasMcp(id: string): Promise<boolean> {
  if (!commandOnPath('claude')) return false;
  try {
    await execa('claude', ['mcp', 'get', id], {
      timeout: 15_000,
      stdin: 'ignore',
      stdout: 'ignore',
      stderr: 'ignore',
    });
    return true; // exit 0 -> exists
  } catch {
    return false;
  }
}

async function buildClaudeUserMcp(m: McpEntry, label: string): Promise<Action> {
  if (!isForce() && (await claudeHasMcp(m.id))) {
    return { kind: 'skip', label, reason: 'already configured (claude mcp)' };
  }
  // Flag form keeps args simple (no JSON blob) — safer across shells/Windows shims.
  const base = ['mcp', 'add', '--scope', 'user'];
  let args: string[];
  if (m.transport === 'http') {
    args = [...base, '--transport', 'http'];
    for (const [k, v] of Object.entries(m.headers)) args.push('--header', `${k}: ${v}`);
    args.push(m.id, m.url);
  } else {
    args = [...base, '--transport', 'stdio'];
    for (const name of m.env) args.push('--env', `${name}=\${${name}}`);
    args.push(m.id, '--', m.command, ...m.args);
  }
  return { kind: 'exec', label, cmd: 'claude', args, timeout: 120_000 };
}

async function buildCodexUserMcp(agent: AgentInfo, m: McpEntry, label: string): Promise<Action> {
  const file = userMcpFileAbs(agent);
  if (!file) return { kind: 'skip', label, reason: 'no codex config path' };
  const before = await readText(file);
  const root = before && before.trim() ? safeParseToml(before) : {};
  if (root === null) {
    return {
      kind: 'note',
      level: 'warn',
      label,
      message: `Could not parse ${tildify(file)}; add [mcp_servers.${m.id}] manually.`,
    };
  }
  const servers = isRecord(root.mcp_servers) ? root.mcp_servers : {};
  const exists = m.id in servers;
  if (exists && !isForce()) {
    return { kind: 'skip', label, reason: `already in ${path.basename(file)}` };
  }

  if (exists && isForce()) {
    if (before?.includes('#')) {
      log.warn(`   rewriting ${tildify(file)} (TOML comments may be lost)`);
    }
    const next = { ...root, mcp_servers: { ...servers, [m.id]: toCodexServer(m) } };
    return { kind: 'file', label, path: file, before: before ?? null, after: stringifyToml(next) };
  }

  // Add: append a rendered table block so the rest of the file (comments,
  // settings) is preserved verbatim.
  let block = stringifyToml({ mcp_servers: { [m.id]: toCodexServer(m) } });
  block = block.replace(/^\[mcp_servers\]\s*\n+/, ''); // drop bare parent header if emitted
  const after =
    before == null || before.trim() === ''
      ? block
      : `${before}${before.endsWith('\n') ? '' : '\n'}\n${block}`;
  return { kind: 'file', label, path: file, before: before ?? null, after };
}

async function buildOpencodeUserMcp(agent: AgentInfo, m: McpEntry, label: string): Promise<Action> {
  const file = userMcpFileAbs(agent);
  if (!file) return { kind: 'skip', label, reason: 'no opencode config path' };
  const before = await readText(file);
  let root: Record<string, unknown> = {};
  if (before && before.trim()) {
    try {
      const parsed: unknown = JSON.parse(before);
      if (isRecord(parsed)) root = parsed;
    } catch {
      return {
        kind: 'note',
        level: 'warn',
        label,
        message: `Could not parse ${tildify(file)} as JSON; add mcp.${m.id} manually.`,
      };
    }
  }
  if (!root.$schema) root.$schema = OPENCODE_SCHEMA;
  const mcp = isRecord(root.mcp) ? root.mcp : {};
  if (m.id in mcp && !isForce()) {
    return { kind: 'skip', label, reason: 'already in opencode.json' };
  }
  root.mcp = { ...mcp, [m.id]: toOpencodeServer(m) };
  return { kind: 'file', label, path: file, before: before ?? null, after: jsonStringify(root) };
}

// ---------------------------------------------------------------------------
// Project-scope file (scaffold): merge many entries into one file
// ---------------------------------------------------------------------------
export interface ProjectMcpOpts {
  file: string;
  format: 'claude' | 'opencode';
  cwd?: string;
}

export async function buildProjectMcpAction(
  entries: McpEntry[],
  opts: ProjectMcpOpts,
): Promise<Action> {
  const file = path.isAbsolute(opts.file)
    ? opts.file
    : path.resolve(opts.cwd ?? process.cwd(), opts.file);
  const before = await readText(file);
  const name = path.basename(file);
  const label = `project ${name} (${entries.length} MCP${entries.length === 1 ? '' : 's'})`;

  let root: Record<string, unknown> = {};
  if (before && before.trim()) {
    try {
      const parsed: unknown = JSON.parse(before);
      if (isRecord(parsed)) root = parsed;
    } catch {
      return {
        kind: 'note',
        level: 'warn',
        label,
        message: `Could not parse ${tildify(file)} as JSON; edit it manually.`,
      };
    }
  }

  let changed = false;
  if (opts.format === 'claude') {
    const servers = isRecord(root.mcpServers) ? { ...root.mcpServers } : {};
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
    const mcp = isRecord(root.mcp) ? { ...root.mcp } : {};
    for (const m of entries) {
      if (m.id in mcp && !isForce()) continue;
      mcp[m.id] = toOpencodeServer(m);
      changed = true;
    }
    root.mcp = mcp;
  }

  if (!changed && before != null) {
    return { kind: 'skip', label, reason: 'all selected MCPs already present' };
  }
  return { kind: 'file', label, path: file, before: before ?? null, after: jsonStringify(root) };
}

// ---------------------------------------------------------------------------
// Env vars to remind about in the auth block
// ---------------------------------------------------------------------------
export function requiredEnvVars(entries: McpEntry[]): string[] {
  const set = new Set<string>();
  for (const m of entries) for (const name of m.env) set.add(name);
  return [...set];
}
