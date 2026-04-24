/**
 * Webview Security Configuration
 *
 * This module sets up security handlers for Electron webviews to prevent:
 * - Node.js integration in webviews (RCE attacks)
 * - Dangerous protocol navigation (javascript:, data:, vbscript:, blob:)
 * - Uncontrolled popup windows
 * - Unauthorized permission requests (camera, mic, geolocation)
 *
 * It also configures the browser panel's isolated session to support:
 * - OAuth/authentication flows (popup-based, redirect-based, SAML/SSO)
 * - Third-party cookie access (required by OAuth providers)
 * - Popup windows that share the same session as the webview
 *
 * Allowed protocols are defined in src/shared/constants.ts (BROWSER_PROTOCOLS)
 * to ensure consistency across the codebase.
 */

import { app, session, shell } from 'electron';
import * as path from 'path';
import { fileURLToPath } from 'url';
import { BROWSER_PANEL_PARTITION, BROWSER_PROTOCOLS } from '../shared/constants';
import { Logger } from '../shared/logger';

const logger = new Logger('WebviewSecurity');

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * Permissions allowed in the browser panel session.
 * These are needed for OAuth flows and general web browsing.
 * - clipboard-read/write: copy/paste support
 * - storage-access: third-party cookie access (OAuth providers set cookies across domains)
 * - top-level-storage-access: allows top-level sites to request third-party cookie access
 *   on behalf of embedded content (used by federated login flows)
 */
const BROWSER_PANEL_ALLOWED_PERMISSIONS = new Set([
  'clipboard-read',
  'clipboard-sanitized-write',
  'storage-access',
  'top-level-storage-access',
]);

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
 * Track webContents IDs of popup windows created from webviews.
 * These popup windows need to navigate freely (for OAuth redirects)
 * without being intercepted by the navigation handler that normally
 * opens external URLs in the system browser.
 */
const webviewPopupContentsIds = new Set<number>();

/**
 * Get secure BrowserWindow options for popup windows opened from a webview.
 * Uses the webview's own session so that cookies set during OAuth flows
 * (or any authentication) are available to the original page.
 *
 * Security model:
 * - No Node.js integration (prevents RCE)
 * - Context isolation enabled (prevents prototype pollution)
 * - Sandbox enabled (process isolation)
 * - No preload scripts (no access to Electron APIs)
 * - Shares the opener webview's session (shared cookies/storage for auth flows)
 *
 * @param webviewSession - The session from the webview that opened the popup.
 *   By passing the Session object directly (instead of a partition string),
 *   we guarantee the popup shares the exact same cookie jar regardless of
 *   how the webview's partition was configured.
 */
function getWebviewPopupOptions(
  webviewSession: Electron.Session,
): Electron.BrowserWindowConstructorOptions {
  return {
    width: 500,
    height: 700,
    webPreferences: {
      nodeIntegration: false,
      nodeIntegrationInWorker: false,
      nodeIntegrationInSubFrames: false,
      contextIsolation: true,
      sandbox: true,
      webSecurity: true,
      allowRunningInsecureContent: false,
      // Share the webview's session so OAuth cookies are accessible to both
      // the popup and the original page.
      session: webviewSession,
    },
  };
}

/**
 * Check if a webContents is a popup window created from a webview.
 * These windows need to navigate freely for OAuth redirect chains.
 */
function isWebviewPopup(contents: Electron.WebContents): boolean {
  return webviewPopupContentsIds.has(contents.id);
}

/**
 * Track a popup window created from a webview (or from another tracked popup).
 * Registers the popup's webContents ID so navigation handlers allow free
 * http/https navigation (needed for OAuth redirect chains). Also attaches
 * a listener for nested popups (e.g., MFA prompts opened from a login popup)
 * so they are tracked recursively.
 */
function trackWebviewPopup(popupWindow: Electron.BrowserWindow): void {
  const popupContents = popupWindow.webContents;
  const popupId = popupContents.id;
  webviewPopupContentsIds.add(popupId);
  logger.info('Registered webview popup window', { popupId });

  // Track nested popups (e.g., an OAuth popup opens an MFA prompt)
  popupContents.on('did-create-window', (nestedPopupWindow) => {
    trackWebviewPopup(nestedPopupWindow);
  });

  // Clean up when the popup window is closed
  popupWindow.on('closed', () => {
    webviewPopupContentsIds.delete(popupId);
    logger.debug('Cleaned up webview popup window', { popupId });
  });
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
    contents.on('will-attach-webview', (_event, webPreferences, params) => {
      const partition = params.partition || 'default';
      logger.debug('Webview attaching, enforcing security settings', {
        partition,
        src: params.src?.substring(0, 80),
        allowpopups: params.allowpopups,
      });

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

      // If this webview uses the browser panel partition, ensure its session
      // has the OAuth-friendly permission handlers configured.
      // This handles the case where the session is created lazily by Electron
      // when the webview attaches (rather than at app startup).
      if (partition === BROWSER_PANEL_PARTITION) {
        setupBrowserPanelSession();
      }

      logger.debug('Webview security settings enforced', {
        nodeIntegration: webPreferences.nodeIntegration,
        contextIsolation: webPreferences.contextIsolation,
        sandbox: webPreferences.sandbox,
        partition,
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

      // Popup windows created from webviews (for OAuth/auth flows) must be allowed
      // to navigate freely to http/https URLs. Without this, OAuth redirect chains
      // (e.g., Google → callback URL) would be intercepted and opened in the system
      // browser, breaking the authentication flow.
      if (isWebviewPopup(contents)) {
        if (!isWebviewAllowedUrl(url)) {
          logger.warn('Blocked disallowed protocol in webview popup', { url: url.substring(0, 100) });
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

    // Handle new window creation (popups) from webviews and app windows
    contents.setWindowOpenHandler(({ url }) => {
      if (contents.getType() === 'webview') {
        logger.debug('Webview requested new window', { url: url.substring(0, 100) });

        if (isBlockedProtocol(url)) {
          logger.warn('Blocked popup with dangerous protocol', { url: url.substring(0, 100) });
          return { action: 'deny' };
        }

        try {
          const parsed = new URL(url);
          if (!isExternalHttpUrl(parsed)) {
            // Block non-http protocols (file://, etc.) in popups for security.
            // file:// is allowed for webview *navigation* but must NOT be opened as a popup.
            logger.warn('Blocked webview popup with non-http protocol', {
              url: url.substring(0, 100),
            });
            return { action: 'deny' };
          }
        } catch {
          logger.warn('Blocked webview popup with invalid URL', { url: url.substring(0, 100) });
          return { action: 'deny' };
        }

        // Allow http/https popups from webviews in a new BrowserWindow.
        // This is essential for OAuth/authentication flows where websites use
        // window.open() to show a consent screen (Google, GitHub, Microsoft, etc.).
        //
        // The popup BrowserWindow shares the webview's session (via contents.session),
        // so cookies set during the OAuth flow are available to the original page.
        // This approach works for ALL OAuth providers without URL pattern matching.
        //
        // How this works for different OAuth patterns:
        // 1. Popup-based OAuth (Google, GitHub, Facebook, Apple, Twitter/X):
        //    - Website calls window.open('https://accounts.google.com/...')
        //    - Popup opens in a BrowserWindow with same session
        //    - User authenticates, provider redirects back
        //    - Cookies are shared, original page detects completion via postMessage/polling
        //
        // 2. Redirect-based OAuth (many providers):
        //    - These don't use popups — the page navigates directly
        //    - Already works because webview allows http/https navigation
        //    - Session partition ensures cookies persist across redirects
        //
        // 3. SAML/SSO multi-redirect chains:
        //    - Same as redirect-based — works within the webview or popup
        //    - Shared session ensures cookies from all domains in the chain are available
        //
        // 4. Silent token refresh (Auth0, Okta):
        //    - Uses hidden iframes within the page
        //    - Works because storage-access permission is granted on the session
        //
        // Security: The popup BrowserWindow has the same restrictions as the webview
        // (no Node.js, sandbox, context isolation) — no additional attack surface.
        logger.info('Allowing webview popup in BrowserWindow', {
          url: url.substring(0, 100),
        });
        return {
          action: 'allow',
          overrideBrowserWindowOptions: getWebviewPopupOptions(contents.session),
        };
      }

      // Popup windows created from webviews should also allow popups
      // (e.g., OAuth flow might open another popup for MFA)
      if (isWebviewPopup(contents) && !isBlockedProtocol(url)) {
        try {
          if (isExternalHttpUrl(new URL(url))) {
            logger.info('Allowing popup from webview popup window', {
              url: url.substring(0, 100),
            });
            return {
              action: 'allow',
              overrideBrowserWindowOptions: getWebviewPopupOptions(contents.session),
            };
          }
        } catch {
          // fall through to deny
        }
      }

      // Non-webview contents (app windows)
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

    // Track popup windows created from webviews so their navigation handler
    // allows free http/https navigation (needed for OAuth redirect chains).
    // Also track popups created from webview popups (nested popups) so that
    // MFA prompts or alternative sign-in options inside a login popup work.
    if (contents.getType() === 'webview') {
      contents.on('did-create-window', (popupWindow) => {
        trackWebviewPopup(popupWindow);
      });
    }
  });

  // Setup permission handlers for the default session
  setupPermissionHandlers(session.defaultSession);

  // Setup the browser panel's isolated session with OAuth-friendly permissions
  setupBrowserPanelSession();

  logger.info('Webview security handlers configured');
}

/**
 * Setup permission request handlers for a session.
 * Used for the default session (app windows) — only allows clipboard access.
 */
function setupPermissionHandlers(ses: Electron.Session): void {
  ses.setPermissionRequestHandler((webContents, permission, callback, details) => {
    const url = details.requestingUrl || webContents?.getURL() || 'unknown';
    logger.info('Permission requested', { permission, url: url.substring(0, 100) });

    if (permission === 'clipboard-read' || permission === 'clipboard-sanitized-write') {
      callback(true);
      return;
    }

    logger.warn('Blocked permission request', { permission, url: url.substring(0, 100) });
    callback(false);
  });

   
  ses.setPermissionCheckHandler((_webContents, permission, _requestingOrigin, _details) => {
    if (permission === 'clipboard-read' || permission === 'clipboard-sanitized-write') {
      return true;
    }
    return false;
  });
}

/**
 * Setup the browser panel's isolated session.
 *
 * This configures a dedicated session partition for the embedded browser panel
 * with permissions needed for OAuth/authentication flows to work:
 *
 * 1. storage-access: Allows third-party cookie access. OAuth providers (Google, Microsoft,
 *    Facebook, etc.) set cookies on their domain during the consent flow. Without this,
 *    the "Unable to get profile information" error occurs because the provider's cookies
 *    are blocked as third-party cookies.
 *
 * 2. top-level-storage-access: Allows top-level sites to request cookie access on behalf
 *    of embedded content. Used by federated login (FedCM) and some SSO flows.
 *
 * 3. clipboard-read/write: Standard copy/paste support.
 *
 * The session uses 'persist:browser-panel' partition, which means:
 * - Cookies and storage persist across app restarts (user stays logged in)
 * - Completely isolated from the app's own session (no cookie leakage)
 * - Shared between the webview and any popup windows it opens (critical for OAuth)
 */
function setupBrowserPanelSession(): void {
  const browserSession = session.fromPartition(BROWSER_PANEL_PARTITION);

  // Permission request handler — allows OAuth-related permissions
  browserSession.setPermissionRequestHandler((webContents, permission, callback, details) => {
    const url = details.requestingUrl || webContents?.getURL() || 'unknown';
    logger.info('Browser panel permission requested', { permission, url: url.substring(0, 100) });

    if (BROWSER_PANEL_ALLOWED_PERMISSIONS.has(permission)) {
      logger.debug('Allowing browser panel permission', { permission });
      callback(true);
      return;
    }

    logger.warn('Blocked browser panel permission request', {
      permission,
      url: url.substring(0, 100),
    });
    callback(false);
  });

  // Permission check handler — synchronous permission queries
  browserSession.setPermissionCheckHandler(
     
    (_webContents, permission, _requestingOrigin, _details) => {
      return BROWSER_PANEL_ALLOWED_PERMISSIONS.has(permission);
    },
  );

  logger.info('Browser panel session configured', { partition: BROWSER_PANEL_PARTITION });
}
