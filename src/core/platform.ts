/**
 * platform — which OS the catalog is being installed on, so Windows-only items
 * (Pencil's .exe MCP, Codex `[windows]` sandbox tables, `Bash(powershell:*)`)
 * are skipped with a reason on Linux/macOS instead of writing dead config.
 *
 * `AGENT_HARNESS_PLATFORM` overrides the detected value so the e2e suite can
 * exercise the Linux and Windows branches on every CI OS. `commandOnPath`
 * (agents.ts) deliberately keeps using the real `process.platform`: PATH
 * parsing must follow the actual OS, not the simulated one.
 */
import process from 'node:process';
import { z } from 'zod';

export const PLATFORM_IDS = ['win32', 'linux', 'darwin'] as const;
export type Platform = (typeof PLATFORM_IDS)[number];

/** Catalog field: optional allowlist of platforms (omit = every platform). */
export const PlatformsSchema = z.array(z.enum(PLATFORM_IDS)).min(1).optional();

function isPlatform(value: string): value is Platform {
  return (PLATFORM_IDS as readonly string[]).includes(value);
}

/**
 * The platform to install for. Example: `currentPlatform({ AGENT_HARNESS_PLATFORM: 'linux' })` → 'linux'.
 * Throws when the override is not one of PLATFORM_IDS.
 */
export function currentPlatform(env: NodeJS.ProcessEnv = process.env): Platform {
  const override = env.AGENT_HARNESS_PLATFORM;
  if (override === undefined || override === '') return normalizeHostPlatform(process.platform);
  if (isPlatform(override)) return override;
  throw new Error(
    `AGENT_HARNESS_PLATFORM=${JSON.stringify(override)} is invalid; expected one of ${PLATFORM_IDS.join(', ')}`,
  );
}

/** Map Node's platform to ours; BSDs and friends behave like linux for our purposes. */
function normalizeHostPlatform(host: NodeJS.Platform): Platform {
  return isPlatform(host) ? host : 'linux';
}

/** True when an optional platforms allowlist permits the current platform. Example: `platformAllows(['win32'])`. */
export function platformAllows(platforms: readonly Platform[] | undefined, current: Platform = currentPlatform()): boolean {
  return !platforms || platforms.includes(current);
}

/** Human reason for a platform skip. Example: `only on win32 (current: linux)`. */
export function platformSkipReason(platforms: readonly Platform[] | undefined, current: Platform = currentPlatform()): string {
  return `only on ${(platforms ?? []).join('/')} (current: ${current})`;
}
