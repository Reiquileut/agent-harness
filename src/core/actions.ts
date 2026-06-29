/**
 * actions — a tiny uniform model for "things the CLI will do".
 *
 * The translation modules (mcp/skills/plugins/templates) are pure planners:
 * they read current state and return an Action describing the intended change.
 * `runAction` is the single place that either previews it (--dry-run) or
 * applies it, so dry-run fidelity and atomic writes are guaranteed everywhere.
 */
import { execa } from 'execa';
import pc from 'picocolors';
import { atomicWrite, dryTag, isDryRun, log, tildify } from './fsx';

/** Write `after` to `path` (atomic). `before` is current content (null if new). */
export interface FileAction {
  kind: 'file';
  label: string;
  path: string;
  before: string | null;
  after: string;
}

/** Run an external command. */
export interface ExecAction {
  kind: 'exec';
  label: string;
  cmd: string;
  args: string[];
  cwd?: string;
  /** ms timeout (default 120000). */
  timeout?: number;
  /** When true, a non-zero exit is reported as a benign skip, not an error. */
  tolerant?: boolean;
}

/** Nothing to do (already configured, unsupported, etc.). */
export interface SkipAction {
  kind: 'skip';
  label: string;
  reason: string;
}

/** Surface information/warning without changing anything. */
export interface NoteAction {
  kind: 'note';
  label: string;
  message: string;
  level?: 'info' | 'warn';
}

export type Action = FileAction | ExecAction | SkipAction | NoteAction;

export type ApplyStatus = 'written' | 'noop' | 'ran' | 'skipped' | 'failed';
export interface ApplyResult {
  status: ApplyStatus;
  label: string;
  detail?: string;
}

const INDENT = '   ';

export async function runAction(action: Action): Promise<ApplyResult> {
  switch (action.kind) {
    case 'skip':
      log.plain(`${INDENT}${pc.dim('· skip')} ${action.label} — ${pc.dim(action.reason)}`);
      return { status: 'skipped', label: action.label, detail: action.reason };

    case 'note':
      if (action.level === 'warn') log.warn(`${INDENT}${action.message}`);
      else log.plain(`${INDENT}${pc.dim('·')} ${action.message}`);
      return { status: 'skipped', label: action.label, detail: action.message };

    case 'file': {
      if (action.before === action.after) {
        log.plain(`${INDENT}${pc.dim('· already set')} ${action.label} ${pc.dim(`(${tildify(action.path)})`)}`);
        return { status: 'noop', label: action.label };
      }
      const verb = action.before == null ? 'create' : 'update';
      if (isDryRun()) {
        log.plain(`${INDENT}${dryTag()}${verb} ${tildify(action.path)} ${pc.dim(`— ${action.label}`)}`);
        return { status: 'written', label: action.label, detail: `${verb} ${action.path}` };
      }
      await atomicWrite(action.path, action.after);
      log.success(`${INDENT}${verb === 'create' ? 'created' : 'updated'} ${tildify(action.path)} ${pc.dim(`— ${action.label}`)}`);
      return { status: 'written', label: action.label };
    }

    case 'exec': {
      const printable = `${action.cmd} ${action.args.join(' ')}`.trim();
      if (isDryRun()) {
        log.plain(`${INDENT}${dryTag()}run: ${pc.cyan(printable)} ${pc.dim(`— ${action.label}`)}`);
        return { status: 'ran', label: action.label, detail: printable };
      }
      try {
        await execa(action.cmd, action.args, {
          cwd: action.cwd,
          timeout: action.timeout ?? 120_000,
          stdin: 'ignore',
          stdout: 'pipe',
          stderr: 'pipe',
        });
        log.success(`${INDENT}${action.label}`);
        return { status: 'ran', label: action.label };
      } catch (err) {
        const first = (err instanceof Error ? err.message : String(err)).split('\n')[0] ?? '';
        if (action.tolerant) {
          log.plain(`${INDENT}${pc.dim('· skip')} ${action.label} ${pc.dim(`(${first})`)}`);
          return { status: 'skipped', label: action.label, detail: first };
        }
        log.error(`${action.label} failed: ${first}`);
        return { status: 'failed', label: action.label, detail: first };
      }
    }
  }
}

/** Run a sequence of actions, returning all results. */
export async function runActions(actions: Action[]): Promise<ApplyResult[]> {
  const results: ApplyResult[] = [];
  for (const a of actions) results.push(await runAction(a));
  return results;
}
