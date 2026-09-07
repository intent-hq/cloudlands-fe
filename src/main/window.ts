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
import { isPairingUri } from '../shared/utils/pairing-uri';
import { getMainWindow, setMainWindow } from './state';
import { LOCAL_CONNECTION_ID } from '../shared/types/connections';
import { fileURLToPath } from 'url';
import { dirname } from 'path';
import {
  getWindowAppearanceOptions,
  getWindowTitleBarOptions,
} from '../shared/main/window-appearance';
import { resolveAppDockIconPath, resolveAppIconPath } from './utils/resolve-app-icon';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const logger = new Logger('Main');

// ---- Shared Window Helpers ----

// Backend stamping lives in the dependency-light window-backend.ts (so
// hud-window.ts and other small modules can read stamps without this
// module's graph); re-exported here for the existing import sites.
import { HUD_ROUTE_PREFIX, registerHudWindow } from './hud-window';
import {
  getBackendIdForWebContents,
  getBackendIdForWindow,
  stampWindowWithBackend,
} from './window-backend';

export { getBackendIdForWebContents, getBackendIdForWindow, stampWindowWithBackend };

/** The focused window's backend; falls back to the main window, then local. */
export function getFocusedWindowBackendId(): string {
  const focused = BrowserWindow.getFocusedWindow();
  if (focused && !focused.isDestroyed()) return getBackendIdForWindow(focused);
  const main = getMainWindow();
  return main && !main.isDestroyed() ? getBackendIdForWindow(main) : LOCAL_CONNECTION_ID;
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
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      webviewTag: true,
    },
    ...getWindowTitleBarOptions(),
    title: opts.title,
    ...getWindowAppearanceOptions(isDarkMode),
    ...(opts.iconPath && { icon: opts.iconPath }),
  };
}

function createConfiguredWindow(opts: Parameters<typeof buildWindowOptions>[0]): BrowserWindowType {
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
 * emits one line per five minutes. Anything chatty belongs at debug instead.
 */
const FORWARDED_RENDERER_INFO_MARKERS = ['[RetentionFingerprint]'] as const;

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
export function forwardRendererConsoleToMainLog(window: BrowserWindowType): void {
  let lastLine = '';
  let suppressed = 0;
  window.webContents.on('console-message', (details) => {
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

function buildLoadUrl(route: string = DEFAULT_WINDOW_ROUTE): string {
  if (process.env.NODE_ENV === 'development') {
    const devPort = process.env.DEV_PORT || '5190';
    return `http://127.0.0.1:${devPort}${route}`;
  }
  return `app://workspaces${route}`;
}

// ---- Window Session Persistence ----
// Saves and restores window sessions so the app reopens with the same
// workspaces/windows. Sessions are keyed by backend id (T2's connections
// store), so each backend restores its own window layout at boot.

export interface WindowSession {
  route: string;
  bounds: { x: number; y: number; width: number; height: number };
  // Optional for backward compat: legacy session entries carry no flag
  // (missing → windowed restore, exactly as before).
  isFullScreen?: boolean;
}

/**
 * On-disk shape of window-sessions.json: a map from backend id (see T2's
 * connections store) to that backend's saved window layout. Legacy files hold
 * a bare `WindowSession[]` — that shape is migrated into the `local` bucket on
 * read (see `readSessionsMap`).
 */
export type WindowSessionsMap = Record<string, WindowSession[]>;

/** Max windows restored per backend, guarding against a corrupted sessions file. */
const MAX_SESSIONS_PER_BACKEND = 20;

export function getWindowSessionsPath(): string {
  return path.join(app.getPath('userData'), 'window-sessions.json');
}

/**
 * Read the raw sessions file and normalize it into a backend-keyed map.
 *
 * Migration: a legacy top-level array (the pre-multi-backend global sessions
 * list) is folded into the `local` backend id so existing single-backend users
 * keep their layout on first run after upgrade. A malformed/absent file yields
 * an empty map.
 */
function readSessionsMap(): WindowSessionsMap {
  try {
    const sessionsPath = getWindowSessionsPath();
    if (!fs.existsSync(sessionsPath)) return {};
    const data = JSON.parse(fs.readFileSync(sessionsPath, 'utf-8'));
    if (Array.isArray(data)) {
      // Legacy global sessions → migrate under the local backend id.
      return { [LOCAL_CONNECTION_ID]: data.filter(isValidWindowSession) };
    }
    if (data && typeof data === 'object') {
      const map: WindowSessionsMap = {};
      for (const [backendId, sessions] of Object.entries(data)) {
        if (Array.isArray(sessions)) {
          map[backendId] = sessions.filter(isValidWindowSession);
        }
      }
      return map;
    }
  } catch (err) {
    logger.warn('Failed to read window sessions map:', err);
  }
  return {};
}

// In-memory snapshot of the most recent non-empty sessions list. Used as a
// fallback when saveWindowSessions() is invoked after all windows are already
// gone (e.g., non-macOS window-all-closed, where BrowserWindow.getAllWindows()
// returns empty and there is nothing live left to serialize).
let lastKnownSessions: WindowSessionsMap = {};

// Backends whose final window was explicitly closed while another backend
// stayed open. Keep the tombstone until a live window is saved so a stale
// on-disk bucket cannot be restored before the next aggregate save removes it.
const closedBackendSessions = new Set<string>();

// True once the app has entered a quit/update-install teardown. Window closes
// during teardown are not deliberate per-backend closes: the close listener
// must keep refreshing the in-memory snapshot but must NOT tombstone/prune a
// backend whose windows are only closing because the whole app is exiting —
// otherwise gracefulShutdown()'s mainWindow.close() wipes the bucket that
// before-quit/installUpdate() just saved. One-way on the gracefulShutdown()
// path (that path always exits); the auto-update service unmarks it when
// quitAndInstall() fails and the process keeps running.
let isQuitTeardownInProgress = false;

/**
 * Mark the start of an app-quit/update-install teardown so subsequent window
 * closes are not treated as deliberate per-backend closes. Registered callers
 * are index.ts (gracefulShutdown, which every quit path — before-quit,
 * window-all-closed, SIGTERM/SIGINT — funnels through) and the auto-update
 * service (before quitAndInstall(), which closes windows before before-quit
 * fires on macOS) — a plain setter, so window.ts never imports those modules.
 */
export function markWindowSessionTeardown(): void {
  isQuitTeardownInProgress = true;
}

/**
 * Revert markWindowSessionTeardown() when a teardown aborts and the process
 * keeps running — e.g. quitAndInstall() throws in installUpdate(). Without the
 * revert, a later deliberate last-window close in the still-running session
 * would skip tombstoning/pruning and wrongly restore the closed backend on the
 * next launch. gracefulShutdown() never calls this: that path always exits.
 */
export function unmarkWindowSessionTeardown(): void {
  isQuitTeardownInProgress = false;
}

/**
 * Synchronously drop one backend's bucket from window-sessions.json.
 * Runs inside the window `close` listener (captureWindowSessionsSnapshot), so
 * it must be sync — the tombstone alone is process-local and a crash before
 * the next aggregate save would leave the stale bucket to be restored by the
 * boot-wide enumeration.
 */
function pruneSessionsBucketFromDisk(backendId: string): void {
  try {
    const map = readSessionsMap();
    if (!(backendId in map)) return;
    delete map[backendId];
    fs.writeFileSync(getWindowSessionsPath(), JSON.stringify(map), 'utf-8');
    logger.debug('Pruned closed backend session bucket from disk', { backendId });
  } catch (err) {
    logger.warn('Failed to prune closed backend session bucket:', err);
  }
}

/**
 * Write the sessions map while honoring tombstones on both sides of the async
 * write. Tombstoned buckets are stripped before serialization, and because a
 * window `close` listener can tombstone + sync-prune a bucket while the write
 * is in flight (the completing write would silently resurrect the pruned
 * bucket on disk), any bucket tombstoned mid-write is re-pruned after the
 * write settles.
 */
async function writeSessionsMapRespectingTombstones(map: WindowSessionsMap): Promise<void> {
  for (const backendId of closedBackendSessions) delete map[backendId];
  await fsAsync.writeFile(getWindowSessionsPath(), JSON.stringify(map), 'utf-8');
  for (const backendId of closedBackendSessions) {
    if (backendId in map) pruneSessionsBucketFromDisk(backendId);
  }
}

// Invoked when a non-local backend's last window is explicitly closed while
// another backend's windows survive, so its pooled JSON-RPC client (socket,
// reconnect timers, subscriptions) can be disposed. Registered by index.ts —
// which wraps the quit guard around disconnectBackendClient() — so window.ts
// never imports the backend IPC module graph.
type LastWindowClosedForBackendHandler = (backendId: string) => void;
let onLastWindowClosedForBackend: LastWindowClosedForBackendHandler | null = null;

export function setOnLastWindowClosedForBackend(
  handler: LastWindowClosedForBackendHandler | null,
): void {
  onLastWindowClosedForBackend = handler;
}

function buildSessionsFromOpenWindows(backendId: string): WindowSession[] {
  return BrowserWindow.getAllWindows()
    .filter((w: BrowserWindowType) => {
      if (w.isDestroyed()) return false;
      if (getBackendIdForWindow(w) !== backendId) return false;
      const url = w.webContents.getURL();
      // Skip windows that haven't loaded yet (about:blank) or have empty URLs
      if (!url || url === 'about:blank') return false;
      return true;
    })
    .map((w: BrowserWindowType) => {
      const bounds = w.getBounds();
      const url = w.webContents.getURL();
      let route = DEFAULT_WINDOW_ROUTE;
      try {
        const parsed = new URL(url);
        if (parsed.protocol === 'file:') {
          // Windows created via WINDOW_CHANNELS.CREATE use file:// with ?initialRoute=
          const initialRoute = parsed.searchParams.get('initialRoute');
          route = initialRoute || DEFAULT_WINDOW_ROUTE;
        } else {
          // For dev (http:) and production (app:): pathname is the route
          route = parsed.pathname;
        }
      } catch {
        // Fall back to the workspace bootstrap route.
      }
      const session: WindowSession = { route, bounds };
      // Persist fullscreen so restore can re-enter it. getBounds() during
      // fullscreen returns that display's bounds, which is exactly what lets
      // restore land on the right monitor via getDisplayMatching().
      if (w.isFullScreen()) session.isFullScreen = true;
      return session;
    });
}

/**
 * Synchronously capture a snapshot of current window sessions into an
 * in-memory cache. Intended to be wired to each window's `close` event so the
 * cache holds the final layout right before the window is destroyed — the
 * non-macOS window-all-closed path fires after BrowserWindow.getAllWindows()
 * has already emptied, at which point saveWindowSessions() would otherwise
 * have nothing to write. Electron invokes EventEmitter listeners with the
 * closing BrowserWindow as `this`, which also lets us distinguish one closed
 * backend from a whole-process last-window close.
 */
export function captureWindowSessionsSnapshot(this: BrowserWindowType | void): void {
  try {
    const liveWindows = BrowserWindow.getAllWindows().filter((window) => !window.isDestroyed());
    const backendIds = new Set(liveWindows.map(getBackendIdForWindow));
    for (const backendId of backendIds) {
      const sessions = buildSessionsFromOpenWindows(backendId);
      if (sessions.length > 0) lastKnownSessions[backendId] = sessions;
    }

    // During app-quit/update-install teardown, window closes are a side effect
    // of the whole process exiting — refresh the snapshot above, but never
    // tombstone/prune a backend the user did not deliberately close.
    if (!isQuitTeardownInProgress && this && typeof this.isDestroyed === 'function') {
      const closingBackendId = getBackendIdForWindow(this);
      const isLastForBackend =
        liveWindows.filter((window) => getBackendIdForWindow(window) === closingBackendId)
          .length === 1;
      const hasSurvivingBackend = liveWindows.some(
        (window) => getBackendIdForWindow(window) !== closingBackendId,
      );
      if (isLastForBackend && hasSurvivingBackend) {
        closedBackendSessions.add(closingBackendId);
        delete lastKnownSessions[closingBackendId];
        // The tombstone is process-local: prune the on-disk bucket now so a
        // crash/force-quit before the next aggregate save cannot resurrect the
        // explicitly closed backend's windows at the next boot-wide restore.
        pruneSessionsBucketFromDisk(closingBackendId);
        // Explicit last-window close for this backend: dispose its pooled
        // client so no socket or reconnect timer keeps dialing a daemon with
        // no windows left ("Open" reconnects on demand). Local is exempt —
        // the sidecar management must stay alive.
        if (closingBackendId !== LOCAL_CONNECTION_ID) {
          try {
            onLastWindowClosedForBackend?.(closingBackendId);
          } catch (err) {
            logger.warn('Failed to dispose backend client on last window close:', err);
          }
        }
      }
    }
  } catch (err) {
    logger.warn('Failed to capture window sessions snapshot:', err);
  }
}

export async function saveWindowSessions(backendId: string): Promise<void> {
  try {
    let sessions = buildSessionsFromOpenWindows(backendId);

    if (sessions.length > 0) {
      // Refresh the cache whenever we have a live non-empty list.
      closedBackendSessions.delete(backendId);
      lastKnownSessions[backendId] = sessions;
    } else if (closedBackendSessions.has(backendId)) {
      delete lastKnownSessions[backendId];
      await writeSessionsMapRespectingTombstones(readSessionsMap());
      return;
    } else if (lastKnownSessions[backendId]?.length > 0) {
      // No live windows (e.g., non-macOS window-all-closed). Fall back to the
      // last pre-close snapshot so the latest layout still persists.
      sessions = lastKnownSessions[backendId];
      logger.info('saveWindowSessions: using last-known snapshot (no live windows)', {
        count: sessions.length,
      });
    }

    if (sessions.length > 0) {
      // Read-modify-write the backend-keyed map so saving one backend's layout
      // never clobbers another backend's saved sessions.
      const map = readSessionsMap();
      map[backendId] = sessions;
      await writeSessionsMapRespectingTombstones(map);
      logger.debug('Saved window sessions', {
        backendId,
        count: sessions.length,
        routes: sessions.map((s) => s.route),
      });
    }
  } catch (err) {
    logger.warn('Failed to save window sessions:', err);
  }
}

/** Persist every live/cached backend bucket without treating activeId as process-global. */
export async function saveAllWindowSessions(): Promise<void> {
  try {
    const backendIds = new Set([
      ...Object.keys(lastKnownSessions),
      ...closedBackendSessions,
      ...BrowserWindow.getAllWindows()
        .filter((window) => !window.isDestroyed())
        .map(getBackendIdForWindow),
    ]);
    const map = readSessionsMap();
    for (const backendId of backendIds) {
      const live = buildSessionsFromOpenWindows(backendId);
      if (live.length > 0) closedBackendSessions.delete(backendId);
      if (closedBackendSessions.has(backendId)) {
        delete lastKnownSessions[backendId];
        delete map[backendId];
        continue;
      }
      const sessions = live.length > 0 ? live : lastKnownSessions[backendId];
      if (!sessions?.length) continue;
      lastKnownSessions[backendId] = sessions;
      map[backendId] = sessions;
    }
    if (backendIds.size > 0) {
      await writeSessionsMapRespectingTombstones(map);
    }
  } catch (err) {
    logger.warn('Failed to save all window sessions:', err);
  }
}

/**
 * Clear the in-memory last-known sessions snapshot.
 *
 * Must be called whenever the on-disk sessions file is intentionally discarded
 * (e.g., macOS manual all-windows-closed, where we delete window-sessions.json
 * so a later dock-click opens a fresh window). Without this, a subsequent
 * saveWindowSessions() call — from a pending debounced saver, an auto-update
 * hook, or any other trigger — would see no live windows, fall back to the
 * cached snapshot, and resurrect the file the user deliberately cleared.
 */
export function clearWindowSessionsSnapshot(): void {
  lastKnownSessions = {};
}

/**
 * Test-only helper: reset the in-memory last-known sessions cache.
 * Not part of the production API.
 */
export function _resetWindowSessionsCacheForTests(): void {
  clearWindowSessionsSnapshot();
  closedBackendSessions.clear();
  onLastWindowClosedForBackend = null;
  isQuitTeardownInProgress = false;
}

export function isValidWindowSession(s: unknown): s is WindowSession {
  if (typeof s !== 'object' || s === null) return false;
  const obj = s as Record<string, unknown>;
  if (typeof obj.route !== 'string') return false;
  if (obj.isFullScreen !== undefined && typeof obj.isFullScreen !== 'boolean') return false;
  if (typeof obj.bounds !== 'object' || obj.bounds === null) return false;
  const b = obj.bounds as Record<string, unknown>;
  return (
    typeof b.x === 'number' &&
    typeof b.y === 'number' &&
    typeof b.width === 'number' &&
    typeof b.height === 'number'
  );
}

export function loadWindowSessions(backendId: string): WindowSession[] | null {
  try {
    if (closedBackendSessions.has(backendId)) return null;
    const valid = readSessionsMap()[backendId];
    if (valid && valid.length > 0) {
      // Cap per backend to guard against a corrupted sessions file.
      const capped = valid.slice(0, MAX_SESSIONS_PER_BACKEND);
      logger.info('Loaded window sessions', {
        backendId,
        count: capped.length,
        total: valid.length,
      });
      return capped;
    }
  } catch (err) {
    logger.warn('Failed to load window sessions:', err);
  }
  return null;
}

/**
 * Create a window to restore a saved session.
 * Similar to createWindow() but accepts a specific route and bounds.
 */
export function createWindowForSession(
  session: WindowSession,
  setAsMain: boolean,
  backendId: string = LOCAL_CONNECTION_ID,
): void {
  const iconPath = resolveIcon(setAsMain);
  // Validate against the display the saved bounds actually land on, not the
  // primary display — otherwise a layout saved on a secondary monitor fails
  // the visibility check and is reset to the primary work area. For bounds on
  // a disconnected monitor, getDisplayMatching() returns the nearest display
  // and validateBounds() then clamps/falls back within it.
  const { workArea } = screen.getDisplayMatching(session.bounds);
  const bounds = validateBounds(session.bounds, workArea);

  const window = createConfiguredWindow({ bounds, title: resolveAppTitle(), iconPath });
  // A restored HUD session keeps its saved backend bucket — the HUD is bound
  // to the backend it was opened on, not forced to local. Register it as THE
  // HUD for that backend right away (stamp first — the registry keys off the
  // stamp): its URL is still loading during startup restore, so the URL-scan
  // fallback would miss it and a concurrent open-HUD request could create a
  // duplicate.
  stampWindowWithBackend(window, backendId);
  if (session.route.startsWith(HUD_ROUTE_PREFIX)) {
    registerHudWindow(window);
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
  window.loadURL(buildLoadUrl(route));

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
}

/**
 * Restore `toBackendId`'s saved window layout, or open one fresh default
 * window when that backend has no saved sessions. Call AFTER the backend's
 * client is connected, so restored windows load against a live daemon.
 * Consumed by the boot-wide restore and Open-with-saved-sessions paths.
 */
export function restoreWindowsForBackend(toBackendId: string): void {
  const savedSessions = loadWindowSessions(toBackendId);
  if (savedSessions && savedSessions.length > 0) {
    logger.info('Restoring window sessions for backend', {
      backendId: toBackendId,
      count: savedSessions.length,
    });
    for (let i = 0; i < savedSessions.length; i++) {
      createWindowForSession(savedSessions[i], i === 0, toBackendId);
    }
  } else {
    logger.info('No saved sessions for backend; opening a fresh window', {
      backendId: toBackendId,
    });
    createWindow(toBackendId);
  }
}

/**
 * Enumerate the backend ids that have a non-empty saved session bucket on
 * disk, excluding backends whose final window was explicitly closed this
 * session (tombstoned — see `closedBackendSessions`).
 */
export function listSavedSessionBackendIds(): string[] {
  try {
    return Object.entries(readSessionsMap())
      .filter(([id, sessions]) => sessions.length > 0 && !closedBackendSessions.has(id))
      .map(([id]) => id);
  } catch (err) {
    logger.warn('Failed to enumerate saved window session backends:', err);
    return [];
  }
}

/**
 * Boot/dock-activate restore across EVERY backend that has a saved session
 * bucket, not just the active one. The active backend restores first so its
 * first window becomes the main window; every bucket gets a pooled client
 * connected via `connectBackend` (injected — window.ts must not import
 * backend.ipc; idempotent for already-connected backends) BEFORE its windows
 * open, so restored windows resolve their own
 * daemon. Fail-soft per bucket: a backend whose client config cannot even be
 * built (forgotten remote, missing token) is skipped with a log, while an
 * unreachable-but-buildable backend still restores — client construction does
 * not await reachability, and the per-window stopped overlay shows until its
 * client connects. Returns true when at least one window was restored.
 */
export async function restoreAllBackendWindowSessions(
  activeBackendId: string,
  connectBackend: (backendId: string) => Promise<unknown>,
): Promise<boolean> {
  const backendIds = listSavedSessionBackendIds();
  // Stable sort: active bucket first, others keep their on-disk order.
  backendIds.sort((a, b) => Number(b === activeBackendId) - Number(a === activeBackendId));
  let restoredAny = false;
  for (const backendId of backendIds) {
    // Connect every bucket unconditionally — connectBackend is idempotent
    // (returns the existing pooled client when one is already connected), so
    // this holds no assumption about which client boot already created.
    try {
      await connectBackend(backendId);
    } catch (err) {
      logger.warn('Skipping window restore for backend without a connectable client', {
        backendId,
        error: err instanceof Error ? err.message : String(err),
      });
      continue;
    }
    const sessions = loadWindowSessions(backendId);
    if (!sessions || sessions.length === 0) continue;
    logger.info('Restoring window sessions', { backendId, count: sessions.length });
    for (let i = 0; i < sessions.length; i++) {
      createWindowForSession(sessions[i], !restoredAny && i === 0, backendId);
    }
    restoredAny = true;
  }
  return restoredAny;
}

/** Focus a live window for a backend, or add that backend's saved/fresh windows. */
export function openOrFocusWindowsForBackend(backendId: string): void {
  const existing = BrowserWindow.getAllWindows().find(
    (window) =>
      !window.isDestroyed() && getBackendIdForWebContents(window.webContents) === backendId,
  );
  if (existing) {
    if (existing.isMinimized()) existing.restore();
    existing.show();
    existing.focus();
    setMainWindow(existing);
    return;
  }
  restoreWindowsForBackend(backendId);
}

/** Ensure closing one backend cannot destroy the app's final live window. */
export function ensureLocalWindowBeforeClosingBackend(backendId: string): void {
  const liveWindows = BrowserWindow.getAllWindows().filter((window) => !window.isDestroyed());
  const closesAnyWindow = liveWindows.some((window) => getBackendIdForWindow(window) === backendId);
  const hasSurvivingWindow = liveWindows.some(
    (window) => getBackendIdForWindow(window) !== backendId,
  );
  if (closesAnyWindow && !hasSurvivingWindow) {
    openOrFocusWindowsForBackend(LOCAL_CONNECTION_ID);
  }
}

/** Destroy only windows bound to one backend, preserving every other backend. */
export function closeWindowsForBackend(backendId: string): void {
  const windows = BrowserWindow.getAllWindows();
  for (const window of windows) {
    if (!window.isDestroyed() && getBackendIdForWindow(window) === backendId) window.destroy();
  }
  const main = getMainWindow();
  if (main?.isDestroyed()) {
    setMainWindow(windows.find((window) => !window.isDestroyed()) ?? null);
  }
}

export function createWindow(backendId: string = LOCAL_CONNECTION_ID) {
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

  const window = createConfiguredWindow({
    bounds: windowBounds,
    title: resolveAppTitle(),
    iconPath,
  });
  stampWindowWithBackend(window, backendId);
  forwardRendererConsoleToMainLog(window);

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

  // Check process.argv for intent:// URL on cold start. Pair links are
  // excluded: they are handled fully in the main process (parked at startup,
  // processed once the window is ready) and must never be embedded in the
  // renderer load URL — the pairing bearer token would leak to the renderer.
  const intentUrl = findIntentUrl(process.argv);
  let loadUrl = buildLoadUrl();

  if (intentUrl && !isPairingUri(intentUrl)) {
    const deepLinkHandler = new DeepLinkHandler();
    const action = deepLinkHandler.parseDeepLink(intentUrl);
    if (action) {
      const encoded = encodeURIComponent(JSON.stringify(action));
      loadUrl += `${loadUrl.includes('?') ? '&' : '?'}deepLink=${encoded}`;
      logger.info('Embedding deep link in load URL for cold start:', { url: intentUrl });
    }
  }

  window.loadURL(loadUrl);

  window.on('closed', () => {
    setMainWindow(null);
    if (saveBoundsTimeout) clearTimeout(saveBoundsTimeout);
  });
}

/**
 * Handle a deep link URL received from the OS (intent:// protocol)
 *
 * Settings deep links are sent to the existing main window.
 * Create deep links are sent to the existing window unless newWindow=true.
 * All other deep link types create a new window.
 */
export async function createWindowForDeepLink(
  deepLinkUrl: string,
  deepLinkHandler: DeepLinkHandler,
) {
  logger.info('Creating window for deep link:', { url: scrubToken(deepLinkUrl) });

  // Pair links never touch the renderer (no window, no IPC): route straight
  // to the main-process pair handler. Dynamic import — pair-deep-link reaches
  // backend.ipc, which imports this module (a static import would cycle).
  if (isPairingUri(deepLinkUrl)) {
    const { handlePairDeepLink } = await import('../features/deeplink/main/pair-deep-link');
    await handlePairDeepLink(deepLinkUrl);
    return;
  }

  // Parse the deep link to extract action and params
  const action = deepLinkHandler.parseDeepLink(deepLinkUrl);
  if (!action) {
    logger.warn('Failed to parse deep link URL:', { url: deepLinkUrl });
    return;
  }

  // Settings actions are always sent to the existing window.
  // Create actions are sent to the existing window unless newWindow=true.
  const shouldRouteToExisting =
    action.type === 'settings' ||
    (action.type === 'create' && String(action.params?.newWindow) !== 'true');

  if (shouldRouteToExisting) {
    const mainWindow = getMainWindow();
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('deep-link', action);
      if (mainWindow.isMinimized()) {
        mainWindow.restore();
      }
      mainWindow.focus();
      logger.info('Sent deep link to existing window', { type: action.type });
    } else {
      // No window yet — store as pending (will be processed after startup)
      logger.info('No window available for deep link, storing as pending', { type: action.type });
      await deepLinkHandler.handleDeepLink(deepLinkUrl, null);
    }
    return;
  }

  // Create a new window with full workArea bounds
  const { workArea } = screen.getPrimaryDisplay();
  const bounds = { x: workArea.x, y: workArea.y, width: workArea.width, height: workArea.height };

  const iconPath = resolveIcon(false);
  const newWindow = createConfiguredWindow({ bounds, title: resolveAppTitle(), iconPath });
  stampWindowWithBackend(newWindow);
  forwardRendererConsoleToMainLog(newWindow);

  const encodedAction = encodeURIComponent(JSON.stringify(action));
  newWindow.loadURL(buildLoadUrl(`${DEFAULT_WINDOW_ROUTE}?deepLink=${encodedAction}`));
  newWindow.focus();

  logger.info('New window created for deep link:', { action: action.type });
}
