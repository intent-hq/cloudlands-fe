import { app } from 'electron';
import { Logger } from '../shared/logger';
import {
  chromeUserAgentMetadata,
  startBrowserChromeIdentity,
} from '../features/browser/main/chrome-identity';
import { browserPanelPageOwner } from './browser-panel-pages';

const logger = new Logger('BrowserChromeIdentity');

/** Call before any window or browser tab is created. */
export function setupBrowserChromeIdentity(): void {
  startBrowserChromeIdentity({
    onWebContentsCreated: (listener) => {
      app.on('web-contents-created', (_event, contents) => listener(contents));
    },
    isBrowserPanelPage: (contents) => browserPanelPageOwner(contents) !== null,
    sendCdpCommand: async (webContentsId, method, params) => {
      const { embeddedBrowserCdp } =
        await import('../features/browser/main/embedded-browser-cdp-service');
      return embeddedBrowserCdp.sendCdpCommand(webContentsId, method, params);
    },
    metadata: chromeUserAgentMetadata({
      chromeVersion: process.versions.chrome,
      platform: process.platform,
      arch: process.arch,
      systemVersion: process.getSystemVersion(),
    }),
    warn: (message, detail) => logger.warn(message, detail),
  });
}
