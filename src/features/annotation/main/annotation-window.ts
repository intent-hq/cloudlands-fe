import path from 'path';
import { randomUUID } from 'node:crypto';
import {
  BrowserWindow,
  desktopCapturer,
  globalShortcut,
  screen,
  systemPreferences,
} from 'electron';
import type { Display } from 'electron';
import { fileURLToPath } from 'url';
import { dirname } from 'path';
import { getActiveId } from '../../backend/main/connections-store';
import { getDockWindow, setDockHiddenForCapture } from '../../../main/dock-window';
import { getBackendIdForWindow, stampWindowWithBackend } from '../../../main/window-backend';
import { Logger } from '../../../shared/logger';
import type {
  AnnotationSessionState,
  AnnotationStartResult,
  AnnotationTool,
  SetAnnotationDestinationRequest,
  RequestAnnotationSendRequest,
  ReportAnnotationDeliveryRequest,
  SetAnnotationToolbarLayoutRequest,
  StartAnnotationRequest,
} from '../../../shared/annotation';
import { ANNOTATION_TOOLBAR_SIZE } from '../../../shared/annotation';
import { isPointInDockPointerRegions, type DockPointerRect } from '../../../shared/dock-layout';
import { ANNOTATION_CHANNELS } from '../../../shared/ipc/channels';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const logger = new Logger('AnnotationWindow');

const TOOLBAR_INSET = 12;
const CAPTURE_SETTLE_MS = 50;
const FOCUS_CAPTURE_SHORTCUT = 'CommandOrControl+Shift+Space';

interface AnnotationLifecycle {
  readonly displayId: number;
  readonly cleanupListeners: Array<() => void>;
  readonly cancelWaits: Set<() => void>;
  overlayWindow: BrowserWindow | null;
  toolbarWindow: BrowserWindow | null;
  state: AnnotationSessionState | null;
  disposed: boolean;
  dockHidden: boolean;
  transitionRevision: number;
  toolbarExpanded: boolean;
  toolbarInteractiveRects: DockPointerRect[];
}

let activeLifecycle: AnnotationLifecycle | null = null;

function routeUrl(route: string): string {
  if (process.env.NODE_ENV === 'development') {
    return `http://127.0.0.1:${process.env.DEV_PORT || '5190'}${route}`;
  }
  return `app://workspaces${route}`;
}

function selectedDisplay(displayId: number): Display {
  const display = screen.getAllDisplays().find((candidate) => candidate.id === displayId);
  if (!display) throw new Error('The selected display is no longer available.');
  return display;
}

async function captureDisplay(displayId: number): Promise<{ display: Display; dataUrl: string }> {
  const display = selectedDisplay(displayId);
  const width = Math.max(1, Math.round(display.bounds.width * display.scaleFactor));
  const height = Math.max(1, Math.round(display.bounds.height * display.scaleFactor));
  const sources = await desktopCapturer.getSources({
    types: ['screen'],
    thumbnailSize: { width, height },
    fetchWindowIcons: false,
  });
  const source = sources.find((candidate) => candidate.display_id === String(display.id));
  if (!source) throw new Error('The selected display could not be captured.');
  if (source.thumbnail.isEmpty()) {
    throw new Error('Screen capture permission is required to start annotation mode.');
  }
  return { display, dataUrl: source.thumbnail.toDataURL() };
}

function isActive(lifecycle: AnnotationLifecycle): boolean {
  return activeLifecycle === lifecycle && !lifecycle.disposed;
}

function publishState(lifecycle: AnnotationLifecycle): boolean {
  if (!isActive(lifecycle) || !lifecycle.state) return false;
  try {
    for (const window of [lifecycle.overlayWindow, lifecycle.toolbarWindow]) {
      if (window && !window.isDestroyed() && !window.webContents.isDestroyed()) {
        window.webContents.send(ANNOTATION_CHANNELS.STATE_CHANGED, lifecycle.state);
      }
    }
    return true;
  } catch (error) {
    logger.warn('Failed to publish annotation state', { error });
    disposeLifecycle(lifecycle);
    return false;
  }
}

function waitForCaptureSurface(lifecycle: AnnotationLifecycle): Promise<void> {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      lifecycle.cancelWaits.delete(finish);
      resolve();
    };
    const timer = setTimeout(finish, CAPTURE_SETTLE_MS);
    lifecycle.cancelWaits.add(finish);
  });
}

function addLifecycleListener<TArgs extends unknown[]>(
  lifecycle: AnnotationLifecycle,
  target: NodeJS.EventEmitter,
  event: string,
  listener: (...args: TArgs) => void,
): void {
  lifecycle.cleanupListeners.push(() => target.removeListener(event, listener));
  target.on(event, listener);
}

function addLifecycleOnceListener<TArgs extends unknown[]>(
  lifecycle: AnnotationLifecycle,
  target: NodeJS.EventEmitter,
  event: string,
  listener: (...args: TArgs) => void,
): void {
  lifecycle.cleanupListeners.push(() => target.removeListener(event, listener));
  target.once(event, listener);
}

function attachLifecycleListeners(lifecycle: AnnotationLifecycle): void {
  const fail = (reason: string): void => {
    if (!isActive(lifecycle)) return;
    logger.warn('Annotation window lifecycle failed', { reason });
    disposeLifecycle(lifecycle);
  };
  const attachWindow = (window: BrowserWindow, name: string): void => {
    addLifecycleListener(lifecycle, window, 'closed', () => fail(`${name}-closed`));
    addLifecycleListener(lifecycle, window, 'unresponsive', () => fail(`${name}-unresponsive`));
    addLifecycleListener(lifecycle, window.webContents, 'render-process-gone', () =>
      fail(`${name}-render-process-gone`),
    );
    const show = (): void => {
      if (!window.isDestroyed() && !window.webContents.isDestroyed()) {
        window.showInactive();
      }
    };
    addLifecycleOnceListener(lifecycle, window, 'ready-to-show', show);
  };
  if (lifecycle.overlayWindow) attachWindow(lifecycle.overlayWindow, 'overlay');
  if (lifecycle.toolbarWindow) attachWindow(lifecycle.toolbarWindow, 'toolbar');

  const displayInvalidated = (_event: Electron.Event, display: Display): void => {
    if (display.id === lifecycle.displayId) fail('display-invalidated');
  };
  addLifecycleListener(lifecycle, screen, 'display-removed', displayInvalidated);
  addLifecycleListener(lifecycle, screen, 'display-metrics-changed', displayInvalidated);
}

function restoreDock(lifecycle: AnnotationLifecycle): void {
  if (!lifecycle.dockHidden) return;
  lifecycle.dockHidden = false;
  if (activeLifecycle && activeLifecycle !== lifecycle) return;
  setDockHiddenForCapture(false);
}

function disposeLifecycle(lifecycle: AnnotationLifecycle, restore = true): void {
  if (lifecycle.disposed) return;
  lifecycle.disposed = true;
  lifecycle.transitionRevision += 1;
  if (activeLifecycle === lifecycle) activeLifecycle = null;

  for (const cancel of [...lifecycle.cancelWaits]) cancel();
  lifecycle.cancelWaits.clear();
  for (const cleanup of lifecycle.cleanupListeners.splice(0)) {
    try {
      cleanup();
    } catch (error) {
      logger.warn('Failed to remove an annotation lifecycle listener', { error });
    }
  }

  const windows = [lifecycle.overlayWindow, lifecycle.toolbarWindow];
  lifecycle.overlayWindow = null;
  lifecycle.toolbarWindow = null;
  lifecycle.state = null;
  for (const window of windows) {
    try {
      if (window && !window.isDestroyed()) window.destroy();
    } catch (error) {
      logger.warn('Failed to destroy an annotation window', { error });
    }
  }
  if (restore) {
    try {
      restoreDock(lifecycle);
    } catch (error) {
      logger.warn('Failed to restore the dock after annotation mode', { error });
    }
  } else lifecycle.dockHidden = false;
}

function createLifecycle(displayId: number): AnnotationLifecycle {
  return {
    displayId,
    cleanupListeners: [],
    cancelWaits: new Set(),
    overlayWindow: null,
    toolbarWindow: null,
    state: null,
    disposed: false,
    dockHidden: false,
    transitionRevision: 0,
    toolbarExpanded: false,
    toolbarInteractiveRects: [],
  };
}

function lifecycleError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function screenCapturePermissionDenied(): boolean {
  return (
    process.platform === 'darwin' &&
    ['denied', 'restricted'].includes(systemPreferences.getMediaAccessStatus('screen'))
  );
}

function permissionDeniedResult(): AnnotationStartResult {
  return {
    success: false,
    code: 'screen-capture-permission-denied',
    error: 'Screen Recording permission is required to start annotation mode.',
  };
}

function replacedSessionResult(): AnnotationStartResult {
  return {
    success: false,
    code: 'session-replaced',
    error: 'Annotation session was replaced or closed.',
  };
}

function startFailureResult(error: unknown): AnnotationStartResult {
  if (screenCapturePermissionDenied()) return permissionDeniedResult();
  return { success: false, code: 'start-failed', error: lifecycleError(error) };
}

function windowIsUsable(window: BrowserWindow | null): window is BrowserWindow {
  return Boolean(window && !window.isDestroyed() && !window.webContents.isDestroyed());
}

function captureOperationIsCurrent(
  lifecycle: AnnotationLifecycle,
  transitionRevision: number,
): boolean {
  return (
    isActive(lifecycle) &&
    lifecycle.transitionRevision === transitionRevision &&
    lifecycle.state !== null &&
    windowIsUsable(lifecycle.overlayWindow) &&
    windowIsUsable(lifecycle.toolbarWindow)
  );
}

function toolbarBounds(display: Display, expanded = false): Electron.Rectangle {
  const workArea = display.workArea;
  const width = Math.max(1, Math.min(ANNOTATION_TOOLBAR_SIZE.width, workArea.width));
  const height = Math.max(
    1,
    Math.min(
      expanded ? ANNOTATION_TOOLBAR_SIZE.expandedHeight : ANNOTATION_TOOLBAR_SIZE.height,
      workArea.height,
    ),
  );
  const desiredX = workArea.x + Math.round((workArea.width - width) / 2);
  const desiredY = workArea.y + workArea.height - height - TOOLBAR_INSET;
  return {
    x: Math.max(workArea.x, Math.min(desiredX, workArea.x + workArea.width - width)),
    y: Math.max(workArea.y, Math.min(desiredY, workArea.y + workArea.height - height)),
    width,
    height,
  };
}

function updateToolbarBounds(window: BrowserWindow, display: Display, expanded = false): void {
  const next = toolbarBounds(display, expanded);
  const current = window.getBounds();
  if (
    current.x !== next.x ||
    current.y !== next.y ||
    current.width !== next.width ||
    current.height !== next.height
  )
    window.setBounds(next);
}

function updateOverlayBounds(window: BrowserWindow, display: Display): void {
  window.setBounds(display.bounds);
}

function applyCapturedDisplay(lifecycle: AnnotationLifecycle, display: Display): void {
  if (lifecycle.overlayWindow) updateOverlayBounds(lifecycle.overlayWindow, display);
  if (lifecycle.toolbarWindow)
    updateToolbarBounds(lifecycle.toolbarWindow, display, lifecycle.toolbarExpanded);
}

function liveState(lifecycle: AnnotationLifecycle): AnnotationSessionState | null {
  return isActive(lifecycle) ? lifecycle.state : null;
}

function hideCaptureWindows(lifecycle: AnnotationLifecycle): boolean {
  if (!windowIsUsable(lifecycle.overlayWindow) || !windowIsUsable(lifecycle.toolbarWindow)) {
    disposeLifecycle(lifecycle);
    return false;
  }
  lifecycle.overlayWindow.setIgnoreMouseEvents(true);
  lifecycle.overlayWindow.setOpacity(0);
  lifecycle.toolbarWindow.hide();
  return true;
}

function showCaptureWindows(lifecycle: AnnotationLifecycle, mouse: boolean): boolean {
  if (!windowIsUsable(lifecycle.overlayWindow) || !windowIsUsable(lifecycle.toolbarWindow)) {
    disposeLifecycle(lifecycle);
    return false;
  }
  // Draw ink over the live desktop. Mouse mode reveals the untouched application;
  // its previous annotated moment is retained separately for evidence export.
  lifecycle.overlayWindow.setOpacity(mouse ? 0 : 1);
  lifecycle.overlayWindow.setIgnoreMouseEvents(mouse);
  lifecycle.toolbarWindow.showInactive();
  return true;
}

function updateStateAfterCapture(
  lifecycle: AnnotationLifecycle,
  tool: AnnotationTool,
  dataUrl: string,
  advanceFrame: boolean,
): boolean {
  const state = liveState(lifecycle);
  if (!state) return false;
  lifecycle.state = {
    ...invalidateFailedDelivery(state),
    phase: 'capturing',
    tool,
    screenshotDataUrl: dataUrl,
    screenshotRevision: state.screenshotRevision + (advanceFrame ? 1 : 0),
  };
  return publishState(lifecycle);
}

function updateToolWithoutCapture(lifecycle: AnnotationLifecycle, tool: AnnotationTool): boolean {
  const state = liveState(lifecycle);
  if (!state) return false;
  lifecycle.state = { ...invalidateFailedDelivery(state), phase: 'capturing', tool };
  return publishState(lifecycle);
}

function currentLifecycle(): AnnotationLifecycle | null {
  return activeLifecycle && !activeLifecycle.disposed ? activeLifecycle : null;
}

function sessionWindows(lifecycle: AnnotationLifecycle): [BrowserWindow, BrowserWindow] | null {
  if (!windowIsUsable(lifecycle.overlayWindow) || !windowIsUsable(lifecycle.toolbarWindow)) {
    disposeLifecycle(lifecycle);
    return null;
  }
  return [lifecycle.overlayWindow, lifecycle.toolbarWindow];
}

function configureWindow(window: BrowserWindow, level: 'overlay' | 'toolbar'): void {
  window.setAlwaysOnTop(true, level === 'toolbar' ? 'screen-saver' : 'floating');
  window.setFullScreenable(false);
  if (process.platform === 'darwin') {
    window.setVisibleOnAllWorkspaces(true, {
      visibleOnFullScreen: true,
      skipTransformProcessType: true,
    });
  }
}

function createOverlay(
  lifecycle: AnnotationLifecycle,
  display: Display,
  backendId: string,
): BrowserWindow {
  const window = new BrowserWindow({
    ...display.bounds,
    show: false,
    frame: false,
    transparent: true,
    // A nonactivating macOS panel accepts annotation input without switching apps.
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
      preload: path.join(__dirname, '../../../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  lifecycle.overlayWindow = window;
  stampWindowWithBackend(window, backendId);
  configureWindow(window, 'overlay');
  return window;
}

function createToolbar(
  lifecycle: AnnotationLifecycle,
  display: Display,
  backendId: string,
): BrowserWindow {
  const window = new BrowserWindow({
    ...toolbarBounds(display),
    show: false,
    frame: false,
    transparent: true,
    // A nonactivating macOS panel accepts annotation input without switching apps.
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
      preload: path.join(__dirname, '../../../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  lifecycle.toolbarWindow = window;
  stampWindowWithBackend(window, backendId);
  configureWindow(window, 'toolbar');
  const pointerTimer = setInterval(() => updateToolbarPointerRouting(lifecycle), 50);
  lifecycle.cleanupListeners.push(() => clearInterval(pointerTimer));
  return window;
}

function updateToolbarPointerRouting(lifecycle: AnnotationLifecycle): void {
  const window = lifecycle.toolbarWindow;
  if (!isActive(lifecycle) || !windowIsUsable(window) || !window.isVisible()) return;
  if (process.platform !== 'darwin' && process.platform !== 'win32') return;
  const bounds = window.getBounds();
  const point = screen.getCursorScreenPoint();
  const regions = lifecycle.toolbarInteractiveRects.length
    ? lifecycle.toolbarInteractiveRects
    : [
        {
          x: 0,
          y: Math.max(0, bounds.height - ANNOTATION_TOOLBAR_SIZE.height),
          width: bounds.width,
          height: Math.min(bounds.height, ANNOTATION_TOOLBAR_SIZE.height),
        },
      ];
  const interactive = isPointInDockPointerRegions(
    { x: point.x - bounds.x, y: point.y - bounds.y },
    regions,
  );
  try {
    window.setIgnoreMouseEvents(!interactive, { forward: true });
  } catch (error) {
    logger.warn('Failed to route annotation toolbar pointer', { error });
  }
}

export function setAnnotationToolbarLayout(
  window: BrowserWindow | null,
  request: SetAnnotationToolbarLayoutRequest,
): boolean {
  const lifecycle = currentLifecycle();
  if (
    !lifecycle ||
    !window ||
    window !== lifecycle.toolbarWindow ||
    !windowIsUsable(window) ||
    lifecycle.state?.startedAt !== request.startedAt
  )
    return false;
  const resizing = lifecycle.toolbarExpanded !== request.expanded;
  lifecycle.toolbarExpanded = request.expanded;
  // Geometry from before a resize is stale; use the anchored strip until the
  // renderer reports the newly measured popup and controls.
  lifecycle.toolbarInteractiveRects = resizing ? [] : request.interactiveRects;
  updateToolbarBounds(window, selectedDisplay(lifecycle.displayId), request.expanded);
  updateToolbarPointerRouting(lifecycle);
  return true;
}

export function closeAnnotationMode(): void {
  const lifecycle = currentLifecycle();
  if (lifecycle) disposeLifecycle(lifecycle);
}

export function focusAnnotationMode(): boolean {
  const lifecycle = currentLifecycle();
  if (!lifecycle) return false;
  const target =
    lifecycle.state?.phase === 'review' ? lifecycle.overlayWindow : lifecycle.toolbarWindow;
  if (windowIsUsable(target)) {
    target.show();
    target.focus();
  }
  return true;
}

export async function startAnnotationMode(
  request: StartAnnotationRequest,
): Promise<AnnotationStartResult> {
  if (focusAnnotationMode()) return { success: true };
  if (screenCapturePermissionDenied()) return permissionDeniedResult();
  const nearestDisplay = screen.getDisplayNearestPoint(screen.getCursorScreenPoint());
  const lifecycle = createLifecycle(nearestDisplay.id);
  activeLifecycle = lifecycle;
  try {
    const dock = getDockWindow();
    if (dock && !dock.isDestroyed()) {
      setDockHiddenForCapture(true);
      lifecycle.dockHidden = true;
      addLifecycleOnceListener(lifecycle, dock, 'closed', () => disposeLifecycle(lifecycle));
      await waitForCaptureSurface(lifecycle);
    }
    if (!isActive(lifecycle)) return replacedSessionResult();
    const capture = await captureDisplay(lifecycle.displayId);
    if (!isActive(lifecycle)) return replacedSessionResult();
    const backendId =
      dock && !dock.isDestroyed() ? getBackendIdForWindow(dock) : await getActiveId();
    if (!isActive(lifecycle)) return replacedSessionResult();
    lifecycle.state = {
      ...request,
      tool: 'mouse',
      phase: 'capturing',
      screenshotDataUrl: capture.dataUrl,
      screenshotRevision: 0,
      startedAt: Date.now(),
      transcripts: [],
      destination: { ...request, agentId: null },
      delivery: { status: 'idle' },
    };
    const overlay = createOverlay(lifecycle, capture.display, backendId);
    const toolbar = createToolbar(lifecycle, capture.display, backendId);
    attachLifecycleListeners(lifecycle);
    // Keep ordinary typing available to other apps in mouse mode. This one
    // session-only chord brings the capture controls back to the keyboard.
    try {
      if (!globalShortcut.isRegistered(FOCUS_CAPTURE_SHORTCUT)) {
        const registered = globalShortcut.register(FOCUS_CAPTURE_SHORTCUT, () => {
          if (!isActive(lifecycle)) return;
          focusAnnotationMode();
        });
        if (registered)
          lifecycle.cleanupListeners.push(() => globalShortcut.unregister(FOCUS_CAPTURE_SHORTCUT));
      }
    } catch (error) {
      logger.warn('Capture focus shortcut unavailable', { error });
    }
    overlay.setOpacity(0);
    overlay.setIgnoreMouseEvents(true);
    await Promise.all([
      overlay.loadURL(routeUrl('/annotation')),
      toolbar.loadURL(routeUrl('/annotation-toolbar')),
    ]);
    if (!isActive(lifecycle)) return replacedSessionResult();
    return { success: true };
  } catch (error) {
    logger.warn('Failed to start annotation mode', { error });
    disposeLifecycle(lifecycle);
    return startFailureResult(error);
  }
}

/** Includes capture startup before any annotation window is ready. */
export function isAnnotationModeActive(): boolean {
  return currentLifecycle() !== null;
}

export function getAnnotationState(): AnnotationSessionState | null {
  const state = currentLifecycle()?.state;
  return state ? { ...state, transcripts: [...state.transcripts] } : null;
}

export function isAnnotationWindow(window: BrowserWindow | null): boolean {
  const lifecycle = currentLifecycle();
  return Boolean(
    window &&
    lifecycle &&
    (window === lifecycle.overlayWindow || window === lifecycle.toolbarWindow),
  );
}

export function isAnnotationOverlayWindow(window: BrowserWindow | null): boolean {
  return Boolean(window && window === currentLifecycle()?.overlayWindow);
}

function deliveryLocksCapture(state: AnnotationSessionState): boolean {
  return Boolean(
    state.delivery && ['preparing', 'sending', 'uncertain', 'sent'].includes(state.delivery.status),
  );
}

function invalidateFailedDelivery(state: AnnotationSessionState): AnnotationSessionState {
  return state.delivery?.status === 'failed'
    ? { ...state, delivery: { status: 'idle' }, sendRequest: undefined }
    : state;
}

function restoreCaptureSurface(lifecycle: AnnotationLifecycle): void {
  const state = liveState(lifecycle);
  const windows = sessionWindows(lifecycle);
  if (!state || !windows) return;
  const [overlay, toolbar] = windows;
  if (state.phase === 'review') {
    overlay.setOpacity(1);
    overlay.setIgnoreMouseEvents(false);
    toolbar.hide();
    overlay.show();
  } else {
    showCaptureWindows(lifecycle, state.tool === 'mouse');
  }
}

export async function setAnnotationTool(tool: AnnotationTool): Promise<boolean> {
  const lifecycle = currentLifecycle();
  const state = lifecycle?.state;
  if (!lifecycle || !state || !sessionWindows(lifecycle)) return false;
  if (deliveryLocksCapture(state)) return false;
  // Archive the visible UI when leaving drawing, and refresh the baseline when
  // drawing resumes. Evidence capture never replaces the visible live desktop.
  const transitionRevision = ++lifecycle.transitionRevision;
  if (tool === 'mouse' && (state.tool === 'mouse' || state.phase === 'review')) {
    if (!updateToolWithoutCapture(lifecycle, tool)) return false;
    return showCaptureWindows(lifecycle, true);
  }
  if (state.phase === 'capturing' && state.tool !== 'mouse' && tool !== 'mouse') {
    if (!updateToolWithoutCapture(lifecycle, tool)) return false;
    return showCaptureWindows(lifecycle, false);
  }
  if (!hideCaptureWindows(lifecycle)) return false;
  try {
    await waitForCaptureSurface(lifecycle);
    if (!captureOperationIsCurrent(lifecycle, transitionRevision)) return false;
    const capture = await captureDisplay(lifecycle.displayId);
    if (!captureOperationIsCurrent(lifecycle, transitionRevision)) return false;
    applyCapturedDisplay(lifecycle, capture.display);
    if (
      !updateStateAfterCapture(
        lifecycle,
        tool,
        capture.dataUrl,
        state.phase === 'review' || (state.tool === 'mouse' && tool !== 'mouse'),
      )
    )
      return false;
    return showCaptureWindows(lifecycle, tool === 'mouse');
  } catch (error) {
    logger.warn('Failed to recapture annotation display', { error });
    if (isActive(lifecycle) && lifecycle.transitionRevision === transitionRevision) {
      restoreCaptureSurface(lifecycle);
    }
    return false;
  }
}

export function appendAnnotationTranscript(text: string, startedAt?: number): boolean {
  const lifecycle = currentLifecycle();
  const state = lifecycle?.state;
  if (startedAt !== undefined && state?.startedAt !== startedAt) return false;
  if (
    !lifecycle ||
    !state ||
    state.phase !== 'capturing' ||
    deliveryLocksCapture(state) ||
    !text.trim()
  )
    return false;
  lifecycle.state = {
    ...invalidateFailedDelivery(state),
    transcripts: [...state.transcripts, text.trim()],
  };
  return publishState(lifecycle);
}

export async function reviewAnnotation(): Promise<boolean> {
  const lifecycle = currentLifecycle();
  const state = lifecycle?.state;
  const windows = lifecycle ? sessionWindows(lifecycle) : null;
  if (!lifecycle || !state || !windows) return false;
  if (deliveryLocksCapture(state)) return false;
  if (state.phase === 'review') return true;
  const transitionRevision = ++lifecycle.transitionRevision;
  {
    if (!hideCaptureWindows(lifecycle)) return false;
    try {
      await waitForCaptureSurface(lifecycle);
      if (!captureOperationIsCurrent(lifecycle, transitionRevision)) return false;
      const capture = await captureDisplay(lifecycle.displayId);
      if (!captureOperationIsCurrent(lifecycle, transitionRevision)) return false;
      if (!lifecycle.state) return false;
      applyCapturedDisplay(lifecycle, capture.display);
      // Publish the new frame and review phase together, preserving any narration
      // received while the OS capture was pending.
      lifecycle.state = {
        ...lifecycle.state,
        screenshotDataUrl: capture.dataUrl,
        screenshotRevision: state.screenshotRevision + (state.tool === 'mouse' ? 1 : 0),
      };
    } catch (error) {
      logger.warn('Failed to capture annotation review', { error });
      if (isActive(lifecycle) && lifecycle.transitionRevision === transitionRevision) {
        restoreCaptureSurface(lifecycle);
      }
      return false;
    }
  }
  if (
    !isActive(lifecycle) ||
    !lifecycle.state ||
    lifecycle.transitionRevision !== transitionRevision
  )
    return false;
  lifecycle.state = { ...lifecycle.state, phase: 'review' };
  const [overlay, toolbar] = windows;
  overlay.setIgnoreMouseEvents(false);
  overlay.setOpacity(1);
  toolbar.hide();
  overlay.show();
  overlay.focus();
  return publishState(lifecycle);
}

export function setAnnotationDestination(request: SetAnnotationDestinationRequest): boolean {
  const lifecycle = currentLifecycle();
  const state = lifecycle?.state;
  if (!lifecycle || !state || state.startedAt !== request.startedAt || deliveryLocksCapture(state))
    return false;
  lifecycle.state = {
    ...state,
    destination: { ...request.destination },
    delivery: { status: 'idle' },
    sendRequest: undefined,
  };
  return publishState(lifecycle);
}

/** Prepare a direct delivery without ever opening the overlay's review UI. */
export async function requestAnnotationSend(
  request: RequestAnnotationSendRequest,
): Promise<boolean> {
  const lifecycle = currentLifecycle();
  const state = lifecycle?.state;
  if (!lifecycle || !state || state.startedAt !== request.startedAt || !sessionWindows(lifecycle))
    return false;
  if (state.delivery && ['preparing', 'sending', 'sent'].includes(state.delivery.status))
    return false;
  const retryUncertain = state.delivery?.status === 'uncertain';
  if (
    request.retryRequestId &&
    (!['failed', 'uncertain'].includes(state.delivery?.status ?? '') ||
      state.sendRequest?.requestId !== request.retryRequestId)
  )
    return false;
  const retrySubmission = retryUncertain || Boolean(request.retryRequestId);
  const requestId = (retrySubmission && state.sendRequest?.requestId) || randomUUID();
  const transitionRevision = ++lifecycle.transitionRevision;
  const destination = (retrySubmission ? state.sendRequest?.destination : state.destination) ?? {
    workspaceId: state.workspaceId,
    workspaceTitle: state.workspaceTitle,
    agentId: null,
  };
  lifecycle.state = {
    ...state,
    sendRequest: undefined,
    delivery: { status: 'preparing', requestId },
  };
  if (!publishState(lifecycle)) return false;
  try {
    // Review and retry must reuse their frozen evidence.
    if (!retrySubmission && state.phase !== 'review') {
      if (!hideCaptureWindows(lifecycle)) return false;
      await waitForCaptureSurface(lifecycle);
      if (!captureOperationIsCurrent(lifecycle, transitionRevision)) return false;
      const capture = await captureDisplay(lifecycle.displayId);
      if (!captureOperationIsCurrent(lifecycle, transitionRevision) || !lifecycle.state)
        return false;
      applyCapturedDisplay(lifecycle, capture.display);
      lifecycle.state = {
        ...lifecycle.state,
        screenshotDataUrl: capture.dataUrl,
        screenshotRevision: state.screenshotRevision + (state.tool === 'mouse' ? 1 : 0),
      };
    }
    if (!captureOperationIsCurrent(lifecycle, transitionRevision) || !lifecycle.state) return false;
    lifecycle.state = {
      ...lifecycle.state,
      phase: 'capturing',
      sendRequest: { requestId, destination: { ...destination } },
      delivery: { status: 'sending', requestId },
    };
    if (!showCaptureWindows(lifecycle, true)) return false;
    return publishState(lifecycle);
  } catch (error) {
    logger.warn('Failed to prepare annotation delivery', { error });
    if (
      isActive(lifecycle) &&
      lifecycle.transitionRevision === transitionRevision &&
      lifecycle.state
    ) {
      lifecycle.state = { ...lifecycle.state, delivery: { status: 'failed', requestId } };
      restoreCaptureSurface(lifecycle);
      publishState(lifecycle);
    }
    return false;
  }
}

export function reportAnnotationDelivery(request: ReportAnnotationDeliveryRequest): boolean {
  const lifecycle = currentLifecycle();
  const state = lifecycle?.state;
  if (
    !lifecycle ||
    !state ||
    state.startedAt !== request.startedAt ||
    state.delivery?.status !== 'sending' ||
    state.delivery.requestId !== request.requestId
  )
    return false;
  lifecycle.state = {
    ...state,
    delivery: {
      status: request.status,
      requestId: request.requestId,
      ...(request.error ? { error: request.error } : {}),
    },
  };
  if (request.status === 'failed') restoreCaptureSurface(lifecycle);
  return publishState(lifecycle);
}
