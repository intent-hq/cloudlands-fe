/**
 * Electron wiring for the Unified window (Labs): the controller's host, the
 * cross-machine workspace feed, and the shell / view IPC handlers. Shell-only
 * handlers accept the Unified window's own renderer only; view-only handlers accept
 * a bound machine view only, and resolve the machine from that binding — never from
 * the request.
 */
import { app, BrowserWindow, ipcMain, WebContentsView } from 'electron';
import { promises as fs } from 'fs';
import path from 'path';
import { Logger } from '$shared/logger';
import { IPC_CHANNELS } from '$shared/ipc-registry';
import {
  EmptySchema,
  UnifiedContentBoundsSchema,
  UnifiedMachineSchema,
  UnifiedOpenWorkspaceSchema,
  UnifiedSaveStateSchema,
  UnifiedSetTabsSchema,
  UnifiedShowSchema,
} from '../../../main/ipc-schemas';
import { createSafeValidatedHandler } from '../../../main/ipc-validation-middleware';
import {
  appRendererWebPreferences,
  buildAppLoadUrl,
  createUnifiedHostWindow,
  isWindowSessionTeardown,
  releaseBackendViewHolder,
} from '../../../main/window';
import {
  bindViewToBackend,
  getViewBinding,
  rendererIdForContents,
  setActiveView,
} from '../../../main/window-backend';
import { isUnifiedWindowLabEnabled } from '../../../main/unified-window-lab';
import { forgetRendererState } from '../../system/main/system.ipc';
import {
  connectMachineForUnifiedWindow,
  getBackendClientForConnection,
  isBackendConnected,
  listUnifiedWindowMachineIds,
  onAnyBackendNotification,
  onAnyBackendStatus,
} from '../../backend/main/backend.ipc';
import type { UnifiedFeedRow } from '../unified-feed-types';
import { parseUnifiedWindowState, type UnifiedWindowState } from '../unified-window-state';
import {
  UNIFIED_SHELL_CHANNELS,
  UnifiedWindowController,
  type UnifiedHostWindow,
  type UnifiedViewHandle,
} from './unified-window-controller';
import { UnifiedWorkspaceFeed } from './unified-workspace-feed';
import { unifiedTabShortcut } from '../unified-shortcuts';

const logger = new Logger('UnifiedWindow');
const UNIFIED = IPC_CHANNELS.UNIFIED;
export const UNIFIED_SHELL_ROUTE = '/unified';

interface StoredRecord {
  /** The window was open when the app last quit: restore it at launch. */
  open: boolean;
  state: UnifiedWindowState | null;
}

const dataDir = () => path.join(app.getPath('userData'), 'unified-window');
const recordPath = () => path.join(dataDir(), 'window.json');
const feedPath = (machineId: string) =>
  path.join(dataDir(), 'feeds', `${encodeURIComponent(machineId)}.json`);

async function readJson(file: string): Promise<unknown> {
  try {
    return JSON.parse(await fs.readFile(file, 'utf8'));
  } catch {
    return null;
  }
}

async function writeJson(file: string, value: unknown): Promise<void> {
  await fs.mkdir(path.dirname(file), { recursive: true });
  const temporary = `${file}.${process.pid}.tmp`;
  await fs.writeFile(temporary, JSON.stringify(value), 'utf8');
  await fs.rename(temporary, file);
}

async function readRecord(): Promise<StoredRecord> {
  const raw = (await readJson(recordPath())) as Partial<StoredRecord> | null;
  return { open: raw?.open === true, state: parseUnifiedWindowState(raw?.state) };
}

let recordWrite: Promise<void> = Promise.resolve();
function updateRecord(change: (record: StoredRecord) => StoredRecord): Promise<void> {
  recordWrite = recordWrite
    .then(async () => writeJson(recordPath(), change(await readRecord())))
    .catch((error) => logger.warn('Failed to save the Unified window record', error));
  return recordWrite;
}

let unifiedWindow: BrowserWindow | null = null;

function isShell(sender: Electron.WebContents): boolean {
  return !!unifiedWindow && !unifiedWindow.isDestroyed() && unifiedWindow.webContents === sender;
}

const viewContents = new WeakMap<UnifiedViewHandle, Electron.WebContents>();

function viewHandle(window: BrowserWindow, machineId: string): UnifiedViewHandle {
  const view = new WebContentsView({ webPreferences: appRendererWebPreferences() });
  const contents = view.webContents;
  window.contentView.addChildView(view);
  bindViewToBackend(contents, window, machineId);
  const rendererId = -contents.id;
  // Tab shortcuts act on the shell's strip, even while the view has keyboard focus.
  contents.on('before-input-event', (event, input) => {
    const shortcut = unifiedTabShortcut(input, process.platform === 'darwin');
    if (!shortcut) return;
    event.preventDefault();
    if (!window.isDestroyed()) window.webContents.send(UNIFIED.SHORTCUT, shortcut);
  });
  contents.on('did-navigate', () => forgetRendererState(rendererId, true));
  contents.once('destroyed', () => forgetRendererState(rendererId));
  const handle: UnifiedViewHandle = {
    machineId,
    load(route) {
      const separator = route.includes('?') ? '&' : '?';
      contents
        .loadURL(buildAppLoadUrl(`${route}${separator}embedded=1`))
        .catch((error: unknown) => logger.warn('Failed to load a Unified machine view', error));
    },
    navigate(route) {
      if (!contents.isDestroyed()) contents.send(UNIFIED_SHELL_CHANNELS.NAVIGATE, { route });
    },
    setBounds(bounds) {
      view.setBounds(bounds);
    },
    setVisible(visible) {
      view.setVisible(visible);
    },
    send(channel, payload) {
      if (!contents.isDestroyed()) contents.send(channel, payload);
    },
    isDestroyed: () => contents.isDestroyed(),
    destroy() {
      if (!window.isDestroyed()) window.contentView.removeChildView(view);
      if (!contents.isDestroyed()) contents.close();
    },
  };
  viewContents.set(handle, contents);
  return handle;
}

function hostWindow(window: BrowserWindow): UnifiedHostWindow {
  return {
    isDestroyed: () => window.isDestroyed(),
    focus: () => window.focus(),
    show: () => window.show(),
    restore: () => window.restore(),
    isMinimized: () => window.isMinimized(),
    close: () => window.close(),
    onClosed: (listener) => window.once('closed', listener),
    send: (channel, payload) => {
      if (!window.isDestroyed() && !window.webContents.isDestroyed())
        window.webContents.send(channel, payload);
    },
  };
}

const windowsByHost = new WeakMap<UnifiedHostWindow, BrowserWindow>();

let feed: UnifiedWorkspaceFeed | null = null;

const controller = new UnifiedWindowController({
  async createWindow() {
    const window = await createUnifiedHostWindow(UNIFIED_SHELL_ROUTE);
    unifiedWindow = window;
    const handle = hostWindow(window);
    windowsByHost.set(handle, window);
    window.once('closed', () => {
      if (unifiedWindow === window) unifiedWindow = null;
      stopFeed();
      // Closed by the user: do not reopen at launch. A quit keeps it for restore.
      if (!isWindowSessionTeardown()) void updateRecord((record) => ({ ...record, open: false }));
    });
    void updateRecord((record) => ({ ...record, open: true }));
    void startFeed();
    return handle;
  },
  createView(handle, machineId) {
    const window = windowsByHost.get(handle);
    if (!window) throw new Error('Unknown Unified window');
    return viewHandle(window, machineId);
  },
  activateView(handle, view) {
    const window = windowsByHost.get(handle);
    if (!window) return;
    const contents = view ? viewContents.get(view) : undefined;
    setActiveView(window, contents && !contents.isDestroyed() ? contents : null);
    contents?.focus();
  },
  connect: async (machineId) => {
    await connectMachineForUnifiedWindow(machineId);
  },
  isConnected: (machineId) => isBackendConnected(machineId),
  releaseHolder: (machineId) => releaseBackendViewHolder(machineId),
  loadState: async () => (await readRecord()).state,
  saveState: (state) => updateRecord((record) => ({ ...record, state })),
  isLabEnabled: () => isUnifiedWindowLabEnabled(),
});

function publishFeed(): void {
  if (!unifiedWindow || unifiedWindow.isDestroyed()) return;
  unifiedWindow.webContents.send(UNIFIED.FEED_CHANGED, feed?.snapshot() ?? []);
}

async function syncTrackedMachines(): Promise<void> {
  if (!feed) return;
  const machineIds = await listUnifiedWindowMachineIds();
  const current = feed.snapshot().map((machine) => machine.machineId);
  for (const machineId of current) {
    if (!machineIds.includes(machineId)) await feed.forget(machineId);
  }
  await feed.track(machineIds, isBackendConnected);
  void controller.connectInBackground(machineIds);
}

async function startFeed(): Promise<void> {
  if (feed) return;
  feed = new UnifiedWorkspaceFeed({
    request: async (machineId, method, params) => {
      const client = getBackendClientForConnection(machineId);
      if (!client) throw new Error(`Machine is not connected: ${machineId}`);
      return client.request(method, params);
    },
    onNotification: (handler) => onAnyBackendNotification(handler),
    onStatus: (handler) => onAnyBackendStatus(handler),
    cache: {
      load: async (machineId) => {
        const rows = await readJson(feedPath(machineId));
        return Array.isArray(rows) ? (rows as UnifiedFeedRow[]) : null;
      },
      save: (machineId, rows) => writeJson(feedPath(machineId), rows),
      delete: async (machineId) => {
        await fs.rm(feedPath(machineId), { force: true });
      },
    },
    publish: () => publishFeed(),
  });
  await syncTrackedMachines();
}

function stopFeed(): void {
  feed?.dispose();
  feed = null;
}

/** A machine was forgotten or a guest host removed: drop its cached workspace list. */
async function handleMachinesChanged(): Promise<void> {
  if (feed) {
    await syncTrackedMachines();
    return;
  }
  const machineIds = new Set(await listUnifiedWindowMachineIds());
  const entries = await fs.readdir(path.join(dataDir(), 'feeds')).catch(() => [] as string[]);
  for (const entry of entries) {
    const machineId = decodeURIComponent(entry.replace(/\.json$/, ''));
    if (!machineIds.has(machineId)) await fs.rm(feedPath(machineId), { force: true });
  }
}

export function openOrFocusUnifiedWindow(): Promise<{ opened: boolean }> {
  return controller.openOrFocus();
}

export function closeUnifiedWindow(): void {
  controller.close();
}

export function getUnifiedWindow(): BrowserWindow | null {
  return unifiedWindow && !unifiedWindow.isDestroyed() ? unifiedWindow : null;
}

/** Route an "open workspace" (link, notification) to the Unified window as a tab. */
export function requestUnifiedOpen(machineId: string, workspaceId: string): boolean {
  return controller.requestOpen(machineId, workspaceId);
}

/** Whether launch will reopen the Unified window (lab on and it was open at quit). */
export async function isUnifiedWindowRestorePending(): Promise<boolean> {
  return isUnifiedWindowLabEnabled() && (await readRecord()).open;
}

/** Launch: reopen the Unified window when the lab is on and it was open at quit. */
export async function restoreUnifiedWindow(): Promise<void> {
  if (!isUnifiedWindowLabEnabled()) return;
  if ((await readRecord()).open) await controller.openOrFocus();
}

export function registerUnifiedWindowHandlers(): void {
  ipcMain.handle(
    UNIFIED.OPEN,
    createSafeValidatedHandler(
      EmptySchema,
      async () => controller.openOrFocus(),
      UNIFIED.OPEN,
    ),
  );

  const shellOnly =
    <T, R>(handler: (request: T) => Promise<R> | R, refused: R) =>
    async (event: Electron.IpcMainInvokeEvent, request: T): Promise<R> =>
      isShell(event.sender) ? handler(request) : refused;

  ipcMain.handle(
    UNIFIED.GET_STATE,
    createSafeValidatedHandler(
      EmptySchema,
      shellOnly(() => controller.loadState(), null),
      UNIFIED.GET_STATE,
    ),
  );
  ipcMain.handle(
    UNIFIED.SAVE_STATE,
    createSafeValidatedHandler(
      UnifiedSaveStateSchema,
      shellOnly(async ({ state }) => {
        const parsed = parseUnifiedWindowState(state);
        if (parsed) await controller.saveState(parsed);
        return { ok: parsed !== null };
      }, { ok: false }),
      UNIFIED.SAVE_STATE,
    ),
  );
  ipcMain.handle(
    UNIFIED.GET_FEED,
    createSafeValidatedHandler(
      EmptySchema,
      shellOnly(() => feed?.snapshot() ?? [], []),
      UNIFIED.GET_FEED,
    ),
  );
  ipcMain.handle(
    UNIFIED.SHOW,
    createSafeValidatedHandler(
      UnifiedShowSchema,
      shellOnly(({ machineId, route }) => {
        if (!isBackendConnected(machineId)) void controller.connect(machineId);
        return { ok: controller.show(machineId, route) };
      }, { ok: false }),
      UNIFIED.SHOW,
    ),
  );
  ipcMain.handle(
    UNIFIED.SET_CONTENT_BOUNDS,
    createSafeValidatedHandler(
      UnifiedContentBoundsSchema,
      shellOnly((bounds) => {
        controller.setContentBounds(bounds);
        return { ok: true };
      }, { ok: false }),
      UNIFIED.SET_CONTENT_BOUNDS,
    ),
  );
  ipcMain.handle(
    UNIFIED.CONNECT,
    createSafeValidatedHandler(
      UnifiedMachineSchema,
      shellOnly(async ({ machineId }) => ({ ok: await controller.connect(machineId) }), {
        ok: false,
      }),
      UNIFIED.CONNECT,
    ),
  );
  ipcMain.handle(
    UNIFIED.HIDE_VIEWS,
    createSafeValidatedHandler(
      EmptySchema,
      shellOnly(() => {
        controller.hideViews();
        return { ok: true };
      }, { ok: false }),
      UNIFIED.HIDE_VIEWS,
    ),
  );
  ipcMain.handle(
    UNIFIED.SET_TABS,
    createSafeValidatedHandler(
      UnifiedSetTabsSchema,
      shellOnly(({ tabs }) => {
        controller.setTabs(tabs);
        return { ok: true };
      }, { ok: false }),
      UNIFIED.SET_TABS,
    ),
  );
  ipcMain.handle(
    UNIFIED.OPEN_WORKSPACE,
    createSafeValidatedHandler(
      UnifiedOpenWorkspaceSchema,
      async (event, { workspaceId, route }) => {
        // The machine is the sender view's own binding, never a request field.
        const binding = getViewBinding(event.sender);
        if (!binding || rendererIdForContents(event.sender) === null) return { ok: false };
        return { ok: controller.requestOpen(binding.backendId, workspaceId, route) };
      },
      UNIFIED.OPEN_WORKSPACE,
    ),
  );

  app.on('connections-changed' as never, () => void handleMachinesChanged());
  app.on('guest-sessions-changed' as never, () => void handleMachinesChanged());
}

/** Whether `window` hosts the Unified shell (menus route through the shell). */
export function isUnifiedWindow(window: BrowserWindow | null | undefined): boolean {
  return !!window && window === unifiedWindow;
}
