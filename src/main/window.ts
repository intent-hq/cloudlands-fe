import path from 'path';
import { app, screen, nativeTheme, nativeImage, BrowserWindow } from 'electron';
import type { BrowserWindow as BrowserWindowType } from 'electron';
import fs from 'fs';
import fsAsync from 'fs/promises';
import { Logger } from '../shared/logger';
import { resolveAppTitle } from './utils/resolve-app-title';
import { DeepLinkHandler } from '../features/deeplink/deep-link-handler';
import { getMainWindow, setMainWindow } from './state';
import { LOCAL_CONNECTION_ID } from '../shared/types/connections';
import { fileURLToPath } from 'url';
import { dirname } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const logger = new Logger('Main');

// ---- Shared Window Helpers ----

/**
 * Resolve the app icon path for dev mode. In production, the icon is baked into the binary.
 * Optionally sets the macOS dock icon.
 */
function resolveIcon(setDockIcon: boolean): string | undefined {
  const isDev = process.env.NODE_ENV === 'development';
  if (!isDev) return undefined;

  const iconPngPath = path.join(__dirname, '../../src/assets/icons/icon.png');
  const iconIcoPath = path.join(__dirname, '../../src/assets/icons/icon.ico');
  const iconIcnsPath = path.join(__dirname, '../../src/assets/icons/icon.icns');

  const platformIconPath = process.platform === 'win32' ? iconIcoPath : iconPngPath;
  let iconPath: string | undefined;
  if (fs.existsSync(platformIconPath)) {
    iconPath = platformIconPath;
  } else if (fs.existsSync(iconPngPath)) {
    iconPath = iconPngPath;
  } else if (fs.existsSync(iconIcoPath)) {
    iconPath = iconIcoPath;
  } else if (fs.existsSync(iconIcnsPath)) {
    iconPath = iconIcnsPath;
  }

  if (setDockIcon && process.platform === 'darwin') {
    try {
      if (fs.existsSync(iconPngPath)) {
        app.dock?.setIcon(nativeImage.createFromPath(iconPngPath));
      } else if (fs.existsSync(iconIcnsPath)) {
        app.dock?.setIcon(nativeImage.createFromPath(iconIcnsPath));
      }
    } catch (e) {
      logger.warn('Failed to set dev dock icon:', e);
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
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'default',
    frame: process.platform !== 'darwin',
    ...(process.platform === 'darwin' && {
      trafficLightPosition: { x: 9, y: 11 },
      tabbingIdentifier: 'intent',
    }),
    title: opts.title,
    backgroundColor: isDarkMode ? '#0a0a0a' : '#ffffff',
    ...(opts.iconPath && { icon: opts.iconPath }),
  };
}

// Bounds for the renderer-console forwarder: per-message size cap and
// consecutive-duplicate suppression keep console-output.log bounded even
// under tight-loop console spam.
const RENDERER_CONSOLE_MAX_MESSAGE_CHARS = 4096;

/**
 * Forward renderer console warnings/errors into the main-process log so they
 * land in {userData}/logs/console-output.log (via setupConsoleLogCapture) and
 * debug exports. Closes the diagnosability gap where renderer-only breadcrumbs
 * (e.g. failed comment.add evidence) were invisible in persistent logs.
 * Info/debug/verbose messages are intentionally not forwarded, messages are
 * truncated to a few KB, and consecutive duplicates are counted instead of
 * re-written, to keep the log file bounded.
 */
export function forwardRendererConsoleToMainLog(window: BrowserWindowType): void {
  let lastLine = '';
  let suppressed = 0;
  window.webContents.on('console-message', (details) => {
    const { level, message, sourceId, lineNumber } = details;
    if (level !== 'warning' && level !== 'error') return;
    const origin = `${sourceId || 'renderer'}:${lineNumber}`;
    const bounded =
      message.length > RENDERER_CONSOLE_MAX_MESSAGE_CHARS
        ? `${message.slice(0, RENDERER_CONSOLE_MAX_MESSAGE_CHARS)}… [truncated ${message.length - RENDERER_CONSOLE_MAX_MESSAGE_CHARS} chars]`
        : message;
    const line = `[RendererConsole] ${bounded} (${origin})`;
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
    } else {
      logger.warn(line);
    }
  });
}

/**
 * Build the URL to load in a window (dev server or production app:// protocol).
 */
function buildLoadUrl(route: string = '/'): string {
  if (process.env.NODE_ENV === 'development') {
    const devPort = process.env.DEV_PORT || '5190';
    return `http://127.0.0.1:${devPort}${route}`;
  }
  return `app://workspaces${route}`;
}

// ---- Window Session Persistence ----
// Saves and restores window sessions so the app reopens with the same
// workspaces/windows. Sessions are keyed by the active backend id (T2's
// connections store), so each backend restores its own window layout on switch.

export interface WindowSession {
  route: string;
  bounds: { x: number; y: number; width: number; height: number };
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
let lastKnownSessions: WindowSession[] | null = null;

function buildSessionsFromOpenWindows(): WindowSession[] {
  return BrowserWindow.getAllWindows()
    .filter((w: BrowserWindowType) => {
      if (w.isDestroyed()) return false;
      const url = w.webContents.getURL();
      // Skip windows that haven't loaded yet (about:blank) or have empty URLs
      if (!url || url === 'about:blank') return false;
      return true;
    })
    .map((w: BrowserWindowType) => {
      const bounds = w.getBounds();
      const url = w.webContents.getURL();
      let route = '/';
      try {
        const parsed = new URL(url);
        if (parsed.protocol === 'file:') {
          // Windows created via WINDOW_CHANNELS.CREATE use file:// with ?initialRoute=
          const initialRoute = parsed.searchParams.get('initialRoute');
          route = initialRoute || '/';
        } else {
          // For dev (http:) and production (app:): pathname is the route
          route = parsed.pathname;
        }
      } catch {
        // Fall back to home
      }
      return { route, bounds };
    });
}

/**
 * Synchronously capture a snapshot of current window sessions into an
 * in-memory cache. Intended to be wired to each window's `close` event so the
 * cache holds the final layout right before the window is destroyed — the
 * non-macOS window-all-closed path fires after BrowserWindow.getAllWindows()
 * has already emptied, at which point saveWindowSessions() would otherwise
 * have nothing to write.
 */
export function captureWindowSessionsSnapshot(): void {
  try {
    const sessions = buildSessionsFromOpenWindows();
    if (sessions.length > 0) {
      lastKnownSessions = sessions;
    }
  } catch (err) {
    logger.warn('Failed to capture window sessions snapshot:', err);
  }
}

export async function saveWindowSessions(backendId: string): Promise<void> {
  try {
    let sessions = buildSessionsFromOpenWindows();

    if (sessions.length > 0) {
      // Refresh the cache whenever we have a live non-empty list.
      lastKnownSessions = sessions;
    } else if (lastKnownSessions && lastKnownSessions.length > 0) {
      // No live windows (e.g., non-macOS window-all-closed). Fall back to the
      // last pre-close snapshot so the latest layout still persists.
      sessions = lastKnownSessions;
      logger.info('saveWindowSessions: using last-known snapshot (no live windows)', {
        count: sessions.length,
      });
    }

    if (sessions.length > 0) {
      // Read-modify-write the backend-keyed map so saving one backend's layout
      // never clobbers another backend's saved sessions.
      const map = readSessionsMap();
      map[backendId] = sessions;
      await fsAsync.writeFile(getWindowSessionsPath(), JSON.stringify(map), 'utf-8');
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
  lastKnownSessions = null;
}

/**
 * Test-only helper: reset the in-memory last-known sessions cache.
 * Not part of the production API.
 */
export function _resetWindowSessionsCacheForTests(): void {
  clearWindowSessionsSnapshot();
}

export function isValidWindowSession(s: unknown): s is WindowSession {
  if (typeof s !== 'object' || s === null) return false;
  const obj = s as Record<string, unknown>;
  if (typeof obj.route !== 'string') return false;
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
export function createWindowForSession(session: WindowSession, setAsMain: boolean): void {
  const iconPath = resolveIcon(setAsMain);
  const { workArea } = screen.getPrimaryDisplay();
  const bounds = validateBounds(session.bounds, workArea);

  const window = new BrowserWindow(
    buildWindowOptions({ bounds, title: resolveAppTitle(), iconPath }),
  );
  forwardRendererConsoleToMainLog(window);

  if (setAsMain) {
    setMainWindow(window);
    import('../features/auto-update/main/auto-update.ipc')
      .then(({ updateAutoUpdaterWindow }) => updateAutoUpdaterWindow(window))
      .catch(() => {});
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

  window.loadURL(buildLoadUrl(session.route));

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
 * Backend-switch window hook — capture + teardown half (consumed by T3's
 * switch orchestration).
 *
 * Persists the currently-open workspace/HUD windows under `fromBackendId` (so
 * switching back restores them), then tears them all down. Split from
 * `restoreWindowsForBackend` so the orchestrator can dispose the old client,
 * connect the new one, and flip the active id in between — the windows it later
 * restores then hit the NEW daemon.
 *
 * Windows are `destroy()`ed, not `close()`d, so the graceful close-snapshot /
 * debounced-save handlers can't race a stale layout back into the wrong
 * backend's bucket.
 */
export async function captureAndCloseWindowsForBackendSwitch(fromBackendId: string): Promise<void> {
  // Persist the outgoing backend's layout while its windows are still live.
  await saveWindowSessions(fromBackendId);
  // That capture belongs to fromBackendId; wipe the id-agnostic snapshot cache
  // so a later save for the incoming backend can't resurrect it.
  clearWindowSessionsSnapshot();

  // Tear down every workspace/HUD window.
  for (const w of BrowserWindow.getAllWindows()) {
    if (!w.isDestroyed()) w.destroy();
  }
  setMainWindow(null);
}

/**
 * Backend-switch window hook — restore half (consumed by T3's switch
 * orchestration).
 *
 * Restores `toBackendId`'s saved window layout, or opens one fresh default
 * window when that backend has no saved sessions. Call AFTER the new client is
 * connected and the active id has been flipped, so restored windows load
 * against the incoming daemon.
 */
export function restoreWindowsForBackend(toBackendId: string): void {
  const savedSessions = loadWindowSessions(toBackendId);
  if (savedSessions && savedSessions.length > 0) {
    logger.info('Restoring window sessions for backend switch', {
      backendId: toBackendId,
      count: savedSessions.length,
    });
    for (let i = 0; i < savedSessions.length; i++) {
      createWindowForSession(savedSessions[i], i === 0);
    }
  } else {
    logger.info('No saved sessions for backend; opening a fresh window', {
      backendId: toBackendId,
    });
    createWindow();
  }
}

export function createWindow() {
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
        const validated = validateBounds(resolved, workArea);
        if (validated === resolved) {
          windowBounds = resolved;
          logger.info('Using saved window bounds:', windowBounds);
        } else {
          logger.info('Saved window bounds not reasonable for current display, using defaults');
        }
      }
    }
  } catch (err) {
    logger.warn('Failed to load saved window bounds:', err);
  }

  const window = new BrowserWindow(
    buildWindowOptions({ bounds: windowBounds, title: resolveAppTitle(), iconPath }),
  );
  forwardRendererConsoleToMainLog(window);

  setMainWindow(window);

  // Update auto-updater's window reference so status events go to the current window
  import('../features/auto-update/main/auto-update.ipc')
    .then(({ updateAutoUpdaterWindow }) => updateAutoUpdaterWindow(window))
    .catch(() => {});

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

  // Check process.argv for intent:// URL on cold start
  const intentUrl = process.argv.find((arg: string) => arg.startsWith('intent://'));
  let loadUrl = buildLoadUrl();

  if (intentUrl) {
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
  logger.info('Creating window for deep link:', { url: deepLinkUrl });

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

  const newWindow = new BrowserWindow(buildWindowOptions({ bounds, title: resolveAppTitle() }));
  forwardRendererConsoleToMainLog(newWindow);

  const encodedAction = encodeURIComponent(JSON.stringify(action));
  newWindow.loadURL(buildLoadUrl(`/?deepLink=${encodedAction}`));
  newWindow.focus();

  logger.info('New window created for deep link:', { action: action.type });
}
