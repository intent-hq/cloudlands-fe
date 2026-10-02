import { app, BrowserWindow, ipcMain, type IpcMainInvokeEvent } from 'electron';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { getBackendIdForWindow, stampWindowWithBackend } from '../../../main/window-backend';
import { DEV_CONSOLE_ROUTE } from '../../../shared/dev-console-route';
import { devConsoleRequests } from '../../../shared/ipc/dev-console-contract';
import { devConsoleCapture } from './dev-console-service';
import type { DevConsoleCaptureService } from './dev-console-capture';

interface ConsoleWindow {
  window: BrowserWindow;
  sessionId: string;
  stop: () => void;
  timer?: ReturnType<typeof setTimeout>;
  notified: boolean;
}

/** One native window per backend; owns every capture session and invalidation listener. */
export class DevConsoleWindows {
  private readonly windows = new Map<string, ConsoleWindow>();
  constructor(
    private readonly capture: DevConsoleCaptureService,
    private readonly options: { preload: string; url: string },
  ) {}

  open(backendId: string): BrowserWindow {
    const existing = this.windows.get(backendId);
    if (existing && !existing.window.isDestroyed()) {
      if (existing.window.isMinimized()) existing.window.restore();
      existing.window.show();
      existing.window.focus();
      return existing.window;
    }
    const window = new BrowserWindow({
      width: 1200,
      height: 800,
      minWidth: 640,
      minHeight: 400,
      show: false,
      title: 'Dev Console', // i18n-ignore (developer tool name)
      webPreferences: {
        preload: this.options.preload,
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
      },
    });
    stampWindowWithBackend(window, backendId);
    const entry: ConsoleWindow = { window, sessionId: '', stop: () => {}, notified: false };
    this.windows.set(backendId, entry);
    this.start(backendId, entry);
    const cleanup = () => this.close(backendId, entry);
    window.once('closed', cleanup);
    window.webContents.once('destroyed', cleanup);
    window.webContents.on('render-process-gone', cleanup);
    window.webContents.on('did-fail-load', (_event, _code, _description, _url, isMainFrame) => {
      if (isMainFrame) cleanup();
    });
    // End the old session before a reload can create new renderer subscriptions.
    window.webContents.on('did-start-navigation', (_event, url, inPlace, isMainFrame) => {
      if (!isMainFrame || inPlace || this.windows.get(backendId) !== entry) return;
      if (url !== this.options.url) {
        cleanup();
        return;
      }
      this.stop(backendId, entry);
      this.start(backendId, entry);
    });
    window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    window.webContents.on('will-navigate', (event, url) => {
      if (url !== this.options.url) event.preventDefault();
    });
    window.once('ready-to-show', () => {
      if (!window.isDestroyed()) window.show();
    });
    void window.loadURL(this.options.url).catch(cleanup);
    return window;
  }

  private start(backendId: string, entry: ConsoleWindow): void {
    entry.sessionId = this.capture.openSession(backendId).sessionId;
    entry.notified = false;
    entry.stop = this.capture.subscribe(backendId, entry.sessionId, () => {
      // At most one outstanding signal until the renderer acknowledges with READ.
      if (entry.timer || entry.notified) return;
      entry.timer = setTimeout(() => {
        entry.timer = undefined;
        if (entry.window.isDestroyed() || entry.window.webContents.isDestroyed()) return;
        entry.notified = true;
        try {
          entry.window.webContents.send('dev-console:changed', { sessionId: entry.sessionId });
        } catch {
          this.close(backendId, entry);
        }
      }, 100);
    });
  }

  private stop(backendId: string, entry: ConsoleWindow): void {
    if (entry.timer) clearTimeout(entry.timer);
    entry.timer = undefined;
    entry.stop();
    this.capture.closeSession(backendId, entry.sessionId);
  }

  private close(backendId: string, entry: ConsoleWindow): void {
    if (this.windows.get(backendId) !== entry) return;
    this.windows.delete(backendId);
    this.stop(backendId, entry);
    if (!entry.window.isDestroyed()) entry.window.destroy();
  }

  dispose(): void {
    for (const [backendId, entry] of this.windows) this.close(backendId, entry);
  }

  /** Derive identity from native window references, never renderer-supplied backend IDs. */
  authorize(
    event: IpcMainInvokeEvent,
    sessionId?: string,
  ): { backendId: string; sessionId: string } {
    const window = this.sender(event);
    const backendId = getBackendIdForWindow(window);
    const entry = this.windows.get(backendId);
    if (
      !entry ||
      entry.window !== window ||
      event.sender.getURL() !== this.options.url ||
      (sessionId !== undefined && entry.sessionId !== sessionId)
    ) {
      throw new Error('Unauthorized Dev Console session');
    }
    return { backendId, sessionId: entry.sessionId };
  }

  sender(event: IpcMainInvokeEvent): BrowserWindow {
    const window = BrowserWindow.fromWebContents(event.sender);
    if (
      !window ||
      window.isDestroyed() ||
      event.sender.isDestroyed() ||
      event.senderFrame !== event.sender.mainFrame
    )
      throw new Error('Unauthorized Dev Console sender');
    const url = new URL(event.sender.getURL());
    const target = new URL(this.options.url);
    if (url.protocol !== target.protocol || url.host !== target.host)
      throw new Error('Unauthorized Dev Console origin');
    return window;
  }

  read(event: IpcMainInvokeEvent, sessionId: string, afterRevision: number) {
    const identity = this.authorize(event, sessionId);
    const entry = this.windows.get(identity.backendId)!;
    entry.notified = false;
    if (entry.timer) clearTimeout(entry.timer);
    entry.timer = undefined;
    return this.capture.getUpdate(identity.backendId, sessionId, afterRevision);
  }
}

export function registerDevConsoleIPC(
  windows: DevConsoleWindows,
  capture: DevConsoleCaptureService,
): () => void {
  // Deliberately bypass the general IPC debug tracker: responses can contain private payloads.
  ipcMain.handle('dev-console:open', (event, data) => {
    devConsoleRequests['dev-console:open'].parse(data);
    return { windowId: windows.open(getBackendIdForWindow(windows.sender(event))).id };
  });
  ipcMain.handle('dev-console:connect', (event, data) => {
    devConsoleRequests['dev-console:connect'].parse(data);
    return windows.authorize(event);
  });
  ipcMain.handle('dev-console:read', (event, data) => {
    const request = devConsoleRequests['dev-console:read'].parse(data);
    return windows.read(event, request.sessionId, request.afterRevision);
  });
  ipcMain.handle('dev-console:record', (event, data) => {
    const request = devConsoleRequests['dev-console:record'].parse(data);
    const { backendId } = windows.authorize(event, request.sessionId);
    return capture.getRecord(backendId, request.sessionId, request.recordId);
  });
  ipcMain.handle('dev-console:clear', (event, data) => {
    const request = devConsoleRequests['dev-console:clear'].parse(data);
    const { backendId } = windows.authorize(event, request.sessionId);
    return capture.clearSession(backendId, request.sessionId);
  });
  ipcMain.handle('dev-console:select', (event, data) => {
    const request = devConsoleRequests['dev-console:select'].parse(data);
    const { backendId } = windows.authorize(event, request.sessionId);
    return capture.setFullCapture(backendId, request.sessionId, request.selection, request.enabled);
  });
  const dispose = () => windows.dispose();
  app.on('will-quit', dispose);
  return () => {
    app.off('will-quit', dispose);
    windows.dispose();
    for (const channel of Object.keys(devConsoleRequests)) ipcMain.removeHandler(channel);
  };
}

let stopProduction: (() => void) | undefined;
export function disposeDevConsole(): void {
  stopProduction?.();
  stopProduction = undefined;
}

export function setupDevConsoleIPC(): void {
  const url =
    process.env.NODE_ENV === 'development'
      ? `http://127.0.0.1:${process.env.DEV_PORT || '5190'}${DEV_CONSOLE_ROUTE}`
      : `app://workspaces${DEV_CONSOLE_ROUTE}`;
  stopProduction = registerDevConsoleIPC(
    new DevConsoleWindows(devConsoleCapture, {
      preload: path.resolve(
        path.dirname(fileURLToPath(import.meta.url)),
        '../../../preload/index.js',
      ),
      url,
    }),
    devConsoleCapture,
  );
}
