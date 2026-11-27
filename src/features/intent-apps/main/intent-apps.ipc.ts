/**
 * Intent apps (Labs) in main: the Labs switch, the app library of each
 * machine, the renderer requests, the open entry and the Intent OS state file.
 * `app-host.ts` owns the app windows.
 *
 * The library is daemon-global and owner-only (`docs/protocol/methods/apps.md`),
 * so each machine has its own. A window shows, installs into and opens from the
 * library of the machine it is connected to: every renderer request goes to the
 * daemon of the sender's machine (`getBackendIdForWebContents`), and each
 * machine has its own app host, so its app windows attach to that daemon (UDS
 * for this computer, WSS with the owner token for a remote machine). Main
 * starts to follow a machine's library when one of its renderers first reads
 * the state, and re-reads `app.list` on `app:installed`, `app:removed` and
 * `app:approval-changed` and on every reconnect of that machine, then pushes
 * the whole state to that machine's renderers (`intent-apps:changed`).
 *
 * The open entry (`intent --open-app <id>`, `intent://app/<id>`) names no
 * machine: `open-app-target.ts` picks one. The Intent OS state file lists this
 * computer's apps only.
 */
import { spawn } from 'child_process';
import { createHash } from 'crypto';
import { BrowserWindow, ipcMain, type IpcMainInvokeEvent } from 'electron';
import { existsSync } from 'fs';
import path from 'path';
import { z } from 'zod';
import { IPC_CHANNELS } from '../../../shared/ipc-registry';
import { isIntentOs } from '../../../shared/intent-os';
import {
  INTENT_APP_FEATURES,
  INTENT_APPS_OFF_STATE,
  isIntentAppId,
  type IntentApp,
  type IntentAppsActionError,
  type IntentAppsActionResult,
  type IntentAppsState,
} from '../../../shared/intent-apps/intent-apps-types';
import { LOCAL_CONNECTION_ID } from '../../../shared/types/connections';
import { Logger } from '../../../shared/logger';
import { getAppWindows } from '../../../main/offscreen-window';
import { createValidatedHandler } from '../../../main/ipc-validation-middleware';
import { getLocalPref, setLocalPref } from '../../../main/local-prefs';
import { showOpenDialog } from '../../../main/file-dialogs';
import { getBackendIdForWebContents, getRendererWebContents } from '../../../main/window-backend';
import { getFocusedWindowBackendId } from '../../../main/window';
import { createBackendSocket } from '../../backend/main/backend-connection';
import {
  requestRouted,
  TRANSFER_REQUEST_TIMEOUT_MS,
} from '../../backend/main/transfer-connections';
import {
  getBackendClientForId,
  onAnyBackendNotification,
  onAnyBackendReconnected,
} from '../../backend/main/backend.ipc';
import * as connectionsStore from '../../backend/main/desktop-connections-store';
import type { JsonRpcNotification } from '../../backend/main/json-rpc-client';
import { IntentAppHost, LOCAL_APP_HOST_MACHINE, type AppHostAdmin } from './app-host';
import { AppsStateFileWriter, intentStateDir } from './apps-state-file';
import { pickOpenAppTarget } from './open-app-target';
import { readAppPackage } from './app-package';
import {
  discardAppPackage,
  installUploadedPackage,
  uploadAppPackage,
  type PackageRequest,
} from './app-package-install';

const logger = new Logger('IntentApps');
const CHANNELS = IPC_CHANNELS.INTENT_APPS;
const APP_EVENTS = ['app:installed', 'app:removed', 'app:approval-changed'] as const;

/** The Intent OS helper (intent-hq/intent-os): focuses an open app's window, else opens it. */
const INTENT_OS_APPS_HELPER = '/usr/lib/intent-os/apps';

/** The library of one machine, as main follows it. */
interface Machine {
  backendId: string;
  host: IntentAppHost;
  state: IntentAppsState;
  /** `app.list` answered at least once with the Labs switch on. */
  loaded: boolean;
  subscriptionId: string | null;
  refreshing: Promise<void> | null;
  refreshAgain: boolean;
  /** The saved connection's name, for app window titles (remote machines). */
  label: string | null;
  iconCache: Map<string, string | null>;
  /** Package uploads this desktop app began on the machine and has not ended. */
  uploads: Set<string>;
}

let labEnabled = false;
let labLoaded: Promise<void> | null = null;
const machines = new Map<string, Machine>();
let stateFile: AppsStateFileWriter | null = null;
/** Open requests that came before the host was ready (cold start, early second instance). */
const pendingOpens: string[] = [];
let started = false;

const AppIdSchema = z.object({ appId: z.string().refine(isIntentAppId) });
const SetLabSchema = z.object({ enabled: z.boolean() });
const EmptySchema = z.object({}).optional();
/**
 * A package install (spec 12): `path` (a `.intentapp` / `.zip` file or a
 * folder on this computer) uploads it to the sender's machine and checks or
 * installs it; `uploadId` checks again or installs a package uploaded before.
 */
const InstallSchema = z
  .object({
    path: z.string().min(1).optional(),
    uploadId: z.string().min(1).optional(),
    replace: z.boolean().optional(),
    dryRun: z.boolean().optional(),
  })
  .refine((params) => (params.path === undefined) !== (params.uploadId === undefined));
const UploadSchema = z.object({ uploadId: z.string().min(1) });
const ApproveSchema = z.object({
  appId: z.string().refine(isIntentAppId),
  bundleHash: z.string().min(1),
  level: z.union([z.literal(1), z.literal(2), z.literal(3)]),
  features: z.array(z.enum(INTENT_APP_FEATURES as [string, ...string[]])),
});

/** Partition key of a remote machine: short, stable and free of the connection id's characters. */
function machineKey(backendId: string): string {
  return createHash('sha256').update(backendId).digest('hex').slice(0, 16);
}

function admin(backendId: string): AppHostAdmin {
  return {
    // `app.readBundle` is a bulk transfer: on a remote transport it rides its own connection.
    request: (method, params, timeoutMs) =>
      requestRouted(
        getBackendClientForId(backendId),
        method,
        params,
        timeoutMs
          ? { timeoutMs }
          : method === 'app.readBundle'
            ? { timeoutMs: TRANSFER_REQUEST_TIMEOUT_MS }
            : undefined,
        backendId,
      ),
    ready: async () => {
      await getBackendClientForId(backendId).readHelloSnapshot();
    },
    // The same transport and credentials as the machine's administrator connection.
    createSocket: () => createBackendSocket(getBackendClientForId(backendId).getConfig()),
  };
}

function machineFor(backendId: string): Machine {
  const existing = machines.get(backendId);
  if (existing) return existing;
  const local = backendId === LOCAL_CONNECTION_ID;
  const machine: Machine = {
    backendId,
    host: null as unknown as IntentAppHost,
    state: { ...INTENT_APPS_OFF_STATE },
    loaded: false,
    subscriptionId: null,
    refreshing: null,
    refreshAgain: false,
    label: null,
    iconCache: new Map(),
    uploads: new Set(),
  };
  machine.host = new IntentAppHost(
    admin(backendId),
    () => setState(machine, { ...machine.state, openAppIds: machine.host.openAppIds() }),
    undefined,
    local
      ? LOCAL_APP_HOST_MACHINE
      : { key: machineKey(backendId), label: () => machine.label ?? backendId },
  );
  machine.host.registerIpc();
  machines.set(backendId, machine);
  return machine;
}

/** The machine of the sender's window (this computer for an unbound window). */
function senderMachine(event: IpcMainInvokeEvent): Machine {
  return machineFor(getBackendIdForWebContents(event.sender));
}

function toActionError(error: unknown): IntentAppsActionError {
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
  const uploadId = (error as { uploadId?: unknown } | null)?.uploadId;
  return {
    code,
    message: error instanceof Error ? error.message : String(error),
    ...(typeof uploadId === 'string' ? { uploadId } : {}),
  };
}

async function action<T>(run: () => Promise<T>): Promise<IntentAppsActionResult<T>> {
  try {
    const result = await run();
    return { ok: true, result } as IntentAppsActionResult<T>;
  } catch (error) {
    return { ok: false, error: toActionError(error) };
  }
}

/** Push a machine's state to the renderers connected to that machine. */
function broadcast(machine: Machine): void {
  for (const window of getAppWindows()) {
    if (window.isDestroyed()) continue;
    for (const renderer of getRendererWebContents(window)) {
      if (renderer.isDestroyed()) continue;
      if (getBackendIdForWebContents(renderer) !== machine.backendId) continue;
      renderer.send(CHANNELS.CHANGED, machine.state);
    }
  }
}

function setState(machine: Machine, next: IntentAppsState): void {
  // Pushes and state-file writes only on a real change: with the Labs switch
  // off every refresh yields the same off state, so nothing happens.
  if (JSON.stringify(next) === JSON.stringify(machine.state)) return;
  machine.state = next;
  broadcast(machine);
  if (!stateFile || machine.backendId !== LOCAL_CONNECTION_ID) return;
  const write = labEnabled && next.supported ? stateFile.write(next.apps) : stateFile.clear();
  write.catch((error: Error) =>
    logger.warn('Could not write the Intent OS apps state file', { error: error.message }),
  );
}

function capabilities(hello: unknown): Record<string, unknown> | undefined {
  return (hello as { server?: { capabilities?: Record<string, unknown> } } | null)?.server
    ?.capabilities;
}

function isSupported(hello: unknown): boolean {
  return capabilities(hello)?.intentApps === 1;
}

async function readLabel(machine: Machine): Promise<void> {
  if (machine.backendId === LOCAL_CONNECTION_ID) return;
  try {
    const record = (await connectionsStore.list()).find((entry) => entry.id === machine.backendId);
    if (record?.label) machine.label = record.label;
  } catch {
    // The title falls back to the connection id.
  }
}

async function refreshNow(machine: Machine): Promise<void> {
  const openAppIds = machine.host.openAppIds();
  if (!labEnabled) {
    machine.loaded = false;
    setState(machine, { ...INTENT_APPS_OFF_STATE, openAppIds });
    return;
  }
  try {
    const client = getBackendClientForId(machine.backendId);
    const hello = await client.readHelloSnapshot();
    if (!isSupported(hello)) {
      machine.loaded = false;
      setState(machine, { ...INTENT_APPS_OFF_STATE, labEnabled: true, openAppIds });
      return;
    }
    await readLabel(machine);
    if (!machine.subscriptionId) {
      const result = await client.request<{ subscriptionId?: string }>('events.subscribe', {
        eventTypes: [...APP_EVENTS],
      });
      machine.subscriptionId = result?.subscriptionId ?? null;
    }
    const { apps } = await client.request<{ apps: IntentApp[] }>('app.list', {});
    machine.loaded = true;
    setState(machine, {
      labEnabled: true,
      supported: true,
      packages: capabilities(hello)?.intentAppPackages === 1,
      apps,
      openAppIds,
      error: null,
    });
  } catch (error) {
    if ((error as { rpcCode?: unknown } | null)?.rpcCode === -32003) {
      // A guest or host member connection: the library is owner-only, so there is none here.
      machine.loaded = false;
      setState(machine, { ...INTENT_APPS_OFF_STATE, labEnabled: true, openAppIds });
      return;
    }
    setState(machine, {
      ...machine.state,
      labEnabled: true,
      openAppIds,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

/** Single-flight and coalesced per machine: a refresh during a refresh runs once more after it. */
function refresh(machine: Machine): Promise<void> {
  if (machine.refreshing) {
    machine.refreshAgain = true;
    return machine.refreshing;
  }
  machine.refreshing = (async () => {
    try {
      do {
        machine.refreshAgain = false;
        await refreshNow(machine);
      } while (machine.refreshAgain);
    } finally {
      machine.refreshing = null;
    }
  })();
  return machine.refreshing;
}

function refreshAll(): Promise<void> {
  return Promise.all([...machines.values()].map((machine) => refresh(machine))).then(() => {});
}

function onNotification(backendId: string, notification: JsonRpcNotification): void {
  if (notification.method !== 'events.event') return;
  const machine = machines.get(backendId);
  if (!machine) return;
  const params = notification.params as {
    subscriptionId?: unknown;
    event?: { type?: unknown; data?: { appId?: unknown } };
  } | null;
  const type = params?.event?.type;
  if (typeof type !== 'string' || !(APP_EVENTS as readonly string[]).includes(type)) return;
  if (machine.subscriptionId && params?.subscriptionId !== machine.subscriptionId) return;
  const appId = params?.event?.data?.appId;
  if (type === 'app:removed' && typeof appId === 'string') {
    void machine.host.clearAppStorage(appId);
  }
  void refresh(machine);
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
 * Open from the open entry (`--open-app`, `intent://app/<id>`): on the machine
 * that `pickOpenAppTarget` picks. Before the host is ready, the request waits for it.
 */
export function requestOpenApp(appId: string): void {
  if (!isIntentAppId(appId)) return;
  if (!started || !labLoaded) {
    pendingOpens.push(appId);
    return;
  }
  void labLoaded.then(async () => {
    if (!labEnabled) {
      logger.info('Ignored an open-app request: Intent apps are off in Labs', { appId });
      return;
    }
    const target = pickOpenAppTarget(
      appId,
      [...machines.values()]
        .filter((machine) => machine.loaded)
        .map((machine) => ({
          backendId: machine.backendId,
          appIds: machine.state.apps.map((app) => app.id),
        })),
      getFocusedWindowBackendId(),
    );
    // Not in any library main has read: this computer's daemon answers (app-not-found).
    const backendId = target.kind === 'machine' ? target.backendId : LOCAL_CONNECTION_ID;
    if (target.kind === 'ambiguous') {
      logger.info('Ignored an open-app request: more than one machine has the app', {
        appId,
        machines: target.backendIds,
      });
      return;
    }
    try {
      await machineFor(backendId).host.openApp(appId);
    } catch (error) {
      logger.warn('Could not open an app', { appId, backendId, error: toActionError(error) });
    }
  });
}

/**
 * The library's Open: on Intent OS the helper opens this computer's apps, so an
 * open app's sway workspace gets focus the same way the top bar does it; else
 * the machine's host.
 */
async function openFromRenderer(machine: Machine, appId: string): Promise<void> {
  requireLab();
  if (
    machine.backendId === LOCAL_CONNECTION_ID &&
    isIntentOs() &&
    existsSync(INTENT_OS_APPS_HELPER)
  ) {
    const child = spawn(INTENT_OS_APPS_HELPER, ['open', appId], {
      detached: true,
      stdio: 'ignore',
    });
    child.on('error', (error) => {
      logger.warn('The Intent OS apps helper failed; opening directly', { error: error.message });
      void machine.host.openApp(appId).catch(() => {});
    });
    child.unref();
    return;
  }
  await machine.host.openApp(appId);
}

async function readIcon(machine: Machine, appId: string): Promise<string | null> {
  const app = machine.state.apps.find((candidate) => candidate.id === appId);
  if (!app?.icon) return null;
  const key = `${appId}@${app.bundleHash}`;
  if (machine.iconCache.has(key)) return machine.iconCache.get(key) ?? null;
  try {
    const file = await machine.host.readBundle(appId, app.icon, app.bundleHash);
    const url = file.mimeType.startsWith('image/')
      ? `data:${file.mimeType};base64,${file.contentBase64}`
      : null;
    machine.iconCache.set(key, url);
    return url;
  } catch {
    return null;
  }
}

/**
 * The native picker for a package: a `.intentapp` or `.zip` file, or a folder.
 * Only the macOS picker can choose files and folders at once, so elsewhere
 * the user picks the folder's `intent-app.json`, which stands for its folder.
 */
async function pickPackage(owner: BrowserWindow | null): Promise<{ path: string } | null> {
  const mac = process.platform === 'darwin';
  const result = await showOpenDialog(owner, {
    properties: mac ? ['openFile', 'openDirectory'] : ['openFile'],
    filters: [{ name: 'Intent app', extensions: ['intentapp', 'zip', 'json'] }], // i18n-ignore (file type name in the native picker)
  });
  const picked = result.canceled ? null : result.filePaths[0];
  if (!picked) return null;
  return { path: /(^|[\\/])intent-app\.json$/i.test(picked) ? path.dirname(picked) : picked };
}

/** Package upload requests: chunks of a remote machine ride its transfer connection. */
function packageRequest(machine: Machine): PackageRequest {
  return <T>(method: string, params: Record<string, unknown>) =>
    requestRouted<T>(
      getBackendClientForId(machine.backendId),
      method,
      params,
      method === 'app.install'
        ? { timeoutMs: 120_000 }
        : { timeoutMs: TRANSFER_REQUEST_TIMEOUT_MS },
      machine.backendId,
    );
}

/** A library request of the sender's machine; refreshes that library after a change. */
function libraryRequest<T>(
  event: IpcMainInvokeEvent,
  method: string,
  params: Record<string, unknown>,
): Promise<IntentAppsActionResult<T>> {
  return action(async () => {
    requireLab();
    const machine = senderMachine(event);
    const result = await getBackendClientForId(machine.backendId).request<T>(method, params);
    void refresh(machine);
    return result;
  });
}

export function setupIntentAppsIPC(): void {
  if (started) return;
  started = true;
  labLoaded = loadLab();
  const local = machineFor(LOCAL_CONNECTION_ID);
  if (isIntentOs()) {
    stateFile = new AppsStateFileWriter(intentStateDir(), async (app) => {
      if (!app.icon) return null;
      const file = await local.host.readBundle(app.id, app.icon, app.bundleHash);
      return Buffer.from(file.contentBase64, 'base64');
    });
  }

  ipcMain.handle(
    CHANNELS.GET_STATE,
    createValidatedHandler(
      EmptySchema,
      async (event) => {
        await labLoaded;
        const machine = senderMachine(event);
        // The first read of a machine starts to follow its library.
        if (labEnabled && !machine.loaded && !machine.state.labEnabled) await refresh(machine);
        return machine.state;
      },
      CHANNELS.GET_STATE,
    ),
  );
  ipcMain.handle(
    CHANNELS.REFRESH,
    createValidatedHandler(
      EmptySchema,
      async (event) => {
        await labLoaded;
        const machine = senderMachine(event);
        await refresh(machine);
        return machine.state;
      },
      CHANNELS.REFRESH,
    ),
  );
  ipcMain.handle(
    CHANNELS.SET_LAB,
    createValidatedHandler(
      SetLabSchema,
      async (event, { enabled }) => {
        await labLoaded;
        await setLocalPref('intentAppsLabEnabled', enabled);
        labEnabled = enabled;
        logger.info('Intent apps (Labs) changed', { enabled });
        if (!enabled) for (const machine of machines.values()) machine.host.closeAll('closed');
        const machine = senderMachine(event);
        await refreshAll();
        return machine.state;
      },
      CHANNELS.SET_LAB,
    ),
  );
  ipcMain.handle(
    CHANNELS.PICK_PACKAGE,
    createValidatedHandler(
      EmptySchema,
      async (event) => pickPackage(BrowserWindow.fromWebContents(event.sender)),
      CHANNELS.PICK_PACKAGE,
    ),
  );
  ipcMain.handle(
    CHANNELS.INSTALL,
    createValidatedHandler(
      InstallSchema,
      async (event, params) =>
        action(async () => {
          requireLab();
          const machine = senderMachine(event);
          if (!machine.state.packages) {
            throw Object.assign(new Error('This machine cannot install app packages'), {
              data: { code: 'not-supported' },
            });
          }
          const request = packageRequest(machine);
          let uploadId = params.uploadId;
          if (uploadId === undefined && params.path !== undefined) {
            uploadId = await uploadAppPackage(request, await readAppPackage(params.path));
            machine.uploads.add(uploadId);
          } else if (uploadId === undefined || !machine.uploads.has(uploadId)) {
            throw Object.assign(new Error('Unknown package upload'), {
              data: { code: 'upload-invalid' },
            });
          }
          try {
            const result = await installUploadedPackage(request, uploadId, params);
            if (!params.dryRun) {
              machine.uploads.delete(uploadId);
              void refresh(machine);
            }
            return { ...result, uploadId };
          } catch (error) {
            // A failed check keeps the upload: the renderer checks again or discards it.
            throw Object.assign(error instanceof Error ? error : new Error(String(error)), {
              uploadId,
            });
          }
        }),
      CHANNELS.INSTALL,
    ),
  );
  ipcMain.handle(
    CHANNELS.DISCARD_PACKAGE,
    createValidatedHandler(
      UploadSchema,
      async (event, { uploadId }) => {
        const machine = senderMachine(event);
        if (!machine.uploads.delete(uploadId)) return { ok: true };
        await discardAppPackage(packageRequest(machine), uploadId);
        return { ok: true };
      },
      CHANNELS.DISCARD_PACKAGE,
    ),
  );
  ipcMain.handle(
    CHANNELS.APPROVE,
    createValidatedHandler(
      ApproveSchema,
      async (event, params) => libraryRequest<{ app: IntentApp }>(event, 'app.approve', params),
      CHANNELS.APPROVE,
    ),
  );
  ipcMain.handle(
    CHANNELS.REVOKE,
    createValidatedHandler(
      AppIdSchema,
      async (event, { appId }) => libraryRequest(event, 'app.revoke', { appId }),
      CHANNELS.REVOKE,
    ),
  );
  ipcMain.handle(
    CHANNELS.UNINSTALL,
    createValidatedHandler(
      AppIdSchema,
      async (event, { appId }) => libraryRequest(event, 'app.uninstall', { appId }),
      CHANNELS.UNINSTALL,
    ),
  );
  ipcMain.handle(
    CHANNELS.OPEN,
    createValidatedHandler(
      AppIdSchema,
      async (event, { appId }) => {
        return action(async () => {
          await labLoaded;
          await openFromRenderer(senderMachine(event), appId);
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
      async (event, { appId }) => {
        return readIcon(senderMachine(event), appId);
      },
      CHANNELS.ICON,
    ),
  );

  onAnyBackendNotification(onNotification);
  onAnyBackendReconnected((backendId) => {
    const machine = machines.get(backendId);
    if (!machine) return;
    machine.subscriptionId = null;
    void refresh(machine);
  });

  void labLoaded.then(async () => {
    // Off on Intent OS: drop apps an earlier session left in the bar's file.
    if (!labEnabled) void stateFile?.clear().catch(() => {});
    await refresh(local);
    for (const appId of pendingOpens.splice(0)) requestOpenApp(appId);
  });
}
