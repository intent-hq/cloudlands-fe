import { BrowserWindow, ipcMain, screen, powerMonitor, type IpcMainEvent } from 'electron';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { DESKTOP_OVERLAY_ROUTE } from '../../../shared/desktop-overlay';
import { stampWindowWithBackend } from '../../../main/window-backend';
import { registerDesktopOverlayWindow } from '../../../shared/main/desktop-overlay-window';
import { openDesktopControllingAgent } from './desktop-overlay-navigation';

import type { DesktopLocalSession, DesktopOverlay } from './desktop-executor';
import type { DesktopEndReason } from '../../../shared/types/desktop';

interface OverlayWindow {
  window: BrowserWindow;
  kind: 'glow' | 'controls';
  url: string;
}

interface ActiveOverlay {
  identity: DesktopLocalSession;
  stop: () => void;
  invalidate: (reason: DesktopEndReason) => void;
  windows: OverlayWindow[];
  cleanup: (() => void)[];
}

/** The caller must await readiness before admitting input and use excludedWindows for capture. */
export class DesktopControlOverlay implements DesktopOverlay {
  private active?: ActiveOverlay;

  constructor(
    private readonly options: {
      url: string;
      preload: string;
      platform?: NodeJS.Platform;
      navigate?: typeof openDesktopControllingAgent;
    },
  ) {}

  async activate(
    identity: DesktopLocalSession,
    stop: () => void,
    invalidate: (reason: DesktopEndReason) => void,
  ): Promise<void> {
    if (this.active) throw new Error('Desktop overlay is already active');
    const platform = this.options.platform ?? process.platform;
    if (platform !== 'darwin' && platform !== 'win32')
      throw new Error('Desktop overlay is unsupported on this platform');
    const entry: ActiveOverlay = {
      identity: { ...identity },
      stop,
      invalidate,
      windows: [],
      cleanup: [],
    };
    this.active = entry;
    const displayChanged = () => this.cancel(entry, 'unsupported_environment');
    const screenLocked = () => this.cancel(entry, 'screen_locked');
    // Display changes also invalidate captured display geometry. Never carry authority
    // through a topology change while replacement indicators are not yet visible.
    screen.on('display-added', displayChanged);
    screen.on('display-removed', displayChanged);
    screen.on('display-metrics-changed', displayChanged);
    powerMonitor.on('lock-screen', screenLocked);
    powerMonitor.on('suspend', screenLocked);
    entry.cleanup.push(() => {
      screen.removeListener('display-added', displayChanged);
      screen.removeListener('display-removed', displayChanged);
      screen.removeListener('display-metrics-changed', displayChanged);
      powerMonitor.removeListener('lock-screen', screenLocked);
      powerMonitor.removeListener('suspend', screenLocked);
    });
    const ready: Promise<void>[] = [];
    try {
      const displays = screen.getAllDisplays();
      if (!displays.length) throw new Error('No desktop displays available');
      for (const display of displays) {
        // Electron bounds are DIPs; multiplying by scaleFactor would double-scale
        // native window placement on mixed-DPI Windows desktops.
        ready.push(this.createWindow(entry, 'glow', display.bounds, platform));
        const area = display.workArea;
        const width = Math.min(480, area.width);
        ready.push(
          this.createWindow(
            entry,
            'controls',
            {
              x: Math.round(area.x + (area.width - width) / 2),
              y: Math.round(area.y + area.height - 64),
              width,
              height: 48,
            },
            platform,
          ),
        );
      }
      await Promise.all(ready);
      if (this.active !== entry) throw new Error('Desktop overlay start was cancelled');
      // Validate every native exclusion identifier before acknowledging readiness.
      this.excludedWindows();
      for (const { window } of entry.windows) {
        window.showInactive();
        if (!window.isVisible()) throw new Error('Desktop overlay could not be shown');
      }
    } catch (error) {
      this.cancel(entry, 'executor_failed');
      // Window creation can fail synchronously after earlier windows began loading.
      // Observe their cancellation rejections even if Promise.all was never reached.
      await Promise.allSettled(ready);
      throw error;
    }
  }

  private createWindow(
    entry: ActiveOverlay,
    kind: OverlayWindow['kind'],
    bounds: Electron.Rectangle,
    platform: NodeJS.Platform,
  ): Promise<void> {
    const window = new BrowserWindow({
      ...bounds,
      show: false,
      frame: false,
      transparent: true,
      backgroundColor: '#00000000',
      hasShadow: false,
      focusable: false,
      skipTaskbar: true,
      resizable: false,
      movable: false,
      minimizable: false,
      maximizable: false,
      fullscreenable: false,
      roundedCorners: false,
      ...(platform === 'darwin' ? { type: 'panel' as const } : {}),
      webPreferences: {
        preload: this.options.preload,
        sandbox: true,
        contextIsolation: true,
        nodeIntegration: false,
        backgroundThrottling: false,
      },
    });
    const url = `${this.options.url}?kind=${kind}`;
    entry.windows.push({ window, kind, url });
    registerDesktopOverlayWindow(window);
    stampWindowWithBackend(window, entry.identity.backendId);
    window.setAlwaysOnTop(true, 'screen-saver');
    if (platform === 'darwin')
      window.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
    window.setIgnoreMouseEvents(true, { forward: kind === 'controls' });
    // Defense in depth only on macOS: the native ScreenCaptureKit filter MUST
    // exclude excludedWindows(). On Windows the native helper verifies WDA + DWM.
    window.setContentProtection(true);
    window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    window.webContents.on('will-navigate', (event) => event.preventDefault());
    window.on('closed', () => this.cancel(entry, 'executor_failed'));
    window.webContents.on('render-process-gone', () => this.cancel(entry, 'executor_failed'));
    return new Promise<void>((resolve, reject) => {
      let settled = false;
      let painted = false;
      let rendererReady = false;
      const finish = (error?: Error) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        if (error) reject(error);
        else resolve();
      };
      const timer = setTimeout(
        () => finish(new Error('Desktop overlay renderer did not become ready')),
        10_000,
      );
      entry.cleanup.push(() => finish(new Error('Desktop overlay closed before ready')));
      const authorized = (event: IpcMainEvent) =>
        this.active === entry &&
        event.sender === window.webContents &&
        event.senderFrame === window.webContents.mainFrame &&
        event.sender.getURL() === url;
      window.once('ready-to-show', () => {
        painted = true;
        if (rendererReady) finish();
      });
      const onReady = (event: IpcMainEvent) => {
        if (!authorized(event)) return;
        rendererReady = true;
        if (painted) finish();
      };
      const onStop = (event: IpcMainEvent) => {
        if (kind === 'controls' && authorized(event)) this.cancel(entry, 'user_stop');
      };
      const onNavigate = (event: IpcMainEvent) => {
        if (kind !== 'controls' || !authorized(event)) return;
        void (this.options.navigate ?? openDesktopControllingAgent)(entry.identity).catch(() =>
          this.cancel(entry, 'executor_failed'),
        );
      };
      const onInteractive = (event: IpcMainEvent, interactive: unknown) => {
        if (kind === 'controls' && authorized(event) && typeof interactive === 'boolean')
          window.setIgnoreMouseEvents(!interactive, { forward: true });
      };
      const handlers = {
        'desktop-overlay:ready': onReady,
        'desktop-overlay:stop': onStop,
        'desktop-overlay:open-agent': onNavigate,
        'desktop-overlay:interactive': onInteractive,
      };
      for (const [channel, handler] of Object.entries(handlers)) {
        ipcMain.on(channel, handler);
        entry.cleanup.push(() => ipcMain.removeListener(channel, handler));
      }
      void window.loadURL(url).catch(() => finish(new Error('Desktop overlay failed to load')));
    });
  }

  private cancel(entry: ActiveOverlay, reason: DesktopEndReason): void {
    if (this.active !== entry) return;
    // Invalidate authority synchronously, before destroying windows or any WSS work.
    // Detach first: stop() may re-enter deactivate().
    this.active = undefined;
    try {
      if (reason === 'user_stop') entry.stop();
      else entry.invalidate(reason);
    } finally {
      this.destroy(entry);
    }
  }

  private destroy(entry: ActiveOverlay): void {
    for (const cleanup of entry.cleanup) cleanup();
    for (const { window } of entry.windows) if (!window.isDestroyed()) window.destroy();
  }

  async deactivate(sessionId: string): Promise<void> {
    const entry = this.active;
    if (!entry || entry.identity.sessionId !== sessionId) return;
    this.active = undefined;
    this.destroy(entry);
  }

  pulse(sessionId: string): void {
    const entry = this.active;
    if (!entry || entry.identity.sessionId !== sessionId) return;
    for (const { window, kind } of entry.windows) {
      if (kind === 'glow' && !window.isDestroyed())
        window.webContents.send('desktop-overlay:pulse');
    }
  }

  excludedWindows(): string[] {
    return (this.active?.windows ?? []).map(({ window }) => {
      const match = /^window:([1-9][0-9]*):[0-9]+$/.exec(window.getMediaSourceId());
      if (!match) throw new Error('Desktop overlay native capture exclusion is unavailable');
      return match[1];
    });
  }
}

let singleton: DesktopOverlay | undefined;
export function getDesktopOverlay(): DesktopOverlay {
  return (singleton ??= new DesktopControlOverlay({
    url:
      process.env.NODE_ENV === 'development'
        ? `http://127.0.0.1:${process.env.DEV_PORT || '5190'}${DESKTOP_OVERLAY_ROUTE}`
        : `app://workspaces${DESKTOP_OVERLAY_ROUTE}`,
    preload: path.resolve(
      path.dirname(fileURLToPath(import.meta.url)),
      '../../../preload/desktop-overlay.js',
    ),
  }));
}
