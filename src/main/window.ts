import { registerChatWindow } from './chat-window-identity';
import { isDevConsoleRoute } from '../shared/dev-console-route';
import { isDesktopOverlayRoute } from '../shared/desktop-overlay';
import path from 'path';
import { app, screen, nativeTheme, nativeImage, BrowserWindow } from 'electron';
import type { BrowserWindow as BrowserWindowType } from 'electron';
import fs from 'fs';
import fsAsync from 'fs/promises';
import { Logger } from '../shared/logger';
import { registerWindowTitleListener, resolveAppTitle } from './utils/resolve-app-title';
import { DeepLinkHandler } from '../features/deeplink/deep-link-handler';
import { scrubToken } from '../features/deeplink/utils/scrub-token';
import { findIntentUrl } from '../features/deeplink/utils/find-intent-url';
import {
  queueDeepLinkForRenderer,
  queueDeepLinkForWindow,
} from '../features/deeplink/main/pending-deep-links';
import { isInviteUri } from '../shared/utils/invite-uri';
import { isMainOnlyLinkUri } from '../shared/utils/node-invite-uri';
import { getMainWindow, setMainWindow } from './state';
import { LOCAL_CONNECTION_ID, type ConnectionAgentTarget } from '../shared/types/connections';
import { fileURLToPath } from 'url';
import { dirname } from 'path';
import {
  getWindowAppearanceOptions,
  getWindowTitleBarOptions,
} from '../shared/main/window-appearance';
import { resolveAppDockIconPath, resolveAppIconPath } from './utils/resolve-app-icon';
import { whenRendererWindowsAllowed } from './renderer-window-gate';
import { loadMenuBarAutoHidePref } from './menu-bar-auto-hide-pref';
import { isDockRoute, isDockWindow } from './dock-window';
import { isDockAnnotationWindow } from './dock-annotation-identity';
import { isDockCaptureEditorWindow } from './dock-capture-editor-identity';

const isTransientCaptureWindow = (window: BrowserWindowType): boolean =>
  isDockWindow(window) || isDockAnnotationWindow(window) || isDockCaptureEditorWindow(window);
const isTransientCaptureRoute = (route: string): boolean =>
  isDockRoute(route) || route === '/dock-annotation' || route === '/dock-capture-editor';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const logger = new Logger('Main');

// ---- Shared Window Helpers ----

// Backend stamping lives in the dependency-light window-backend.ts (so
// hud-window.ts and other small modules can read stamps without this
// module's graph); re-exported here for the existing import sites.
import { getAppWindows } from './offscreen-window';
import {
  addMachineToFrame,
  getMachineRailSession,
  isFrameEmptied,
  isMachineRailEnabled,
  openFrameMachines,
  selectFrameMachine,
} from './machine-rail-state';
import type {
  FrameMachineSession,
  FrameSession,
  WindowFramesFile,
} from '../shared/types/machine-rail';
import {
  frameHolds,
  keepFrameMachines,
  mergeParkedFrames,
  migrateWindowSessions,
  orderFramesForRestore,
  parseWindowFramesFile,
  routeFromRendererUrl,
  WINDOW_FRAMES_VERSION,
  type FrameSessionFilter,
} from './frame-sessions';
import {
  findExistingHudWindow,
  HUD_ROUTE_PREFIX,
  isHudWindow,
  isTrackedHudWindow,
  registerHudWindow,
} from './hud-window';
import {
  getBackendIdForWebContents,
  getBackendIdForWindow,
  isFrameWindow,
  markFrameWindow,
  stampWindowWithBackend,
} from './window-backend';
import { getTabWindowSessions, isTabWindow, markTabWindow } from './tab-window-identity';
import { tabWindowRoute, type TabWindowDisplayMode } from '../shared/types/tab-window';
import {
  focusedFrame,
  frameMachines,
  frameToShow,
  mostRecentFrame,
  rendererFor,
  shownMachine,
} from './frames';

export { getBackendIdForWebContents, getBackendIdForWindow, stampWindowWithBackend };

/** The machine the focused frame shows; falls back to the main window's, then local. */
export function getFocusedWindowBackendId(): string {
  const frame = focusedFrame();
  return frame ? shownMachine(frame) : LOCAL_CONNECTION_ID;
}

/**
 * Resolve the development window icon and optionally set the macOS Dock icon.
 */
function resolveIcon(setDockIcon: boolean): string | undefined {
  const resolutionOptions = {
    isPackaged: app.isPackaged,
    nodeEnv: process.env.NODE_ENV,
    platform: process.platform,
  };
  const iconPath = resolveAppIconPath(resolutionOptions);
  const dockIconPath = resolveAppDockIconPath(resolutionOptions);

  if (dockIconPath && setDockIcon) {
    try {
      app.dock?.setIcon(nativeImage.createFromPath(dockIconPath));
    } catch (e) {
      logger.warn('Failed to set Dock icon:', e);
    }
  }

  return iconPath;
}

/**
 * Validate that window bounds are reasonable for the current display.
 * Returns the original bounds if valid, or full workArea bounds as fallback.
 */
function validateBounds(
  bounds: { x: number; y: number; width: number; height: number },
  workArea: Electron.Rectangle,
): { x: number; y: number; width: number; height: number } {
  const minVisibleSize = 100;
  const isReasonable =
    bounds.width >= 800 &&
    bounds.height >= 600 &&
    bounds.x < workArea.x + workArea.width - minVisibleSize &&
    bounds.x > workArea.x - bounds.width + minVisibleSize &&
    bounds.y < workArea.y + workArea.height - minVisibleSize &&
    bounds.y > workArea.y - bounds.height + minVisibleSize;

  if (!isReasonable) {
    return { x: workArea.x, y: workArea.y, width: workArea.width, height: workArea.height };
  }
  return bounds;
}

/** Web preferences of every app renderer: a window, or a machine view inside one. */
export function buildRendererWebPreferences(): Electron.WebPreferences {
  return {
    preload: path.join(__dirname, '../preload-build/preload/index.js'),
    contextIsolation: true,
    nodeIntegration: false,
    webviewTag: true,
    additionalArguments: process.env.INTENT_IN_APP_PICKER === '1' ? ['--intent-in-app-picker'] : [],
  };
}

/**
 * A frame's own page (the frame route) only paints the backdrop under its
 * machine views: a sandboxed page with the backdrop bridge alone, no app
 * preload and no webviews.
 */
export function buildFramePageWebPreferences(): Electron.WebPreferences {
  return {
    preload: path.join(__dirname, '../preload-build/preload/frame.js'),
    sandbox: true,
    contextIsolation: true,
    nodeIntegration: false,
    webviewTag: false,
  };
}

/**
 * Build the standard BrowserWindowConstructorOptions used by all window creation functions.
 */
function buildWindowOptions(opts: {
  bounds: { x: number; y: number; width: number; height: number };
  title: string;
  iconPath?: string;
  /** Show the window once created (default); false keeps it hidden until shown. */
  show?: boolean;
  /** The window's own page privileges (default: the app renderer's). */
  webPreferences?: Electron.WebPreferences;
}): Electron.BrowserWindowConstructorOptions {
  const isDarkMode = nativeTheme.shouldUseDarkColors;
  return {
    x: opts.bounds.x,
    y: opts.bounds.y,
    width: opts.bounds.width,
    height: opts.bounds.height,
    minWidth: 800,
    minHeight: 600,
    ...(opts.show === false && { show: false }),
    webPreferences: opts.webPreferences ?? buildRendererWebPreferences(),
    ...getWindowTitleBarOptions(),
    title: opts.title,
    ...getWindowAppearanceOptions(isDarkMode),
    ...(opts.iconPath && { icon: opts.iconPath }),
  };
}

/**
 * The one seam every renderer window passes through. Awaits the
 * renderer-window gate first so no renderer boots before the critical IPC
 * handlers are registered (see ./renderer-window-gate.ts); callers never
 * re-derive that readiness themselves.
 */
async function createConfiguredWindow(
  opts: Parameters<typeof buildWindowOptions>[0],
): Promise<BrowserWindowType> {
  await whenRendererWindowsAllowed();
  await loadMenuBarAutoHidePref();
  const window = new BrowserWindow(buildWindowOptions(opts));
  registerWindowTitleListener(window);
  return window;
}

// Bounds for the renderer-console forwarder: per-message size cap and
// consecutive-duplicate suppression keep console-output.log bounded even
// under tight-loop console spam.
const RENDERER_CONSOLE_MAX_MESSAGE_CHARS = 4096;

/**
 * Renderer INFO breadcrumbs that are forwarded despite the info-level filter.
 *
 * Info is dropped by default to keep the log bounded, but a diagnostic whose
 * entire purpose is to populate a debug bundle is useless if it never reaches
 * the file. Entries here must be low-rate and periodic — `[RetentionFingerprint]`
 * emits one line per five minutes; `[BrowserHosting]` (intent-hq/intent#7855)
 * logs agent browser background-hosting steps only when a tab's mount
 * decision changes or a registration times out. Anything chatty belongs at
 * debug instead.
 */
const FORWARDED_RENDERER_INFO_MARKERS = ['[RetentionFingerprint]', '[BrowserHosting]'] as const;

function isForwardedInfoMessage(level: string, message: string): boolean {
  return level === 'info' && FORWARDED_RENDERER_INFO_MARKERS.some((m) => message.includes(m));
}

/**
 * Logger for forwarded renderer breadcrumbs.
 *
 * A separate category from `Main` because it is pinned to INFO in
 * logging-config: the production defaultLevel is WARN, so routing the
 * allowlisted info lines through `Main` would silently drop them in packaged
 * builds — the exact machines debug bundles come from. Note that `Logger`
 * re-reads the level from config on every call and ignores its constructor
 * `level` option, so registering the category is the only thing that works.
 */
const rendererConsoleLogger = new Logger('RendererConsole');

/**
 * Forward renderer console warnings/errors into the main-process log so they
 * land in {userData}/logs/console-output.log (via setupConsoleLogCapture) and
 * debug exports. Closes the diagnosability gap where renderer-only breadcrumbs
 * (e.g. failed comment.add evidence) were invisible in persistent logs.
 * Debug/verbose messages are never forwarded, info only for the explicit
 * allowlist above, messages are truncated to a few KB, and consecutive
 * duplicates are counted instead of re-written, to keep the log file bounded.
 */
export function forwardRendererConsoleToMainLog(
  window: BrowserWindowType,
  contents: Electron.WebContents = window.webContents,
): void {
  let lastLine = '';
  let suppressed = 0;
  contents.on('console-message', (details) => {
    const { level, message, sourceId, lineNumber } = details;
    const forwardedInfo = isForwardedInfoMessage(level, message);
    if (level !== 'warning' && level !== 'error' && !forwardedInfo) return;
    const origin = `${sourceId || 'renderer'}:${lineNumber}`;
    const bounded =
      message.length > RENDERER_CONSOLE_MAX_MESSAGE_CHARS
        ? `${message.slice(0, RENDERER_CONSOLE_MAX_MESSAGE_CHARS)}… [truncated ${message.length - RENDERER_CONSOLE_MAX_MESSAGE_CHARS} chars]`
        : message;
    // Warn/error keep the literal tag because they log under the `Main`
    // category; the info path already carries `RendererConsole` as its logger
    // context, so repeating it would stutter in the file.
    const line = forwardedInfo
      ? `${bounded} (${origin})`
      : `[RendererConsole] ${bounded} (${origin})`;
    if (line === lastLine) {
      suppressed += 1;
      return;
    }
    if (suppressed > 0) {
      logger.warn(`[RendererConsole] previous message repeated ${suppressed} more time(s)`);
      suppressed = 0;
    }
    lastLine = line;
    if (level === 'error') {
      logger.error(line);
    } else if (forwardedInfo) {
      rendererConsoleLogger.info(line);
    } else {
      logger.warn(line);
    }
  });
}

/**
 * Build the URL to load in a window (dev server or production app:// protocol).
 */
const DEFAULT_WINDOW_ROUTE = '/workspace/new';

export function buildLoadUrl(route: string = DEFAULT_WINDOW_ROUTE): string {
  if (process.env.NODE_ENV === 'development') {
    const devPort = process.env.DEV_PORT || '5190';
    return `http://127.0.0.1:${devPort}${route}`;
  }
  return `app://workspaces${route}`;
}

// ---- Saved Frames ----
// Saves and restores frames (app windows) so the app reopens with the same
// windows, each with its machines, the page each machine showed and the one
// it showed. window-frames.json holds them; window-sessions.json (older
// clients, keyed by backend) is migrated once and left on disk untouched, so
// an older client still restores its own layout after a downgrade.

/** A window to open on one machine and page (see `createWindowForSession`). */
export interface WindowSession {
  route: string;
  bounds: { x: number; y: number; width: number; height: number };
  isFullScreen?: boolean;
}

export function getWindowFramesPath(): string {
  return path.join(app.getPath('userData'), 'window-frames.json');
}

/** Older clients' per-backend layout. Read for migration only; never written or deleted. */
function getLegacyWindowSessionsPath(): string {
  return path.join(app.getPath('userData'), 'window-sessions.json');
}

function isRestorableRoute(route: string): boolean {
  return (
    !isTransientCaptureRoute(route) && !isDevConsoleRoute(route) && !isDesktopOverlayRoute(route)
  );
}

// Machines no longer saved (forgotten connections and guest sessions) are
// dropped when the saved frames are read; a frame left with none is dropped.
// Every machine counts as saved until boot reports the saved ones.
let savedMachineIds: ReadonlySet<string> | null = null;

function isSavedMachine(id: string): boolean {
  return id === LOCAL_CONNECTION_ID || !savedMachineIds || savedMachineIds.has(id);
}

const SAVED_FRAME_FILTER: FrameSessionFilter = {
  isSavedMachine,
  isRestorableRoute,
};

/**
 * Boot: the machines still saved (connection records and guest sessions; the
 * local machine always is). Call before restoring frames; frames already read
 * drop the other machines too.
 */
export function setSavedMachineIds(ids: Iterable<string>): void {
  savedMachineIds = new Set(ids);
  if (parkedFrames) parkedFrames = keepSavedMachines(parkedFrames, isSavedMachine);
}

/** `frames` with only the machines `keep` accepts; frames left empty are dropped. */
function keepSavedMachines(frames: FrameSession[], keep: (id: string) => boolean): FrameSession[] {
  return frames
    .map((frame) => keepFrameMachines(frame, keep))
    .filter((frame): frame is FrameSession => frame !== null);
}

function modifiedAt(file: string): number | null {
  try {
    return fs.statSync(file).mtimeMs;
  } catch {
    return null;
  }
}

/**
 * The saved frames. Migrates window-sessions.json when window-frames.json is
 * missing, or older than it (an older client ran after this one), and writes
 * the result so the migration runs once. A corrupt frames file reads as no
 * frames.
 */
function readSavedFrames(): FrameSession[] {
  const framesPath = getWindowFramesPath();
  const legacyPath = getLegacyWindowSessionsPath();
  const framesAt = modifiedAt(framesPath);
  const legacyAt = modifiedAt(legacyPath);
  if (framesAt !== null && (legacyAt === null || legacyAt <= framesAt)) {
    try {
      const frames = parseWindowFramesFile(
        JSON.parse(fs.readFileSync(framesPath, 'utf-8')),
        SAVED_FRAME_FILTER,
      );
      if (frames) return frames;
      logger.warn('Ignoring a window-frames.json of an unknown shape');
    } catch (err) {
      logger.warn('Failed to read saved frames:', err);
    }
    return [];
  }
  if (legacyAt === null) return [];
  let frames: FrameSession[] = [];
  try {
    frames = migrateWindowSessions(
      JSON.parse(fs.readFileSync(legacyPath, 'utf-8')),
      LOCAL_CONNECTION_ID,
      SAVED_FRAME_FILTER,
    );
    logger.info('Migrated window sessions to frames', { count: frames.length });
  } catch (err) {
    logger.warn('Failed to migrate window sessions:', err);
  }
  writeFramesSync(frames);
  return frames;
}

function serializeFrames(frames: FrameSession[]): string {
  const file: WindowFramesFile = { version: WINDOW_FRAMES_VERSION, frames };
  return JSON.stringify(file);
}

// Bumped by every synchronous write (a frame closing, or the saved layout
// discarded). An async save that was in flight across one rewrites that
// latest state, so it cannot resurrect a frame the user just closed.
let syncWriteCount = 0;
let lastSyncWrite = '';

function writeFramesSync(frames: FrameSession[]): void {
  try {
    lastSyncWrite = serializeFrames(frames);
    syncWriteCount++;
    fs.writeFileSync(getWindowFramesPath(), lastSyncWrite, 'utf-8');
  } catch (err) {
    logger.warn('Failed to write saved frames:', err);
  }
}

async function writeFrames(frames: FrameSession[]): Promise<void> {
  const before = syncWriteCount;
  await fsAsync.writeFile(getWindowFramesPath(), serializeFrames(frames), 'utf-8');
  if (syncWriteCount !== before) fs.writeFileSync(getWindowFramesPath(), lastSyncWrite, 'utf-8');
}

// The live frames at the last moment any were open. Used when a save runs
// after every window is gone (e.g. non-macOS window-all-closed, where
// getAppWindows() is already empty).
let lastKnownFrames: FrameSession[] | null = null;

// Saved frames not restored this run (no machine of theirs could connect, or a
// deep link skipped the restore). Saves keep them until a frame holding one of
// their machines opens. Null until the saved file is first read.
let parkedFrames: FrameSession[] | null = null;

function takeParkedFrames(): FrameSession[] {
  parkedFrames ??= readSavedFrames();
  return parkedFrames;
}

// The frame each restored window came from, for the pages its renderers have
// not loaded yet.
const restoredFrames = new WeakMap<BrowserWindowType, FrameSession>();

// True once the app has entered a quit/update-install teardown. Window closes
// during teardown are not deliberate closes: the close listener must not drop
// a frame that is only closing because the whole app is exiting — otherwise
// gracefulShutdown()'s mainWindow.close() removes the frames that
// before-quit/installUpdate() just saved. One-way on the gracefulShutdown()
// path (that path always exits); the auto-update service unmarks it when
// quitAndInstall() fails and the process keeps running.
let isQuitTeardownInProgress = false;

/**
 * Mark the start of an app-quit/update-install teardown so subsequent window
 * closes are not treated as deliberate closes. Registered callers are index.ts
 * (gracefulShutdown, which every quit path funnels through) and the
 * auto-update service (before quitAndInstall(), which closes windows before
 * before-quit fires on macOS).
 */
export function markWindowSessionTeardown(): void {
  isQuitTeardownInProgress = true;
}

/**
 * Revert markWindowSessionTeardown() when a teardown aborts and the process
 * keeps running — e.g. quitAndInstall() throws in installUpdate().
 */
export function unmarkWindowSessionTeardown(): void {
  isQuitTeardownInProgress = false;
}

/** Whether an app-quit/update-install teardown is closing the windows. */
export function isWindowSessionTeardown(): boolean {
  return isQuitTeardownInProgress;
}

// Invoked when a window that is not a frame (a HUD) is explicitly closed while
// another window survives and nothing else uses its non-local machine, so its
// pooled JSON-RPC client (socket, reconnect timers, subscriptions) can be
// disposed. A frame's machines are released by the rail owner when the frame
// closes. Registered by index.ts — which wraps the quit guard around
// disconnectBackendClient() — so window.ts never imports the backend IPC
// module graph.
type LastWindowClosedForBackendHandler = (backendId: string) => void;
let onLastWindowClosedForBackend: LastWindowClosedForBackendHandler | null = null;

export function setOnLastWindowClosedForBackend(
  handler: LastWindowClosedForBackendHandler | null,
): void {
  onLastWindowClosedForBackend = handler;
}

/** A live window whose layout is saved: a frame, or a HUD pop-out. */
function isSavedWindow(window: BrowserWindowType): boolean {
  if (window.isDestroyed()) return false;
  return isFrameWindow(window) || isTrackedHudWindow(window) || isHudWindow(window);
}

function withPlacement(window: BrowserWindowType, frame: FrameSession): FrameSession {
  // getBounds() during fullscreen returns that display's bounds, which is
  // exactly what lets restore land on the right monitor.
  if (window.isFullScreen()) frame.isFullScreen = true;
  return frame;
}

/**
 * What `window` saves: a frame's machines in rail order, each with the page
 * its view shows (one whose view has not loaded keeps the page it was
 * restored with), and the machine it shows; a HUD its machine and page. Null
 * for any other window, or a HUD that has not loaded its page.
 */
function frameFromWindow(window: BrowserWindowType): FrameSession | null {
  if (!isSavedWindow(window)) return null;
  if (!isFrameWindow(window)) {
    const id = getBackendIdForWindow(window);
    const route = routeFromRendererUrl(window.webContents.getURL(), DEFAULT_WINDOW_ROUTE);
    if (!route?.startsWith(HUD_ROUTE_PREFIX)) return null;
    return withPlacement(window, {
      bounds: window.getBounds(),
      machines: [{ id, route }],
      selectedId: id,
    });
  }
  const rail = getMachineRailSession(window);
  if (!rail) return null;
  if (isTabWindow(window)) {
    // A tab window saves its one machine, its page and its tab.
    const tabWindow = getTabWindowSessions()?.sessionFor(window);
    if (!tabWindow) return null;
    const id = rail.selectedId;
    return withPlacement(window, {
      bounds: window.getBounds(),
      machines: [{ id, route: tabWindowRoute(tabWindow.tabWindowId) }],
      selectedId: id,
      tabWindow,
    });
  }
  const restored = restoredFrames.get(window);
  const restoredRoute = (id: string) => restored?.machines.find((m) => m.id === id)?.route;
  const machines: FrameMachineSession[] = rail.machineIds.map((id) => {
    const renderer = rendererFor(window, id);
    const route =
      (renderer && !renderer.isDestroyed()
        ? routeFromRendererUrl(renderer.getURL(), DEFAULT_WINDOW_ROUTE)
        : null) ?? restoredRoute(id);
    return route && isRestorableRoute(route) ? { id, route } : { id };
  });
  return withPlacement(window, {
    bounds: window.getBounds(),
    machines,
    selectedId: rail.selectedId,
  });
}

function liveFrames(exclude?: BrowserWindowType): FrameSession[] {
  return getAppWindows()
    .filter((window) => window !== exclude)
    .map(frameFromWindow)
    .filter((frame): frame is FrameSession => frame !== null);
}

/**
 * Synchronously refresh the saved layout as a window closes. Wired to each
 * window's `close` event, while the closing window is still live. A frame the
 * user closes while other windows stay open is dropped from the file right
 * away (crash-safe), and its machine's pooled client is released when no
 * other window uses it. The last window closing, or any close during app
 * teardown, keeps the layout so the next launch reopens it. Electron invokes
 * the listener with the closing BrowserWindow as `this`.
 */
export function captureWindowSessionsSnapshot(this: BrowserWindowType | void): void {
  try {
    const closing =
      this && typeof this.isDestroyed === 'function' && isSavedWindow(this) ? this : null;
    const survivors = getAppWindows().filter(
      (window) => window !== closing && !window.isDestroyed(),
    );
    // A frame whose last machine the user removed is dropped even when it is
    // the last window, so the next launch does not bring the machine back.
    const emptied = closing !== null && isFrameEmptied(closing);
    if (!closing || isQuitTeardownInProgress || (survivors.length === 0 && !emptied)) {
      const live = liveFrames();
      if (live.length > 0 && !(isQuitTeardownInProgress && lastKnownFrames)) {
        lastKnownFrames = live;
      }
      return;
    }
    lastKnownFrames = liveFrames(closing);
    writeFramesSync(mergeParkedFrames(lastKnownFrames, takeParkedFrames()));
    // A frame's machines are released by the rail owner once it closes.
    if (isFrameWindow(closing)) return;
    const machineId = getBackendIdForWindow(closing);
    const stillUsed = survivors.some((window) =>
      isFrameWindow(window)
        ? frameMachines(window).includes(machineId)
        : getBackendIdForWindow(window) === machineId,
    );
    // Explicit last-window close for this machine: dispose its pooled client
    // so no socket or reconnect timer keeps dialing a daemon with no windows
    // left ("Open" reconnects on demand). Local is exempt — the sidecar
    // management must stay alive.
    if (machineId !== LOCAL_CONNECTION_ID && !stillUsed) {
      try {
        onLastWindowClosedForBackend?.(machineId);
      } catch (err) {
        logger.warn('Failed to dispose backend client on last window close:', err);
      }
    }
  } catch (err) {
    logger.warn('Failed to capture window sessions snapshot:', err);
  }
}

/** Save every live frame (or the last ones known, once every window is gone). */
export async function saveAllWindowSessions(): Promise<void> {
  try {
    const live = liveFrames();
    if (live.length > 0) lastKnownFrames = live;
    if (!lastKnownFrames) return;
    const frames = mergeParkedFrames(lastKnownFrames, takeParkedFrames());
    await writeFrames(frames);
    logger.debug('Saved frames', { count: frames.length });
  } catch (err) {
    logger.warn('Failed to save frames:', err);
  }
}

/**
 * Clear the in-memory last-known frames.
 *
 * Must be called whenever the saved layout is intentionally discarded (see
 * `discardSavedWindowFrames`). Without this, a later save — from a pending
 * debounced saver, an auto-update hook, or any other trigger — would see no
 * live windows, fall back to the cached frames, and resurrect the layout the
 * user deliberately cleared.
 */
export function clearWindowSessionsSnapshot(): void {
  lastKnownFrames = null;
}

/**
 * Forget the saved layout (macOS: the user closed every window, so a later
 * dock click opens one fresh window). Writes an empty frames file rather than
 * deleting it, so the next launch does not migrate window-sessions.json again.
 */
export function discardSavedWindowFrames(): void {
  clearWindowSessionsSnapshot();
  parkedFrames = [];
  writeFramesSync([]);
}

/**
 * Test-only helper: reset the in-memory saved-frame state.
 * Not part of the production API.
 */
export function _resetWindowSessionsCacheForTests(): void {
  clearWindowSessionsSnapshot();
  parkedFrames = null;
  savedMachineIds = null;
  syncWriteCount = 0;
  lastSyncWrite = '';
  onLastWindowClosedForBackend = null;
  isQuitTeardownInProgress = false;
}

/** Keep window-bounds.json (the boot window's bounds) up to date while `window` moves. */
function saveBoundsWhileMoving(window: BrowserWindowType): void {
  const savedBoundsPath = path.join(app.getPath('userData'), 'window-bounds.json');
  let saveBoundsTimeout: NodeJS.Timeout | null = null;
  const saveWindowBounds = () => {
    if (saveBoundsTimeout) clearTimeout(saveBoundsTimeout);
    saveBoundsTimeout = setTimeout(async () => {
      if (window.isDestroyed() || window.isMinimized() || window.isFullScreen()) return;
      try {
        await fsAsync.writeFile(savedBoundsPath, JSON.stringify(window.getBounds()), 'utf-8');
      } catch (err) {
        logger.warn('Failed to save window bounds:', err);
      }
    }, 500);
  };
  window.on('resize', saveWindowBounds);
  window.on('move', saveWindowBounds);
  window.on('closed', () => {
    if (saveBoundsTimeout) clearTimeout(saveBoundsTimeout);
  });
}

/** Clear the renderer cache in production, so a rebuilt app loads fresh files. */
function clearCacheInProduction(window: BrowserWindowType): void {
  if (process.env.NODE_ENV && process.env.NODE_ENV !== 'production') return;
  window.webContents.session
    .clearCache()
    .catch((error: unknown) => logger.error('Failed to clear cache:', error as Error));
}

/** A new frame and the renderer of the machine it shows (null when none could open). */
export interface OpenedFrame {
  window: BrowserWindowType;
  contents: Electron.WebContents | null;
}

/**
 * Open a frame: a window holding `machines`, each a view on its page, showing
 * `selectedId`. Its own page is the frame page (backdrop only), which the rail
 * owner loads only while the rail lab is on.
 */
async function createFrameWindow(opts: {
  bounds: { x: number; y: number; width: number; height: number };
  machines: FrameMachineSession[];
  selectedId: string;
  isFullScreen?: boolean;
  setAsMain: boolean;
  /** Also sets the macOS Dock icon (the boot window does). */
  setDockIcon?: boolean;
  /** False keeps the frame hidden until the caller shows it. */
  show?: boolean;
  /** A tab window (one panel tab): frame pickers skip it. */
  tabWindow?: boolean;
  /** Open maximized (a tab window on Windows and other Linux desktops). */
  maximize?: boolean;
}): Promise<OpenedFrame> {
  const iconPath = resolveIcon(opts.setDockIcon ?? opts.setAsMain);
  const window = await createConfiguredWindow({
    bounds: opts.bounds,
    title: resolveAppTitle(),
    iconPath,
    show: opts.show,
    webPreferences: buildFramePageWebPreferences(),
  });
  markFrameWindow(window);
  if (opts.tabWindow) markTabWindow(window);
  registerChatWindow(window);
  forwardRendererConsoleToMainLog(window);
  if (opts.setAsMain) {
    setMainWindow(window);
    clearCacheInProduction(window);
    saveBoundsWhileMoving(window);
    window.on('closed', () => {
      if (getMainWindow() === window) setMainWindow(null);
    });
  }
  // Re-enter fullscreen on the display the validated bounds landed on — a
  // frame saved fullscreen restores fullscreen, not windowed at screen-sized
  // bounds.
  if (opts.isFullScreen) window.setFullScreen(true);
  else if (opts.maximize) window.maximize();
  // The rail owner loads the frame page itself, once the shown machine has loaded.
  const contents = openFrameMachines(window, opts.machines, opts.selectedId);
  return { window, contents };
}

/**
 * Open a new frame on one machine at `route` (a path, may carry a query),
 * centred on the primary display. `show: false` keeps it hidden until the
 * caller shows it (a dock launch waits for the page to render).
 */
export async function openMachineFrame(opts: {
  machineId: string;
  route?: string;
  show?: boolean;
}): Promise<OpenedFrame> {
  const { workArea } = screen.getPrimaryDisplay();
  const width = Math.min(1920, workArea.width);
  const height = Math.min(1080, workArea.height);
  return createFrameWindow({
    bounds: {
      x: workArea.x + Math.round((workArea.width - width) / 2),
      y: workArea.y + Math.round((workArea.height - height) / 2),
      width,
      height,
    },
    machines: [{ id: opts.machineId, ...(opts.route ? { route: opts.route } : {}) }],
    selectedId: opts.machineId,
    setAsMain: false,
    show: opts.show,
  });
}

/**
 * Open a tab window: a frame on one machine at its tab window page, full
 * screen or maximized as `mode` says, on the display of the focused window.
 */
export async function openTabWindowFrame(opts: {
  machineId: string;
  route: string;
  mode: TabWindowDisplayMode;
}): Promise<BrowserWindowType> {
  const focused = BrowserWindow.getFocusedWindow();
  const display = focused ? screen.getDisplayMatching(focused.getBounds()) : null;
  const { workArea } = display ?? screen.getPrimaryDisplay();
  const { window } = await createFrameWindow({
    bounds: { x: workArea.x, y: workArea.y, width: workArea.width, height: workArea.height },
    machines: [{ id: opts.machineId, route: opts.route }],
    selectedId: opts.machineId,
    isFullScreen: opts.mode === 'full-screen',
    maximize: opts.mode === 'maximized',
    setAsMain: false,
    tabWindow: true,
  });
  return window;
}

/** Open a saved HUD pop-out, bound to the machine it was opened on. */
async function createHudWindowForFrame(
  frame: FrameSession,
  bounds: FrameSession['bounds'],
): Promise<BrowserWindowType> {
  const [{ id, route }] = frame.machines;
  const window = await createConfiguredWindow({
    bounds,
    title: resolveAppTitle(),
    iconPath: resolveIcon(false),
  });
  // Register it as THE HUD for that backend right away (stamp first — the
  // registry keys off the stamp): its URL is still loading during startup
  // restore, so the URL-scan fallback would miss it and a concurrent open-HUD
  // request could create a duplicate.
  stampWindowWithBackend(window, id);
  registerHudWindow(window);
  forwardRendererConsoleToMainLog(window);
  if (frame.isFullScreen) window.setFullScreen(true);
  window
    .loadURL(buildLoadUrl(route))
    .catch((error: unknown) => logger.error('Failed to load the HUD window:', error as Error));
  return window;
}

/**
 * Open a saved frame: its machines on their pages, showing the one it
 * showed. A saved HUD reopens as a HUD window. The bounds are checked
 * against the display they land on, not the primary display — otherwise a
 * layout saved on a secondary monitor fails the visibility check and is reset
 * to the primary work area. For bounds on a disconnected monitor,
 * getDisplayMatching() returns the nearest display and validateBounds() then
 * clamps/falls back within it.
 */
async function createWindowForFrame(
  frame: FrameSession,
  setAsMain: boolean,
): Promise<BrowserWindowType | null> {
  const first = frame.machines[0];
  if (!first || (first.route && isTransientCaptureRoute(first.route))) return null;
  const bounds = validateBounds(frame.bounds, screen.getDisplayMatching(frame.bounds).workArea);
  if (first.route?.startsWith(HUD_ROUTE_PREFIX)) {
    const hud = await createHudWindowForFrame(frame, bounds);
    restoredFrames.set(hud, frame);
    return hud;
  }
  if (frame.tabWindow) return createTabWindowForFrame(frame, bounds);
  // The bare root route (older saved sessions) reopens on the bootstrap route.
  const machines = frame.machines.map((machine) =>
    machine.route === '/' ? { ...machine, route: DEFAULT_WINDOW_ROUTE } : machine,
  );
  const { window } = await createFrameWindow({
    bounds,
    machines,
    selectedId: frame.selectedId,
    isFullScreen: frame.isFullScreen,
    setAsMain,
  });
  restoredFrames.set(window, frame);
  logger.info('Opened saved frame', { machines: frame.machines.length, isMain: setAsMain });
  return window;
}

/**
 * Reopen a saved tab window. It registers with the tab window registry
 * first, so the source window's restore sees it as open; a tab window that
 * cannot come back (its tab is in another tab window) is skipped.
 */
async function createTabWindowForFrame(
  frame: FrameSession,
  bounds: FrameSession['bounds'],
): Promise<BrowserWindowType | null> {
  const record = frame.tabWindow;
  const sessions = getTabWindowSessions();
  if (!record || !sessions) return null;
  const machineId = frame.selectedId;
  if (!sessions.willRestore(record, machineId)) return null;
  try {
    const { window } = await createFrameWindow({
      bounds,
      machines: [{ id: machineId, route: tabWindowRoute(record.tabWindowId) }],
      selectedId: machineId,
      isFullScreen: frame.isFullScreen,
      setAsMain: false,
      tabWindow: true,
    });
    sessions.restored(window, record.tabWindowId);
    restoredFrames.set(window, frame);
    logger.info('Opened saved tab window');
    return window;
  } catch (error) {
    sessions.restoreFailed(record.tabWindowId);
    throw error;
  }
}

/** Open a frame on one machine at `session.route` (a HUD route opens a HUD window). */
export async function createWindowForSession(
  session: WindowSession,
  setAsMain: boolean,
  backendId: string = LOCAL_CONNECTION_ID,
): Promise<BrowserWindowType | null> {
  const frame: FrameSession = {
    bounds: session.bounds,
    machines: [
      { id: backendId, route: session.route === '/' ? DEFAULT_WINDOW_ROUTE : session.route },
    ],
    selectedId: backendId,
  };
  if (session.isFullScreen) frame.isFullScreen = true;
  return createWindowForFrame(frame, setAsMain);
}

/**
 * Restore the saved frames that hold `toBackendId` and were not restored
 * yet, or open one fresh frame on it when there are none. Call AFTER the
 * backend's client is connected, so restored views load against a live
 * daemon.
 */
export async function restoreWindowsForBackend(toBackendId: string): Promise<void> {
  const parked = takeParkedFrames();
  const held = parked.filter((frame) => frameHolds(frame, toBackendId));
  parkedFrames = parked.filter((frame) => !held.includes(frame));
  // Tab windows last: the frames their tabs go back to open first.
  const frames = [...held.filter((f) => !f.tabWindow), ...held.filter((f) => f.tabWindow)];
  if (frames.length === 0) {
    logger.info('No saved frames for backend; opening a fresh window', { backendId: toBackendId });
    await createWindow(toBackendId);
    return;
  }
  logger.info('Restoring saved frames for backend', {
    backendId: toBackendId,
    count: frames.length,
  });
  const isHud = (frame: FrameSession) => !!frame.machines[0].route?.startsWith(HUD_ROUTE_PREFIX);
  const firstAppFrame = frames.findIndex((frame) => !isHud(frame) && !frame.tabWindow);
  for (let i = 0; i < frames.length; i++) {
    // Switching backends can restore app frames while its HUD is already open.
    if (isHud(frames[i]) && findExistingHudWindow(frames[i].machines[0].id)) continue;
    await createWindowForFrame(frames[i], i === firstAppFrame);
  }
  if (firstAppFrame === -1) await createWindow(toBackendId);
}

/**
 * Boot/dock-activate restore of every saved frame. Frames showing the active
 * machine restore first, so the first one becomes the main window. A frame
 * keeps the machines whose pooled client can be built via `connectBackend`
 * (injected — window.ts must not import backend.ipc; idempotent for
 * already-connected machines); a frame with none (forgotten remotes, missing
 * tokens) is skipped and kept saved. An unreachable-but-buildable machine
 * still restores behind the stopped overlay. Returns true when at least one
 * window was restored.
 */
export async function restoreAllBackendWindowSessions(
  activeBackendId: string,
  connectBackend: (backendId: string) => Promise<unknown>,
): Promise<boolean> {
  const frames = orderFramesForRestore(takeParkedFrames(), activeBackendId);
  parkedFrames = [];
  // Saved tab windows count as open from the start: a source window whose
  // layout restores before its tab window reopens must not take the tab back.
  const sessions = getTabWindowSessions();
  for (const frame of frames) {
    if (frame.tabWindow) sessions?.willRestore(frame.tabWindow, frame.selectedId);
  }
  const connectable = new Map<string, boolean>();
  const canConnect = async (id: string): Promise<boolean> => {
    let ok = connectable.get(id);
    if (ok === undefined) {
      try {
        await connectBackend(id);
        ok = true;
      } catch (err) {
        logger.warn('Skipping a machine without a connectable client', {
          backendId: id,
          error: err instanceof Error ? err.message : String(err),
        });
        ok = false;
      }
      connectable.set(id, ok);
    }
    return ok;
  };
  let restoredAny = false;
  for (const frame of frames) {
    const usable = new Set<string>();
    for (const machine of frame.machines) if (await canConnect(machine.id)) usable.add(machine.id);
    const kept = keepFrameMachines(frame, (id) => usable.has(id));
    if (!kept) {
      parkedFrames.push(frame);
      if (frame.tabWindow) sessions?.restoreFailed(frame.tabWindow.tabWindowId);
      continue;
    }
    const window = await createWindowForFrame(kept, !restoredAny && !kept.tabWindow);
    if (window) restoredAny = true;
    else if (kept.tabWindow) sessions?.restoreFailed(kept.tabWindow.tabWindowId);
  }
  if (restoredAny) logger.info('Restored saved frames', { count: frames.length });
  return restoredAny;
}

/** Bring `window` to the front and make it the main window. */
function bringToFront(window: BrowserWindowType): void {
  if (window.isMinimized()) window.restore();
  window.show();
  window.focus();
  setMainWindow(window);
}

/**
 * Show `backendId` in the frame that should show it (see `frameToShow`),
 * selecting it there when that frame holds it without showing it. Returns the
 * frame and the machine's renderer, or null when no frame holds the machine.
 */
function showInFrame(
  backendId: string,
): { window: BrowserWindowType; contents: Electron.WebContents | null } | null {
  const window = frameToShow(backendId);
  if (!window) return null;
  const selected = selectFrameMachine(window, backendId);
  return { window, contents: selected?.contents ?? rendererFor(window, backendId) };
}

/**
 * Open or focus a machine (Settings → Devices, deep links, invites): a frame
 * that holds it (the focused one, else the most recently focused) selects it
 * and comes to the front. Otherwise, with the rail on, the machine joins the
 * most recently focused frame; with the rail off (or when that frame cannot
 * take it) its saved frames reopen, or a fresh frame opens on it.
 */
export async function openOrFocusWindowsForBackend(backendId: string): Promise<void> {
  await openOrFocusMachine(backendId, true);
}

/**
 * The last window is about to close and holds no local machine: open (or
 * focus) local in a frame of its own. It must not join the closing frame,
 * which would close it too.
 */
export async function openLocalFrameBeforeClosingLast(): Promise<void> {
  await openOrFocusMachine(LOCAL_CONNECTION_ID, false);
}

/** {@link openOrFocusWindowsForBackend}; `mayJoin` false never adds the machine to a live frame. */
async function openOrFocusMachine(backendId: string, mayJoin: boolean): Promise<void> {
  let shown = showInFrame(backendId)?.window ?? null;
  if (!shown && mayJoin && isMachineRailEnabled()) {
    const recent = mostRecentFrame();
    if (recent && (await addMachineToFrame(recent, backendId)) && !recent.isDestroyed())
      shown = recent;
  }
  if (!shown) {
    await restoreWindowsForBackend(backendId);
    shown = showInFrame(backendId)?.window ?? null;
  }
  if (shown) bringToFront(shown);
}

/**
 * Show `workspaceId` in a frame holding `backendId` (picked and selected as
 * by `openOrFocusWindowsForBackend`): queue an `open` deep link for that
 * machine's view (drained by its deep-links saga once its daemon has admitted
 * it, so a just-restored view still picks it up) and bring the frame to the
 * front. Call after the machine was opened or focused. Returns false when no
 * frame holds the machine.
 */
export function showWorkspaceInBackendWindow(backendId: string, workspaceId: string): boolean {
  const target = showInFrame(backendId);
  if (!target?.contents) {
    logger.warn('No window for backend to show workspace in', { backendId, workspaceId });
    return false;
  }
  queueDeepLinkForRenderer(target.contents, { type: 'open', params: { id: workspaceId } });
  bringToFront(target.window);
  return true;
}

/**
 * Show an agent or panel tab of a workspace in a frame holding `backendId`, as
 * {@link showWorkspaceInBackendWindow} shows a workspace: the queued link opens
 * the workspace and then the agent or tab, as a notification click does. Returns
 * false when no frame holds the machine.
 */
export function showAgentInBackendWindow(
  backendId: string,
  { workspaceId, agentId, tabId }: ConnectionAgentTarget,
): boolean {
  const target = showInFrame(backendId);
  if (!target?.contents) {
    logger.warn('No window for backend to show agent in', {
      backendId,
      workspaceId,
      agentId,
      tabId,
    });
    return false;
  }
  queueDeepLinkForRenderer(target.contents, {
    type: 'notification',
    params: { workspaceId, ...(agentId ? { agentId } : {}), ...(tabId ? { tabId } : {}) },
  });
  bringToFront(target.window);
  return true;
}

/**
 * Whether closing `backendId` closes `window`: a frame that holds only that
 * machine, or another window (HUD, popup) bound to it.
 */
function closesWith(window: BrowserWindowType, backendId: string): boolean {
  if (!isFrameWindow(window)) return getBackendIdForWindow(window) === backendId;
  const machines = frameMachines(window);
  return machines.length > 0 && machines.every((id) => id === backendId);
}

/** Ensure closing one backend cannot destroy the app's final live window. */
export async function ensureLocalWindowBeforeClosingBackend(backendId: string): Promise<void> {
  const liveWindows = getAppWindows().filter(
    (window) => !window.isDestroyed() && !isTransientCaptureWindow(window),
  );
  const closesAnyWindow = liveWindows.some((window) => closesWith(window, backendId));
  const hasSurvivingWindow = liveWindows.some((window) => !closesWith(window, backendId));
  // Every live frame is about to close: local gets a frame of its own.
  if (closesAnyWindow && !hasSurvivingWindow) {
    await openOrFocusMachine(LOCAL_CONNECTION_ID, false);
  }
}

/**
 * Destroy the windows that close with one backend (frames holding only it,
 * and HUDs bound to it), preserving every other backend. Frames that hold
 * other machines too keep them; the caller removes the backend from them.
 */
export function closeWindowsForBackend(backendId: string): void {
  // A forgotten machine leaves the saved frames not restored this run too.
  if (parkedFrames) parkedFrames = keepSavedMachines(parkedFrames, (id) => id !== backendId);
  const windows = getAppWindows();
  for (const window of windows) {
    if (!window.isDestroyed() && !isDockWindow(window) && closesWith(window, backendId))
      window.destroy();
  }
  const main = getMainWindow();
  if (main?.isDestroyed()) {
    setMainWindow(
      windows.find((window) => !window.isDestroyed() && !isTransientCaptureWindow(window)) ?? null,
    );
  }
}

let coldStartDeepLinkTaken = false;

export function __resetColdStartDeepLinkForTesting(): void {
  coldStartDeepLinkTaken = false;
}

export async function createWindow(backendId: string = LOCAL_CONNECTION_ID): Promise<void> {
  const { workArea } = screen.getPrimaryDisplay();

  // Try to restore saved window bounds, falling back to full workArea
  interface WindowBounds {
    x?: number;
    y?: number;
    width?: number;
    height?: number;
  }

  let windowBounds = {
    x: workArea.x,
    y: workArea.y,
    width: workArea.width,
    height: workArea.height,
  };

  const savedBoundsPath = path.join(app.getPath('userData'), 'window-bounds.json');
  try {
    if (fs.existsSync(savedBoundsPath)) {
      const savedBounds = JSON.parse(fs.readFileSync(savedBoundsPath, 'utf-8')) as WindowBounds;
      logger.info('Loaded window bounds from file:', savedBounds);

      if (savedBounds && savedBounds.width && savedBounds.height) {
        // Resolve optional x/y before validating
        const resolved = {
          x: savedBounds.x ?? workArea.x,
          y: savedBounds.y ?? workArea.y,
          width: savedBounds.width,
          height: savedBounds.height,
        };
        // Validate against the display the saved bounds land on, not the
        // primary display, so bounds saved on a secondary monitor survive. In
        // the fallback case validateBounds() returns that matched display's
        // work area, so use its result either way instead of snapping back to
        // the primary display.
        windowBounds = validateBounds(resolved, screen.getDisplayMatching(resolved).workArea);
        if (windowBounds === resolved) {
          logger.info('Using saved window bounds:', windowBounds);
        } else {
          logger.info(
            'Saved window bounds not reasonable, using matched display work area:',
            windowBounds,
          );
        }
      }
    }
  } catch (err) {
    logger.warn('Failed to load saved window bounds:', err);
  }

  const { window, contents } = await createFrameWindow({
    bounds: windowBounds,
    machines: [{ id: backendId }],
    selectedId: backendId,
    setAsMain: true,
    setDockIcon: true,
  });

  window.once('show', () => {
    logger.info('Window shown with bounds:', window.getBounds());
  });

  // Check process.argv for intent:// URL on cold start. Pair and invite links
  // are excluded: they are handled fully in the main process (parked at
  // startup, processed once the window is ready) and never reach the
  // renderer. Any other link is queued for the frame's machine; its
  // deep-links saga pulls it once it starts listening. argv never changes, so
  // only the first frame created takes the link — a later createWindow
  // (session restore, another backend) must not replay it (a replayed
  // `open?path` could create a second workspace).
  const intentUrl = coldStartDeepLinkTaken ? undefined : findIntentUrl(process.argv);
  if (contents && intentUrl && !isMainOnlyLinkUri(intentUrl) && !isInviteUri(intentUrl)) {
    coldStartDeepLinkTaken = true;
    const deepLinkHandler = new DeepLinkHandler();
    const action = deepLinkHandler.parseDeepLink(intentUrl);
    if (action) {
      queueDeepLinkForRenderer(contents, action);
      logger.info('Queued cold-start deep link for the boot window:', {
        url: scrubToken(intentUrl),
      });
    }
  }
}

/** Focus `window` (restoring it from the dock first) for a delivered deep link. */
function focusDeepLinkWindow(window: BrowserWindowType): void {
  if (window.isMinimized()) window.restore();
  window.focus();
}

/**
 * Handle a deep link URL received from the OS (intent:// protocol)
 *
 * Every renderer-bound action is queued for its target window and pulled by
 * that window's deep-links saga (see pending-deep-links.ts):
 * - `open` links (`path` from the `intent` CLI, or a workspace `id`) target a
 *   window bound to the local daemon — opened or focused on demand — because
 *   the path and id refer to this machine's daemon, not a remote host.
 * - `create` with `newWindow=true` opens a new (local) window.
 * - Every other action (`create`, `clone`, `settings`) goes to the
 *   last-focused main window.
 */
export async function createWindowForDeepLink(
  deepLinkUrl: string,
  deepLinkHandler: DeepLinkHandler,
): Promise<void> {
  logger.info('Creating window for deep link:', { url: scrubToken(deepLinkUrl) });

  // Pair links never touch the renderer (no window, no IPC): route straight
  // to the main-process pair handler. Dynamic import — pair-deep-link reaches
  // backend.ipc, which imports this module (a static import would cycle).
  if (isMainOnlyLinkUri(deepLinkUrl)) {
    const { handlePairDeepLink } = await import('../features/deeplink/main/pair-deep-link');
    await handlePairDeepLink(deepLinkUrl);
    return;
  }
  // Invite links: same posture (the invite secret never reaches the renderer).
  if (isInviteUri(deepLinkUrl)) {
    const { handleInviteDeepLink } = await import('../features/deeplink/main/invite-deep-link');
    await handleInviteDeepLink(deepLinkUrl);
    return;
  }

  // Parse the deep link to extract action and params
  const action = deepLinkHandler.parseDeepLink(deepLinkUrl);
  if (!action) {
    logger.warn('Failed to parse deep link URL:', { url: scrubToken(deepLinkUrl) });
    return;
  }

  const queueForLocalWindow = async (): Promise<void> => {
    await openOrFocusWindowsForBackend(LOCAL_CONNECTION_ID);
    // The local machine's own view, even while the frame is still switching to it.
    const local = showInFrame(LOCAL_CONNECTION_ID);
    if (local?.contents) {
      queueDeepLinkForRenderer(local.contents, action);
      focusDeepLinkWindow(local.window);
      logger.info('Queued deep link for local window', { type: action.type });
    } else {
      logger.warn('No local window could be opened for deep link', { type: action.type });
    }
  };

  if (action.type === 'open') {
    await queueForLocalWindow();
    return;
  }

  if (!(action.type === 'create' && String(action.params?.newWindow) === 'true')) {
    const mainWindow = getMainWindow();
    if (mainWindow && !mainWindow.isDestroyed()) {
      queueDeepLinkForWindow(mainWindow, action);
      focusDeepLinkWindow(mainWindow);
      logger.info('Queued deep link for existing window', { type: action.type });
    } else {
      // Every window is closed (e.g. macOS keeps the app in the dock): open a
      // local one rather than parking a link nothing would drain.
      await queueForLocalWindow();
    }
    return;
  }

  // Create a new local frame with full workArea bounds
  const { workArea } = screen.getPrimaryDisplay();
  const bounds = { x: workArea.x, y: workArea.y, width: workArea.width, height: workArea.height };
  const { window: newWindow, contents } = await createFrameWindow({
    bounds,
    machines: [{ id: LOCAL_CONNECTION_ID, route: DEFAULT_WINDOW_ROUTE }],
    selectedId: LOCAL_CONNECTION_ID,
    setAsMain: false,
  });
  if (contents) queueDeepLinkForRenderer(contents, action);
  newWindow.focus();

  logger.info('New window created for deep link:', { action: action.type });
}
