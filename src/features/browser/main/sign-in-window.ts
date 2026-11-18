import { BrowserWindow, screen } from 'electron';

import { isLoopbackHost } from '../../../shared/loopback-host';
import { getMainWindow } from '../../../main/state';
import { allowWebNavigationInWindow } from '../../../main/webview-security';

/** The flag a second launch passes to open a web page in Intent (`--open-url=<url>`). */
const OPEN_URL_FLAG = '--open-url=';

const PARTITION = 'persist:intent-sign-in';
const CLOSE_AFTER_LOOPBACK_MS = 1500;

let signInWindow: BrowserWindow | null = null;

/** The http(s) URL in a second launch's `--open-url=` argument, if any. */
export function findOpenUrlArg(argv: readonly string[]): string | undefined {
  const arg = argv.find((value) => value.startsWith(OPEN_URL_FLAG));
  const url = arg?.slice(OPEN_URL_FLAG.length);
  return url && isWebUrl(url) ? url : undefined;
}

function isWebUrl(value: string): boolean {
  try {
    const { protocol } = new URL(value);
    return protocol === 'https:' || protocol === 'http:';
  } catch {
    return false;
  }
}

function isLoopbackUrl(value: string): boolean {
  try {
    const { protocol, hostname } = new URL(value);
    return protocol === 'http:' && isLoopbackHost(hostname);
  } catch {
    return false;
  }
}

/**
 * Open a web page for a device with no browser (Intent OS): a CLI's OAuth
 * sign-in that `xdg-open` routes to Intent. One window, reused. Like a
 * native-app OAuth flow (RFC 8252), it closes itself once the provider
 * redirects back to the CLI's loopback listener; Escape closes it early.
 */
export function openSignInWindow(url: string): void {
  if (!isWebUrl(url)) return;
  if (signInWindow && !signInWindow.isDestroyed()) {
    void signInWindow.loadURL(url);
    signInWindow.focus();
    return;
  }

  const parent = getMainWindow();
  const area = screen.getDisplayMatching(
    parent && !parent.isDestroyed() ? parent.getBounds() : screen.getPrimaryDisplay().bounds,
  ).workArea;
  const window = new BrowserWindow({
    width: Math.min(520, area.width),
    height: Math.min(720, area.height - 48),
    parent: parent && !parent.isDestroyed() ? parent : undefined,
    autoHideMenuBar: true,
    webPreferences: {
      partition: PARTITION,
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      webSecurity: true,
      webviewTag: false,
    },
  });
  signInWindow = window;
  allowWebNavigationInWindow(window);
  window.removeMenu();
  window.on('closed', () => {
    if (signInWindow === window) signInWindow = null;
  });

  const contents = window.webContents;
  // Popups (a provider's "continue with" page) stay in this window.
  contents.setWindowOpenHandler(({ url: target }) => {
    if (isWebUrl(target)) void window.loadURL(target);
    return { action: 'deny' };
  });
  contents.on('will-navigate', (event) => {
    if (!isWebUrl(event.url)) event.preventDefault();
  });

  let returnedToCli = false;
  const noteLoopback = ({ url: target, isMainFrame }: { url: string; isMainFrame: boolean }) => {
    if (isMainFrame && isLoopbackUrl(target)) returnedToCli = true;
  };
  contents.on('did-start-navigation', noteLoopback);
  contents.on('did-redirect-navigation', noteLoopback);
  contents.on('did-finish-load', () => {
    if (!returnedToCli) return;
    setTimeout(() => {
      if (!window.isDestroyed()) window.close();
    }, CLOSE_AFTER_LOOPBACK_MS);
  });
  contents.on('before-input-event', (event, input) => {
    if (input.type === 'keyDown' && input.key === 'Escape') {
      event.preventDefault();
      window.close();
    }
  });

  void window.loadURL(url);
}
