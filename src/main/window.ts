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
import { queueDeepLinkForWindow } from '../features/deeplink/main/pending-deep-links';
import { isInviteUri } from '../shared/utils/invite-uri';
import { isMainOnlyLinkUri } from '../shared/utils/node-invite-uri';
import { getMainWindow, setMainWindow } from './state';
import { LOCAL_CONNECTION_ID } from '../shared/types/connections';
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
import { getMachineRailSession, restoreMachineRailSession } from './machine-rail-state';
import type {
  FrameMachineSession,
  FrameSession,
  MachineRailSession,
  WindowFramesFile,
} from '../shared/types/machine-rail';
import {
  frameOwnMachineId,
  mergeParkedFrames,
  migrateWindowSessions,
  orderFramesForRestore,
  parseWindowFramesFile,
  promoteFrameMachine,
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
  stampWindowWithBackend,
} from './window-backend';
import {
  focusedFrame,
  frameMachines,
  frameOwnMachine,
  rendererFor,
  setNonFrameWindowPredicate,
} from './frames';

export { getBackendIdForWebContents, getBackendIdForWindow, stampWindowWithBackend };

// Dock and capture windows are not frames.
setNonFrameWindowPredicate(isTransientCaptureWindow);

/** The focused frame's own machine; falls back to the main window, then local. */
export function getFocusedWindowBackendId(): string {
  const frame = focusedFrame();
  return frame ? frameOwnMachine(frame) : LOCAL_CONNECTION_ID;
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
  };
}

/**
 * Build the standard BrowserWindowConstructorOptions used by all window creation functions.
 */
function buildWindowOptions(opts: {
  bounds: { x: number; y: number; width: number; height: number };
  title: string;
  iconPath?: string;
}): Electron.BrowserWindowConstructorOptions {
  const isDarkMode = nativeTheme.shouldUseDarkColors;
  return {
    x: opts.bounds.x,
    y: opts.bounds.y,
    width: opts.bounds.width,
    height: opts.bounds.height,
    minWidth: 800,
    minHeight: 600,
    webPreferences: buildRendererWebPreferences(),
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

/** A window to restore (see `createWindowForSession`). */
export interface WindowSession {
  route: string;
  bounds: { x: number; y: number; width: number; height: number };
  isFullScreen?: boolean;
  // Machine rail (Labs): the window's machines, their pages and the one it
  // showed. Missing → the window shows only its own machine.
  rail?: MachineRailSession;
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

// Machines no longer saved are dropped at restore: a window's own machine
// fails to connect, and the rail keeps only saved machines.
const SAVED_FRAME_FILTER: FrameSessionFilter = {
  isSavedMachine: () => true,
  isRestorableRoute,
};

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

// Saved frames not restored this run (their machine could not connect, or a
// deep link skipped the restore). Saves keep them until a window on their
// machine opens. Null until the saved file is first read.
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

// Invoked when a non-local machine's last window is explicitly closed while
// another window survives, so its pooled JSON-RPC client (socket, reconnect
// timers, subscriptions) can be disposed. Registered by index.ts — which wraps
// the quit guard around disconnectBackendClient() — so window.ts never
// imports the backend IPC module graph.
type LastWindowClosedForBackendHandler = (backendId: string) => void;
let onLastWindowClosedForBackend: LastWindowClosedForBackendHandler | null = null;

export function setOnLastWindowClosedForBackend(
  handler: LastWindowClosedForBackendHandler | null,
): void {
  onLastWindowClosedForBackend = handler;
}

function isLiveFrameWindow(window: BrowserWindowType): boolean {
  return !window.isDestroyed() && !isTransientCaptureWindow(window);
}

/**
 * What `window` saves: its own machine with its page first, then its rail
 * machines with theirs (a machine whose renderer has not loaded keeps the
 * page it was restored with), and the machine it shows. Null for a window
 * that has not loaded a page or whose page never reopens.
 */
function frameFromWindow(window: BrowserWindowType): FrameSession | null {
  if (!isLiveFrameWindow(window)) return null;
  const restored = restoredFrames.get(window);
  const restoredRoute = (id: string) => restored?.machines.find((m) => m.id === id)?.route;
  const ownId = frameOwnMachine(window);
  const ownRoute =
    routeFromRendererUrl(window.webContents.getURL(), DEFAULT_WINDOW_ROUTE) ?? restoredRoute(ownId);
  if (!ownRoute || isDevConsoleRoute(ownRoute) || isDesktopOverlayRoute(ownRoute)) return null;
  const machines: FrameMachineSession[] = [{ id: ownId, route: ownRoute }];
  const rail = getMachineRailSession(window);
  for (const id of rail?.machineIds ?? []) {
    if (id === ownId) continue;
    const renderer = rendererFor(window, id);
    const route =
      (renderer && !renderer.isDestroyed()
        ? routeFromRendererUrl(renderer.getURL(), DEFAULT_WINDOW_ROUTE)
        : null) ?? restoredRoute(id);
    machines.push(route ? { id, route } : { id });
  }
  const selectedId =
    rail && machines.some((machine) => machine.id === rail.selectedId) ? rail.selectedId : ownId;
  const frame: FrameSession = { bounds: window.getBounds(), machines, selectedId };
  // getBounds() during fullscreen returns that display's bounds, which is
  // exactly what lets restore land on the right monitor.
  if (window.isFullScreen()) frame.isFullScreen = true;
  return frame;
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
      this && typeof this.isDestroyed === 'function' && isLiveFrameWindow(this) ? this : null;
    const survivors = getAppWindows().filter(
      (window) => window !== closing && !window.isDestroyed(),
    );
    if (!closing || isQuitTeardownInProgress || survivors.length === 0) {
      const live = liveFrames();
      if (live.length > 0 && !(isQuitTeardownInProgress && lastKnownFrames)) {
        lastKnownFrames = live;
      }
      return;
    }
    lastKnownFrames = liveFrames(closing);
    writeFramesSync(mergeParkedFrames(lastKnownFrames, takeParkedFrames()));
    const machineId = frameOwnMachine(closing);
    const stillUsed = survivors.some((window) =>
      isTransientCaptureWindow(window)
        ? getBackendIdForWindow(window) === machineId
        : frameMachines(window).includes(machineId),
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
  syncWriteCount = 0;
  lastSyncWrite = '';
  onLastWindowClosedForBackend = null;
  isQuitTeardownInProgress = false;
}

/**
 * Create a window to restore a saved session.
 * Similar to createWindow() but accepts a specific route and bounds.
 */
export async function createWindowForSession(
  session: WindowSession,
  setAsMain: boolean,
  backendId: string = LOCAL_CONNECTION_ID,
): Promise<BrowserWindowType | null> {
  if (isTransientCaptureRoute(session.route)) return null;
  const iconPath = resolveIcon(setAsMain);
  // Validate against the display the saved bounds actually land on, not the
  // primary display — otherwise a layout saved on a secondary monitor fails
  // the visibility check and is reset to the primary work area. For bounds on
  // a disconnected monitor, getDisplayMatching() returns the nearest display
  // and validateBounds() then clamps/falls back within it.
  const { workArea } = screen.getDisplayMatching(session.bounds);
  const bounds = validateBounds(session.bounds, workArea);

  const window = await createConfiguredWindow({ bounds, title: resolveAppTitle(), iconPath });
  // A restored HUD session keeps its saved backend bucket — the HUD is bound
  // to the backend it was opened on, not forced to local. Register it as THE
  // HUD for that backend right away (stamp first — the registry keys off the
  // stamp): its URL is still loading during startup restore, so the URL-scan
  // fallback would miss it and a concurrent open-HUD request could create a
  // duplicate.
  stampWindowWithBackend(window, backendId);
  if (session.route.startsWith(HUD_ROUTE_PREFIX)) {
    registerHudWindow(window);
  } else {
    registerChatWindow(window);
    restoreMachineRailSession(window, session.rail);
  }
  forwardRendererConsoleToMainLog(window);

  if (setAsMain) {
    setMainWindow(window);
  }

  // Clear cache in production to ensure fresh file references after rebuilds
  if (setAsMain && (!process.env.NODE_ENV || process.env.NODE_ENV === 'production')) {
    window.webContents.session
      .clearCache()
      .then(() => logger.info('Cache cleared for session-restored window'))
      .catch((error: unknown) =>
        logger.error('Failed to clear cache for session-restored window:', error as Error),
      );
  }

  // Re-enter fullscreen on the display the validated bounds landed on — a
  // session saved fullscreen restores fullscreen, not windowed at
  // screen-sized bounds.
  if (session.isFullScreen) {
    window.setFullScreen(true);
  }

  const route = session.route === '/' ? DEFAULT_WINDOW_ROUTE : session.route;
  window
    .loadURL(buildLoadUrl(route))
    .catch((error: unknown) =>
      logger.error('Failed to load session-restored window URL:', error as Error),
    );

  // Save bounds on resize/move (updates the main window bounds file for backward compat)
  let saveBoundsTimeout: NodeJS.Timeout | null = null;
  if (setAsMain) {
    const savedBoundsPath = path.join(app.getPath('userData'), 'window-bounds.json');
    const saveWindowBounds = () => {
      if (saveBoundsTimeout) clearTimeout(saveBoundsTimeout);
      saveBoundsTimeout = setTimeout(async () => {
        if (window.isDestroyed() || window.isMinimized() || window.isFullScreen()) return;
        try {
          const currentBounds = window.getBounds();
          await fsAsync.writeFile(savedBoundsPath, JSON.stringify(currentBounds), 'utf-8');
        } catch (err) {
          logger.warn('Failed to save window bounds:', err);
        }
      }, 500);
    };
    window.on('resize', saveWindowBounds);
    window.on('move', saveWindowBounds);
  }

  window.on('closed', () => {
    if (setAsMain) {
      setMainWindow(null);
    }
    if (saveBoundsTimeout) clearTimeout(saveBoundsTimeout);
  });

  logger.info('Restored session window', { route: session.route, isMain: setAsMain });
  return window;
}

/**
 * Open the window for a saved frame on `ownId` (the frame's first machine for
 * now): its page, then its rail machines with their pages, showing the
 * machine it showed.
 */
async function createWindowForFrame(
  frame: FrameSession,
  setAsMain: boolean,
): Promise<BrowserWindowType | null> {
  const [own] = frame.machines;
  const route = own.route ?? DEFAULT_WINDOW_ROUTE;
  const routes: Record<string, string> = {};
  for (const machine of frame.machines) if (machine.route) routes[machine.id] = machine.route;
  const session: WindowSession = { route, bounds: frame.bounds };
  if (frame.isFullScreen) session.isFullScreen = true;
  if (frame.machines.length > 1 && !route.startsWith(HUD_ROUTE_PREFIX)) {
    session.rail = {
      machineIds: frame.machines.map((machine) => machine.id),
      selectedId: frame.selectedId,
      routes,
    };
  }
  const window = await createWindowForSession(session, setAsMain, own.id);
  if (window) restoredFrames.set(window, frame);
  return window;
}

/**
 * Restore the saved frames that open on `toBackendId` and were not restored
 * yet, or open one fresh default window when there are none. Call AFTER the
 * backend's client is connected, so restored windows load against a live
 * daemon.
 */
export async function restoreWindowsForBackend(toBackendId: string): Promise<void> {
  const parked = takeParkedFrames();
  const frames = parked.filter((frame) => frameOwnMachineId(frame) === toBackendId);
  parkedFrames = parked.filter((frame) => !frames.includes(frame));
  if (frames.length === 0) {
    logger.info('No saved frames for backend; opening a fresh window', { backendId: toBackendId });
    await createWindow(toBackendId);
    return;
  }
  logger.info('Restoring saved frames for backend', {
    backendId: toBackendId,
    count: frames.length,
  });
  const firstAppFrame = frames.findIndex(
    (frame) => !frame.machines[0].route?.startsWith(HUD_ROUTE_PREFIX),
  );
  for (let i = 0; i < frames.length; i++) {
    // Switching backends can restore app frames while its HUD is already open.
    if (
      frames[i].machines[0].route?.startsWith(HUD_ROUTE_PREFIX) &&
      findExistingHudWindow(toBackendId)
    ) {
      continue;
    }
    await createWindowForFrame(frames[i], i === firstAppFrame);
  }
  if (firstAppFrame === -1) await createWindow(toBackendId);
}

/**
 * Boot/dock-activate restore of every saved frame. Frames opening on the
 * active machine restore first, so the first one becomes the main window.
 * Each frame opens on its first machine whose pooled client can be built via
 * `connectBackend` (injected — window.ts must not import backend.ipc;
 * idempotent for already-connected machines); machines before it are dropped.
 * A frame with no such machine (forgotten remote, missing token) is skipped
 * and kept saved; an unreachable-but-buildable machine still restores behind
 * the stopped overlay. Returns true when at least one window was restored.
 */
export async function restoreAllBackendWindowSessions(
  activeBackendId: string,
  connectBackend: (backendId: string) => Promise<unknown>,
): Promise<boolean> {
  const frames = orderFramesForRestore(takeParkedFrames(), activeBackendId);
  parkedFrames = [];
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
    let ownId: string | null = null;
    for (const machine of frame.machines) {
      if (await canConnect(machine.id)) {
        ownId = machine.id;
        break;
      }
    }
    if (!ownId) {
      parkedFrames.push(frame);
      continue;
    }
    const window = await createWindowForFrame(promoteFrameMachine(frame, ownId), !restoredAny);
    if (window) restoredAny = true;
  }
  if (restoredAny) logger.info('Restored saved frames', { count: frames.length });
  return restoredAny;
}

/** Focus the first app window for a backend, restoring saved/fresh windows if needed. */
/** First live, non-HUD app window bound to `backendId`, if any. */
function findAppWindowForBackend(backendId: string): BrowserWindowType | undefined {
  return getAppWindows().find(
    (window) =>
      !window.isDestroyed() &&
      !isTransientCaptureWindow(window) &&
      frameOwnMachine(window) === backendId &&
      !isTrackedHudWindow(window) &&
      !isHudWindow(window),
  );
}

export async function openOrFocusWindowsForBackend(backendId: string): Promise<void> {
  const findAppWindow = () => findAppWindowForBackend(backendId);
  let existing = findAppWindow();
  if (!existing) {
    await restoreWindowsForBackend(backendId);
    existing = findAppWindow();
  }
  if (existing) {
    if (existing.isMinimized()) existing.restore();
    existing.show();
    existing.focus();
    setMainWindow(existing);
  }
}

/**
 * Show `workspaceId` in `backendId`'s app window: queue an `open` deep link
 * for it (drained by that window's deep-links saga once its daemon has
 * admitted it, so a just-restored window still picks it up) and bring the
 * window to the front. Call after the backend's window was opened or focused
 * (see `openOrFocusWindowsForBackend`). Returns false when no app window is
 * bound to the backend.
 */
export function showWorkspaceInBackendWindow(backendId: string, workspaceId: string): boolean {
  const window = findAppWindowForBackend(backendId);
  if (!window) {
    logger.warn('No window for backend to show workspace in', { backendId, workspaceId });
    return false;
  }
  queueDeepLinkForWindow(window, { type: 'open', params: { id: workspaceId } });
  if (window.isMinimized()) window.restore();
  window.show();
  window.focus();
  setMainWindow(window);
  return true;
}

/** Ensure closing one backend cannot destroy the app's final live window. */
export async function ensureLocalWindowBeforeClosingBackend(backendId: string): Promise<void> {
  const liveWindows = getAppWindows().filter(
    (window) => !window.isDestroyed() && !isTransientCaptureWindow(window),
  );
  const closesAnyWindow = liveWindows.some((window) => frameOwnMachine(window) === backendId);
  const hasSurvivingWindow = liveWindows.some((window) => frameOwnMachine(window) !== backendId);
  if (closesAnyWindow && !hasSurvivingWindow) {
    await openOrFocusWindowsForBackend(LOCAL_CONNECTION_ID);
  }
}

/** Destroy only windows bound to one backend, preserving every other backend. */
export function closeWindowsForBackend(backendId: string): void {
  const windows = getAppWindows();
  for (const window of windows) {
    if (!window.isDestroyed() && !isDockWindow(window) && frameOwnMachine(window) === backendId)
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
  const iconPath = resolveIcon(true);
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

  const window = await createConfiguredWindow({
    bounds: windowBounds,
    title: resolveAppTitle(),
    iconPath,
  });
  stampWindowWithBackend(window, backendId);
  forwardRendererConsoleToMainLog(window);

  registerChatWindow(window);
  setMainWindow(window);

  // Save window bounds when resized or moved (debounced)
  let saveBoundsTimeout: NodeJS.Timeout | null = null;
  const saveWindowBounds = () => {
    if (saveBoundsTimeout) clearTimeout(saveBoundsTimeout);
    saveBoundsTimeout = setTimeout(async () => {
      if (window.isDestroyed() || window.isMinimized() || window.isFullScreen()) return;
      try {
        const bounds = window.getBounds();
        await fsAsync.writeFile(savedBoundsPath, JSON.stringify(bounds), 'utf-8');
        logger.info('Saved window bounds:', bounds);
      } catch (err) {
        logger.warn('Failed to save window bounds:', err);
      }
    }, 500);
  };

  window.on('resize', saveWindowBounds);
  window.on('move', saveWindowBounds);

  window.once('show', () => {
    logger.info('Window shown with bounds:', window.getBounds());
  });

  // Clear cache in production to ensure fresh file references after rebuilds
  if (!process.env.NODE_ENV || process.env.NODE_ENV === 'production') {
    window.webContents.session
      .clearCache()
      .then(() => logger.info('Cache cleared for fresh build'))
      .catch((error: unknown) => logger.error('Failed to clear cache:', error as Error));
  }

  // Check process.argv for intent:// URL on cold start. Pair and invite links
  // are excluded: they are handled fully in the main process (parked at
  // startup, processed once the window is ready) and never reach the
  // renderer. Any other link is queued for this window; its deep-links saga
  // pulls it once it starts listening. argv never changes, so only the first
  // window created takes the link — a later createWindow (session restore,
  // another backend) must not replay it (a replayed `open?path` could create
  // a second workspace).
  const intentUrl = coldStartDeepLinkTaken ? undefined : findIntentUrl(process.argv);
  const loadUrl = buildLoadUrl();

  if (intentUrl && !isMainOnlyLinkUri(intentUrl) && !isInviteUri(intentUrl)) {
    coldStartDeepLinkTaken = true;
    const deepLinkHandler = new DeepLinkHandler();
    const action = deepLinkHandler.parseDeepLink(intentUrl);
    if (action) {
      queueDeepLinkForWindow(window, action);
      logger.info('Queued cold-start deep link for the boot window:', {
        url: scrubToken(intentUrl),
      });
    }
  }

  window
    .loadURL(loadUrl)
    .catch((error: unknown) => logger.error('Failed to load main window URL:', error as Error));

  window.on('closed', () => {
    setMainWindow(null);
    if (saveBoundsTimeout) clearTimeout(saveBoundsTimeout);
  });
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
    const localWindow = findAppWindowForBackend(LOCAL_CONNECTION_ID);
    if (localWindow) {
      queueDeepLinkForWindow(localWindow, action);
      focusDeepLinkWindow(localWindow);
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

  // Create a new window with full workArea bounds
  const { workArea } = screen.getPrimaryDisplay();
  const bounds = { x: workArea.x, y: workArea.y, width: workArea.width, height: workArea.height };

  const iconPath = resolveIcon(false);
  const newWindow = await createConfiguredWindow({ bounds, title: resolveAppTitle(), iconPath });
  registerChatWindow(newWindow);
  stampWindowWithBackend(newWindow);
  forwardRendererConsoleToMainLog(newWindow);
  queueDeepLinkForWindow(newWindow, action);

  newWindow
    .loadURL(buildLoadUrl(DEFAULT_WINDOW_ROUTE))
    .catch((error: unknown) =>
      logger.error('Failed to load deep-link window URL:', error as Error),
    );
  newWindow.focus();

  logger.info('New window created for deep link:', { action: action.type });
}
