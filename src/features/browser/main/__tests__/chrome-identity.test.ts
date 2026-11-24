/**
 * Browser-panel pages get Chrome's user-agent metadata through CDP: only
 * panel pages, once per CDP session, again after a detach, and a bounded
 * number of retries after a failed send.
 */
import type { WebContents } from 'electron';
import { describe, expect, it, vi } from 'vitest';

import { chromeUserAgentMetadata, startBrowserChromeIdentity } from '../chrome-identity';

type Listener = (...args: any[]) => unknown;

const USER_AGENT =
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.7444.59 Safari/537.36';
const METADATA = chromeUserAgentMetadata({
  chromeVersion: '142.0.7444.59',
  platform: 'linux',
  arch: 'x64',
  systemVersion: '6.8.0',
});

let nextId = 100;

function fakeContents(type: 'webview' | 'window' = 'webview') {
  const listeners = new Map<string, Listener[]>();
  const debuggerListeners = new Map<string, Listener[]>();
  let destroyed = false;
  const add = (map: Map<string, Listener[]>) => (name: string, listener: Listener) => {
    map.set(name, [...(map.get(name) ?? []), listener]);
  };
  const contents = {
    id: nextId++,
    session: { getUserAgent: () => USER_AGENT },
    getType: () => type,
    isDestroyed: () => destroyed,
    on: vi.fn(add(listeners)),
    debugger: { on: vi.fn(add(debuggerListeners)) },
  };
  const fire = (name: string, ...args: unknown[]) => {
    for (const listener of listeners.get(name) ?? []) listener(...args);
  };
  return {
    contents: contents as unknown as WebContents,
    navigate(isMainFrame = true) {
      fire('did-start-navigation', { isMainFrame });
    },
    domReady: () => fire('dom-ready'),
    detach: () => {
      for (const listener of debuggerListeners.get('detach') ?? []) listener({}, 'target closed');
    },
    destroy: () => {
      destroyed = true;
    },
  };
}

function harness(
  options: {
    isPanel?: (contents: WebContents) => boolean;
    send?: () => Promise<unknown>;
  } = {},
) {
  let created: ((contents: WebContents) => void) | undefined;
  const send = vi.fn(async (_id: number, _method: string, _params: Record<string, unknown>) =>
    options.send?.(),
  );
  const warn = vi.fn();
  startBrowserChromeIdentity({
    onWebContentsCreated: (listener) => {
      created = listener;
    },
    isBrowserPanelPage: options.isPanel ?? (() => true),
    sendCdpCommand: send,
    metadata: METADATA,
    warn,
    retryDelayMs: 0,
  });
  return {
    send,
    warn,
    page(type: 'webview' | 'window' = 'webview') {
      const page = fakeContents(type);
      created?.(page.contents);
      return page;
    },
  };
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 5));

describe('chromeUserAgentMetadata', () => {
  it('lists Google Chrome beside Chromium at the Chromium version', () => {
    expect(METADATA.brands).toEqual([
      { brand: 'Chromium', version: '142' },
      { brand: 'Google Chrome', version: '142' },
      { brand: 'Not_A Brand', version: '99' },
    ]);
    expect(METADATA.fullVersionList).toContainEqual({
      brand: 'Google Chrome',
      version: '142.0.7444.59',
    });
    expect(METADATA).toMatchObject({
      fullVersion: '142.0.7444.59',
      platform: 'Linux',
      platformVersion: '',
      architecture: 'x86',
      bitness: '64',
      mobile: false,
    });
  });

  it('names the platform and architecture as Chrome does', () => {
    expect(
      chromeUserAgentMetadata({
        chromeVersion: '142.0.0.0',
        platform: 'darwin',
        arch: 'arm64',
        systemVersion: '15.1',
      }),
    ).toMatchObject({
      platform: 'macOS',
      platformVersion: '15.1.0',
      architecture: 'arm',
      bitness: '64',
    });
    expect(
      chromeUserAgentMetadata({
        chromeVersion: '142.0.0.0',
        platform: 'win32',
        arch: 'ia32',
        systemVersion: '10.0.19045',
      }),
    ).toMatchObject({
      platform: 'Windows',
      platformVersion: '10.0.0',
      architecture: 'x86',
      bitness: '32',
    });
  });

  it('reports the Windows API contract, so Windows 11 reads as 13.0.0 or later', () => {
    const windows = (systemVersion: string) =>
      chromeUserAgentMetadata({
        chromeVersion: '152.0.0.0',
        platform: 'win32',
        arch: 'x64',
        systemVersion,
      }).platformVersion;
    expect(windows('10.0.22000')).toBe('14.0.0');
    expect(windows('10.0.22631')).toBe('15.0.0');
    expect(windows('10.0.26100')).toBe('19.0.0');
    expect(windows('10.0.17763')).toBe('7.0.0');
    for (const build of ['10.0.22000', '10.0.22631', '10.0.26100']) {
      expect(Number.parseInt(windows(build), 10)).toBeGreaterThanOrEqual(13);
    }
    expect(Number.parseInt(windows('10.0.19045'), 10)).toBeLessThan(13);
  });
});

describe('startBrowserChromeIdentity', () => {
  it('sets the session user agent and Chrome metadata once per CDP session', async () => {
    const h = harness();
    const page = h.page();
    page.navigate();
    page.domReady();
    await settle();
    page.navigate();
    await settle();

    expect(h.send).toHaveBeenCalledTimes(1);
    expect(h.send).toHaveBeenCalledWith(page.contents.id, 'Emulation.setUserAgentOverride', {
      userAgent: USER_AGENT,
      userAgentMetadata: METADATA,
    });
  });

  it('ignores subframe navigations, app pages and other web contents types', async () => {
    const h = harness({ isPanel: () => false });
    const appPage = h.page('window');
    appPage.navigate();
    appPage.domReady();
    const other = harness();
    const subframe = other.page();
    subframe.navigate(false);
    await settle();

    expect(h.send).not.toHaveBeenCalled();
    expect(other.send).not.toHaveBeenCalled();
  });

  it('recognises a main-owned page that registers after it was created', async () => {
    let registered = false;
    const h = harness({ isPanel: () => registered });
    const page = h.page('window');
    page.navigate();
    registered = true;
    page.domReady();
    await settle();

    expect(h.send).toHaveBeenCalledTimes(1);
  });

  it('sets the override again after the debugger detaches', async () => {
    const h = harness();
    const page = h.page();
    page.navigate();
    await settle();
    page.detach();
    await settle();

    expect(h.send).toHaveBeenCalledTimes(2);
  });

  it('retries a failed send at most three times, and not for a closed page', async () => {
    const h = harness({ send: () => Promise.reject(new Error('no target')) });
    h.page().navigate();
    await settle();
    expect(h.send).toHaveBeenCalledTimes(4);
    expect(h.warn).toHaveBeenCalledTimes(4);

    const closed = harness({ send: () => Promise.reject(new Error('closed')) });
    const page = closed.page();
    page.navigate();
    page.destroy();
    await settle();
    expect(closed.send).toHaveBeenCalledTimes(1);
    expect(closed.warn).not.toHaveBeenCalled();
  });
});
