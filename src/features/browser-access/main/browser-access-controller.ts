/**
 * Owns the Browser access setting and server lifecycle. Electron-free so it
 * can be tested; `browser-access.ipc.ts` wires it to prefs, IPC and backends.
 *
 * Changes run one at a time. The access key is generated on first load and
 * read live by the server, so resetting it signs every browser out at once.
 */
import fs from 'node:fs';
import path from 'node:path';

import {
  BROWSER_ACCESS_DEFAULT_PORT,
  isValidBrowserAccessPort,
  type BrowserAccessError,
  type BrowserAccessState,
} from '../../../shared/types/browser-access';
import { generateAccessKey } from './browser-access-auth';
import type { BrowserAccessServer } from './browser-access-server';

export const PREF_ENABLED = 'browserAccess.enabled';
export const PREF_PORT = 'browserAccess.port';
export const PREF_ACCESS_KEY = 'browserAccess.accessKey';

interface BrowserAccessPrefs {
  get(key: string): Promise<unknown>;
  set(key: string, value: unknown): Promise<void>;
}

export interface BrowserAccessControllerDeps {
  readonly prefs: BrowserAccessPrefs;
  readonly webRoot: string;
  readonly createServer: (getAccessKey: () => string) => BrowserAccessServer;
  readonly log?: Pick<Console, 'info' | 'warn'>;
  /** Whether the experimental feature is unlocked; the server never runs otherwise. */
  readonly isAllowed?: () => boolean;
}

export interface BrowserAccessController {
  /** Read persisted settings and start the server when enabled. */
  load(): Promise<BrowserAccessState>;
  state(): BrowserAccessState;
  setEnabled(enabled: boolean): Promise<BrowserAccessState>;
  setPort(port: number): Promise<BrowserAccessState>;
  resetKey(): Promise<BrowserAccessState>;
  /** Stop serving without changing the setting (app shutdown). */
  shutdown(): Promise<void>;
}

function classifyListenError(error: unknown): BrowserAccessError {
  const code = (error as NodeJS.ErrnoException | null)?.code;
  if (code === 'EADDRINUSE') return 'port-in-use';
  if (code === 'EACCES') return 'permission-denied';
  return 'failed';
}

export function createBrowserAccessController(
  deps: BrowserAccessControllerDeps,
): BrowserAccessController {
  const log = deps.log ?? console;
  const isAllowed = deps.isAllowed ?? (() => true);
  let enabled = false;
  let port = BROWSER_ACCESS_DEFAULT_PORT;
  let accessKey = '';
  let error: BrowserAccessError | null = null;
  let server: BrowserAccessServer | null = null;
  let chain: Promise<unknown> = Promise.resolve();

  const available = (): boolean => fs.existsSync(path.join(deps.webRoot, 'index.html'));

  const state = (): BrowserAccessState => ({
    available: available(),
    enabled,
    port,
    running: server !== null,
    error,
    accessKey,
  });

  const stopServer = async (): Promise<void> => {
    const current = server;
    server = null;
    if (current) await current.close();
  };

  const startServer = async (): Promise<void> => {
    await stopServer();
    error = null;
    if (!available()) {
      error = 'unavailable';
      return;
    }
    const next = deps.createServer(() => accessKey);
    try {
      await next.listen(port);
      server = next;
      log.info(`[BrowserAccess] serving on 127.0.0.1:${port}`);
    } catch (listenError) {
      error = classifyListenError(listenError);
      log.warn(`[BrowserAccess] could not listen on 127.0.0.1:${port}`, listenError);
      await next.close().catch(() => {});
    }
  };

  const serialize = <T>(work: () => Promise<T>): Promise<T> => {
    const run = chain.then(work);
    chain = run.catch(() => {});
    return run;
  };

  return {
    load: () =>
      serialize(async () => {
        const [storedEnabled, storedPort, storedKey] = await Promise.all([
          deps.prefs.get(PREF_ENABLED),
          deps.prefs.get(PREF_PORT),
          deps.prefs.get(PREF_ACCESS_KEY),
        ]);
        enabled = storedEnabled === true;
        port = isValidBrowserAccessPort(storedPort) ? storedPort : BROWSER_ACCESS_DEFAULT_PORT;
        if (typeof storedKey === 'string' && storedKey.length >= 32) {
          accessKey = storedKey;
        } else {
          accessKey = generateAccessKey();
          await deps.prefs.set(PREF_ACCESS_KEY, accessKey);
        }
        if (enabled && isAllowed()) await startServer();
        return state();
      }),
    state,
    setEnabled: (next) =>
      serialize(async () => {
        if (next && !isAllowed()) throw new Error('browser access is not unlocked in this app');
        if (!next) await stopServer();
        await deps.prefs.set(PREF_ENABLED, next);
        enabled = next;
        if (next) await startServer();
        else error = null;
        return state();
      }),
    setPort: (next) =>
      serialize(async () => {
        if (!isValidBrowserAccessPort(next)) throw new Error(`invalid port: ${next}`);
        await deps.prefs.set(PREF_PORT, next);
        port = next;
        if (enabled && isAllowed()) await startServer();
        return state();
      }),
    resetKey: () =>
      serialize(async () => {
        const next = generateAccessKey();
        await deps.prefs.set(PREF_ACCESS_KEY, next);
        accessKey = next;
        server?.disconnectAll();
        return state();
      }),
    shutdown: () => serialize(stopServer),
  };
}
