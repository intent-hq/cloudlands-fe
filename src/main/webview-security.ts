/**
 * Webview Security Configuration
 *
 * This module sets up security handlers for Electron webviews to prevent:
 * - Node.js integration in webviews (RCE attacks)
 * - Dangerous protocol navigation (javascript:, data:, vbscript:, blob:)
 * - Uncontrolled popup windows
 * - Unauthorized permission requests (camera, mic, geolocation)
 *
 * Allowed protocols are defined in src/shared/constants.ts (BROWSER_PROTOCOLS)
 * to ensure consistency across the codebase.
 */

import { app, session, shell } from 'electron';
import * as path from 'path';
import { fileURLToPath } from 'url';
import { BROWSER_PROTOCOLS } from '../shared/constants';
import { Logger } from '../shared/logger';

const logger = new Logger('WebviewSecurity');

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * Check if a URL uses a protocol allowed in webviews
 */
function isWebviewAllowedUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return BROWSER_PROTOCOLS.WEBVIEW_ALLOWED.includes(parsed.protocol);
  } catch {
    return false;
  }
}

/**
 * Check if a URL uses a dangerous protocol that should always be blocked
 */
function isBlockedProtocol(url: string): boolean {
  try {
    const parsed = new URL(url);
    return BROWSER_PROTOCOLS.BLOCKED.includes(parsed.protocol);
  } catch {
    return false;
  }
}

function isDevServerUrl(parsed: URL): boolean {
  if (process.env.NODE_ENV !== 'development') {
    return false;
  }

  const devPort = process.env.DEV_PORT || '5177';
  const hostAllowed = parsed.hostname === 'localhost' || parsed.hostname === '127.0.0.1';
  const port = parsed.port || (parsed.protocol === 'https:' ? '443' : '80');

  return hostAllowed && port === devPort && BROWSER_PROTOCOLS.EXTERNAL.includes(parsed.protocol);
}

function isInternalUrl(parsed: URL): boolean {
  if (parsed.protocol === 'about:') {
    return true;
  }

  if (BROWSER_PROTOCOLS.INTERNAL.includes(parsed.protocol)) {
    return true;
  }

  return isDevServerUrl(parsed);
}

function isExternalHttpUrl(parsed: URL): boolean {
  return BROWSER_PROTOCOLS.EXTERNAL.includes(parsed.protocol);
}

function getSecureWindowPreferences(): Electron.BrowserWindowConstructorOptions {
  return {
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      webviewTag: true,
    },
  };
}

/**
 * Setup webview security handlers
 * Should be called early in app initialization, before any windows are created
 */
export function setupWebviewSecurity(): void {
  logger.info('Setting up webview security handlers');

  // Handler for webview attachment - enforce security settings
  app.on('web-contents-created', (_event, contents) => {
    // Handle webview attachment
    contents.on('will-attach-webview', (event, webPreferences, _params) => {
      logger.debug('Webview attaching, enforcing security settings');

      // Remove any preload scripts that might be injected
      delete webPreferences.preload;

      // Disable Node.js integration in webviews (critical security)
      webPreferences.nodeIntegration = false;
      webPreferences.nodeIntegrationInWorker = false;
      webPreferences.nodeIntegrationInSubFrames = false;

      // Enable context isolation (prevents prototype pollution attacks)
      webPreferences.contextIsolation = true;

      // Enable sandbox (additional process isolation)
      webPreferences.sandbox = true;

      // Disable web security only if explicitly needed (keep enabled)
      webPreferences.webSecurity = true;

      // Don't allow running insecure content
      webPreferences.allowRunningInsecureContent = false;

      logger.debug('Webview security settings enforced', {
        nodeIntegration: webPreferences.nodeIntegration,
        contextIsolation: webPreferences.contextIsolation,
        sandbox: webPreferences.sandbox,
      });
    });

    const handleNavigation = (event: Electron.Event, url: string, isMainFrame = true) => {
      if (!isMainFrame) {
        return;
      }

      if (isBlockedProtocol(url)) {
        logger.warn('Blocked dangerous protocol navigation', { url: url.substring(0, 100) });
        event.preventDefault();
        return;
      }

      if (contents.getType() === 'webview') {
        if (!isWebviewAllowedUrl(url)) {
          logger.warn('Blocked disallowed protocol navigation in webview', { url: url.substring(0, 100) });
          event.preventDefault();
        }
        return;
      }

      try {
        const parsed = new URL(url);
        if (isInternalUrl(parsed)) {
          return;
        }

        if (isExternalHttpUrl(parsed)) {
          event.preventDefault();
          shell.openExternal(url).catch((err: Error) => {
            logger.error('Failed to open URL in external browser', { url, error: err.message });
          });
          return;
        }

        logger.warn('Blocked navigation to unsupported protocol', { url: url.substring(0, 100) });
        event.preventDefault();
      } catch {
        logger.warn('Blocked navigation with invalid URL', { url: url.substring(0, 100) });
        event.preventDefault();
      }
    };

    // Handle navigation in webviews
    contents.on('will-navigate', (event, url) => {
      handleNavigation(event, url);
    });

    contents.on('will-redirect', (event, url, _isInPlace, isMainFrame) => {
      handleNavigation(event, url, isMainFrame);
    });

    // Handle new window creation (popups) from webviews
    contents.setWindowOpenHandler(({ url }) => {
      if (contents.getType() === 'webview') {
        logger.debug('Webview requested new window', { url: url.substring(0, 100) });

        if (isBlockedProtocol(url)) {
          logger.warn('Blocked popup with dangerous protocol', { url: url.substring(0, 100) });
          return { action: 'deny' };
        }

        // Only open http(s) URLs in the system browser.
        // file:// is allowed for webview *navigation* (rendering local HTML)
        // but must NOT be passed to shell.openExternal (could execute local files).
        try {
          if (isExternalHttpUrl(new URL(url))) {
            shell.openExternal(url).catch((err: Error) => {
              logger.error('Failed to open URL in external browser', { url, error: err.message });
            });
          } else {
            logger.warn('Blocked webview popup with non-http protocol', {
              url: url.substring(0, 100),
            });
          }
        } catch {
          logger.warn('Blocked webview popup with invalid URL', { url: url.substring(0, 100) });
        }

        return { action: 'deny' };
      }

      if (isBlockedProtocol(url)) {
        logger.warn('Blocked popup with dangerous protocol', { url: url.substring(0, 100) });
        return { action: 'deny' };
      }

      try {
        const parsed = new URL(url);
        if (isInternalUrl(parsed)) {
          return {
            action: 'allow',
            overrideBrowserWindowOptions: getSecureWindowPreferences(),
          };
        }

        if (isExternalHttpUrl(parsed)) {
          shell.openExternal(url).catch((err: Error) => {
            logger.error('Failed to open URL in external browser', { url, error: err.message });
          });
          return { action: 'deny' };
        }

        logger.warn('Blocked popup with unsupported protocol', { url: url.substring(0, 100) });
        return { action: 'deny' };
      } catch {
        logger.warn('Blocked popup with invalid URL', { url: url.substring(0, 100) });
        return { action: 'deny' };
      }
    });
  });

  // Setup permission handlers for the default session
  setupPermissionHandlers(session.defaultSession);

  logger.info('Webview security handlers configured');
}

/**
 * Setup permission request handlers for a session
 */
function setupPermissionHandlers(ses: Electron.Session): void {
  // Handle permission requests (camera, microphone, geolocation, etc.)
  ses.setPermissionRequestHandler((webContents, permission, callback, details) => {
    const url = details.requestingUrl || webContents?.getURL() || 'unknown';

    // Log the permission request
    logger.info('Permission requested', { permission, url: url.substring(0, 100) });

    // Allow clipboard read/write for convenience (copy/paste)
    // clipboard-read: Reading from clipboard
    // clipboard-sanitized-write: Writing sanitized (text) content to clipboard
    if (permission === 'clipboard-read' || permission === 'clipboard-sanitized-write') {
      callback(true);
      return;
    }

    // Block all other permissions from webviews by default
    // This includes: geolocation, media (camera/mic), notifications, midi, pointerLock, etc.
    logger.warn('Blocked permission request', { permission, url: url.substring(0, 100) });
    callback(false);
  });

  // Handle permission check (synchronous permission queries)
  ses.setPermissionCheckHandler((_webContents, permission, _requestingOrigin, _details) => {
    // Allow clipboard read/write
    if (permission === 'clipboard-read' || permission === 'clipboard-sanitized-write') {
      return true;
    }

    // Block all other permission checks
    return false;
  });
}
