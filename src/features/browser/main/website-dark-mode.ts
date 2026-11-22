/**
 * View → Darken Websites (intent-hq/intent#9661). While on, browser-panel
 * pages showing an external http(s) site get two CDP overrides: a dark
 * `prefers-color-scheme` (sites switch to their own dark theme) and
 * Chromium's automatic darkening (light-only sites). Local dev servers are
 * never darkened. While off, nothing attaches a debugger or sends CDP.
 *
 * Electron has no per-webContents force-dark switch; `nativeTheme` and
 * `WebContentsForceDark` are process-wide and would darken Intent's own UI.
 */
import type { WebContents } from 'electron';
import { isLoopbackHost } from '../../../shared/loopback-host';

export interface BrowserWebsiteDarkModeDeps {
  onWebContentsCreated(listener: (contents: WebContents) => void): void;
  /** Production: `browserPanelPageOwner(contents) !== null`. */
  isBrowserPanelPage(contents: WebContents): boolean;
  sendCdpCommand(
    webContentsId: number,
    method: string,
    params: Record<string, unknown>,
  ): Promise<unknown>;
  /** `daemonHost` of every connected remote backend. */
  remoteDaemonHosts(): Promise<readonly string[]>;
  readPref(): Promise<unknown>;
  writePref(enabled: boolean): Promise<void>;
  warn(message: string, detail: unknown): void;
  /** Wait after a debugger detach before attaching again. */
  reapplyDelayMs?: number;
}

export interface BrowserWebsiteDarkMode {
  start(): Promise<void>;
  isEnabled(): boolean;
  setEnabled(next: boolean): void;
}

interface Page {
  contents: WebContents;
  /** URL the page is showing or navigating to. */
  url: string;
  /** Recognised as a browser-panel page at least once (main-owned views register after creation). */
  panelPage: boolean;
  /** The main frame shows an error page. */
  loadFailed: boolean;
  /** Overrides currently set in the page's CDP session. */
  darkened: boolean;
  queue: Promise<void>;
}

const DEFAULT_REAPPLY_DELAY_MS = 250;

function bareHost(host: string): string {
  return host
    .trim()
    .toLowerCase()
    .replace(/^\[(.*)\]$/, '$1')
    .replace(/\.$/, '');
}

/** External http(s) pages only: no loopback, `*.localhost`, or remote daemon host. */
export function isDarkenableUrl(url: string, remoteDaemonHosts: readonly string[]): boolean {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return false;
  const host = bareHost(parsed.hostname);
  if (!host || isLoopbackHost(host)) return false;
  if (host === 'localhost' || host.endsWith('.localhost')) return false;
  return !remoteDaemonHosts.some((daemonHost) => bareHost(daemonHost) === host);
}

export function createBrowserWebsiteDarkMode(
  deps: BrowserWebsiteDarkModeDeps,
): BrowserWebsiteDarkMode {
  const pages = new Map<WebContents, Page>();
  const reapplyDelayMs = deps.reapplyDelayMs ?? DEFAULT_REAPPLY_DELAY_MS;
  let enabled = false;

  const isPanelPage = (page: Page): boolean => {
    if (!page.panelPage) page.panelPage = deps.isBrowserPanelPage(page.contents);
    return page.panelPage;
  };

  const shouldDarken = async (page: Page): Promise<boolean> =>
    enabled &&
    !page.loadFailed &&
    isPanelPage(page) &&
    isDarkenableUrl(page.url, await deps.remoteDaemonHosts());

  const sync = (page: Page): void => {
    page.queue = page.queue.then(async () => {
      if (page.contents.isDestroyed()) return;
      let darken = false;
      try {
        darken = await shouldDarken(page);
      } catch (error) {
        deps.warn('Could not read the remote daemon hosts', error);
      }
      if (page.contents.isDestroyed() || darken === page.darkened) return;
      const id = page.contents.id;
      try {
        // Automatic darkening alone does not ask a site for its own dark theme.
        await deps.sendCdpCommand(id, 'Emulation.setEmulatedMedia', {
          features: darken ? [{ name: 'prefers-color-scheme', value: 'dark' }] : [],
        });
        await deps.sendCdpCommand(
          id,
          'Emulation.setAutoDarkModeOverride',
          darken ? { enabled: true } : {},
        );
        page.darkened = darken;
      } catch (error) {
        // A partial apply may have left one override set; let a later sync clear it.
        if (darken) page.darkened = true;
        if (!page.contents.isDestroyed()) deps.warn('Could not update website dark mode', error);
      }
    });
  };

  const track = (contents: WebContents): void => {
    const type = contents.getType();
    if (type !== 'webview' && type !== 'window') return;
    const page: Page = {
      contents,
      url: contents.getURL(),
      panelPage: false,
      loadFailed: false,
      darkened: false,
      queue: Promise.resolve(),
    };
    pages.set(contents, page);

    const navigation = (details: { url: string; isMainFrame: boolean; isSameDocument: boolean }) => {
      if (!details.isMainFrame || details.isSameDocument) return;
      page.url = details.url;
      page.loadFailed = false;
      sync(page);
    };
    contents.on('did-start-navigation', navigation);
    contents.on('did-redirect-navigation', navigation);
    contents.on('did-fail-load', (_event, errorCode, _description, _url, isMainFrame) => {
      // -3 is ERR_ABORTED: the user or a new navigation stopped the load.
      if (!isMainFrame || errorCode === -3) return;
      page.loadFailed = true;
      sync(page);
    });
    contents.on('dom-ready', () => {
      page.url = contents.getURL();
      sync(page);
    });
    // Chromium drops emulation overrides with the CDP session.
    contents.debugger.on('detach', () => {
      if (!page.darkened) return;
      page.darkened = false;
      setTimeout(() => {
        if (enabled && !contents.isDestroyed()) sync(page);
      }, reapplyDelayMs);
    });
    contents.once('destroyed', () => pages.delete(contents));
  };

  return {
    async start() {
      deps.onWebContentsCreated(track);
      enabled = (await deps.readPref()) === true;
      if (enabled) for (const page of pages.values()) sync(page);
    },
    isEnabled: () => enabled,
    setEnabled(next) {
      if (enabled === next) return;
      enabled = next;
      void deps.writePref(next).catch((error: unknown) => {
        deps.warn('Could not save website dark mode', error);
      });
      for (const page of pages.values()) sync(page);
    },
  };
}
