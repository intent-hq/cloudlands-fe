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
  type BrowserAccessSignInCode,
  type BrowserAccessState,
} from '../../../shared/types/browser-access';
import { generateAccessKey, preferredPageOrigin } from './browser-access-auth';
import { LOGIN_PATH, type BrowserAccessServer } from './browser-access-server';
import {
  createMemorySignInStore,
  createSignInCodes,
  parseSignInState,
  signInLink,
  type SignInCodeResult,
} from './browser-access-sign-in-codes';

export const PREF_ENABLED = 'browserAccess.enabled';
export const PREF_PORT = 'browserAccess.port';
export const PREF_ACCESS_KEY = 'browserAccess.accessKey';
/** Page origin last seen on a signed-in page load, for sign-in links. */
export const PREF_PAGE_ORIGIN = 'browserAccess.pageOrigin';

interface BrowserAccessPrefs {
  get(key: string): Promise<unknown>;
  set(key: string, value: unknown): Promise<void>;
}

export interface BrowserAccessControllerDeps {
  readonly prefs: BrowserAccessPrefs;
  readonly webRoot: string;
  readonly createServer: (
    getAccessKey: () => string,
    signIn: {
      readonly consumeSignInCode: (code: string) => Promise<SignInCodeResult>;
      readonly onPageOrigin: (origin: string) => void;
    },
  ) => BrowserAccessServer;
  readonly log?: Pick<Console, 'info' | 'warn'>;
}

export interface BrowserAccessController {
  /** Read persisted settings and start the server when enabled. */
  load(): Promise<BrowserAccessState>;
  state(): BrowserAccessState;
  setEnabled(enabled: boolean): Promise<BrowserAccessState>;
  setPort(port: number): Promise<BrowserAccessState>;
  resetKey(): Promise<BrowserAccessState>;
  /** A single-use sign-in code (kept in memory) plus its link when an origin is known. */
  createSignInCode(): Promise<BrowserAccessSignInCode>;
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
  let enabled = false;
  let port = BROWSER_ACCESS_DEFAULT_PORT;
  let accessKey = '';
  let error: BrowserAccessError | null = null;
  let server: BrowserAccessServer | null = null;
  let chain: Promise<unknown> = Promise.resolve();
  const signInStore = createMemorySignInStore();
  const codes = createSignInCodes({ store: signInStore, getAccessKey: () => accessKey });

  const recordPageOrigin = (origin: string): void => {
    void (async () => {
      const previous = await codes.pageOrigin();
      const next = preferredPageOrigin(previous, origin);
      if (next === previous) return;
      await codes.setPageOrigin(next);
      await deps.prefs.set(PREF_PAGE_ORIGIN, next);
    })().catch((saveError: unknown) =>
      log.warn('[BrowserAccess] could not save the page origin', saveError),
    );
  };

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
    const next = deps.createServer(() => accessKey, {
      consumeSignInCode: (code) => codes.consume(code),
      onPageOrigin: recordPageOrigin,
    });
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
        const [storedEnabled, storedPort, storedKey, storedOrigin] = await Promise.all([
          deps.prefs.get(PREF_ENABLED),
          deps.prefs.get(PREF_PORT),
          deps.prefs.get(PREF_ACCESS_KEY),
          deps.prefs.get(PREF_PAGE_ORIGIN),
        ]);
        await codes.setPageOrigin(parseSignInState({ pageOrigin: storedOrigin }).pageOrigin);
        enabled = storedEnabled === true;
        port = isValidBrowserAccessPort(storedPort) ? storedPort : BROWSER_ACCESS_DEFAULT_PORT;
        if (typeof storedKey === 'string' && storedKey.length >= 32) {
          accessKey = storedKey;
        } else {
          accessKey = generateAccessKey();
          await deps.prefs.set(PREF_ACCESS_KEY, accessKey);
        }
        if (enabled) await startServer();
        return state();
      }),
    state,
    setEnabled: (next) =>
      serialize(async () => {
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
        if (enabled) await startServer();
        return state();
      }),
    resetKey: () =>
      serialize(async () => {
        const next = generateAccessKey();
        await deps.prefs.set(PREF_ACCESS_KEY, next);
        accessKey = next;
        await codes.clear();
        server?.disconnectAll();
        return state();
      }),
    createSignInCode: () =>
      serialize(async () => {
        if (!server) throw new Error('Browser access is not running');
        const created = await codes.create();
        return { ...created, link: signInLink(await codes.pageOrigin(), LOGIN_PATH, created.code) };
      }),
    shutdown: () => serialize(stopServer),
  };
}
