/**
 * Electron wiring for Browser access: prefs, IPC handlers, and the bridge to
 * every backend this app knows (the local daemon and saved remote
 * connections, via the same config and transport desktop windows use).
 */
import path from 'node:path';

import { app, ipcMain } from 'electron';

import { BROWSER_ACCESS_CHANNELS } from '../../../shared/ipc/channels';
import { m } from '../../../shared/paraglide/messages.js';
import type { BrowserAccessState } from '../../../shared/types/browser-access';
import {
  BrowserAccessSetEnabledSchema,
  BrowserAccessSetPortSchema,
  EmptySchema,
} from '../../../main/ipc-schemas';
import { createSafeValidatedHandler } from '../../../main/ipc-validation-middleware';
import { getLocalPref, setLocalPref } from '../../../main/local-prefs';
import { getMainActiveLocale } from '../../../main/main-locale';
import { Logger } from '../../../shared/logger';
import { createBackendSocket } from '../../backend/main/backend-connection';
import {
  buildConfigForConnection,
  listConnectionsForBrowserAccess,
} from '../../backend/main/backend.ipc';
import {
  createBrowserAccessController,
  type BrowserAccessController,
} from './browser-access-controller';
import { createBrowserAccessServer } from './browser-access-server';

const logger = new Logger('BrowserAccess');

let controller: BrowserAccessController | null = null;

/** The web build ships unpacked next to the renderer bundle. */
function resolveWebRoot(): string {
  const appPath = app.getAppPath().replace('app.asar', 'app.asar.unpacked');
  return path.join(appPath, 'dist', 'web');
}

function createController(): BrowserAccessController {
  const log = {
    info: (message: string) => logger.info(message),
    warn: (message: string, detail?: unknown) => logger.warn(message, detail),
  };
  return createBrowserAccessController({
    prefs: { get: (key) => getLocalPref(key), set: (key, value) => setLocalPref(key, value) },
    webRoot: resolveWebRoot(),
    log,
    createServer: (getAccessKey) =>
      createBrowserAccessServer({
        webRoot: resolveWebRoot(),
        getAccessKey,
        log,
        listConnections: (backendId) => listConnectionsForBrowserAccess(backendId),
        openUpstream: async (connectionId) => {
          const { config } = await buildConfigForConnection(connectionId);
          return createBackendSocket(config);
        },
        loginText: () => ({
          lang: getMainActiveLocale(),
          title: m.browserAccess_login_title(),
          prompt: m.browserAccess_login_prompt(),
          keyLabel: m.browserAccess_login_key_label(),
          submit: m.browserAccess_login_submit_label(),
          invalidKey: m.browserAccess_login_invalidKey_error(),
          tooManyAttempts: m.browserAccess_login_tooManyAttempts_error(),
        }),
      }),
  });
}

/** Register IPC and start serving when the setting is on. */
export async function setupBrowserAccess(): Promise<void> {
  const current = createController();
  controller = current;
  const handle = <T>(
    channel: string,
    schema: Parameters<typeof createSafeValidatedHandler<T>>[0],
    run: (request: T) => Promise<BrowserAccessState>,
  ): void => {
    ipcMain.handle(
      channel,
      createSafeValidatedHandler(schema, async (_event, request) => run(request), channel),
    );
  };
  handle(BROWSER_ACCESS_CHANNELS.GET_STATE, EmptySchema, async () => current.state());
  handle(BROWSER_ACCESS_CHANNELS.SET_ENABLED, BrowserAccessSetEnabledSchema, (request) =>
    current.setEnabled(request.enabled),
  );
  handle(BROWSER_ACCESS_CHANNELS.SET_PORT, BrowserAccessSetPortSchema, (request) =>
    current.setPort(request.port),
  );
  handle(BROWSER_ACCESS_CHANNELS.RESET_KEY, EmptySchema, () => current.resetKey());
  try {
    await current.load();
  } catch (error) {
    logger.warn('Failed to load browser access settings', error);
  }
}

/** Stop serving during app shutdown (the setting is kept). */
export async function shutdownBrowserAccess(): Promise<void> {
  await controller?.shutdown();
}
