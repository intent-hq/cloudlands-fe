import path from 'path';
import { app, BrowserWindow, screen, powerMonitor } from 'electron';
import type { Rectangle } from 'electron';
import { fileURLToPath } from 'url';
import { dirname } from 'path';
import { Logger } from '../shared/logger';
import {
  getActiveId,
  list as listConnections,
} from '../features/backend/main/desktop-connections-store';
import {
  DOCK_WINDOW_WIDTH,
  isPointInDockPointerRegions,
  type DockPointerRect,
} from '../shared/dock-layout';
import { WINDOW_CHANNELS } from '../shared/ipc/channels';
import {
  getBackendIdForWindow,
  getStrictBackendBindingForWebContents,
  onStrictBackendBindingRetired,
  stampWindowWithBackend,
} from './window-backend';
import { DockPlacementController } from './dock-placement-controller';
import { attachDockCursor } from './dock-cursor';
import { fixWebContentsZoom } from './fixed-zoom';
import { createDockPointerPresenceTracker } from './dock-pointer-presence';
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
/**
 * The hit regions the dock had when a system selection hid it. Hiding clears the live
 * regions (as any hide must), but the selection keeps the document mounted and the
 * renderer deduplicates unchanged geometry, so it never republishes them: on reveal the
 * dock would be click-through everywhere. Restored only for the same document and
 * placement revision, and only if nothing newer arrived meanwhile.
 */
let selectionRegions: {
  window: BrowserWindow;
  document: number;
  state: { active: boolean; regions: DockPointerRect[]; revision?: number };
  /** The reset in effect when the selection began: the hide's reset must be a new one. */
  resetBefore: object | null;
} | null = null;
/** The state object the last hide/close reset installed (identity, not value). */
let lastResetState: object | null = null;
/** Counts main-frame navigations of the dock: hit regions belong to one document. */
let dockDocument = 0;
let pointerState: { active: boolean; regions: DockPointerRect[]; revision?: number } = {
  active: false,
  regions: [],
};
let sessionPaused = false;
const captureHiddenWindows = new WeakSet<BrowserWindow>();
/**
 * The recording that keeps the dock out of sight (transparent, click-through and not
 * focusable, still shown): only that clip, on that window, brings it back.
 */
let recordingHide: { window: BrowserWindow; clipId: string } | null = null;
const recordingHidden = (window: BrowserWindow) => recordingHide?.window === window;
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

export function isDockWindow(window: BrowserWindow | null | undefined): boolean {
  if (!window) return false;
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

const lastForwardedMove = new WeakMap<BrowserWindow, { x: number; y: number }>();
const pointerPresence = new WeakMap<
  BrowserWindow,
  ReturnType<typeof createDockPointerPresenceTracker>
>();
function presenceFor(window: BrowserWindow) {
  let tracker = pointerPresence.get(window);
  if (!tracker) {
    tracker = createDockPointerPresenceTracker((presence) => {
      if (!window.isDestroyed() && !window.webContents.isDestroyed())
        window.webContents.send(WINDOW_CHANNELS.DOCK_POINTER_PRESENCE_CHANGED, presence);
    });
    pointerPresence.set(window, tracker);
  }
  return tracker;
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
    if (recordingHidden(window)) {
      applyPointerRouting(window, true);
      updateNativeCursor(window, false);
      return true;
    }
    if (placementController?.isDragging || placementController?.isResizing) {
      presenceFor(window).update({
        inside: false,
        x: 0,
        y: 0,
        revision: state.revision,
        suppressed: true,
      });
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
    // Hover is reported from this poll. macOS sends no mouse moves to a non-key
    // window, so moves inside it are forwarded too: Chromium then tracks hover and
    // reports cursor changes. Neither focuses the window nor activates the app.
    const entered = presenceFor(window).update({
      inside: interactive,
      x: localPoint.x,
      y: localPoint.y,
      revision: state.revision,
      // Inactive/empty publications are routing resets, not physical exits.
      // Leave the first live-region sample available to resynchronize after capture.
      suppressed:
        !state.active ||
        state.regions.length === 0 ||
        !window.isVisible() ||
        !!snapshot?.captureHidden,
    });
    const x = Math.round(localPoint.x);
    const y = Math.round(localPoint.y);
    const last = lastForwardedMove.get(window);
    const moved = !last || last.x !== x || last.y !== y;
    if (entered || (interactive && moved && !window.isFocused())) {
      lastForwardedMove.set(window, { x, y });
      window.webContents.sendInputEvent({ type: 'mouseMove', x, y });
    }
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
  if (selectionRegions?.window === window) selectionRegions = null;
  appliedPointerRouting.delete(window);
  pointerPresence.delete(window);
  clearTimeout(readyFallbacks.get(window));
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
  const reset = { active: false, regions: [], revision };
  // Track the assignment itself: on platforms without pointer forwarding the state is
  // still reset even though the call reports false.
  setDockPointerRegions(window, reset);
  if (pointerState === reset) lastResetState = reset;
}

export function getDockPlacementSnapshot(window: BrowserWindow): DockPlacementSnapshot | null {
  return window === getDockWindow() ? (placementController?.getSnapshot() ?? null) : null;
}

/** The renderer publishes the painted shell first, before auxiliary input regions. */
export function getDockVisibleSurfaceBounds(window: BrowserWindow): DockPointerRect | null {
  if (window !== getDockWindow() || window.isDestroyed() || !pointerState.active) return null;
  const snapshot = placementController?.getSnapshot();
  if (!snapshot || snapshot.captureHidden || pointerState.revision !== snapshot.revision)
    return null;
  const rect = pointerState.regions[0];
  if (
    !rect ||
    ![rect.x, rect.y, rect.width, rect.height].every(Number.isFinite) ||
    rect.width <= 0 ||
    rect.height <= 0
  )
    return null;
  return { ...rect };
}

/** Every interactive dock region (shell plus open popups, banner, lightbox), window-local. */
export function getDockVisibleSurfaceRegions(window: BrowserWindow): DockPointerRect[] {
  if (!getDockVisibleSurfaceBounds(window)) return [];
  return pointerState.regions
    .filter(
      (rect) =>
        [rect.x, rect.y, rect.width, rect.height].every(Number.isFinite) &&
        rect.width > 0 &&
        rect.height > 0,
    )
    .map((rect) => ({ ...rect }));
}

export async function updateDockPlacement(
  window: BrowserWindow,
  command: DockPlacementCommand,
): Promise<DockPlacementSnapshot | null> {
  if (window !== getDockWindow() || captureHiddenWindows.has(window) || sessionPaused)
    return getDockPlacementSnapshot(window);
  if (command.action === 'focus') {
    window.focus();
    window.webContents.focus();
    return getDockPlacementSnapshot(window);
  }
  if (command.action === 'release') {
    // A transient close: the renderer collapsed; only hand the keyboard back. Electron's
    // blur on macOS orders the window out and back, which blanks the dock: hand it back
    // natively first (the dock stays on screen) and blur only if that is unavailable.
    placementController?.cancelInteraction();
    if (window.isFocused() && !dockCursor?.releaseKey()) window.blur();
    return getDockPlacementSnapshot(window);
  }
  if (command.action === 'dismiss') {
    placementController?.cancelInteraction();
    // Let the validated invoke return before destroying its sending webContents.
    // Recheck ownership: capture may acquire visibility before this callback runs.
    setImmediate(() => {
      if (window !== getDockWindow() || captureHiddenWindows.has(window) || sessionPaused) return;
      try {
        dockHide();
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
    if (canRevealDock(window)) window.showInactive();
  };
  const refreshBackend = (): void => {
    if (window.isDestroyed()) return;
    refreshDockBackend(window, false);
  };
  const resetPointerRouting = (): void => {
    if (dockWindowRef !== window) return;
    dockCursor?.cursorChanged('default');
    placementController?.cancelInteraction();
    pointerPresence.get(window)?.reset();
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
  // Poll fast only while the pointer is near the dock; elsewhere a slow check is enough
  // to notice it approaching. Each check is one cursor read and a few rect tests.
  let pointerTimer: ReturnType<typeof setTimeout>;
  const pollPointer = (): void => {
    let near = false;
    if (!window.isDestroyed() && window.isVisible()) {
      setDockPointerRegions(window, pointerState);
      const b = window.getBounds();
      const p = screen.getCursorScreenPoint();
      near =
        p.x >= b.x - 48 && p.x < b.x + b.width + 48 && p.y >= b.y - 48 && p.y < b.y + b.height + 48;
    }
    pointerTimer = setTimeout(pollPointer, near ? 50 : 200);
  };
  pointerTimer = setTimeout(pollPointer, 50);
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
    clearTimeout(pointerTimer);
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
    if (mainFrame && !inPlace) dockDocument += 1;
    if (dockWindowRef === window && mainFrame && !inPlace) resetDockRendererReady(window);
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

// The dock is shown only once its renderer can respond (hydrated, presence and first
// regions live); a document that never reports ready is shown after a fallback.
const DOCK_READY_FALLBACK_MS = 10_000;
const rendererReady = new WeakSet<BrowserWindow>();
const readyFallbacks = new WeakMap<BrowserWindow, ReturnType<typeof setTimeout>>();

function canRevealDock(window: BrowserWindow): boolean {
  return (
    !window.isDestroyed() &&
    !sessionPaused &&
    !captureHiddenWindows.has(window) &&
    !editorHeld(window) &&
    rendererReady.has(window)
  );
}

/**
 * Capture → editor handoff. The dock stays out of sight from a capture (or the start of a
 * recording) that opens the media editor, and for every editor session, until that editor
 * ends: a hold, by token, that capture, selection and recording releases do not clear. Each
 * hold belongs to the dock document (and strict binding) that asked; the editor session that
 * opened adopts it. The dock document stays mounted throughout (its draft and save workers
 * keep running). A gone owner releases its holds without revealing anything.
 */
interface EditorHold {
  window: BrowserWindow;
  sender: Electron.WebContents;
  binding: object;
  openId: string | null;
}
const editorHolds = new Map<string, EditorHold>();
function editorHeld(window: BrowserWindow): boolean {
  for (const hold of editorHolds.values()) if (hold.window === window) return true;
  return false;
}
function ownerCurrent(hold: Pick<EditorHold, 'window' | 'sender' | 'binding'>): boolean {
  return (
    hold.window === getDockWindow() &&
    !hold.window.isDestroyed() &&
    !hold.sender.isDestroyed() &&
    hold.window.webContents === hold.sender &&
    getStrictBackendBindingForWebContents(hold.sender) === hold.binding
  );
}
/** Forget every hold of a gone owner (document reload, backend switch, window closed). */
function dropOwnerHolds(match: (hold: EditorHold) => boolean): void {
  for (const [token, hold] of editorHolds) if (match(hold)) editorHolds.delete(token);
}
export function beginDockEditorHold(
  window: BrowserWindow,
  sender: Electron.WebContents,
  binding: object,
  token: string,
): boolean {
  const owner = { window, sender, binding };
  if (!ownerCurrent(owner) || editorHolds.has(token)) return false;
  editorHolds.set(token, { ...owner, openId: null });
  onStrictBackendBindingRetired(sender, () => dropOwnerHolds((hold) => hold.sender === sender));
  window.once('closed', () => dropOwnerHolds((hold) => hold.window === window));
  return true;
}
/**
 * The editor session `openId` opened for this owner: it owns the hold now (a pre-capture
 * token, or one main takes for an editor opened without a capture). An already-visible dock
 * hides now, its document still mounted.
 */
export function adoptDockEditorHold(
  token: string,
  owner: { window: BrowserWindow; sender: Electron.WebContents; binding: object },
  openId: string,
): boolean {
  let hold = editorHolds.get(token);
  if (!hold) {
    if (!beginDockEditorHold(owner.window, owner.sender, owner.binding, token)) return false;
    hold = editorHolds.get(token)!;
  }
  if (
    hold.openId !== null ||
    hold.window !== owner.window ||
    hold.sender !== owner.sender ||
    hold.binding !== owner.binding
  )
    return false;
  hold.openId = openId;
  if (owner.window.isVisible() && !recordingHidden(owner.window)) owner.window.hide();
  return true;
}
/** No editor took this hold (refused, failed, cancelled capture): only its owner ends it. */
export function endDockEditorHold(
  token: string,
  sender: Electron.WebContents,
  binding: object,
): void {
  const hold = editorHolds.get(token);
  if (!hold || hold.openId !== null || hold.sender !== sender || hold.binding !== binding) return;
  editorHolds.delete(token);
  revealAfterEditorHold(hold);
}
/**
 * The editor session `openId` ended. `reveal` brings the dock back as it was (collapsed,
 * inactive) for a close or cancel, and only for that same owner document; a retired owner
 * or an attach passes false.
 */
export function releaseDockEditorHolds(openId: string, reveal: boolean): void {
  let owner: EditorHold | null = null;
  for (const [token, hold] of editorHolds)
    if (hold.openId === openId) {
      editorHolds.delete(token);
      owner = hold;
    }
  if (owner && reveal) revealAfterEditorHold(owner);
}
/** True while the session `openId` still holds its owner's dock (an attach awaiting its ACK). */
export function dockEditorHoldOwner(
  openId: string,
): { window: BrowserWindow; sender: Electron.WebContents; binding: object } | null {
  for (const hold of editorHolds.values()) if (hold.openId === openId) return hold;
  return null;
}
/**
 * The editor attached and its owner validated the return: bring that very dock forward with
 * the keyboard. No shortcut routing, foreground sample or focus-dock request is involved.
 */
export function focusDockForEditorReturn(owner: {
  window: BrowserWindow;
  sender: Electron.WebContents;
  binding: object;
}): boolean {
  const { window } = owner;
  if (!ownerCurrent(owner) || recordingHidden(window) || !canRevealDock(window)) return false;
  dockFocusedByIntentAt = Date.now();
  window.show();
  window.focus();
  return true;
}
function revealAfterEditorHold(owner: Pick<EditorHold, 'window' | 'sender' | 'binding'>): void {
  // Never on behalf of a replaced document or window.
  if (!ownerCurrent(owner) || recordingHidden(owner.window)) return;
  if (canRevealDock(owner.window) && !owner.window.isVisible()) owner.window.showInactive();
}

function armDockReadyFallback(window: BrowserWindow): void {
  clearTimeout(readyFallbacks.get(window));
  readyFallbacks.set(
    window,
    setTimeout(() => {
      if (dockWindowRef !== window || window.isDestroyed() || rendererReady.has(window)) return;
      logger.warn('Dock renderer did not report ready; showing the dock anyway', {
        timeoutMs: DOCK_READY_FALLBACK_MS,
      });
      markDockRendererReady(window);
    }, DOCK_READY_FALLBACK_MS),
  );
}

/** A new document (reload, crash recovery, backend switch) hides the dock until ready. */
function resetDockRendererReady(window: BrowserWindow): void {
  rendererReady.delete(window);
  if (!window.isDestroyed() && window.isVisible()) window.hide();
  armDockReadyFallback(window);
}

/** The dock document reports it can respond; show it without focusing or activating. */
export function markDockRendererReady(window: BrowserWindow): boolean {
  if (window !== dockWindowRef || window.isDestroyed()) return false;
  clearTimeout(readyFallbacks.get(window));
  rendererReady.add(window);
  if (canRevealDock(window) && !window.isVisible()) window.showInactive();
  return true;
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
      // The dock is rarely the key window; throttled frames stall its open/close morphs.
      backgroundThrottling: false,
    },
  });

  dockWindowRef = window;
  // A hidden dock (a capture or system selection) can change while hidden, e.g.
  // collapse as the pointer leaves. macOS then reveals its last frame, an open dock
  // that is not there: clicks fall through it. Repaint on every reveal.
  window.on('show', () => {
    if (!window.isDestroyed()) window.webContents.invalidate();
  });
  fixWebContentsZoom(window.webContents);
  attachLifecycleListeners(window);
  configurePlatformBehavior(window);
  dockCursor = attachDockCursor(window);
  placementController = new DockPlacementController(
    window,
    () => resetDockPointerRouting(window),
    () => canRevealDock(window),
  );
  resetDockPointerRouting(window);
  void placementController
    .initialize()
    .catch((error) => logger.warn('Failed to restore dock placement', { error }));
  armDockReadyFallback(window);
  refreshDockBackend(window, true);
  return window;
}

export function getDockWindow(): BrowserWindow | null {
  if (dockWindowRef && !dockWindowRef.isDestroyed()) return dockWindowRef;
  if (dockWindowRef) clearTrackedWindow(dockWindowRef);
  return null;
}

/** Capture owns visibility until it finishes, even if the first paint arrives late. */
export function setDockHiddenForCapture(
  hidden: boolean,
  owner?: { window: BrowserWindow; restore?: boolean },
): void {
  const window = getDockWindow();
  if (!window || (owner && owner.window !== window)) return;
  if (hidden) {
    if (pendingBackendSwitch?.window === window) pendingBackendSwitch.cancelled = true;
    captureHiddenWindows.add(window);
    placementController?.setCaptureHidden(true);
    window.hide();
  } else {
    if (owner?.restore === false) {
      // Keep canShow() false through layout: a stale capture may release its
      // barrier, but must not reveal the replacement document during reflow.
      placementController?.setCaptureHidden(false);
      captureHiddenWindows.delete(window);
      return;
    }
    captureHiddenWindows.delete(window);
    placementController?.setCaptureHidden(false);
    if (canRevealDock(window)) window.showInactive();
  }
}

/**
 * Keeps the dock out of sight while a recording runs (its tool bar is the control
 * then). The window stays shown, only transparent, click-through and not focusable:
 * the recording's capture and its mark images keep their usual rules (the dock is
 * excluded from both either way), and its document, draft and owner stay mounted.
 * Held by one clip on one window; only that clip's end brings it back.
 */
export function hideDockForRecording(window: BrowserWindow, clipId: string): void {
  if (window !== getDockWindow() || window.isDestroyed()) return;
  if (recordingHide && recordingHide.window !== window) restoreRecordingHide();
  recordingHide = { window, clipId };
  placementController?.cancelInteraction();
  // Leave now: the renderer collapses (and drops its focus) rather than stay "hovered"
  // behind a transparent window that no longer reports presence.
  presenceFor(window).update({
    inside: false,
    x: -1,
    y: -1,
    revision: pointerState.revision,
    suppressed: false,
  });
  lastForwardedMove.delete(window);
  // Never type into an invisible prompt: the dock cannot be key while hidden.
  const hadFocus = window.isFocused();
  window.setFocusable(false);
  if (hadFocus) window.blur();
  window.setOpacity(0);
  applyPointerRouting(window, true);
}

/** The clip that hid the dock ended (however it ended): bring the dock back. */
export function releaseDockRecordingHide(clipId: string): void {
  if (recordingHide?.clipId === clipId) restoreRecordingHide();
}

function restoreRecordingHide(): void {
  const held = recordingHide;
  recordingHide = null;
  if (!held || held.window.isDestroyed()) return;
  const { window } = held;
  // A capture → editor handoff keeps it out of sight: hidden first, so nothing paints.
  if (editorHeld(window)) window.hide();
  // Focusable again, never focused: the person's current window keeps the keyboard.
  window.setFocusable(true);
  window.setOpacity(1);
  // `blur` may have ordered it back within its level; up front again, still not key.
  window.moveTop();
  window.webContents.invalidate();
  presenceFor(window).reset();
  lastForwardedMove.delete(window);
  // Re-route at once from the live cursor (an enter is sent if it is over the dock).
  appliedPointerRouting.delete(window);
  if (window === dockWindowRef) setDockPointerRegions(window, pointerState);
}

/**
 * Hides the dock while the person selects a window or region with the system UI.
 * Like a capture it is never revealed, focused or dragged meanwhile, but its
 * document is not told: a selection can take seconds, and the surface (draft,
 * editor and its mark chips) must stay mounted rather than be torn down.
 */
export function setDockHiddenForSelection(
  hidden: boolean,
  owner: { window: BrowserWindow; restore?: boolean },
): void {
  const window = getDockWindow();
  if (!window || owner.window !== window) return;
  if (hidden) {
    if (pendingBackendSwitch?.window === window) pendingBackendSwitch.cancelled = true;
    captureHiddenWindows.add(window);
    placementController?.cancelInteraction();
    selectionRegions = {
      window,
      document: dockDocument,
      state: { ...pointerState, regions: [...pointerState.regions] },
      resetBefore: lastResetState,
    };
    // The pointer poll stops while hidden, so its last "inside" would outlive the
    // selection: back over the dock, no enter would ever be sent, and the dock would
    // stay collapsed and click-through. Forget it, as a capture's suppression does.
    presenceFor(window).reset();
    lastForwardedMove.delete(window);
    window.hide();
    return;
  }
  captureHiddenWindows.delete(window);
  const held = selectionRegions;
  selectionRegions = null;
  if (owner.restore !== false && canRevealDock(window)) {
    window.showInactive();
    // The hide cleared the regions. Bring back the ones from before the selection when
    // they still describe this document and placement and nothing newer arrived (the
    // renderer will not republish unchanged geometry); otherwise its own next publish
    // (a new revision or document always republishes) supplies them.
    const revision = placementController?.getSnapshot()?.revision;
    // "Nothing newer" is identity, not value: the live state must still be the very
    // reset object this selection's hide installed. Any publication meanwhile, even an
    // intentional inactive/empty one, is a different object and wins.
    if (
      held &&
      held.window === window &&
      held.document === dockDocument &&
      held.state.revision === revision &&
      lastResetState !== null &&
      lastResetState !== held.resetBefore &&
      pointerState === lastResetState
    )
      pointerState = held.state;
    // Re-route at once from the live cursor rather than the pre-selection state.
    appliedPointerRouting.delete(window);
    setDockPointerRegions(window, pointerState);
  }
}

/** When Intent itself last focused the dock (a shortcut, the dock's own request). */
let dockFocusedByIntentAt = 0;
const DOCK_FOCUS_RECEIPT_MS = 1500;

/**
 * Whether the dock having focus right now is the dock's own doing: the pointer is on
 * the dock (a click there activates the process) or Intent just focused it. Anything
 * else, such as reopening Intent from a launcher or its Dock icon while the dock
 * happened to be the last key window, is a request for the main app.
 */
export function isDockFocusOwnDoing(
  now = Date.now(),
  cursorPoint = screen.getCursorScreenPoint(),
): boolean {
  const window = getDockWindow();
  if (!window || window.isDestroyed()) return false;
  if (now - dockFocusedByIntentAt < DOCK_FOCUS_RECEIPT_MS) return true;
  if (!pointerState.active || !window.isVisible()) return false;
  const bounds = window.getBounds();
  return isPointInDockPointerRegions(
    { x: cursorPoint.x - bounds.x, y: cursorPoint.y - bounds.y },
    pointerState.regions,
  );
}

export function focusDockWindow(
  context?: import('../shared/dock-shortcuts').DockShortcutContext,
): void {
  const window = getDockWindow();
  if (!window || captureHiddenWindows.has(window) || editorHeld(window) || sessionPaused) return;
  if (recordingHidden(window)) {
    // Out of sight for a recording: never shown or focused, and a focus-only request
    // (or capture) does nothing meanwhile. Record and dictate reach the dock
    // flagged owner-only: they act on the live recording's own pair, never route.
    const action = context?.action;
    if (
      context &&
      (action === 'record' || action === 'dictate') &&
      !window.webContents.isDestroyed()
    )
      window.webContents.send(WINDOW_CHANNELS.FOCUS_DOCK, {
        ...context,
        recordingOwnerOnly: true,
      });
    return;
  }
  dockFocusedByIntentAt = Date.now();
  window.show();
  window.focus();
  // Only main sets the owner-only flag, and only above.
  const plain = context ? { ...context } : context;
  if (plain) delete plain.recordingOwnerOnly;
  if (!window.webContents.isDestroyed()) window.webContents.send(WINDOW_CHANNELS.FOCUS_DOCK, plain);
}

let dockHide: () => void = closeDockWindow;

/** Routes the dock's own Hide command, so main can remember it as a user hide. */
export function setDockHideHandler(handler: () => void): void {
  dockHide = handler;
}

export function closeDockWindow(): void {
  const window = getDockWindow();
  if (!window) return;
  clearTrackedWindow(window);
  window.close();
}
