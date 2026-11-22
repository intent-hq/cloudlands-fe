import { app } from 'electron';
import { Logger } from '../shared/logger';
import { createBrowserWebsiteDarkMode } from '../features/browser/main/website-dark-mode';
import { browserPanelPageOwner } from './browser-panel-pages';
import { getLocalPref, setLocalPref } from './local-prefs';

const logger = new Logger('BrowserWebsiteDarkMode');

// The browser modules load lazily; only an enabled setting needs them.
const loadCdp = () => import('../features/browser/main/embedded-browser-cdp-service');
const loadBrowserIpc = () => import('../features/browser/main/browser.ipc');

const websiteDarkMode = createBrowserWebsiteDarkMode({
  onWebContentsCreated: (listener) => {
    app.on('web-contents-created', (_event, contents) => listener(contents));
  },
  isBrowserPanelPage: (contents) => browserPanelPageOwner(contents) !== null,
  sendCdpCommand: async (webContentsId, method, params) => {
    const { embeddedBrowserCdp } = await loadCdp();
    return embeddedBrowserCdp.sendCdpCommand(webContentsId, method, params);
  },
  remoteDaemonHosts: async () => {
    const { connectedRemoteDaemonHosts } = await loadBrowserIpc();
    return connectedRemoteDaemonHosts();
  },
  readPref: () => getLocalPref('browserWebsiteDarkMode'),
  writePref: (enabled) => setLocalPref('browserWebsiteDarkMode', enabled),
  warn: (message, detail) => logger.warn(message, detail),
});

export function isBrowserWebsiteDarkModeEnabled(): boolean {
  return websiteDarkMode.isEnabled();
}

/** Load the browser modules early so the first page is dark from first paint. */
function preload(): void {
  void Promise.all([loadCdp(), loadBrowserIpc()]).catch((error: unknown) => {
    logger.warn('Could not load the browser modules for website dark mode', error);
  });
}

export function setBrowserWebsiteDarkModeEnabled(next: boolean): void {
  if (next) preload();
  websiteDarkMode.setEnabled(next);
}

/** Call before any window or browser tab is created. */
export async function setupBrowserWebsiteDarkMode(): Promise<void> {
  await websiteDarkMode.start();
  if (websiteDarkMode.isEnabled()) preload();
}
