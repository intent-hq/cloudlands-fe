/**
 * Host-wide locks for verification checks that cannot share a host resource.
 *
 * `verify:changed` holds one while it runs a Playwright CT check (`ct-<port>`)
 * or the full Vitest fallback (`vitest-full`); the CT launcher
 * (run-ct-tests.mjs) takes the same `ct-<port>` lock for direct
 * `pnpm run test:ct` runs, so two worktrees on one CT_PORT never share a
 * component server (intent-hq/intent#4964). The CT runtime reuses any endpoint
 * that already answers on its port ("Dev Server is already running at …,
 * using it"), so the second run would otherwise mount against the other
 * tree's component registry.
 *
 * When a lock holder spawns a nested runner it exports `HELD_LOCK_ENV=<key>`;
 * the nested runner skips acquisition for that key instead of waiting on its
 * own parent.
 *
 * A lock is a directory holding one owner record named after the holder's
 * token (`owner-<token>.json`). It is created by renaming a pre-populated
 * sibling directory into place, so a held lock is never observed empty, and a
 * stale lock is reclaimed by unlinking the dead owner's record by name and
 * then `rmdir`-ing the directory: a contender that re-created the lock in the
 * meantime holds a differently named record, so the unlink misses it and the
 * non-recursive rmdir refuses its non-empty directory.
 */
import { createHash, randomUUID } from 'node:crypto';
import {
  mkdtempSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmdirSync,
  rmSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export const HELD_LOCK_ENV = 'INTENT_VERIFICATION_LOCK_HELD';
export const DEFAULT_CT_PORT = 3100;

const OWNER_RECORD = /^owner(-[^/]+)?\.json$/;
const LOCK_HELD_CODES = new Set(['EEXIST', 'ENOTEMPTY', 'EPERM']);

/**
 * Blank (empty or whitespace-only) CT_PORT is unset: playwright-ct.config.ts
 * derives its `ctPort` and `ctCacheDir` with the same rule (playwright/ct-port.ts),
 * so a blank value cannot yield lock `ct-0` next to the default port and cache.
 */
export function ctPort(env = process.env) {
  const raw = env.CT_PORT?.trim();
  return raw ? Number(raw) : DEFAULT_CT_PORT;
}

export function ctLockKey(env = process.env) {
  return `ct-${ctPort(env)}`;
}

export function processIsAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error?.code === 'EPERM';
  }
}

export function defaultLockPath(lockKey) {
  const key = createHash('sha256')
    .update(`cloudlands-fe-verification:${lockKey}`)
    .digest('hex')
    .slice(0, 12);
  return join(tmpdir(), `intent-${key}.lock`);
}

export function lockTimeout(lockKey, envValue) {
  const value = Number(envValue);
  const defaultMs = lockKey.startsWith('ct-') ? 240_000 : 120_000;
  return Number.isFinite(value) && value >= 0 ? Math.min(value, 300_000) : defaultMs;
}

function ownerRecordName(lockPath) {
  return readdirSync(lockPath).find((name) => OWNER_RECORD.test(name));
}

/** The owner record of the lock at `lockPath`, or `undefined` when it has none. */
export function lockOwner(lockPath) {
  const record = ownerRecordName(lockPath);
  return record ? JSON.parse(readFileSync(join(lockPath, record), 'utf8')) : undefined;
}

/**
 * Remove a stale lock without touching a lock re-created by another contender:
 * only the dead owner's record (`record`) is unlinked, and the directory goes
 * only while empty. Either step failing means someone else got there first.
 */
function reclaimStaleLock(lockPath, record) {
  if (record) {
    try {
      unlinkSync(join(lockPath, record));
    } catch (error) {
      if (error?.code === 'ENOENT') return;
      throw error;
    }
  }
  try {
    rmdirSync(lockPath);
  } catch (error) {
    if (!['ENOENT', 'ENOTEMPTY', 'EEXIST'].includes(error?.code)) throw error;
  }
}

export async function acquireVerificationLock(options = {}) {
  const lockPath = options.lockPath ?? defaultLockPath();
  const timeoutMs = options.timeoutMs ?? 30_000;
  const pollMs = options.pollMs ?? 250;
  const statLock = options.statLock ?? statSync;
  const token = randomUUID();
  const ownerRecord = `owner-${token}.json`;
  const started = Date.now();
  const staging = mkdtempSync(`${lockPath}.acquire-`);
  writeFileSync(
    join(staging, ownerRecord),
    JSON.stringify({ pid: process.pid, cwd: options.cwd ?? process.cwd(), token }),
  );
  try {
    while (true) {
      try {
        renameSync(staging, lockPath);
        return () => {
          try {
            unlinkSync(join(lockPath, ownerRecord));
            rmdirSync(lockPath);
          } catch {
            // A missing or replaced lock is not ours to remove.
          }
        };
      } catch (error) {
        if (!LOCK_HELD_CODES.has(error?.code)) throw error;
        let stale;
        let owner;
        let record;
        try {
          record = ownerRecordName(lockPath);
          if (!record) throw new Error('lock has no owner record');
          owner = JSON.parse(readFileSync(join(lockPath, record), 'utf8'));
          stale = !processIsAlive(owner.pid);
        } catch {
          try {
            stale = Date.now() - statLock(lockPath).mtimeMs > 4 * 60 * 60 * 1000;
          } catch (statError) {
            if (statError?.code === 'ENOENT') continue;
            throw statError;
          }
        }
        if (stale) {
          reclaimStaleLock(lockPath, record);
          continue;
        }
        if (Date.now() - started >= timeoutMs) {
          const waitedMs = Date.now() - started;
          const ownerDetails = owner
            ? `owner pid ${owner.pid} cwd ${owner.cwd ?? '<unknown>'}`
            : 'owner metadata unavailable';
          throw new Error(`verification lock ${lockPath}: ${ownerDetails}; waited ${waitedMs}ms`, {
            cause: error,
          });
        }
        await new Promise((done) => setTimeout(done, pollMs));
      }
    }
  } finally {
    rmSync(staging, { recursive: true, force: true });
  }
}
