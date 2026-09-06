/**
 * skills — install agent skills by delegating to the `skills` CLI (Vercel Labs),
 * which already maps each agent's install path. We orchestrate the call and
 * keep a direct-copy fallback from assets/skills/<id>/ for when the CLI is
 * unavailable or installs to the wrong place (see plan's drift TODO).
 *
 * Skills that ship their own installer (catalog `installer`, e.g.
 * `npx impeccable install`) run that instead — once per scope, with every
 * selected agent's provider name joined into a single call.
 */
import { promises as fs } from 'node:fs';
import path from 'node:path';
import type { Action } from './actions';
import type { AgentInfo } from './agents';
import { assetsDir, skillAppliesTo } from './catalog';
import type { SkillEntry } from './catalog';
import { expandHome, homeDir, pathExists, readText } from './fsx';

export type SkillScope = 'user' | 'project';

/** Skills with source "local" are bundled in assets/skills/<id>/ and copied directly. */
export function isLocalSkill(skill: SkillEntry): boolean {
  return skill.source === 'local';
}

/** Skills with a catalog `installer` run their own CLI instead of `npx skills`. */
export function hasInstaller(skill: SkillEntry): boolean {
  return Boolean(skill.installer);
}

/**
 * Primary install: `npx --yes skills add <source> --skill <skill> -a <agent> [-g] -y`.
 * `--yes` auto-confirms npx's package download; trailing `-y` auto-confirms the
 * skills CLI; `-g` installs globally (user scope) vs project-local.
 */
export function buildSkillAction(agent: AgentInfo, skill: SkillEntry, scope: SkillScope): Action {
  const label = `Skill ${skill.skill} → ${agent.label}`;
  const args = [
    '--yes',
    'skills',
    'add',
    skill.source,
    '--skill',
    skill.skill,
    '-a',
    agent.skillAgentId,
    '-y',
  ];
  if (scope === 'user') args.push('-g');
  return { kind: 'exec', label, cmd: 'npx', args, timeout: 180_000 };
}

/**
 * Installer-backed skill: one exec for all applicable agents. `{provider}` →
 * comma-joined provider names, `{scope}` → `global` | `project`.
 */
export function buildInstallerSkillAction(
  agents: AgentInfo[],
  skill: SkillEntry,
  scope: SkillScope,
): Action {
  const inst = skill.installer;
  const applicable = agents.filter((a) => a.supports.skills && skillAppliesTo(skill, a.id));
  const label = `Skill ${skill.skill} → ${applicable.map((a) => a.label).join(', ') || 'no agent'}`;
  if (!inst) {
    return { kind: 'skip', label, reason: 'no installer declared' };
  }
  const providers = applicable
    .map((a) => inst.providers[a.id])
    .filter((p): p is string => Boolean(p));
  if (providers.length === 0) {
    return { kind: 'skip', label, reason: 'no selected agent supported by this installer' };
  }
  const scopeWord = scope === 'user' ? 'global' : 'project';
  const args = inst.args.map((a) =>
    a.replaceAll('{provider}', providers.join(',')).replaceAll('{scope}', scopeWord),
  );
  // Global installs run from the home dir: installers that also drop
  // project-level files (impeccable writes .codex/hooks.json into cwd) then
  // land them in ~/.codex, ~/.claude, … instead of whatever repo we're in.
  const cwd = scope === 'user' ? homeDir() : undefined;
  return { kind: 'exec', label, cmd: inst.cmd, args, cwd, timeout: 300_000 };
}

export function localSkillDir(skill: SkillEntry): string {
  return path.join(assetsDir(), 'skills', skill.id);
}

export function hasLocalSkill(skill: SkillEntry): boolean {
  return pathExists(localSkillDir(skill));
}

async function listFilesRecursive(dir: string): Promise<string[]> {
  const out: string[] = [];
  const entries = await fs.readdir(dir, { withFileTypes: true });
  for (const e of entries) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...(await listFilesRecursive(full)));
    else if (e.isFile()) out.push(full);
  }
  return out;
}

/**
 * Extensions that must be copied byte-for-byte. Reading these as utf8 (the
 * text FileAction path) silently corrupts them — e.g. the PNGs bundled with
 * the shadcn skill.
 */
const BINARY_EXTENSIONS = new Set([
  '.png', '.jpg', '.jpeg', '.gif', '.webp', '.ico', '.avif',
  '.pdf', '.zip', '.gz', '.tar',
  '.woff', '.woff2', '.ttf', '.otf', '.eot',
  '.mp3', '.mp4', '.webm', '.wasm',
]);

function isBinaryFile(file: string): boolean {
  return BINARY_EXTENSIONS.has(path.extname(file).toLowerCase());
}

/**
 * Copy a locally-bundled skill (assets/skills/<id>/) directly into the agent's
 * documented skills directory. Used both as the primary path for source:"local"
 * skills and as the fallback when `npx skills` fails. Returns one file action
 * per file, or a single warning note when there's nothing local to copy.
 */
export async function buildLocalSkillCopyActions(
  agent: AgentInfo,
  skill: SkillEntry,
  scope: SkillScope,
): Promise<Action[]> {
  const label = `Skill ${skill.skill} → ${agent.label} (local copy)`;
  const srcDir = localSkillDir(skill);
  if (!pathExists(srcDir)) {
    return [
      {
        kind: 'note',
        level: 'warn',
        label,
        message: `No local copy at assets/skills/${skill.id}/ — install this skill manually.`,
      },
    ];
  }
  const destBase = expandHome(scope === 'user' ? agent.skills.userDir : agent.skills.projectDir);
  const destDir = path.join(destBase, skill.skill);
  const files = await listFilesRecursive(srcDir);
  const actions: Action[] = [];
  for (const file of files) {
    const rel = path.relative(srcDir, file);
    const dest = path.join(destDir, rel);
    if (isBinaryFile(file)) {
      actions.push({ kind: 'copy', label: `copy ${rel} → ${agent.label}`, src: file, dest });
      continue;
    }
    const after = await fs.readFile(file, 'utf8');
    actions.push({
      kind: 'file',
      label: `copy ${rel} → ${agent.label}`,
      path: dest,
      before: await readText(dest),
      after,
    });
  }
  return actions;
}
