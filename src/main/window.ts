import path from 'path';
import { app, screen, nativeTheme, nativeImage, BrowserWindow } from 'electron';
import type { BrowserWindow as BrowserWindowType } from 'electron';
import fs from 'fs';
import fsAsync from 'fs/promises';
import { Logger } from '../shared/logger';
import { resolveAppTitle } from './utils/resolve-app-title';
import { DeepLinkHandler } from '../features/deeplink/deep-link-handler';
import { getMainWindow, setMainWindow } from './state';
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

/**
 * Build the URL to load in a window (dev server or production app:// protocol).
 */
function buildLoadUrl(route: string = '/'): string {
  if (process.env.NODE_ENV === 'development') {
    const devPort = process.env.DEV_PORT || '5177';
    return `http://127.0.0.1:${devPort}${route}`;
  }
  return `app://workspaces${route}`;
}


// ---- Window Session Persistence ----
// Saves and restores window sessions so the app reopens with the same workspaces/windows.

export interface WindowSession {
  route: string;
  bounds: { x: number; y: number; width: number; height: number };
}

export function getWindowSessionsPath(): string {
  return path.join(app.getPath('userData'), 'window-sessions.json');
}

export async function saveWindowSessions(): Promise<void> {
  try {
    const allWindows = BrowserWindow.getAllWindows();
    const sessions: WindowSession[] = allWindows
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

    const sessionsPath = getWindowSessionsPath();
    if (sessions.length > 0) {
      await fsAsync.writeFile(sessionsPath, JSON.stringify(sessions), 'utf-8');
      logger.info('Saved window sessions', {
        count: sessions.length,
        routes: sessions.map((s) => s.route),
      });
    }
  } catch (err) {
    logger.warn('Failed to save window sessions:', err);
  }
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

export function loadWindowSessions(): WindowSession[] | null {
  try {
    const sessionsPath = getWindowSessionsPath();
    if (fs.existsSync(sessionsPath)) {
      const data = JSON.parse(fs.readFileSync(sessionsPath, 'utf-8'));
      if (Array.isArray(data) && data.length > 0) {
        const valid = data.filter(isValidWindowSession);
        if (valid.length > 0) {
          // Cap at 20 windows to guard against corrupted sessions file
          const capped = valid.slice(0, 20);
          logger.info('Loaded window sessions', { count: capped.length, total: valid.length });
          return capped;
        }
      }
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

  let windowBounds = { x: workArea.x, y: workArea.y, width: workArea.width, height: workArea.height };

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
 * All other deep link types create a new window.
 */
export async function createWindowForDeepLink(deepLinkUrl: string, deepLinkHandler: DeepLinkHandler) {
  logger.info('Creating window for deep link:', { url: deepLinkUrl });

  // Parse the deep link to extract action and params
  const action = deepLinkHandler.parseDeepLink(deepLinkUrl);
  if (!action) {
    logger.warn('Failed to parse deep link URL:', { url: deepLinkUrl });
    return;
  }

  // Settings actions should be sent to the existing window, not create a new one
  if (action.type === 'settings') {
    const mainWindow = getMainWindow();
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('deep-link', action);
      if (mainWindow.isMinimized()) {
        mainWindow.restore();
      }
      mainWindow.focus();
      logger.info('Sent settings deep link to existing window');
    } else {
      // No window yet — store as pending (will be processed after startup)
      logger.info('No window available for settings deep link, storing as pending');
      await deepLinkHandler.handleDeepLink(deepLinkUrl, null);
    }
    return;
  }

  // Create a new window with full workArea bounds
  const { workArea } = screen.getPrimaryDisplay();
  const bounds = { x: workArea.x, y: workArea.y, width: workArea.width, height: workArea.height };

  const newWindow = new BrowserWindow(
    buildWindowOptions({ bounds, title: resolveAppTitle() }),
  );

  const encodedAction = encodeURIComponent(JSON.stringify(action));
  newWindow.loadURL(buildLoadUrl(`/?deepLink=${encodedAction}`));
  newWindow.focus();

  logger.info('New window created for deep link:', { action: action.type });
}
