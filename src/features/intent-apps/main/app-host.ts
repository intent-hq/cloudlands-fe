/**
 * The Intent app host (Labs; `docs/protocol/methods/apps.md` → "Roles", "The
 * app bridge", "Window identity and open entry"). Main owns, per open app:
 *
 * - one top-level window, titled `Intent App: <name>`, with its own persistent
 *   session partition `persist:intent-app-<appId>`, sandboxed, context
 *   isolation on, Node integration off, and a preload that exposes only
 *   `window.intent`;
 * - the `intent-app://<appId>/` scheme on that partition, served through
 *   `app.readBundle` pinned to the session's bundle hash;
 * - one app session (`app.session.open` on the administrator connection) and
 *   one attached app connection (`app.session.attach` first), which carries
 *   every daemon call of the bridge.
 *
 * One window per app: a second open focuses it. Closing the window closes the
 * session. When the session ends without the host asking, the host reads the
 * app again and keeps or closes the window (see `session-recovery.ts`).
 */
import {
  BrowserWindow,
  globalShortcut,
  ipcMain,
  nativeImage,
  Notification,
  session as electronSession,
  type IpcMainInvokeEvent,
  type Session,
} from 'electron';
import * as path from 'path';
import type { Duplex } from 'stream';
import { fileURLToPath } from 'url';
import { IPC_CHANNELS } from '../../../shared/ipc-registry';
import { isIntentOs } from '../../../shared/intent-os';
import {
  intentAppPartition,
  intentAppWindowTitle,
  type IntentApp,
  type IntentAppPlatform,
  type IntentAppSession,
} from '../../../shared/intent-apps/intent-apps-types';
import { Logger } from '../../../shared/logger';
import { openExternal } from '../../../main/open-external';
import { markIntentAppWindow, unmarkIntentAppWindow } from '../../../main/intent-app-windows';
import {
  AppDisconnectedError,
  BRIDGE_VERSION,
  handleBridgeCall,
  type AppInfo,
  type BridgeContext,
  type BridgeResponse,
} from './app-bridge';
import { AppConnection } from './app-connection';
import {
  createAppSchemeHandler,
  INTENT_APP_SCHEME,
  intentAppEntryUrl,
  type AppSchemeTarget,
  type BundleFile,
} from './app-scheme';
import { decideAfterSessionLoss, isSameGrant, type SessionEndReason } from './session-recovery';

const logger = new Logger('IntentAppHost');
const CHANNELS = IPC_CHANNELS.INTENT_APP;

/** Time the app's `session-ended` listeners get before the window closes. */
const SESSION_ENDED_CLOSE_DELAY_MS = 500;
/** How long the host keeps trying to get the app back after a lost session. */
const RECOVERY_BUDGET_MS = 60_000;
const RECOVERY_RETRY_MS = 1_000;

/** What the host needs from the administrator connection. */
export interface AppHostAdmin {
  request<T = unknown>(method: string, params?: unknown, timeoutMs?: number): Promise<T>;
  /** Resolves once the administrator connection is up (rejects when it cannot be). */
  ready(): Promise<void>;
  /** A new socket on the same transport as the administrator connection. */
  createSocket(): Duplex;
}

interface OpenApp {
  appId: string;
  name: string;
  version: string;
  window: BrowserWindow;
  contentsId: number;
  session: IntentAppSession;
  connection: AppConnection | null;
  /** The host is ending this window; a connection close is expected. */
  ending: boolean;
  recovering: boolean;
  shortcuts: Set<string>;
  notifications: Map<string, Notification>;
}

function platformName(): IntentAppPlatform {
  if (process.platform === 'darwin') return 'mac';
  if (process.platform === 'win32') return 'windows';
  return isIntentOs() ? 'intent-os' : 'linux';
}

function errorCode(error: unknown): string | null {
  const data = (error as { data?: { code?: unknown } } | null)?.data;
  return typeof data?.code === 'string' ? data.code : null;
}

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** `--intent-app-level=<n>` and `--intent-app-features=<a,b>` for the app preload. */
function grantArguments(session: Pick<IntentAppSession, 'level' | 'features'>): string[] {
  return [
    `--intent-app-level=${session.level}`,
    `--intent-app-features=${session.features.join(',')}`,
  ];
}

function defaultPreloadPath(): string {
  return path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    '../../../preload-build/preload/intent-app.js',
  );
}

export class IntentAppHost {
  private readonly open = new Map<string, OpenApp>();
  private readonly opening = new Map<string, Promise<void>>();
  private readonly byContents = new Map<number, OpenApp>();
  /** Partitions whose scheme handler and rules are installed. */
  private readonly securedPartitions = new Set<string>();
  private ipcRegistered = false;
  /** Bumped by closeAll: an open that started earlier is cancelled at its next step. */
  private generation = 0;

  constructor(
    private readonly admin: AppHostAdmin,
    /** Called when the set of open apps changes. */
    private readonly onOpenChanged: () => void,
    /** The compiled `src/preload/intent-app.ts` (an Electron test passes its own bundle). */
    private readonly preloadPath: string = defaultPreloadPath(),
  ) {}

  openAppIds(): string[] {
    return [...this.open.keys()].sort();
  }

  isOpen(appId: string): boolean {
    return this.open.has(appId);
  }

  /** Answer `intent-app:invoke`. Call once at startup. */
  registerIpc(): void {
    if (this.ipcRegistered) return;
    this.ipcRegistered = true;
    ipcMain.handle(CHANNELS.INVOKE, (event, message) => this.handleInvoke(event, message));
  }

  /** Open `appId`, or focus its window. Rejects with the daemon error when it cannot open. */
  async openApp(appId: string): Promise<void> {
    const existing = this.open.get(appId);
    if (existing && !existing.window.isDestroyed()) {
      this.focus(existing.window);
      return;
    }
    const pending = this.opening.get(appId);
    if (pending) return pending;
    const run = this.openNew(appId).finally(() => this.opening.delete(appId));
    this.opening.set(appId, run);
    return run;
  }

  /** Close every app window and cancel every open in progress (Labs switch off, quit). */
  closeAll(reason: SessionEndReason = 'closed'): void {
    this.generation += 1;
    for (const entry of [...this.open.values()]) this.endWindow(entry, reason, false);
  }

  /** An `app:removed` event: clear the app's browser storage. */
  async clearAppStorage(appId: string): Promise<void> {
    try {
      await electronSession.fromPartition(intentAppPartition(appId)).clearStorageData();
    } catch (error) {
      logger.warn('Could not clear the storage of a removed app', { appId, error: String(error) });
    }
  }

  /** A file of the installed bundle (icons for the library and Intent OS). */
  readBundle(appId: string, filePath: string, bundleHash?: string): Promise<BundleFile> {
    return this.admin.request<BundleFile>('app.readBundle', {
      appId,
      path: filePath,
      ...(bundleHash ? { bundleHash } : {}),
    });
  }

  private focus(window: BrowserWindow): void {
    if (window.isMinimized()) window.restore();
    window.show();
    window.focus();
  }

  private async openSession(
    appId: string,
  ): Promise<{ session: IntentAppSession; connection: AppConnection }> {
    const opened = await this.admin.request<IntentAppSession>('app.session.open', { appId });
    const token = opened.token;
    if (typeof token !== 'string' || !token) throw new Error('app.session.open returned no token');
    try {
      const { connection, session } = await AppConnection.attach(
        () => this.admin.createSocket(),
        token,
      );
      return { session, connection };
    } catch (error) {
      await this.admin
        .request('app.session.close', { sessionId: opened.sessionId })
        .catch(() => undefined);
      throw error;
    }
  }

  private async openNew(appId: string): Promise<void> {
    const generation = this.generation;
    const cancelled = () => generation !== this.generation;
    const cancelledError = () => new Error('The app open was cancelled');
    await this.admin.ready();
    if (cancelled()) throw cancelledError();
    const { app } = await this.admin.request<{ app: IntentApp }>('app.get', { appId });
    if (cancelled()) throw cancelledError();
    const { session, connection } = await this.openSession(appId);
    const release = async () => {
      connection.close();
      await this.admin
        .request('app.session.close', { sessionId: session.sessionId })
        .catch(() => {});
    };
    if (cancelled()) {
      await release();
      throw cancelledError();
    }
    if (this.open.has(appId)) {
      // Another open won the race; keep its window.
      connection.close();
      await this.admin
        .request('app.session.close', { sessionId: session.sessionId })
        .catch(() => {});
      const winner = this.open.get(appId);
      if (winner) this.focus(winner.window);
      return;
    }
    const icon = await this.loadIcon(app, session.bundleHash);
    if (cancelled()) {
      await release();
      throw cancelledError();
    }
    const window = this.createWindow(app, session, icon);
    const entry: OpenApp = {
      appId,
      name: app.name,
      version: app.version,
      window,
      contentsId: window.webContents.id,
      session,
      connection: null,
      ending: false,
      recovering: false,
      shortcuts: new Set(),
      notifications: new Map(),
    };
    this.open.set(appId, entry);
    this.byContents.set(entry.contentsId, entry);
    this.attachConnection(entry, connection);
    window.on('closed', () => this.onWindowClosed(entry));
    this.onOpenChanged();
    logger.info('Opened app window', { appId, level: session.level, features: session.features });
    await window.loadURL(intentAppEntryUrl(appId, session.entry)).catch((error: Error) => {
      logger.warn('App entry did not load', { appId, error: error.message });
    });
  }

  private async loadIcon(
    app: IntentApp,
    bundleHash: string,
  ): Promise<Electron.NativeImage | undefined> {
    if (!app.icon || process.platform === 'darwin') return undefined;
    try {
      const file = await this.readBundle(app.id, app.icon, bundleHash);
      const image = nativeImage.createFromBuffer(Buffer.from(file.contentBase64, 'base64'));
      return image.isEmpty() ? undefined : image;
    } catch {
      return undefined;
    }
  }

  private createWindow(
    app: IntentApp,
    session: IntentAppSession,
    icon: Electron.NativeImage | undefined,
  ): BrowserWindow {
    const partition = intentAppPartition(app.id);
    this.secureSession(app.id, partition);
    const spec = session.window;
    const alwaysOnTop =
      spec.alwaysOnTop && session.level >= 2 && session.features.includes('alwaysOnTop');
    const title = intentAppWindowTitle(app.name);
    const window = new BrowserWindow({
      title,
      width: spec.width,
      height: spec.height,
      ...(spec.minWidth ? { minWidth: spec.minWidth } : {}),
      ...(spec.minHeight ? { minHeight: spec.minHeight } : {}),
      resizable: spec.resizable,
      alwaysOnTop,
      show: true,
      autoHideMenuBar: true,
      ...(icon ? { icon } : {}),
      webPreferences: {
        partition,
        preload: this.preloadPath,
        // The grant, so the preload can refuse `intent.on("shortcut")` synchronously.
        additionalArguments: grantArguments(session),
        contextIsolation: true,
        nodeIntegration: false,
        nodeIntegrationInSubFrames: false,
        sandbox: true,
        webSecurity: true,
        allowRunningInsecureContent: false,
        webviewTag: false,
        spellcheck: false,
        safeDialogs: true,
        navigateOnDragDrop: false,
      },
    });
    markIntentAppWindow(window);
    if (process.platform !== 'darwin') window.setMenu(null);
    const contents = window.webContents;
    // The title is the window's identity (Intent OS finds the window by it).
    window.on('page-title-updated', (event) => event.preventDefault());
    contents.setWindowOpenHandler(({ url }) => {
      if (/^https?:/i.test(url)) {
        openExternal(url).catch(() => {});
      }
      return { action: 'deny' };
    });
    const onNavigate = (event: Electron.Event, url: string) => {
      if (this.isOwnUrl(app.id, url)) return;
      event.preventDefault();
      if (/^https?:/i.test(url)) openExternal(url).catch(() => {});
    };
    contents.on('will-navigate', onNavigate);
    contents.on('will-redirect', onNavigate);
    contents.on('will-attach-webview', (event) => event.preventDefault());
    return window;
  }

  private isOwnUrl(appId: string, url: string): boolean {
    try {
      const parsed = new URL(url);
      return parsed.protocol === `${INTENT_APP_SCHEME}:` && parsed.hostname === appId;
    } catch {
      return false;
    }
  }

  /** Install the scheme handler and the partition rules once per partition. */
  private secureSession(appId: string, partition: string): void {
    if (this.securedPartitions.has(partition)) return;
    const ses: Session = electronSession.fromPartition(partition);
    const target = (): AppSchemeTarget | null => {
      const entry = this.open.get(appId);
      return entry
        ? { appId, bundleHash: entry.session.bundleHash, entry: entry.session.entry }
        : null;
    };
    ses.protocol.handle(
      INTENT_APP_SCHEME,
      createAppSchemeHandler(target, (params) =>
        this.admin.request<BundleFile>('app.readBundle', params),
      ),
    );
    // Defense in depth under the CSP: the partition reaches no network.
    ses.webRequest.onBeforeRequest(
      { urls: ['http://*/*', 'https://*/*', 'ws://*/*', 'wss://*/*', 'file://*/*'] },
      (_details, callback) => callback({ cancel: true }),
    );
    const allowed = new Set(['clipboard-sanitized-write', 'fullscreen']);
    ses.setPermissionRequestHandler((_contents, permission, callback) =>
      callback(allowed.has(permission)),
    );
    ses.setPermissionCheckHandler((_contents, permission) => allowed.has(permission));
    ses.setDevicePermissionHandler(() => false);
    this.securedPartitions.add(partition);
  }

  private attachConnection(entry: OpenApp, connection: AppConnection): void {
    entry.connection = connection;
    connection.onClose(() => {
      if (entry.connection !== connection) return;
      entry.connection = null;
      if (entry.ending || entry.window.isDestroyed()) return;
      void this.recover(entry);
    });
  }

  /** The session ended without the host asking: keep the window or end it. */
  private async recover(entry: OpenApp): Promise<void> {
    if (entry.recovering) return;
    entry.recovering = true;
    const previous = entry.session;
    const deadline = Date.now() + RECOVERY_BUDGET_MS;
    try {
      while (!entry.ending && !entry.window.isDestroyed()) {
        let app: IntentApp | null;
        try {
          await this.admin.ready();
          app = (await this.admin.request<{ app: IntentApp }>('app.get', { appId: entry.appId }))
            .app;
        } catch (error) {
          if (errorCode(error) === 'app-not-found') {
            app = null;
          } else {
            if (Date.now() > deadline) break;
            await delay(RECOVERY_RETRY_MS);
            continue;
          }
        }
        const decision = decideAfterSessionLoss(previous, app);
        if (decision.kind === 'end') {
          logger.info('App session ended', { appId: entry.appId, reason: decision.reason });
          this.endWindow(entry, decision.reason, decision.reopen);
          return;
        }
        try {
          const { session, connection } = await this.openSession(entry.appId);
          if (entry.ending || entry.window.isDestroyed()) {
            connection.close();
            await this.admin
              .request('app.session.close', { sessionId: session.sessionId })
              .catch(() => {});
            return;
          }
          if (!isSameGrant(previous, session)) {
            connection.close();
            await this.admin
              .request('app.session.close', { sessionId: session.sessionId })
              .catch(() => {});
            this.endWindow(entry, 'updated', true);
            return;
          }
          entry.session = session;
          this.attachConnection(entry, connection);
          logger.info('App session reopened after a lost connection', { appId: entry.appId });
          return;
        } catch (error) {
          if (Date.now() > deadline) break;
          logger.debug('App session reopen failed; retrying', {
            appId: entry.appId,
            error: error instanceof Error ? error.message : String(error),
          });
          await delay(RECOVERY_RETRY_MS);
        }
      }
      if (!entry.ending && !entry.window.isDestroyed()) {
        this.endWindow(entry, 'disconnected', false);
      }
    } finally {
      entry.recovering = false;
    }
  }

  /** Tell the app, close its window and session. `reopen`: open it again afterwards. */
  private endWindow(entry: OpenApp, reason: SessionEndReason, reopen: boolean): void {
    if (entry.ending) return;
    // From here the bridge refuses every call and the grant is gone, so the app
    // cannot keep shortcuts, always-on-top or a daemon session while it ends.
    entry.ending = true;
    this.releaseHostGrants(entry);
    entry.connection?.close();
    entry.connection = null;
    void this.admin
      .request('app.session.close', { sessionId: entry.session.sessionId })
      .catch(() => undefined);
    this.send(entry, 'session-ended', { reason });
    // destroy(), not close(): an app's beforeunload handler must not keep the window.
    const close = () => {
      if (!entry.window.isDestroyed()) entry.window.destroy();
    };
    setTimeout(close, SESSION_ENDED_CLOSE_DELAY_MS);
    if (reopen) {
      entry.window.once('closed', () => {
        void this.openApp(entry.appId).catch((error: Error) =>
          logger.warn('Could not reopen an app with its new grant', {
            appId: entry.appId,
            error: error.message,
          }),
        );
      });
    }
  }

  private onWindowClosed(entry: OpenApp): void {
    entry.ending = true;
    this.byContents.delete(entry.contentsId);
    unmarkIntentAppWindow(entry.window.id, entry.contentsId);
    if (this.open.get(entry.appId) === entry) this.open.delete(entry.appId);
    this.releaseHostGrants(entry);
    entry.connection?.close();
    entry.connection = null;
    void this.admin
      .request('app.session.close', { sessionId: entry.session.sessionId })
      .catch(() => undefined);
    this.onOpenChanged();
    logger.info('Closed app window', { appId: entry.appId });
  }

  /** Shortcuts, always-on-top and notifications that the host holds for the app. */
  private releaseHostGrants(entry: OpenApp): void {
    for (const accelerator of entry.shortcuts) globalShortcut.unregister(accelerator);
    entry.shortcuts.clear();
    for (const notification of entry.notifications.values()) notification.close();
    entry.notifications.clear();
    if (!entry.window.isDestroyed() && entry.window.isAlwaysOnTop()) {
      entry.window.setAlwaysOnTop(false);
    }
  }

  private send(entry: OpenApp, type: string, data: unknown): void {
    const contents = entry.window.isDestroyed() ? null : entry.window.webContents;
    if (contents && !contents.isDestroyed()) contents.send(CHANNELS.EVENT, { type, data });
  }

  /** The sender must be an app window's own contents and its `intent-app://<appId>/` main frame. */
  private entryForSender(event: IpcMainInvokeEvent): OpenApp | null {
    const entry = this.byContents.get(event.sender.id);
    if (!entry || entry.window.isDestroyed()) return null;
    const frame = event.senderFrame;
    if (!frame || frame !== event.sender.mainFrame) return null;
    return this.isOwnUrl(entry.appId, frame.url) ? entry : null;
  }

  private async handleInvoke(event: IpcMainInvokeEvent, message: unknown): Promise<BridgeResponse> {
    const entry = this.entryForSender(event);
    if (!entry) {
      return { ok: false, error: { code: 'forbidden', message: 'Not an app window' } };
    }
    if (entry.ending) {
      return { ok: false, error: { code: 'disconnected', message: 'The app session ended' } };
    }
    const { call, args } = (message ?? {}) as { call?: unknown; args?: unknown };
    return handleBridgeCall(this.bridgeContext(entry), call, args);
  }

  private bridgeContext(entry: OpenApp): BridgeContext {
    const session = entry.session;
    const info: AppInfo = {
      appId: entry.appId,
      name: entry.name,
      version: entry.version,
      bundleHash: session.bundleHash,
      level: session.level,
      features: [...session.features],
      platform: platformName(),
      bridgeVersion: BRIDGE_VERSION,
    };
    return {
      session,
      info,
      request: (method, params, timeoutMs) => {
        const connection = entry.connection;
        if (!connection) return Promise.reject(new AppDisconnectedError());
        return connection.request(method, params, timeoutMs);
      },
      showNotification: (notification) => this.showNotification(entry, notification),
      setAlwaysOnTop: (on) => {
        if (!entry.window.isDestroyed()) entry.window.setAlwaysOnTop(on);
      },
      close: () => {
        if (!entry.window.isDestroyed()) entry.window.close();
      },
      registerShortcut: (accelerator) => {
        if (entry.ending) return false;
        // Never take an accelerator that Intent or another app window holds.
        if (globalShortcut.isRegistered(accelerator)) return false;
        const registered = globalShortcut.register(accelerator, () =>
          this.send(entry, 'shortcut', { accelerator }),
        );
        if (registered) entry.shortcuts.add(accelerator);
        return registered;
      },
      unregisterShortcut: (accelerator) => {
        if (!entry.shortcuts.delete(accelerator)) return false;
        globalShortcut.unregister(accelerator);
        return true;
      },
      unregisterAllShortcuts: () => {
        for (const accelerator of entry.shortcuts) globalShortcut.unregister(accelerator);
        entry.shortcuts.clear();
      },
      shortcutCount: () => entry.shortcuts.size,
      ownsShortcut: (accelerator) => entry.shortcuts.has(accelerator),
    };
  }

  private showNotification(
    entry: OpenApp,
    notification: { title: string; body?: string; tag?: string },
  ): void {
    if (!Notification.isSupported()) return;
    const shown = new Notification({
      title: notification.title,
      ...(notification.body ? { body: notification.body } : {}),
      silent: false,
    });
    if (notification.tag) {
      entry.notifications.get(notification.tag)?.close();
      entry.notifications.set(notification.tag, shown);
      shown.on('close', () => {
        if (entry.notifications.get(notification.tag!) === shown) {
          entry.notifications.delete(notification.tag!);
        }
      });
    }
    shown.on('click', () => {
      if (!entry.window.isDestroyed()) this.focus(entry.window);
    });
    shown.show();
  }
}
