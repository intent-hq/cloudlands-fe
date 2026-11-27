/**
 * Intent apps (Labs) in main: the Labs switch, the app library of this
 * computer's daemon, the renderer requests, the open entry and the Intent OS
 * state file. `app-host.ts` owns the app windows.
 *
 * The library is daemon-global and owner-only (`docs/protocol/methods/apps.md`),
 * and the open entry (`intent --open-app <id>`, `intent://app/<id>`) names no
 * machine, so M1 uses the local daemon only, through main's pooled local
 * client. Main re-reads `app.list` on `app:installed`, `app:removed` and
 * `app:approval-changed` and on every reconnect, then pushes the whole state to
 * every Intent renderer (`intent-apps:changed`).
 */
import { spawn } from 'child_process';
import { ipcMain } from 'electron';
import { existsSync } from 'fs';
import { z } from 'zod';
import { IPC_CHANNELS } from '../../../shared/ipc-registry';
import { isIntentOs } from '../../../shared/intent-os';
import {
  INTENT_APP_FEATURES,
  INTENT_APPS_OFF_STATE,
  isIntentAppId,
  type IntentApp,
  type IntentAppInstallResult,
  type IntentAppsActionResult,
  type IntentAppsState,
} from '../../../shared/intent-apps/intent-apps-types';
import { Logger } from '../../../shared/logger';
import { getAppWindows } from '../../../main/offscreen-window';
import { createValidatedHandler } from '../../../main/ipc-validation-middleware';
import { getLocalPref, setLocalPref } from '../../../main/local-prefs';
import { getRendererWebContents } from '../../../main/window-backend';
import { createBackendSocket } from '../../backend/main/backend-connection';
import {
  requestRouted,
  TRANSFER_REQUEST_TIMEOUT_MS,
} from '../../backend/main/transfer-connections';
import {
  getLocalBackendClient,
  onBackendNotification,
  onBackendReconnected,
} from '../../backend/main/backend.ipc';
import type { JsonRpcNotification } from '../../backend/main/json-rpc-client';
import { IntentAppHost, type AppHostAdmin } from './app-host';
import { AppsStateFileWriter, intentStateDir } from './apps-state-file';

const logger = new Logger('IntentApps');
const CHANNELS = IPC_CHANNELS.INTENT_APPS;
const APP_EVENTS = ['app:installed', 'app:removed', 'app:approval-changed'] as const;

/** The Intent OS helper (intent-hq/intent-os): focuses an open app's window, else opens it. */
const INTENT_OS_APPS_HELPER = '/usr/lib/intent-os/apps';

let labEnabled = false;
let labLoaded: Promise<void> | null = null;
let state: IntentAppsState = { ...INTENT_APPS_OFF_STATE };
let host: IntentAppHost | null = null;
let stateFile: AppsStateFileWriter | null = null;
let subscriptionId: string | null = null;
let refreshing: Promise<void> | null = null;
let refreshAgain = false;
/** Open requests that came before the host was ready (cold start, early second instance). */
const pendingOpens: string[] = [];
let started = false;
const iconCache = new Map<string, string | null>();

const AppIdSchema = z.object({ appId: z.string().refine(isIntentAppId) });
const SetLabSchema = z.object({ enabled: z.boolean() });
const EmptySchema = z.object({}).optional();
const InstallSchema = z.object({
  workspaceId: z.string().min(1),
  path: z.string(),
  replace: z.boolean().optional(),
  dryRun: z.boolean().optional(),
});
const ApproveSchema = z.object({
  appId: z.string().refine(isIntentAppId),
  bundleHash: z.string().min(1),
  level: z.union([z.literal(1), z.literal(2), z.literal(3)]),
  features: z.array(z.enum(INTENT_APP_FEATURES as [string, ...string[]])),
});

function admin(): AppHostAdmin {
  return {
    // `app.readBundle` is a bulk transfer: on a remote transport it rides its own connection.
    request: (method, params, timeoutMs) =>
      requestRouted(
        getLocalBackendClient(),
        method,
        params,
        timeoutMs
          ? { timeoutMs }
          : method === 'app.readBundle'
            ? { timeoutMs: TRANSFER_REQUEST_TIMEOUT_MS }
            : undefined,
      ),
    ready: async () => {
      await getLocalBackendClient().readHelloSnapshot();
    },
    createSocket: () => createBackendSocket(getLocalBackendClient().getConfig()),
  };
}

function toActionError(error: unknown): { code: string; message: string } {
  const data = (error as { data?: { code?: unknown } } | null)?.data;
  const rpcCode = (error as { rpcCode?: unknown } | null)?.rpcCode;
  const code =
    typeof data?.code === 'string'
      ? data.code
      : rpcCode === -32003
        ? 'forbidden'
        : rpcCode === -32601
          ? 'not-supported'
          : 'internal';
  return { code, message: error instanceof Error ? error.message : String(error) };
}

async function action<T>(run: () => Promise<T>): Promise<IntentAppsActionResult<T>> {
  try {
    const result = await run();
    return { ok: true, result } as IntentAppsActionResult<T>;
  } catch (error) {
    return { ok: false, error: toActionError(error) };
  }
}

function broadcast(): void {
  for (const window of getAppWindows()) {
    if (window.isDestroyed()) continue;
    for (const renderer of getRendererWebContents(window)) {
      if (!renderer.isDestroyed()) renderer.send(CHANNELS.CHANGED, state);
    }
  }
}

function setState(next: IntentAppsState): void {
  state = next;
  broadcast();
  if (stateFile) {
    stateFile
      .write(labEnabled && next.supported ? next.apps : [])
      .catch((error: Error) =>
        logger.warn('Could not write the Intent OS apps state file', { error: error.message }),
      );
  }
}

function isSupported(hello: unknown): boolean {
  const capabilities = (hello as { server?: { capabilities?: Record<string, unknown> } } | null)
    ?.server?.capabilities;
  return capabilities?.intentApps === 1;
}

async function subscribe(): Promise<void> {
  const client = getLocalBackendClient();
  const result = await client.request<{ subscriptionId?: string }>('events.subscribe', {
    eventTypes: [...APP_EVENTS],
  });
  subscriptionId = result?.subscriptionId ?? null;
}

async function refreshNow(): Promise<void> {
  const openAppIds = host?.openAppIds() ?? [];
  if (!labEnabled) {
    setState({ ...INTENT_APPS_OFF_STATE, openAppIds });
    return;
  }
  const client = getLocalBackendClient();
  try {
    const hello = await client.readHelloSnapshot();
    if (!isSupported(hello)) {
      setState({ ...INTENT_APPS_OFF_STATE, labEnabled: true, openAppIds });
      return;
    }
    if (!subscriptionId) await subscribe();
    const { apps } = await client.request<{ apps: IntentApp[] }>('app.list', {});
    setState({ labEnabled: true, supported: true, apps, openAppIds, error: null });
  } catch (error) {
    setState({
      ...state,
      labEnabled: true,
      openAppIds,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

/** Single-flight and coalesced: a refresh during a refresh runs once more after it. */
function refresh(): Promise<void> {
  if (refreshing) {
    refreshAgain = true;
    return refreshing;
  }
  refreshing = (async () => {
    try {
      do {
        refreshAgain = false;
        await refreshNow();
      } while (refreshAgain);
    } finally {
      refreshing = null;
    }
  })();
  return refreshing;
}

function onNotification(notification: JsonRpcNotification): void {
  if (notification.method !== 'events.event') return;
  const params = notification.params as {
    subscriptionId?: unknown;
    event?: { type?: unknown; data?: { appId?: unknown } };
  } | null;
  const type = params?.event?.type;
  if (typeof type !== 'string' || !(APP_EVENTS as readonly string[]).includes(type)) return;
  if (subscriptionId && params?.subscriptionId !== subscriptionId) return;
  const appId = params?.event?.data?.appId;
  if (typeof appId === 'string') iconCache.delete(appId);
  if (type === 'app:removed' && typeof appId === 'string') void host?.clearAppStorage(appId);
  void refresh();
}

async function loadLab(): Promise<void> {
  try {
    labEnabled = (await getLocalPref<unknown>('intentAppsLabEnabled')) === true;
  } catch {
    labEnabled = false;
  }
}

function requireLab(): void {
  if (!labEnabled)
    throw Object.assign(new Error('Intent apps are off in Labs'), { data: { code: 'lab-off' } });
}

/**
 * Open from the open entry (`--open-app`, `intent://app/<id>`) or a renderer.
 * Before the host is ready, the request waits for it.
 */
export function requestOpenApp(appId: string): void {
  if (!isIntentAppId(appId)) return;
  if (!started || !labLoaded) {
    pendingOpens.push(appId);
    return;
  }
  void labLoaded.then(async () => {
    if (!labEnabled || !host) {
      logger.info('Ignored an open-app request: Intent apps are off in Labs', { appId });
      return;
    }
    try {
      await host.openApp(appId);
    } catch (error) {
      logger.warn('Could not open an app', { appId, error: toActionError(error) });
    }
  });
}

/**
 * The library's Open: on Intent OS the helper does it, so an open app's sway
 * workspace gets focus the same way the top bar does it; elsewhere the host.
 */
async function openFromRenderer(appId: string): Promise<void> {
  requireLab();
  if (isIntentOs() && existsSync(INTENT_OS_APPS_HELPER)) {
    const child = spawn(INTENT_OS_APPS_HELPER, ['open', appId], {
      detached: true,
      stdio: 'ignore',
    });
    child.on('error', (error) => {
      logger.warn('The Intent OS apps helper failed; opening directly', { error: error.message });
      void host?.openApp(appId).catch(() => {});
    });
    child.unref();
    return;
  }
  if (!host) throw new Error('The app host is not ready');
  await host.openApp(appId);
}

async function readIcon(appId: string): Promise<string | null> {
  const app = state.apps.find((candidate) => candidate.id === appId);
  if (!app?.icon || !host) return null;
  const key = `${appId}@${app.bundleHash}`;
  if (iconCache.has(key)) return iconCache.get(key) ?? null;
  try {
    const file = await host.readBundle(appId, app.icon, app.bundleHash);
    const url = file.mimeType.startsWith('image/')
      ? `data:${file.mimeType};base64,${file.contentBase64}`
      : null;
    iconCache.set(key, url);
    return url;
  } catch {
    return null;
  }
}

export function setupIntentAppsIPC(): void {
  if (started) return;
  started = true;
  labLoaded = loadLab();
  host = new IntentAppHost(admin(), () => {
    const openAppIds = host?.openAppIds() ?? [];
    setState({ ...state, openAppIds });
  });
  host.registerIpc();
  if (isIntentOs()) {
    stateFile = new AppsStateFileWriter(intentStateDir(), async (app) => {
      if (!app.icon || !host) return null;
      const file = await host.readBundle(app.id, app.icon, app.bundleHash);
      return Buffer.from(file.contentBase64, 'base64');
    });
  }

  ipcMain.handle(
    CHANNELS.GET_STATE,
    createValidatedHandler(
      EmptySchema,
      async () => {
        await labLoaded;
        return state;
      },
      CHANNELS.GET_STATE,
    ),
  );
  ipcMain.handle(
    CHANNELS.REFRESH,
    createValidatedHandler(
      EmptySchema,
      async () => {
        await labLoaded;
        await refresh();
        return state;
      },
      CHANNELS.REFRESH,
    ),
  );
  ipcMain.handle(
    CHANNELS.SET_LAB,
    createValidatedHandler(
      SetLabSchema,
      async (_event, { enabled }) => {
        await labLoaded;
        await setLocalPref('intentAppsLabEnabled', enabled);
        labEnabled = enabled;
        logger.info('Intent apps (Labs) changed', { enabled });
        if (!enabled) host?.closeAll('closed');
        await refresh();
        return state;
      },
      CHANNELS.SET_LAB,
    ),
  );
  ipcMain.handle(
    CHANNELS.INSTALL,
    createValidatedHandler(
      InstallSchema,
      async (_event, params) => {
        return action(async () => {
          requireLab();
          const result = await getLocalBackendClient().request<IntentAppInstallResult>(
            'app.install',
            params,
            { timeoutMs: 120_000 },
          );
          if (!params.dryRun) void refresh();
          return result;
        });
      },
      CHANNELS.INSTALL,
    ),
  );
  ipcMain.handle(
    CHANNELS.APPROVE,
    createValidatedHandler(
      ApproveSchema,
      async (_event, params) => {
        return action(async () => {
          requireLab();
          const result = await getLocalBackendClient().request<{ app: IntentApp }>(
            'app.approve',
            params,
          );
          void refresh();
          return result;
        });
      },
      CHANNELS.APPROVE,
    ),
  );
  ipcMain.handle(
    CHANNELS.REVOKE,
    createValidatedHandler(
      AppIdSchema,
      async (_event, { appId }) => {
        return action(async () => {
          requireLab();
          const result = await getLocalBackendClient().request('app.revoke', { appId });
          void refresh();
          return result;
        });
      },
      CHANNELS.REVOKE,
    ),
  );
  ipcMain.handle(
    CHANNELS.UNINSTALL,
    createValidatedHandler(
      AppIdSchema,
      async (_event, { appId }) => {
        return action(async () => {
          requireLab();
          const result = await getLocalBackendClient().request('app.uninstall', { appId });
          void refresh();
          return result;
        });
      },
      CHANNELS.UNINSTALL,
    ),
  );
  ipcMain.handle(
    CHANNELS.OPEN,
    createValidatedHandler(
      AppIdSchema,
      async (_event, { appId }) => {
        return action(async () => {
          await labLoaded;
          await openFromRenderer(appId);
          return undefined;
        });
      },
      CHANNELS.OPEN,
    ),
  );
  ipcMain.handle(
    CHANNELS.ICON,
    createValidatedHandler(
      AppIdSchema,
      async (_event, { appId }) => {
        return readIcon(appId);
      },
      CHANNELS.ICON,
    ),
  );

  onBackendNotification(onNotification);
  onBackendReconnected(() => {
    subscriptionId = null;
    void refresh();
  });

  void labLoaded.then(async () => {
    await refresh();
    for (const appId of pendingOpens.splice(0)) requestOpenApp(appId);
  });
}
