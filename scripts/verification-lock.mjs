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
 */
import { createHash, randomUUID } from 'node:crypto';
import { mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export const HELD_LOCK_ENV = 'INTENT_VERIFICATION_LOCK_HELD';
export const DEFAULT_CT_PORT = 3100;

export function ctPort(env = process.env) {
  return env.CT_PORT ? Number(env.CT_PORT) : DEFAULT_CT_PORT;
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

export async function acquireVerificationLock(options = {}) {
  const lockPath = options.lockPath ?? defaultLockPath();
  const timeoutMs = options.timeoutMs ?? 30_000;
  const pollMs = options.pollMs ?? 250;
  const statLock = options.statLock ?? statSync;
  const token = randomUUID();
  const started = Date.now();
  while (true) {
    try {
      mkdirSync(lockPath);
      writeFileSync(
        join(lockPath, 'owner.json'),
        JSON.stringify({ pid: process.pid, cwd: options.cwd ?? process.cwd(), token }),
      );
      return () => {
        try {
          const owner = JSON.parse(readFileSync(join(lockPath, 'owner.json'), 'utf8'));
          if (owner.token === token) rmSync(lockPath, { recursive: true, force: true });
        } catch {
          // A missing or replaced lock is not ours to remove.
        }
      };
    } catch (error) {
      if (error?.code !== 'EEXIST') throw error;
      let stale;
      let owner;
      try {
        owner = JSON.parse(readFileSync(join(lockPath, 'owner.json'), 'utf8'));
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
        rmSync(lockPath, { recursive: true, force: true });
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
}
