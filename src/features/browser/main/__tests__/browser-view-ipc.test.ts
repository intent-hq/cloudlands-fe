/**
 * IPC for main-owned browser views: the Labs setting gates creation, and only
 * the renderer of the window and machine that own a page may drive it.
 */
import { EventEmitter } from 'events';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  handlers: new Map<string, (event: unknown, data: unknown) => Promise<unknown>>(),
  prefs: new Map<string, unknown>(),
  bindings: new Map<unknown, { window: unknown; backendId: string }>(),
  views: [] as Array<{ webContents: any }>,
  registerTab: vi.fn(),
  unregisterTab: vi.fn(),
  setMainOwnedBrowserViews: vi.fn(),
}));

vi.mock('electron', () => {
  class WebContentsView {
    webContents: any;
    constructor() {
      const contents = Object.assign(new (require('events').EventEmitter)(), {
        id: 300 + mocks.views.length,
        isDestroyed: () => false,
        loadURL: vi.fn(async () => undefined),
        close: vi.fn(),
        navigationHistory: { canGoBack: () => false, canGoForward: () => false },
        stop: vi.fn(),
      });
      this.webContents = contents;
      mocks.views.push(this);
    }
    setBounds = vi.fn();
    setVisible = vi.fn();
  }
  return {
    app: new (require('events').EventEmitter)(),
    ipcMain: {
      handle: vi.fn((channel: string, handler: any) => mocks.handlers.set(channel, handler)),
    },
    WebContentsView,
  };
});

vi.mock('../../../../main/local-prefs', () => ({
  getLocalPref: vi.fn(async (key: string) => mocks.prefs.get(key)),
  setLocalPref: vi.fn(async (key: string, value: unknown) => mocks.prefs.set(key, value)),
}));
vi.mock('../../../../main/frames', () => ({
  rendererFor: (window: { machine: unknown }) => window.machine,
  shownMachine: () => 'local',
}));
vi.mock('../../../../main/webview-security', () => ({
  buildBrowserViewWebPreferences: () => ({ sandbox: true }),
  isBrowserGuestNavigationAllowed: (url: string) => url.startsWith('https:'),
  secureMainOwnedBrowserContents: vi.fn(),
}));
vi.mock('../../../../main/window-backend', () => ({
  getStrictBackendBindingForWebContents: (sender: unknown) => mocks.bindings.get(sender) ?? null,
}));
vi.mock('../embedded-browser-cdp-service', () => ({
  embeddedBrowserCdp: {
    registerTab: mocks.registerTab,
    unregisterTab: mocks.unregisterTab,
    setMainOwnedBrowserViews: mocks.setMainOwnedBrowserViews,
  },
}));
vi.mock('../../../../shared/logger', () => ({
  Logger: class {
    debug = vi.fn();
    info = vi.fn();
    warn = vi.fn();
    error = vi.fn();
  },
}));

import { IPC_CHANNELS } from '../../../../shared/ipc-registry';

const CH = IPC_CHANNELS.BROWSER_VIEW;

function fakeWindow() {
  return Object.assign(new EventEmitter(), {
    isDestroyed: () => false,
    machine: { isDestroyed: () => false, getZoomFactor: () => 1, send: vi.fn() },
    contentView: { addChildView: vi.fn(), removeChildView: vi.fn() },
  });
}

/** A renderer bound to `window` and `backendId`, calling from its main frame. */
function renderer(window: unknown, backendId = 'local') {
  const mainFrame = {};
  const sender = { mainFrame };
  mocks.bindings.set(sender, { window, backendId });
  return { sender, senderFrame: mainFrame };
}

async function invoke(channel: string, event: unknown, data: unknown) {
  const handler = mocks.handlers.get(channel);
  if (!handler) throw new Error(`no handler for ${channel}`);
  return handler(event, data);
}

async function register() {
  vi.resetModules();
  mocks.handlers.clear();
  const module = await import('../browser-view.ipc');
  module.registerBrowserViewHandlers();
}

const CREATE = { tabId: 'tab-1', workspaceId: 'ws-1', url: 'https://a.test/' };

beforeEach(() => {
  mocks.prefs.clear();
  mocks.bindings.clear();
  mocks.views.length = 0;
  vi.clearAllMocks();
});

describe('browser view IPC', () => {
  it('is off by default: creating a page is refused until the Labs setting is on', async () => {
    await register();
    const window = fakeWindow();
    const event = renderer(window);

    await expect(invoke(CH.CREATE, event, CREATE)).rejects.toThrow('off');
    await expect(invoke(CH.GET_LAB, event, undefined)).resolves.toEqual({ enabled: false });

    await expect(invoke(CH.SET_LAB, event, { enabled: true })).resolves.toEqual({ enabled: true });
    expect(mocks.prefs.get('browserViewsInMainEnabled')).toBe(true);
    await expect(invoke(CH.CREATE, event, CREATE)).resolves.toEqual({ webContentsId: 300 });
    expect(mocks.registerTab).toHaveBeenCalledWith('tab-1', 300, 'ws-1');
  });

  it('connects the service to the CDP registry', async () => {
    await register();
    const [views] = mocks.setMainOwnedBrowserViews.mock.calls[0];
    expect(views.owns(12345)).toBe(false);
  });

  it('refuses a sender that is not a bound app renderer main frame', async () => {
    mocks.prefs.set('browserViewsInMainEnabled', true);
    await register();
    const window = fakeWindow();
    const bound = renderer(window);

    await expect(invoke(CH.CREATE, { sender: {}, senderFrame: {} }, CREATE)).rejects.toThrow();
    await expect(
      invoke(CH.CREATE, { sender: bound.sender, senderFrame: {} }, CREATE),
    ).rejects.toThrow();
    expect(mocks.views).toEqual([]);
  });

  it('lets only the owning window and machine drive or close a page', async () => {
    mocks.prefs.set('browserViewsInMainEnabled', true);
    await register();
    const owner = renderer(fakeWindow());
    const otherWindow = renderer(fakeWindow());
    const otherMachine = renderer(mocks.bindings.get(owner.sender)!.window, 'remote');
    await invoke(CH.CREATE, owner, CREATE);
    const placement = {
      tabId: 'tab-1',
      rect: { x: 0, y: 0, width: 10, height: 10 },
      visible: true,
    };

    for (const intruder of [otherWindow, otherMachine]) {
      await expect(invoke(CH.SET_PLACEMENT, intruder, placement)).rejects.toThrow('another window');
      await expect(
        invoke(CH.COMMAND, intruder, { tabId: 'tab-1', command: { type: 'stop' } }),
      ).rejects.toThrow('another window');
      await expect(invoke(CH.DESTROY, intruder, { tabId: 'tab-1' })).rejects.toThrow(
        'another window',
      );
    }
    await expect(invoke(CH.SET_PLACEMENT, owner, placement)).resolves.toEqual({
      placement: 'shown',
    });
    await expect(invoke(CH.DESTROY, owner, { tabId: 'tab-1' })).resolves.toEqual({
      success: true,
    });
    expect(mocks.views[0].webContents.close).toHaveBeenCalled();
  });

  it('rejects malformed commands before they reach the page', async () => {
    mocks.prefs.set('browserViewsInMainEnabled', true);
    await register();
    const owner = renderer(fakeWindow());
    await invoke(CH.CREATE, owner, CREATE);

    await expect(
      invoke(CH.COMMAND, owner, { tabId: 'tab-1', command: { type: 'exec', code: '1' } }),
    ).resolves.toMatchObject({ success: false });
    await expect(
      invoke(CH.COMMAND, owner, {
        tabId: 'tab-1',
        command: { type: 'navigate', url: 'javascript:1' },
      }),
    ).rejects.toThrow();
  });
});
