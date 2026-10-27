import path from 'path';
import { app, BrowserWindow, screen, powerMonitor } from 'electron';
import type { Rectangle } from 'electron';
import { fileURLToPath } from 'url';
import { dirname } from 'path';
import { Logger } from '../shared/logger';
import { getActiveId, list as listConnections } from '../features/backend/main/connections-store';
import {
  DOCK_WINDOW_WIDTH,
  isPointInDockPointerRegions,
  type DockPointerRect,
} from '../shared/dock-layout';
import { WINDOW_CHANNELS } from '../shared/ipc/channels';
import {
  getBackendIdForWindow,
  getStrictBackendBindingForWebContents,
  stampWindowWithBackend,
} from './window-backend';
import { DockPlacementController } from './dock-placement-controller';
import { attachDockCursor } from './dock-cursor';
import type { DockPlacementCommand, DockPlacementSnapshot } from '../shared/dock-placement';
import type {
  DockBackendSwitchFailed,
  SwitchDockBackendRequest,
  SwitchDockBackendResult,
} from '../shared/dock-connection';
import { DOCK_BACKEND_SWITCH_FAILED_QUERY } from '../shared/dock-connection';
import { getLocalPref, setLocalPref, deleteLocalPref } from './local-prefs';
import { LOCAL_CONNECTION_ID } from '../shared/types/connections';

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
const closingDockWindows = new WeakSet<BrowserWindow>();
let removeLifecycleListeners: (() => void) | null = null;
let backendRefreshSequence: Promise<void> = Promise.resolve();
let selectedDockBackendId: string | null = null;
let dockBackendPreferenceLoaded = false;
const DOCK_BACKEND_PREFERENCE = 'dockBackendId';
interface DockBackendSwitch {
  window: BrowserWindow;
  cancelled: boolean;
  phase: 'probe' | 'handoff';
  expectedNavigation: string | null;
}
let pendingBackendSwitch: DockBackendSwitch | null = null;
const DOCK_BACKEND_PROBE_TIMEOUT_MS = 15_000;
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
  if (pendingBackendSwitch?.window === window) {
    pendingBackendSwitch.cancelled = true;
    pendingBackendSwitch = null;
  }
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

async function resolveDockBackendId(): Promise<string> {
  const saved = await listConnections();
  if (!dockBackendPreferenceLoaded) {
    const preference = await getLocalPref(DOCK_BACKEND_PREFERENCE);
    dockBackendPreferenceLoaded = true;
    if (typeof preference === 'string' && saved.some((connection) => connection.id === preference))
      selectedDockBackendId = preference;
    else if (preference !== undefined) await deleteLocalPref(DOCK_BACKEND_PREFERENCE);
  }
  if (selectedDockBackendId) {
    if (saved.some((connection) => connection.id === selectedDockBackendId))
      return selectedDockBackendId;
    selectedDockBackendId = null;
    await deleteLocalPref(DOCK_BACKEND_PREFERENCE);
  }
  const defaultId = await getActiveId();
  return saved.some((connection) => connection.id === defaultId) ? defaultId : LOCAL_CONNECTION_ID;
}

function refreshDockBackend(window: BrowserWindow, closeOnFailure: boolean): void {
  if (pendingBackendSwitch || captureHiddenWindows.has(window)) return;
  backendRefreshSequence = backendRefreshSequence
    .then(async () => {
      const backendId = await resolveDockBackendId();
      if (
        window.isDestroyed() ||
        dockWindowRef !== window ||
        pendingBackendSwitch ||
        captureHiddenWindows.has(window)
      )
        return;
      placementController?.cancelInteraction();
      resetDockPointerRouting(window);
      // Retire an existing renderer before changing even legacy window-level routing.
      if (window.webContents.getURL() && getBackendIdForWindow(window) !== backendId) {
        await window.loadURL('about:blank');
        if (window.isDestroyed() || dockWindowRef !== window || pendingBackendSwitch) return;
      }
      stampWindowWithBackend(window, backendId);
      await window.loadURL(buildDockUrl());
    })
    .catch((error: unknown) => {
      logger.warn('Failed to load dock for active backend', { error });
      if (!closeOnFailure || window.isDestroyed() || dockWindowRef !== window) return;
      clearTrackedWindow(window);
      window.destroy();
    });
}

/** Probe without changing any global connection preference or workspace window. */
export async function switchDockBackend(
  window: BrowserWindow,
  request: SwitchDockBackendRequest,
  senderFrame: Electron.WebFrameMain,
): Promise<SwitchDockBackendResult> {
  if (window !== getDockWindow() || window.isDestroyed() || window.webContents.isDestroyed())
    throw new Error('Only the live dock can select its machine');
  const binding = getStrictBackendBindingForWebContents(window.webContents);
  const available = (): boolean =>
    window === getDockWindow() &&
    !window.isDestroyed() &&
    !window.webContents.isDestroyed() &&
    !closingDockWindows.has(window) &&
    !captureHiddenWindows.has(window) &&
    !sessionPaused;
  if (
    !available() ||
    pendingBackendSwitch ||
    !binding ||
    binding.frame !== senderFrame ||
    !isDockRoute(new URL(window.webContents.getURL()).pathname)
  )
    throw new Error('The dock document is unavailable for machine selection');
  const operation: DockBackendSwitch = {
    window,
    cancelled: false,
    phase: 'probe',
    expectedNavigation: null,
  };
  pendingBackendSwitch = operation;
  const current = (): boolean =>
    pendingBackendSwitch === operation &&
    !operation.cancelled &&
    available() &&
    getStrictBackendBindingForWebContents(window.webContents) === binding;
  let timeout: ReturnType<typeof setTimeout> | undefined;
  let connectionStillCurrent = (): boolean => false;
  try {
    const probe = async (): Promise<void> => {
      const saved = await listConnections();
      if (!current()) throw new Error('Dock machine selection was cancelled');
      if (!saved.some((connection) => connection.id === request.backendId))
        throw new Error('Unknown saved machine');
      const pool = await import('../features/backend/main/backend.ipc');
      const client = await pool.connectBackendClient(request.backendId);
      connectionStillCurrent = () =>
        pool.getBackendClientForConnection(request.backendId) === client &&
        client.getStatus() === 'connected';
      if (!current()) throw new Error('Dock machine selection was cancelled');
      // The client queues this authenticated request until connected; construction alone is not readiness.
      await client.request('host.status', undefined, { timeoutMs: DOCK_BACKEND_PROBE_TIMEOUT_MS });
      if (!current() || !connectionStillCurrent())
        throw new Error('Dock machine connection was replaced');
      if (!(await listConnections()).some((connection) => connection.id === request.backendId))
        throw new Error('Selected machine was removed');
    };
    await Promise.race([
      probe(),
      new Promise<never>((_resolve, reject) => {
        timeout = setTimeout(
          () => reject(new Error('Dock machine connection timed out')),
          DOCK_BACKEND_PROBE_TIMEOUT_MS,
        );
      }),
    ]);
    if (!current()) throw new Error('Dock machine selection was cancelled');
    const previousBackendId = binding.backendId;
    const previousOverride = selectedDockBackendId;
    // The invoke must return to the old document before native navigation retires it.
    setImmediate(() => {
      if (!current() || !connectionStillCurrent()) {
        const notifyOriginalDocument =
          pendingBackendSwitch === operation &&
          window === getDockWindow() &&
          !window.isDestroyed() &&
          !closingDockWindows.has(window) &&
          !window.webContents.isDestroyed() &&
          getStrictBackendBindingForWebContents(window.webContents) === binding;
        if (pendingBackendSwitch === operation) pendingBackendSwitch = null;
        if (notifyOriginalDocument) {
          try {
            window.webContents.send(WINDOW_CHANNELS.DOCK_BACKEND_SWITCH_FAILED, {
              backendId: request.backendId,
            } satisfies DockBackendSwitchFailed);
          } catch (error) {
            logger.warn('Failed to notify dock of cancelled machine selection', { error });
          }
        }
        return;
      }
      operation.phase = 'handoff';
      const owned = (): boolean =>
        pendingBackendSwitch === operation &&
        window === getDockWindow() &&
        !window.isDestroyed() &&
        !window.webContents.isDestroyed();
      const navigate = async (url: string): Promise<void> => {
        operation.expectedNavigation = url;
        await window.loadURL(url);
      };
      void (async () => {
        try {
          placementController?.cancelInteraction();
          resetDockPointerRouting(window);
          await navigate('about:blank');
          if (!owned()) return;
          if (operation.cancelled || !available() || !connectionStillCurrent())
            throw new Error('Dock machine handoff cancelled');
          stampWindowWithBackend(window, request.backendId);
          await navigate(buildDockUrl());
          if (!owned()) return;
          if (operation.cancelled || !available())
            throw new Error('Dock machine handoff cancelled');
          selectedDockBackendId = request.backendId;
          await setLocalPref(DOCK_BACKEND_PREFERENCE, request.backendId);
        } catch (error) {
          logger.warn('Failed to switch dock machine; restoring prior binding', { error });
          if (!owned()) return;
          try {
            // Never rebind a possibly loaded target document to the previous machine.
            await navigate('about:blank');
            if (!owned()) return;
            stampWindowWithBackend(window, previousBackendId);
            selectedDockBackendId = previousOverride;
            await navigate(`${buildDockUrl()}?${DOCK_BACKEND_SWITCH_FAILED_QUERY}=1`);
          } catch (restoreError) {
            logger.warn('Failed to restore dock machine', { error: restoreError });
            if (owned()) {
              clearTrackedWindow(window);
              window.destroy();
            }
          }
        } finally {
          if (pendingBackendSwitch === operation) pendingBackendSwitch = null;
        }
      })();
    });
    return { success: true };
  } catch (error) {
    operation.cancelled = true;
    if (pendingBackendSwitch === operation) pendingBackendSwitch = null;
    throw error;
  } finally {
    clearTimeout(timeout);
  }
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
    if (pendingBackendSwitch?.window === window) pendingBackendSwitch.cancelled = true;
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
  window.webContents.on('did-start-navigation', (_event, url, inPlace, mainFrame) => {
    const operation = pendingBackendSwitch;
    if (!operation || operation.window !== window || inPlace || !mainFrame) return;
    if (operation.phase === 'handoff' && operation.expectedNavigation === url) {
      operation.expectedNavigation = null;
    } else operation.cancelled = true;
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
  window.on('close', () => {
    closingDockWindows.add(window);
    if (pendingBackendSwitch?.window === window) pendingBackendSwitch.cancelled = true;
    resetPointerRouting();
  });
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
    // Feedback begins with a dock click, before annotation owns the lifecycle.
    // Avoid activating the app (and raising its workspace windows) at that point.
    ...(process.platform === 'darwin' ? { type: 'panel' as const } : {}),
    acceptFirstMouse: true,
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
    if (pendingBackendSwitch?.window === window) pendingBackendSwitch.cancelled = true;
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
