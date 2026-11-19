import { app, session, type WebContents } from 'electron';
import { BROWSER_PANEL_PARTITION } from '../shared/constants';
import { Logger } from '../shared/logger';
import { embeddedBrowserCdp } from '../features/browser/main/embedded-browser-cdp-service';
import { getLocalPref, setLocalPref } from './local-prefs';

const logger = new Logger('BrowserWebsiteDarkMode');
const guests = new Map<WebContents, () => void>();
let enabled = false;

export function isBrowserWebsiteDarkModeEnabled(): boolean {
  return enabled;
}

export function setBrowserWebsiteDarkModeEnabled(next: boolean): void {
  if (enabled === next) return;
  enabled = next;
  void setLocalPref('browserWebsiteDarkMode', next);
  for (const apply of guests.values()) apply();
}

export async function setupBrowserWebsiteDarkMode(): Promise<void> {
  enabled = (await getLocalPref('browserWebsiteDarkMode')) === true;
  const browserSession = session.fromPartition(BROWSER_PANEL_PARTITION);

  app.on('web-contents-created', (_event, contents) => {
    if (contents.getType() !== 'webview' || contents.session !== browserSession) return;

    let applied = false;
    let pending = Promise.resolve();
    const apply = () => {
      pending = pending.then(async () => {
        if (contents.isDestroyed()) return;
        const darken = enabled && /^https?:\/\//i.test(contents.getURL());
        if (!darken && !applied) return;

        try {
          if (darken) applied = true;
          // Chromium's automatic recoloring alone does not request a site's dark theme.
          await embeddedBrowserCdp.sendCdpCommand(contents.id, 'Emulation.setEmulatedMedia', {
            features: darken ? [{ name: 'prefers-color-scheme', value: 'dark' }] : [],
          });
          await embeddedBrowserCdp.sendCdpCommand(
            contents.id,
            'Emulation.setAutoDarkModeOverride',
            darken ? { enabled: true } : {},
          );
          applied = darken;
        } catch (error) {
          if (!contents.isDestroyed()) logger.warn('Could not update website dark mode', error);
        }
      });
    };

    guests.set(contents, apply);
    contents.on('dom-ready', apply);
    contents.once('destroyed', () => guests.delete(contents));
  });
}
