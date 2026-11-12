/**
 * Sign-in codes and the last page origin for intent-web, shared between the
 * running server and `intent-web link` in another process through
 * `sign-in.json` (mode 0600) in the data directory.
 *
 * Every change runs under an exclusive lock file (`sign-in.json.lock`, created
 * with O_EXCL and holding a random token) and lands with a same-directory
 * rename, so a code can be consumed only once even when two processes race,
 * and readers never see a torn file. A holder removes the lock only while it
 * still holds its token. A lock left by a crashed process is taken over once
 * it is older than `staleLockMs` (every critical section is a few file
 * operations), by renaming it aside so only one waiter wins.
 *
 * `lockTimeoutMs` bounds how long one holder may keep the lock, not a waiter's
 * total wait: the deadline restarts whenever the lock changes hands, so many
 * waiters on a slow machine queue up instead of timing out while the lock is
 * making progress.
 *
 * A lock's age is measured on the filesystem's clock, not this process's: its
 * mtime is compared with the mtime of a probe file this waiter writes beside
 * it. Subtracting a file timestamp from `Date.now()` mixes two clocks, so a
 * process clock running ahead of the filesystem's would take over a live
 * holder's lock (two holders, so a single-use code could be consumed twice),
 * and one running behind would wait out a crashed holder's lock until it timed
 * out.
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

import {
  EMPTY_SIGN_IN_STATE,
  parseSignInState,
  type SignInState,
  type SignInStore,
} from '../../browser-access/main/browser-access-sign-in-codes';

export const SIGN_IN_FILE = 'sign-in.json';

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export function createFileSignInStore(
  dataDir: string,
  options: { lockTimeoutMs?: number; staleLockMs?: number } = {},
): SignInStore {
  const file = path.join(dataDir, SIGN_IN_FILE);
  const lockFile = `${file}.lock`;
  const lockTimeoutMs = options.lockTimeoutMs ?? 5000;
  const staleLockMs = options.staleLockMs ?? 10_000;
  let chain: Promise<unknown> = Promise.resolve();

  const read = async (): Promise<SignInState> => {
    try {
      return parseSignInState(JSON.parse(await fs.promises.readFile(file, 'utf8')));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return EMPTY_SIGN_IN_STATE;
      // A damaged file holds nothing worth keeping: codes expire in minutes.
      if (error instanceof SyntaxError) return EMPTY_SIGN_IN_STATE;
      throw error;
    }
  };

  const write = async (state: SignInState): Promise<void> => {
    const temporary = `${file}.${crypto.randomUUID()}.tmp`;
    try {
      await fs.promises.writeFile(temporary, JSON.stringify(state), { mode: 0o600, flag: 'wx' });
      await fs.promises.rename(temporary, file);
    } finally {
      await fs.promises.rm(temporary, { force: true });
    }
  };

  /**
   * The filesystem clock's reading minus `Date.now()`, measured once per
   * contended acquire with a probe file in the data directory.
   */
  const filesystemClockOffset = async (): Promise<number> => {
    const probe = `${lockFile}.${crypto.randomUUID()}.probe`;
    try {
      const handle = await fs.promises.open(probe, 'wx', 0o600);
      try {
        const before = Date.now();
        await handle.writeFile('probe');
        const { mtimeMs } = await handle.stat();
        return mtimeMs - (before + Date.now()) / 2;
      } finally {
        await handle.close();
      }
    } finally {
      await fs.promises.rm(probe, { force: true });
    }
  };

  /** Take the lock; resolves with this holder's token. */
  const acquire = async (): Promise<string> => {
    const token = crypto.randomUUID();
    let deadline = Date.now() + lockTimeoutMs;
    let clockOffset: number | undefined;
    let holder: string | undefined;
    for (;;) {
      try {
        await fs.promises.writeFile(lockFile, token, { mode: 0o600, flag: 'wx' });
        return token;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
      }
      clockOffset ??= await filesystemClockOffset().catch(() => 0);
      const seen = await takeOverIfStale(clockOffset);
      if (seen !== holder) {
        holder = seen;
        deadline = Date.now() + lockTimeoutMs;
      } else if (Date.now() > deadline) {
        throw new Error(`Timed out waiting for ${lockFile}`);
      }
      await sleep(10 + Math.random() * 20);
    }
  };

  /**
   * Remove a lock left by a crashed holder. The lock is renamed aside (atomic,
   * so only one waiter gets a given file) and removed only if it is still the
   * stale one this waiter inspected; a fresh lock taken meanwhile by another
   * process is put back. Resolves with the token seen in the lock, or
   * undefined when there is no readable lock.
   */
  const takeOverIfStale = async (clockOffset: number): Promise<string | undefined> => {
    // One handle, so the age and the token describe the same file even if
    // another waiter replaces the lock in between.
    let seen: string;
    let stale: boolean;
    try {
      const handle = await fs.promises.open(lockFile, 'r');
      try {
        const { mtimeMs } = await handle.stat();
        stale = Date.now() + clockOffset - mtimeMs > staleLockMs;
        seen = await handle.readFile('utf8');
      } finally {
        await handle.close();
      }
    } catch {
      return undefined;
    }
    if (!stale) return seen;
    const aside = `${lockFile}.${crypto.randomUUID()}.stale`;
    try {
      await fs.promises.rename(lockFile, aside);
    } catch {
      return seen;
    }
    try {
      if ((await fs.promises.readFile(aside, 'utf8')) !== seen) {
        // Another process took the lock between our checks: restore it.
        // `link` fails rather than overwrite if a third process created a
        // lock in this gap; that narrow case can still yield two holders.
        await fs.promises.link(aside, lockFile).catch(() => {});
      }
    } finally {
      await fs.promises.rm(aside, { force: true });
    }
    return seen;
  };

  /** Release the lock only if it is still ours. */
  const release = async (token: string): Promise<void> => {
    try {
      if ((await fs.promises.readFile(lockFile, 'utf8')) === token)
        await fs.promises.rm(lockFile, { force: true });
    } catch {
      // Already gone.
    }
  };

  return {
    read,
    update: <T>(change: (state: SignInState) => { state: SignInState; result: T }) => {
      const run = chain.then(async () => {
        const token = await acquire();
        try {
          const next = change(await read());
          await write(next.state);
          return next.result;
        } finally {
          await release(token);
        }
      });
      chain = run.catch(() => {});
      return run;
    },
  };
}
