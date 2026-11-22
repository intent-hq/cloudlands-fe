/**
 * View → Darken Websites (intent-hq/intent#9661): which browser-panel pages
 * get the dark overrides, when they are set and cleared, and that nothing
 * touches CDP while the setting is off.
 */
import type { WebContents } from 'electron';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const panelSession = vi.hoisted(() => ({ name: 'browser-panel-session' }));

vi.mock('electron', () => ({
  session: { fromPartition: vi.fn(() => panelSession) },
}));

import {
  browserPanelPageOwner,
  setMainOwnedBrowserPageOwners,
} from '../../../../main/browser-panel-pages';
import { createBrowserWebsiteDarkMode, isDarkenableUrl } from '../website-dark-mode';

type Listener = (...args: any[]) => unknown;

const DARK_MEDIA = {
  features: [{ name: 'prefers-color-scheme', value: 'dark' }],
};
const CLEAR_MEDIA = { features: [] };

let nextId = 100;

function fakeContents(options: {
  type: 'webview' | 'window';
  url?: string;
  session?: object;
  host?: object | null;
}) {
  const listeners = new Map<string, Listener[]>();
  const debuggerListeners = new Map<string, Listener[]>();
  let url = options.url ?? 'about:blank';
  let destroyed = false;
  const add = (map: Map<string, Listener[]>) => (name: string, listener: Listener) => {
    map.set(name, [...(map.get(name) ?? []), listener]);
  };
  const contents = {
    id: nextId++,
    session: options.session ?? panelSession,
    hostWebContents:
      options.host === undefined ? { id: 1, isDestroyed: () => false } : options.host,
    getType: () => options.type,
    getURL: () => url,
    isDestroyed: () => destroyed,
    on: vi.fn(add(listeners)),
    once: vi.fn(add(listeners)),
    debugger: { on: vi.fn(add(debuggerListeners)) },
  };
  const fire = (name: string, ...args: unknown[]) => {
    for (const listener of listeners.get(name) ?? []) listener(...args);
  };
  return {
    contents: contents as unknown as WebContents,
    raw: contents,
    /** Main-frame, cross-document navigation start, then (optionally) commit + dom-ready. */
    startNavigation(target: string, details: Partial<Record<string, unknown>> = {}) {
      fire('did-start-navigation', {
        url: target,
        isMainFrame: true,
        isSameDocument: false,
        ...details,
      });
    },
    commit(target: string) {
      url = target;
      fire('dom-ready');
    },
    failLoad(errorCode: number, isMainFrame = true) {
      fire('did-fail-load', {}, errorCode, 'failed', url, isMainFrame);
    },
    detachDebugger(reason = 'target closed') {
      for (const listener of debuggerListeners.get('detach') ?? []) listener({}, reason);
    },
    destroy() {
      destroyed = true;
      fire('destroyed');
    },
  };
}

function harness(
  options: {
    pref?: unknown;
    remoteHosts?: string[];
    send?: (id: number, method: string, params: unknown) => Promise<unknown>;
  } = {},
) {
  let created: ((contents: WebContents) => void) | undefined;
  const sends: Array<{ id: number; method: string; params: unknown }> = [];
  const send = vi.fn(async (id: number, method: string, params: Record<string, unknown>) => {
    sends.push({ id, method, params });
    return options.send?.(id, method, params);
  });
  const writePref = vi.fn(async (_enabled: boolean) => undefined);
  const readPref = vi.fn(async () => options.pref);
  const warn = vi.fn();
  const controller = createBrowserWebsiteDarkMode({
    onWebContentsCreated: (listener) => {
      created = listener;
    },
    isBrowserPanelPage: (contents) => browserPanelPageOwner(contents) !== null,
    sendCdpCommand: send,
    remoteDaemonHosts: async () => options.remoteHosts ?? [],
    readPref,
    writePref,
    warn,
    reapplyDelayMs: 0,
  });
  return {
    controller,
    send,
    sends,
    readPref,
    writePref,
    warn,
    open(contents: ReturnType<typeof fakeContents>) {
      if (!created) throw new Error('web-contents-created listener not registered');
      created(contents.contents);
      return contents;
    },
    methodsFor(id: number) {
      return sends.filter((s) => s.id === id).map((s) => [s.method, s.params]);
    },
  };
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));
async function flush() {
  for (let i = 0; i < 5; i++) await settle();
}

const APPLIED = [
  ['Emulation.setEmulatedMedia', DARK_MEDIA],
  ['Emulation.setAutoDarkModeOverride', { enabled: true }],
];
const CLEARED = [
  ['Emulation.setEmulatedMedia', CLEAR_MEDIA],
  ['Emulation.setAutoDarkModeOverride', {}],
];

afterEach(() => {
  setMainOwnedBrowserPageOwners(null);
});

describe('isDarkenableUrl', () => {
  const remote = ['devbox.example.net', 'fd00::5'];
  it.each([
    ['https://example.com/docs', true],
    ['http://example.com', true],
    ['http://localhost:5173/', false],
    ['http://LOCALHOST:3000', false],
    ['http://127.0.0.1:8960/', false],
    ['http://127.4.5.6/', false],
    ['http://[::1]:3000/', false],
    ['http://daemon.localhost:8960/', false],
    ['http://client.localhost:3000/', false],
    ['http://foo.localhost/', false],
    ['http://localhost.:3000/', false],
    ['http://devbox.example.net:8960/', false],
    ['https://DEVBOX.example.net/', false],
    ['http://[fd00::5]:3000/', false],
    ['https://www.devbox.example.net/', true],
    ['about:blank', false],
    ['data:text/html,<p>hi</p>', false],
    ['file:///Users/me/index.html', false],
    ['workspace-file://ws/readme.pdf', false],
    ['chrome-error://chromewebdata/', false],
    ['not a url', false],
  ])('%s → %s', (url, expected) => {
    expect(isDarkenableUrl(url, remote)).toBe(expected);
  });
});

describe('browser website dark mode', () => {
  beforeEach(() => {
    vi.useRealTimers();
  });

  it('reads the pref at start (default off) and writes it on toggle', async () => {
    const h = harness();
    await h.controller.start();
    expect(h.readPref).toHaveBeenCalledTimes(1);
    expect(h.controller.isEnabled()).toBe(false);

    h.controller.setEnabled(true);
    expect(h.controller.isEnabled()).toBe(true);
    expect(h.writePref).toHaveBeenLastCalledWith(true);
    h.controller.setEnabled(false);
    expect(h.writePref).toHaveBeenLastCalledWith(false);

    const on = harness({ pref: true });
    await on.controller.start();
    expect(on.controller.isEnabled()).toBe(true);
  });

  it('sends no CDP command while off, from boot through navigations and detaches', async () => {
    const h = harness();
    await h.controller.start();
    const tab = h.open(fakeContents({ type: 'webview' }));
    tab.startNavigation('https://example.com/');
    tab.commit('https://example.com/');
    tab.detachDebugger();
    tab.startNavigation('http://localhost:3000/');
    tab.commit('http://localhost:3000/');
    await flush();
    expect(h.send).not.toHaveBeenCalled();
  });

  it('darkens live eligible tabs on toggle and clears only the tabs it darkened', async () => {
    const h = harness();
    await h.controller.start();
    const external = h.open(fakeContents({ type: 'webview', url: 'https://example.com/' }));
    const devServer = h.open(fakeContents({ type: 'webview', url: 'http://localhost:5173/' }));

    h.controller.setEnabled(true);
    await flush();
    expect(h.methodsFor(external.raw.id)).toEqual(APPLIED);
    expect(h.methodsFor(devServer.raw.id)).toEqual([]);

    h.sends.length = 0;
    h.controller.setEnabled(false);
    await flush();
    expect(h.methodsFor(external.raw.id)).toEqual(CLEARED);
    expect(h.methodsFor(devServer.raw.id)).toEqual([]);
  });

  it('applies at navigation start, before dom-ready, for tabs opened while on', async () => {
    const h = harness({ pref: true });
    await h.controller.start();
    const tab = h.open(fakeContents({ type: 'webview' }));
    tab.startNavigation('https://example.com/');
    await flush();
    expect(h.methodsFor(tab.raw.id)).toEqual(APPLIED);

    tab.commit('https://example.com/');
    await flush();
    expect(h.methodsFor(tab.raw.id)).toEqual(APPLIED);
  });

  it('clears at navigation start when moving to a dev server, and re-applies on the way back', async () => {
    const h = harness({ pref: true, remoteHosts: ['devbox.example.net'] });
    await h.controller.start();
    const tab = h.open(fakeContents({ type: 'webview' }));
    tab.startNavigation('https://example.com/');
    tab.commit('https://example.com/');
    await flush();

    h.sends.length = 0;
    tab.startNavigation('http://daemon.localhost:8960/');
    await flush();
    expect(h.methodsFor(tab.raw.id)).toEqual(CLEARED);

    h.sends.length = 0;
    tab.startNavigation('http://devbox.example.net:8960/');
    tab.commit('http://devbox.example.net:8960/');
    await flush();
    expect(h.methodsFor(tab.raw.id)).toEqual([]);

    tab.startNavigation('https://example.com/next');
    await flush();
    expect(h.methodsFor(tab.raw.id)).toEqual(APPLIED);
  });

  it('clears on a main-frame error page, ignores aborted loads, and re-applies on the next navigation', async () => {
    const h = harness({ pref: true });
    await h.controller.start();
    const tab = h.open(fakeContents({ type: 'webview' }));
    tab.startNavigation('https://example.com/');
    tab.commit('https://example.com/');
    await flush();

    h.sends.length = 0;
    tab.failLoad(-3);
    tab.failLoad(-105, false);
    await flush();
    expect(h.sends).toEqual([]);

    tab.failLoad(-105);
    tab.commit('https://example.com/');
    await flush();
    expect(h.methodsFor(tab.raw.id)).toEqual(CLEARED);

    h.sends.length = 0;
    tab.startNavigation('https://example.com/');
    await flush();
    expect(h.methodsFor(tab.raw.id)).toEqual(APPLIED);
  });

  it('ignores same-document and subframe navigations', async () => {
    const h = harness({ pref: true });
    await h.controller.start();
    const tab = h.open(fakeContents({ type: 'webview' }));
    tab.startNavigation('https://example.com/');
    await flush();

    h.sends.length = 0;
    tab.startNavigation('http://localhost:3000/', { isSameDocument: true });
    tab.startNavigation('http://localhost:3000/', { isMainFrame: false });
    await flush();
    expect(h.sends).toEqual([]);
  });

  it('re-applies right after a debugger detach while on, without a navigation', async () => {
    const h = harness({ pref: true });
    await h.controller.start();
    const tab = h.open(fakeContents({ type: 'webview' }));
    tab.startNavigation('https://example.com/');
    tab.commit('https://example.com/');
    await flush();

    h.sends.length = 0;
    tab.detachDebugger();
    await flush();
    expect(h.methodsFor(tab.raw.id)).toEqual(APPLIED);
  });

  it('does not re-apply after a detach on a dev-server tab or a destroyed tab', async () => {
    const h = harness({ pref: true });
    await h.controller.start();
    const dev = h.open(fakeContents({ type: 'webview', url: 'http://localhost:3000/' }));
    const gone = h.open(fakeContents({ type: 'webview', url: 'https://example.com/' }));
    gone.commit('https://example.com/');
    await flush();

    h.sends.length = 0;
    dev.detachDebugger();
    gone.destroy();
    gone.detachDebugger();
    await flush();
    expect(h.sends).toEqual([]);
  });

  it('handles a main-owned view like a webview guest, and ignores a popup window', async () => {
    const h = harness({ pref: true });
    await h.controller.start();
    const owned = new Set<number>();
    setMainOwnedBrowserPageOwners({
      pageOwner: (id) => (owned.has(id) ? { host: {} as WebContents, shown: true } : null),
    });

    // web-contents-created fires before BrowserViewService registers the page.
    const view = h.open(fakeContents({ type: 'window' }));
    owned.add(view.raw.id);
    view.startNavigation('https://example.com/');
    const popup = h.open(fakeContents({ type: 'window' }));
    popup.startNavigation('https://example.com/popup');
    popup.commit('https://example.com/popup');
    const appWindow = h.open(fakeContents({ type: 'window', session: { name: 'default' } }));
    appWindow.startNavigation('https://example.com/');
    await flush();

    expect(h.methodsFor(view.raw.id)).toEqual(APPLIED);
    expect(h.methodsFor(popup.raw.id)).toEqual([]);
    expect(h.methodsFor(appWindow.raw.id)).toEqual([]);
  });

  it('logs a failed tab as a warning and keeps handling other tabs', async () => {
    const h = harness({
      send: async (id) => {
        if (id === failing.raw.id) throw new Error('Debugger attach timeout');
      },
    });
    await h.controller.start();
    const failing = h.open(fakeContents({ type: 'webview', url: 'https://broken.example/' }));
    const healthy = h.open(fakeContents({ type: 'webview', url: 'https://example.com/' }));

    expect(() => h.controller.setEnabled(true)).not.toThrow();
    await flush();
    expect(h.warn).toHaveBeenCalled();
    expect(h.methodsFor(healthy.raw.id)).toEqual(APPLIED);
  });
});
