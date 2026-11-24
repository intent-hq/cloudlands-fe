/**
 * Browser-panel pages identify as Google Chrome to page script as well as to
 * servers. Google sign-in rejects Electron ("This browser or app may not be
 * secure") when `navigator.userAgentData` lists only Chromium, even after the
 * session user agent and client-hint headers claim Chrome. Electron has no
 * session API for that metadata; CDP `Emulation.setUserAgentOverride` sets
 * the user agent, client hints and `navigator.userAgentData` together.
 */
import type { WebContents } from 'electron';

interface UserAgentBrand {
  brand: string;
  version: string;
}

interface UserAgentMetadata {
  brands: UserAgentBrand[];
  fullVersionList: UserAgentBrand[];
  fullVersion: string;
  platform: string;
  platformVersion: string;
  architecture: string;
  model: string;
  mobile: boolean;
  bitness: string;
  wow64: boolean;
}

// i18n-ignore (browser brand sent to websites, not user-facing)
const CHROME_BRAND = 'Google Chrome';

const PLATFORM_NAMES: Partial<Record<NodeJS.Platform, string>> = {
  darwin: 'macOS',
  win32: 'Windows',
  linux: 'Linux',
};

/**
 * Windows build where each UniversalApiContract version first ships, newest
 * first. Chrome reports this contract, not the OS build, as the Windows
 * platform version (Windows 11 is 13.0.0 or later).
 */
const WINDOWS_API_CONTRACTS: ReadonlyArray<readonly [build: number, contract: number]> = [
  [26100, 19],
  [22621, 15],
  [22000, 14],
  [19041, 10],
  [18362, 8],
  [17763, 7],
  [17134, 6],
  [16299, 5],
  [15063, 4],
  [14393, 3],
  [10586, 2],
  [10240, 1],
];

/** The UA-CH platform version Chrome reports, from Electron's `process.getSystemVersion()`. */
function chromePlatformVersion(platform: NodeJS.Platform, systemVersion: string): string {
  const parts = systemVersion.split('.').map((part) => Number.parseInt(part, 10) || 0);
  if (platform === 'win32') {
    const build = parts[2] ?? 0;
    const contract = WINDOWS_API_CONTRACTS.find(([first]) => build >= first)?.[1] ?? 0;
    return `${contract}.0.0`;
  }
  if (platform === 'darwin') {
    return [parts[0] ?? 0, parts[1] ?? 0, parts[2] ?? 0].join('.');
  }
  return '';
}

/** What Google Chrome at `chromeVersion` reports on this platform. */
export function chromeUserAgentMetadata(env: {
  chromeVersion: string;
  platform: NodeJS.Platform;
  arch: string;
  /** `process.getSystemVersion()`. */
  systemVersion: string;
}): UserAgentMetadata {
  const major = env.chromeVersion.split('.')[0];
  return {
    brands: [
      { brand: 'Chromium', version: major },
      { brand: CHROME_BRAND, version: major },
      { brand: 'Not_A Brand', version: '99' },
    ],
    fullVersionList: [
      { brand: 'Chromium', version: env.chromeVersion },
      { brand: CHROME_BRAND, version: env.chromeVersion },
      { brand: 'Not_A Brand', version: '99.0.0.0' },
    ],
    fullVersion: env.chromeVersion,
    platform: PLATFORM_NAMES[env.platform] ?? 'Linux',
    platformVersion: chromePlatformVersion(env.platform, env.systemVersion),
    architecture: env.arch.startsWith('arm') ? 'arm' : 'x86',
    model: '',
    mobile: false,
    bitness: env.arch === 'ia32' || env.arch === 'arm' ? '32' : '64',
    wow64: false,
  };
}

interface BrowserChromeIdentityDeps {
  onWebContentsCreated(listener: (contents: WebContents) => void): void;
  /** Production: `browserPanelPageOwner(contents) !== null`. */
  isBrowserPanelPage(contents: WebContents): boolean;
  sendCdpCommand(
    webContentsId: number,
    method: string,
    params: Record<string, unknown>,
  ): Promise<unknown>;
  metadata: UserAgentMetadata;
  warn(message: string, detail: unknown): void;
  /** Wait after a debugger detach or failed send before trying again. */
  retryDelayMs?: number;
}

interface Page {
  contents: WebContents;
  /** Recognised as a browser-panel page at least once (main-owned views register after creation). */
  panelPage: boolean;
  /** The override is set in the page's current CDP session. */
  applied: boolean;
  sending: boolean;
  /** Bumped on every debugger detach, which drops the override. */
  detaches: number;
  failures: number;
}

const DEFAULT_RETRY_DELAY_MS = 250;
const MAX_RETRIES = 3;

export function startBrowserChromeIdentity(deps: BrowserChromeIdentityDeps): void {
  const retryDelayMs = deps.retryDelayMs ?? DEFAULT_RETRY_DELAY_MS;

  const apply = (page: Page): void => {
    const { contents } = page;
    if (page.applied || page.sending || contents.isDestroyed()) return;
    if (!page.panelPage) page.panelPage = deps.isBrowserPanelPage(contents);
    if (!page.panelPage) return;
    page.sending = true;
    const detaches = page.detaches;
    deps
      .sendCdpCommand(contents.id, 'Emulation.setUserAgentOverride', {
        userAgent: contents.session.getUserAgent(),
        userAgentMetadata: deps.metadata,
      })
      .then(() => {
        page.failures = 0;
        // A detach mid-send dropped the override with its session.
        if (detaches === page.detaches) page.applied = true;
        else later(page);
      })
      .catch((error: unknown) => {
        if (contents.isDestroyed()) return;
        // i18n-ignore (main-process log, not user-facing)
        deps.warn('Could not set the Chrome identity of a browser page', error);
        if (++page.failures <= MAX_RETRIES) later(page);
      })
      .finally(() => {
        page.sending = false;
      });
  };

  const later = (page: Page): void => {
    setTimeout(() => apply(page), retryDelayMs);
  };

  deps.onWebContentsCreated((contents) => {
    const type = contents.getType();
    if (type !== 'webview' && type !== 'window') return;
    const page: Page = {
      contents,
      panelPage: false,
      applied: false,
      sending: false,
      detaches: 0,
      failures: 0,
    };
    contents.on('did-start-navigation', (details: { isMainFrame: boolean }) => {
      if (details.isMainFrame) apply(page);
    });
    contents.on('dom-ready', () => apply(page));
    contents.debugger.on('detach', () => {
      page.detaches++;
      page.applied = false;
      page.failures = 0;
      if (page.panelPage) later(page);
    });
  });
}
