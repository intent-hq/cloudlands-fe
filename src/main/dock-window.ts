import path from 'path';
import { app, BrowserWindow, screen } from 'electron';
import type { Rectangle } from 'electron';
import { fileURLToPath } from 'url';
import { dirname } from 'path';
import { Logger } from '../shared/logger';
import { getActiveId } from '../features/backend/main/connections-store';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const logger = new Logger('DockWindow');

export const DOCK_ROUTE_PREFIX = '/dock';
export const DOCK_WINDOW_WIDTH = 420;

let dockWindowRef: BrowserWindow | null = null;
let removeLifecycleListeners: (() => void) | null = null;
let backendRefreshSequence: Promise<void> = Promise.resolve();

type BackendBoundDockWindow = BrowserWindow & { backendId?: string };

export function isDockRoute(route: string): boolean {
  return route === DOCK_ROUTE_PREFIX || route.startsWith(`${DOCK_ROUTE_PREFIX}/`);
}

export function isDockWindow(window: BrowserWindow): boolean {
  if (dockWindowRef === window) return true;
  try {
    if (window.isDestroyed() || window.webContents.isDestroyed?.()) return false;
    const url = window.webContents.getURL();
    return url ? isDockRoute(new URL(url).pathname) : false;
  } catch {
    return false;
  }
}

export function getDockBounds(workArea: Rectangle): Rectangle {
  const width = Math.min(DOCK_WINDOW_WIDTH, workArea.width);
  return {
    x: workArea.x + workArea.width - width,
    y: workArea.y,
    width,
    height: workArea.height,
  };
}

function buildDockUrl(): string {
  if (process.env.NODE_ENV === 'development') {
    const devPort = process.env.DEV_PORT || '5190';
    return `http://127.0.0.1:${devPort}${DOCK_ROUTE_PREFIX}`;
  }
  return `app://workspaces${DOCK_ROUTE_PREFIX}`;
}

function clearTrackedWindow(window: BrowserWindow): void {
  if (dockWindowRef !== window) return;
  removeLifecycleListeners?.();
  removeLifecycleListeners = null;
  dockWindowRef = null;
}

function moveToPrimaryDisplay(window: BrowserWindow): void {
  if (window.isDestroyed()) return;
  window.setBounds(getDockBounds(screen.getPrimaryDisplay().workArea), false);
}

function refreshDockBackend(window: BrowserWindow, closeOnFailure: boolean): void {
  backendRefreshSequence = backendRefreshSequence
    .then(async () => {
      const backendId = await getActiveId();
      if (window.isDestroyed() || dockWindowRef !== window) return;
      (window as BackendBoundDockWindow).backendId = backendId;
      await window.loadURL(buildDockUrl());
    })
    .catch((error: unknown) => {
      logger.warn('Failed to load dock for active backend', { error });
      if (!closeOnFailure || window.isDestroyed()) return;
      clearTrackedWindow(window);
      window.destroy();
    });
}

function attachLifecycleListeners(window: BrowserWindow): void {
  const backendEvents = app as unknown as {
    on(event: string, listener: () => void): void;
    off(event: string, listener: () => void): void;
  };
  const updateBounds = (): void => moveToPrimaryDisplay(window);
  const refreshBackend = (): void => {
    if (window.isDestroyed()) return;
    refreshDockBackend(window, false);
  };

  screen.on('display-metrics-changed', updateBounds);
  screen.on('display-removed', updateBounds);
  backendEvents.on('backend-connection-changed', refreshBackend);
  removeLifecycleListeners = () => {
    screen.off('display-metrics-changed', updateBounds);
    screen.off('display-removed', updateBounds);
    backendEvents.off('backend-connection-changed', refreshBackend);
  };

  window.on('closed', () => clearTrackedWindow(window));
  window.webContents.on('render-process-gone', (_event, details) => {
    logger.warn('Dock renderer exited; closing dock window', { reason: details.reason });
    clearTrackedWindow(window);
    if (!window.isDestroyed()) window.destroy();
  });
}

function configurePlatformBehavior(window: BrowserWindow): void {
  window.setAlwaysOnTop(true, 'floating');
  window.setFullScreenable(false);
  if (process.platform === 'darwin') {
    window.setVisibleOnAllWorkspaces(true, {
      visibleOnFullScreen: true,
      skipTransformProcessType: true,
    });
  }
}

export function createDockWindow(): BrowserWindow {
  const existing = getDockWindow();
  if (existing) return existing;

  const bounds = getDockBounds(screen.getPrimaryDisplay().workArea);
  const window = new BrowserWindow({
    ...bounds,
    show: false,
    frame: false,
    transparent: true,
    backgroundColor: '#00000000',
    alwaysOnTop: true,
    skipTaskbar: true,
    resizable: false,
    movable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    hasShadow: false,
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      webviewTag: true,
    },
  });

  dockWindowRef = window;
  attachLifecycleListeners(window);
  configurePlatformBehavior(window);
  window.once('ready-to-show', () => {
    if (!window.isDestroyed()) window.showInactive();
  });
  refreshDockBackend(window, true);
  return window;
}

export function getDockWindow(): BrowserWindow | null {
  if (dockWindowRef && !dockWindowRef.isDestroyed()) return dockWindowRef;
  if (dockWindowRef) clearTrackedWindow(dockWindowRef);
  return null;
}

export function focusDockWindow(): void {
  const window = getDockWindow();
  if (!window) return;
  window.show();
  window.focus();
}

export function closeDockWindow(): void {
  const window = getDockWindow();
  if (!window) return;
  clearTrackedWindow(window);
  window.close();
}

export function _resetDockWindowForTests(): void {
  removeLifecycleListeners?.();
  removeLifecycleListeners = null;
  dockWindowRef = null;
  backendRefreshSequence = Promise.resolve();
}
