#!/usr/bin/env node
// guard-no-private — fail when a git-tracked (or untracked, not ignored) path or file in this PUBLIC repo
// contains a token that belongs to the private overlay (client names, private
// hostnames, machine user names). Private skills/MCPs live in a separate private
// overlay repo; this guard is the regression test that keeps them out of here.
//
// Why hashes: the denylist itself would leak the names it protects, so the
// committed list (scripts/private-denylist.sha256) holds only
// sha256(salt + token). Tokens are whole words of [a-z0-9]{4,}, lowercased.
// AGENT_HARNESS_GUARD_LIST may point at a plaintext list (one token per line)
// kept OUTSIDE this repo — the private overlay keeps the source list there.
// Matches are reported by file:line and hash prefix, never by the token itself
// (CI logs of a public repo are public too).
//
// Limits (a deterrent, not secrecy): only whole [a-z0-9]{4,} words match, so a
// name glued inside a longer run ("acme2026") slips through; and the salt is
// public, so short names can be brute-forced from the digests — the names were
// already public in old history; the guard exists to stop NEW content leaking.
//
// Usage:
//   node scripts/guard-no-private.mjs [--root <repo>]        # check (exit 1 on a match)
//   node scripts/guard-no-private.mjs --hash-list <file>     # print salted hashes for a plaintext list
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const DENYLIST_FILE = path.join(path.dirname(fileURLToPath(import.meta.url)), 'private-denylist.sha256');
const TOKEN_PATTERN = /[a-z0-9]{4,}/g;
const MAX_SCANNED_BYTES = 5 * 1024 * 1024;

/** Read `salt <hex>` + digest lines. Example line 1: `salt 3f9a…`. */
function readDenylistFile(file) {
  const lines = readFileSync(file, 'utf8').split(/\r?\n/).map((l) => l.trim()).filter((l) => l && !l.startsWith('#'));
  const saltLine = lines.find((l) => l.startsWith('salt '));
  if (!saltLine) throw new Error(`${file}: missing "salt <hex>" line (expected it before the digests)`);
  return { salt: saltLine.slice(5).trim(), digests: new Set(lines.filter((l) => /^[0-9a-f]{64}$/.test(l))) };
}

function hashGuardToken(salt, token) {
  return createHash('sha256').update(`${salt}${token}`).digest('hex');
}

/** Plaintext list → tokens; each line must be ONE token, or common sub-words would false-positive. */
function readPlaintextGuardList(file) {
  const lines = readFileSync(file, 'utf8').split(/\r?\n/).map((l) => l.trim().toLowerCase());
  return lines.filter((l) => l && !l.startsWith('#')).map((token, index) => {
    if (/^[a-z0-9]{4,}$/.test(token)) return token;
    throw new Error(`${file}: entry #${index + 1} is not a single [a-z0-9]{4,} token (split it into distinctive words)`);
  });
}

function loadGuardDigests() {
  const { salt, digests } = readDenylistFile(DENYLIST_FILE);
  const extra = process.env.AGENT_HARNESS_GUARD_LIST;
  if (extra) for (const token of readPlaintextGuardList(extra)) digests.add(hashGuardToken(salt, token));
  return { salt, digests };
}

function trackedFiles(root) {
  const out = execFileSync('git', ['-C', root, 'ls-files', '-z', '--cached', '--others', '--exclude-standard'], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  return out.split('\0').filter(Boolean);
}

/** Text content to scan, or '' for binaries / files deleted from the worktree; null when too big to scan. */
function readScannableText(file) {
  try {
    if (statSync(file).size > MAX_SCANNED_BYTES) return null;
    const bytes = readFileSync(file);
    return bytes.subarray(0, 8192).includes(0) ? '' : bytes.toString('utf8');
  } catch {
    return '';
  }
}

/** First matching token's hash in `text`, using a memo so each token is hashed once. */
function firstGuardHit(text, guard, memo) {
  for (const token of text.toLowerCase().match(TOKEN_PATTERN) ?? []) {
    if (!memo.has(token)) memo.set(token, guard.digests.has(hashGuardToken(guard.salt, token)) ? hashGuardToken(guard.salt, token) : null);
    if (memo.get(token)) return memo.get(token);
  }
  return null;
}

/** Report hits for one tracked file: its path, then each line. */
function scanTrackedFile(root, rel, guard, memo) {
  const hits = [];
  const pathHit = firstGuardHit(rel, guard, memo);
  if (pathHit) hits.push(`${rel} (path) matches a private token (sha256 ${pathHit.slice(0, 12)}…)`);
  const text = readScannableText(path.join(root, rel));
  if (text === null) {
    console.warn(`guard: ${rel} is larger than ${MAX_SCANNED_BYTES} bytes — not scanned, review it by hand`);
    return hits;
  }
  text.split('\n').forEach((line, i) => {
    const hit = firstGuardHit(line, guard, memo);
    if (hit) hits.push(`${rel}:${i + 1} matches a private token (sha256 ${hit.slice(0, 12)}…)`);
  });
  return hits;
}

function runGuardCheck(root) {
  const guard = loadGuardDigests();
  const memo = new Map();
  const hits = trackedFiles(root).flatMap((rel) => scanTrackedFile(root, rel, guard, memo));
  for (const hit of hits) console.error(`guard: ${hit}`);
  console.log(hits.length ? `guard: ${hits.length} private token match(es) — move that content to the private overlay` : 'guard: no private tokens in tracked files');
  return hits.length ? 1 : 0;
}

function runHashList(file) {
  const { salt } = readDenylistFile(DENYLIST_FILE);
  for (const token of readPlaintextGuardList(file)) console.log(hashGuardToken(salt, token));
  return 0;
}

function argValue(flag) {
  const at = process.argv.indexOf(flag);
  return at === -1 ? undefined : process.argv[at + 1];
}

try {
  const listFile = argValue('--hash-list');
  process.exitCode = listFile ? runHashList(listFile) : runGuardCheck(path.resolve(argValue('--root') ?? process.cwd()));
} catch (err) {
  console.error(`guard: ${err instanceof Error ? err.message : String(err)}`);
  process.exitCode = 2;
}
