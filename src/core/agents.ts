/**
 * agents — data-driven registry of the agents we know how to configure.
 *
 * Each entry captures everything the rest of the CLI needs: how to detect it,
 * where its config/instructions live, how its user-scope MCP is written, the
 * id to pass to `npx skills`, and the login hint to print at the end.
 *
 * Reference facts verified against each vendor's current docs (see plan).
 */
import { existsSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { expandHome, pathExists } from './fsx';

export type AgentId = 'claude-code' | 'codex' | 'opencode';

/** How a given agent's USER-scope MCP server is registered. */
export type McpUserMethod =
  | 'claude-cli' // delegate to `claude mcp add-json ... --scope user`
  | 'codex-toml' // merge ~/.codex/config.toml [mcp_servers.<id>]
  | 'opencode-json'; // merge ~/.config/opencode/opencode.json mcp.<id>

export interface AgentInfo {
  id: AgentId;
  label: string;
  /** Identifier passed to `npx skills add -a <id>`. */
  skillAgentId: string;
  /** Per-repo instructions file this agent reads. */
  instructionsFile: 'CLAUDE.md' | 'AGENTS.md';
  /** Login hint printed in the auth block (NOT executed). */
  login: { cmd: string; note?: string };
  /** Binary name on PATH (for detection). */
  bin: string;
  /** Dirs whose existence implies the agent is installed. */
  detectDirs: string[];
  /** Files whose existence implies the agent is installed. */
  detectFiles: string[];
  /** Capabilities this agent supports. */
  supports: { mcp: boolean; skills: boolean; plugins: boolean };
  /** How user-scope MCP is written. */
  mcpUserMethod: McpUserMethod;
  /** Path of the user-scope MCP config file (for file-merge methods). */
  userMcpFile?: string;
  /** Project-scope MCP config file written by `scaffold`. */
  projectMcpFile?: string;
  /** Global instructions file location (for reference / future use). */
  globalInstructionsFile?: string;
  /**
   * Skill directories this agent reads — used by the direct-copy FALLBACK when
   * `npx skills` is unavailable or writes to the wrong place. These are the
   * paths the agent itself documents as read locations (may differ from where
   * the `skills` CLI installs; see plan's drift TODO).
   */
  skills: { userDir: string; projectDir: string };
}

export const AGENTS: AgentInfo[] = [
  {
    id: 'claude-code',
    label: 'Claude Code',
    skillAgentId: 'claude-code',
    instructionsFile: 'CLAUDE.md',
    login: { cmd: 'claude', note: 'OAuth on first run, or /login' },
    bin: 'claude',
    detectDirs: ['~/.claude'],
    detectFiles: ['~/.claude.json'],
    supports: { mcp: true, skills: true, plugins: true },
    mcpUserMethod: 'claude-cli',
    projectMcpFile: '.mcp.json',
    globalInstructionsFile: '~/.claude/CLAUDE.md',
    skills: { userDir: '~/.claude/skills', projectDir: '.claude/skills' },
  },
  {
    id: 'codex',
    label: 'Codex',
    skillAgentId: 'codex',
    instructionsFile: 'AGENTS.md',
    login: { cmd: 'codex login' },
    bin: 'codex',
    detectDirs: ['~/.codex'],
    detectFiles: ['~/.codex/config.toml'],
    supports: { mcp: true, skills: true, plugins: false },
    mcpUserMethod: 'codex-toml',
    userMcpFile: '~/.codex/config.toml',
    globalInstructionsFile: '~/.codex/AGENTS.md',
    // Codex reads ~/.agents/skills (user) and .agents/skills (repo) per current docs.
    skills: { userDir: '~/.agents/skills', projectDir: '.agents/skills' },
  },
  {
    id: 'opencode',
    label: 'OpenCode',
    skillAgentId: 'opencode',
    instructionsFile: 'AGENTS.md',
    login: { cmd: 'opencode auth login' },
    bin: 'opencode',
    detectDirs: ['~/.config/opencode', '~/.opencode'],
    detectFiles: ['~/.config/opencode/opencode.json'],
    supports: { mcp: true, skills: true, plugins: false },
    mcpUserMethod: 'opencode-json',
    userMcpFile: '~/.config/opencode/opencode.json',
    globalInstructionsFile: '~/.config/opencode/AGENTS.md',
    skills: { userDir: '~/.config/opencode/skills', projectDir: '.opencode/skills' },
  },
];

export function getAgent(id: string): AgentInfo | undefined {
  return AGENTS.find((a) => a.id === id);
}

/** True if `bin` resolves on PATH (respects PATHEXT on Windows). */
export function commandOnPath(bin: string): boolean {
  const rawPath = process.env.PATH ?? process.env.Path ?? '';
  if (!rawPath) return false;
  const sep = process.platform === 'win32' ? ';' : ':';
  const exts =
    process.platform === 'win32'
      ? (process.env.PATHEXT ?? '.EXE;.CMD;.BAT;.COM').split(';').filter(Boolean)
      : [''];
  for (const dir of rawPath.split(sep)) {
    if (!dir) continue;
    for (const ext of exts) {
      try {
        if (existsSync(path.join(dir, bin + ext))) return true;
      } catch {
        /* ignore unreadable PATH entries */
      }
    }
  }
  return false;
}

/** An agent counts as installed if a config dir/file exists or its binary is on PATH. */
export function isAgentInstalled(a: AgentInfo): boolean {
  if (a.detectDirs.some((d) => pathExists(d))) return true;
  if (a.detectFiles.some((f) => pathExists(f))) return true;
  return commandOnPath(a.bin);
}

export function detectInstalledAgentIds(): string[] {
  return AGENTS.filter(isAgentInstalled).map((a) => a.id);
}

/** Resolve the user-scope MCP file (absolute) for file-merge agents. */
export function userMcpFileAbs(a: AgentInfo): string | undefined {
  return a.userMcpFile ? expandHome(a.userMcpFile) : undefined;
}
