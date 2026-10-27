import path from 'path';
import { app, BrowserWindow, screen, powerMonitor } from 'electron';
import type { Rectangle } from 'electron';
import { fileURLToPath } from 'url';
import { dirname } from 'path';
import { Logger } from '../shared/logger';
import { getActiveId } from '../features/backend/main/connections-store';
import {
  DOCK_WINDOW_WIDTH,
  isPointInDockPointerRegions,
  type DockPointerRect,
} from '../shared/dock-layout';
import { WINDOW_CHANNELS } from '../shared/ipc/channels';
import { stampWindowWithBackend } from './window-backend';
import { DockPlacementController } from './dock-placement-controller';
import { attachDockCursor } from './dock-cursor';
import type { DockPlacementCommand, DockPlacementSnapshot } from '../shared/dock-placement';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const logger = new Logger('DockWindow');

const DOCK_ROUTE_PREFIX = '/dock';

let dockWindowRef: BrowserWindow | null = null;
let placementController: DockPlacementController | null = null;
let pointerState: { active: boolean; regions: DockPointerRect[]; revision?: number } = {
  active: false,
  regions: [],
};
let sessionPaused = false;
const captureHiddenWindows = new WeakSet<BrowserWindow>();
let removeLifecycleListeners: (() => void) | null = null;
let backendRefreshSequence: Promise<void> = Promise.resolve();
let dockCursor: ReturnType<typeof attachDockCursor>;
const appliedPointerRouting = new WeakMap<BrowserWindow, { ignore: boolean; forward: boolean }>();

function applyPointerRouting(window: BrowserWindow, ignore: boolean): void {
  const forward = ignore;
  const applied = appliedPointerRouting.get(window);
  if (applied?.ignore === ignore && applied.forward === forward) return;
  try {
    if (ignore) window.setIgnoreMouseEvents(true, { forward: true });
    else window.setIgnoreMouseEvents(false);
    appliedPointerRouting.set(window, { ignore, forward });
  } catch (error) {
    // A failed native write must never suppress the next recovery attempt.
    appliedPointerRouting.delete(window);
    throw error;
  }
}

function updateNativeCursor(window: BrowserWindow, interactive: boolean): void {
  const snapshot = placementController?.getSnapshot();
  dockCursor?.update({
    regions: pointerState.regions,
    excludedRegions: snapshot?.cutout ? [snapshot.cutout] : [],
    revision: snapshot?.revision ?? 0,
    enabled:
      interactive &&
      pointerState.active &&
      pointerState.revision === snapshot?.revision &&
      !sessionPaused &&
      !captureHiddenWindows.has(window) &&
      window.isVisible(),
  });
}

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

function getDockBounds(workArea: Rectangle): Rectangle {
  const width = Math.min(DOCK_WINDOW_WIDTH, workArea.width);
  return {
    x: workArea.x + workArea.width - width,
    y: workArea.y,
    width,
    height: workArea.height,
  };
}

function supportsDockPointerForwarding(platform: NodeJS.Platform): boolean {
  return platform === 'darwin' || platform === 'win32';
}

/**
 * Keep only an active dock surface interactive. On Linux, Electron cannot
 * forward mouse moves through an ignored window, so leave the window interactive.
 */
export function setDockPointerRegions(
  window: BrowserWindow,
  state: { active: boolean; regions: DockPointerRect[]; revision?: number },
  platform: NodeJS.Platform = process.platform,
  cursorPoint = screen.getCursorScreenPoint(),
): boolean {
  if (window !== dockWindowRef || window.isDestroyed()) return false;
  const snapshot = placementController?.getSnapshot();
  if (snapshot && state.revision !== snapshot.revision) return false;
  pointerState = state;
  try {
    if (placementController?.isDragging || placementController?.isResizing) {
      applyPointerRouting(window, false);
      updateNativeCursor(window, true);
      return true;
    }
    if (!supportsDockPointerForwarding(platform)) {
      applyPointerRouting(window, false);
      updateNativeCursor(window, false);
      return false;
    }
    const bounds = window.getBounds();
    const localPoint = { x: cursorPoint.x - bounds.x, y: cursorPoint.y - bounds.y };
    const interactive = state.active && isPointInDockPointerRegions(localPoint, state.regions);
    applyPointerRouting(window, !interactive);
    updateNativeCursor(window, interactive);
    return true;
  } catch (error) {
    updateNativeCursor(window, false);
    appliedPointerRouting.delete(window);
    logger.warn('Failed to update dock pointer routing', { error });
    try {
      applyPointerRouting(window, false);
    } catch {
      // The window may already be closing. There is no further safe recovery.
    }
    return false;
  }
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
  if (!window.isDestroyed()) resetDockPointerRouting(window);
  appliedPointerRouting.delete(window);
  dockCursor?.dispose();
  dockCursor = undefined;
  placementController?.dispose();
  placementController = null;
  removeLifecycleListeners?.();
  removeLifecycleListeners = null;
  dockWindowRef = null;
}

function resetDockPointerRouting(window: BrowserWindow): void {
  const revision = placementController?.getSnapshot()?.revision;
  setDockPointerRegions(window, { active: false, regions: [], revision });
}

export function getDockPlacementSnapshot(window: BrowserWindow): DockPlacementSnapshot | null {
  return window === getDockWindow() ? (placementController?.getSnapshot() ?? null) : null;
}

export async function updateDockPlacement(
  window: BrowserWindow,
  command: DockPlacementCommand,
): Promise<DockPlacementSnapshot | null> {
  if (window !== getDockWindow() || captureHiddenWindows.has(window) || sessionPaused)
    return getDockPlacementSnapshot(window);
  if (command.action === 'dismiss') {
    placementController?.cancelInteraction();
    // Let the validated invoke return before destroying its sending webContents.
    // Recheck ownership: capture may acquire visibility before this callback runs.
    setImmediate(() => {
      if (window !== getDockWindow() || captureHiddenWindows.has(window) || sessionPaused) return;
      try {
        closeDockWindow();
      } catch (error) {
        logger.warn('Failed to dismiss dock window', { error });
      }
    });
    return getDockPlacementSnapshot(window);
  }
  // Gesture initiation enables input directly in the controller before onLayout
  // reapplies routing. Invalidate first so cancellation cannot reuse an old
  // ignored state after that successful direct write.
  if (command.action === 'begin-drag' || command.action === 'begin-resize')
    appliedPointerRouting.delete(window);
  return placementController?.command(command) ?? null;
}

function refreshDockBackend(window: BrowserWindow, closeOnFailure: boolean): void {
  backendRefreshSequence = backendRefreshSequence
    .then(async () => {
      const backendId = await getActiveId();
      if (window.isDestroyed() || dockWindowRef !== window) return;
      placementController?.cancelInteraction();
      resetDockPointerRouting(window);
      stampWindowWithBackend(window, backendId);
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
  const dockContents = window.webContents;
  const backendEvents = app as unknown as {
    on(event: string, listener: () => void): void;
    off(event: string, listener: () => void): void;
  };
  const updateBounds = (): void => {
    void placementController
      ?.refreshDisplays()
      .catch((error) => logger.warn('Failed to refresh dock placement', { error }));
  };
  let suspended = false;
  let locked = false;
  const pause = (): void => {
    sessionPaused = suspended || locked;
    placementController?.cancelInteraction();
    if (!window.isDestroyed()) window.hide();
  };
  const resume = (): void => {
    sessionPaused = suspended || locked;
    updateBounds();
    if (!window.isDestroyed() && !captureHiddenWindows.has(window) && !sessionPaused)
      window.showInactive();
  };
  const refreshBackend = (): void => {
    if (window.isDestroyed()) return;
    refreshDockBackend(window, false);
  };
  const resetPointerRouting = (): void => {
    if (dockWindowRef !== window) return;
    dockCursor?.cursorChanged('default');
    placementController?.cancelInteraction();
    if (!window.isDestroyed()) resetDockPointerRouting(window);
  };

  const suspend = (): void => {
    suspended = true;
    pause();
  };
  const lock = (): void => {
    locked = true;
    pause();
  };
  const wake = (): void => {
    suspended = false;
    resume();
  };
  const unlock = (): void => {
    locked = false;
    resume();
  };
  screen.on('display-added', updateBounds);
  screen.on('display-metrics-changed', updateBounds);
  powerMonitor.on('suspend', suspend);
  powerMonitor.on('lock-screen', lock);
  powerMonitor.on('resume', wake);
  powerMonitor.on('unlock-screen', unlock);
  const pointerTimer = setInterval(() => {
    if (!window.isDestroyed() && window.isVisible()) setDockPointerRegions(window, pointerState);
  }, 50);
  const refreshCursorRouting = (_event: Electron.Event, type: string): void => {
    if (dockWindowRef === window && !window.isDestroyed() && window.isVisible()) {
      setDockPointerRegions(window, pointerState);
      dockCursor?.cursorChanged(type);
    }
  };
  // Forwarded movement can request a header cursor before the next native poll.
  // Apply the same revision/region/OS-point guards at that handoff immediately.
  dockContents.on('cursor-changed', refreshCursorRouting);
  screen.on('display-removed', updateBounds);
  backendEvents.on('backend-connection-changed', refreshBackend);
  removeLifecycleListeners = () => {
    clearInterval(pointerTimer);
    // The BrowserWindow may already be destroyed when its closed listener runs.
    dockContents.off('cursor-changed', refreshCursorRouting);
    screen.off('display-added', updateBounds);
    screen.off('display-metrics-changed', updateBounds);
    powerMonitor.off('suspend', suspend);
    powerMonitor.off('lock-screen', lock);
    powerMonitor.off('resume', wake);
    powerMonitor.off('unlock-screen', unlock);
    screen.off('display-removed', updateBounds);
    backendEvents.off('backend-connection-changed', refreshBackend);
  };

  window.webContents.on('before-input-event', (event, input) => {
    if (
      dockWindowRef === window &&
      input.key === 'Escape' &&
      (placementController?.isDragging || placementController?.isResizing)
    ) {
      event.preventDefault();
      placementController.cancelInteraction();
    }
  });
  window.webContents.on('did-start-loading', () => {
    if (dockWindowRef !== window) return;
    dockCursor?.cursorChanged('default');
    placementController?.cancelInteraction();
    resetDockPointerRouting(window);
  });
  window.on('closed', () => clearTrackedWindow(window));
  window.on('blur', () => {
    if (dockWindowRef !== window) return;
    placementController?.cancelInteraction();
    // Focus loss does not invalidate visible hit regions. The renderer deduplicates
    // unchanged geometry, so clearing them here would leave a compact dock inert.
    // The cursor poll still forwards input outside the accepted regions.
  });
  window.on('hide', resetPointerRouting);
  window.on('close', resetPointerRouting);
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
    // Use a borderless NSWindow: the hidden native titlebar otherwise owns the
    // top strip's cursor. The renderer supplies every visible dock corner.
    roundedCorners: false,
    // ElectronNSWindow otherwise constrains a frameless window below the menu bar.
    // Our geometry resolver bounds detached surfaces; the notch must reach display y=0.
    enableLargerThanScreen: process.platform === 'darwin',
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
  dockCursor = attachDockCursor(window);
  placementController = new DockPlacementController(
    window,
    () => resetDockPointerRouting(window),
    () => !sessionPaused && !captureHiddenWindows.has(window),
  );
  resetDockPointerRouting(window);
  void placementController
    .initialize()
    .catch((error) => logger.warn('Failed to restore dock placement', { error }));
  window.once('ready-to-show', () => {
    if (!window.isDestroyed() && !captureHiddenWindows.has(window) && !sessionPaused)
      window.showInactive();
  });
  refreshDockBackend(window, true);
  return window;
}

export function getDockWindow(): BrowserWindow | null {
  if (dockWindowRef && !dockWindowRef.isDestroyed()) return dockWindowRef;
  if (dockWindowRef) clearTrackedWindow(dockWindowRef);
  return null;
}

/** Capture owns visibility until it finishes, even if the first paint arrives late. */
export function setDockHiddenForCapture(hidden: boolean): void {
  const window = getDockWindow();
  if (!window) return;
  if (hidden) {
    captureHiddenWindows.add(window);
    placementController?.setCaptureHidden(true);
    window.hide();
  } else {
    captureHiddenWindows.delete(window);
    placementController?.setCaptureHidden(false);
    if (!sessionPaused) window.showInactive();
  }
}

export function focusDockWindow(): void {
  const window = getDockWindow();
  if (!window || captureHiddenWindows.has(window) || sessionPaused) return;
  window.show();
  window.focus();
  if (!window.webContents.isDestroyed()) window.webContents.send(WINDOW_CHANNELS.FOCUS_DOCK);
}

export function closeDockWindow(): void {
  const window = getDockWindow();
  if (!window) return;
  clearTrackedWindow(window);
  window.close();
}
