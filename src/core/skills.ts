/**
 * skills — install agent skills by delegating to the `skills` CLI (Vercel Labs),
 * which already maps each agent's install path. We orchestrate the call and
 * keep a direct-copy fallback from assets/skills/<id>/ for when the CLI is
 * unavailable or installs to the wrong place (see plan's drift TODO).
 */
import { promises as fs } from 'node:fs';
import path from 'node:path';
import type { Action } from './actions';
import type { AgentInfo } from './agents';
import { assetsDir } from './catalog';
import type { SkillEntry } from './catalog';
import { expandHome, pathExists, readText } from './fsx';

export type SkillScope = 'user' | 'project';

/** Skills with source "local" are bundled in assets/skills/<id>/ and copied directly. */
export function isLocalSkill(skill: SkillEntry): boolean {
  return skill.source === 'local';
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
