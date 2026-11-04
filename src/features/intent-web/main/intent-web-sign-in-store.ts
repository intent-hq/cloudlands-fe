/**
 * Sign-in codes and the last page origin for intent-web, shared between the
 * running server and `intent-web link` in another process through
 * `sign-in.json` (mode 0600) in the data directory.
 *
 * Every change runs under an exclusive lock file (`sign-in.json.lock`, created
 * with O_EXCL) and lands with a same-directory rename, so a code can be
 * consumed only once even when two processes race, and readers never see a
 * torn file. A lock left by a crashed process is taken over once it is older
 * than `staleLockMs`; every critical section is a few file operations.
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

  const acquire = async (): Promise<void> => {
    const deadline = Date.now() + lockTimeoutMs;
    for (;;) {
      try {
        const handle = await fs.promises.open(lockFile, 'wx', 0o600);
        await handle.writeFile(String(process.pid));
        await handle.close();
        return;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
      }
      try {
        const { mtimeMs } = await fs.promises.stat(lockFile);
        if (Date.now() - mtimeMs > staleLockMs) {
          await fs.promises.rm(lockFile, { force: true });
          continue;
        }
      } catch {
        continue;
      }
      if (Date.now() > deadline) throw new Error(`Timed out waiting for ${lockFile}`);
      await sleep(10 + Math.random() * 20);
    }
  };

  return {
    read,
    update: <T>(change: (state: SignInState) => { state: SignInState; result: T }) => {
      const run = chain.then(async () => {
        await acquire();
        try {
          const next = change(await read());
          await write(next.state);
          return next.result;
        } finally {
          await fs.promises.rm(lockFile, { force: true });
        }
      });
      chain = run.catch(() => {});
      return run;
    },
  };
}
