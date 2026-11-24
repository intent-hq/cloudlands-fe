/**
 * Security parity: a main-owned browser view (BrowserViewService) gets the
 * same rules as a `<webview>` guest — the same web preferences, the same
 * navigation and popup policy, and never the app-window HUD popup path.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const electronMocks = vi.hoisted(() => ({
  appOn: vi.fn(),
  openExternal: vi.fn(async () => undefined),
  sessionHandlers: {
    setPermissionRequestHandler: vi.fn(),
    setPermissionCheckHandler: vi.fn(),
    getUserAgent: vi.fn(() => 'Mozilla/5.0 Chrome/142.0.0.0 Electron/44.0.0'),
    setUserAgent: vi.fn(),
    webRequest: { onBeforeSendHeaders: vi.fn() },
  },
}));

vi.mock('electron', () => ({
  app: { on: electronMocks.appOn, getName: () => 'intent-cloudlands' },
  BrowserWindow: { getAllWindows: vi.fn(() => []), fromWebContents: vi.fn(() => null) },
  session: {
    defaultSession: electronMocks.sessionHandlers,
    fromPartition: vi.fn(() => electronMocks.sessionHandlers),
  },
  shell: { openExternal: electronMocks.openExternal },
}));

vi.mock('../open-external', () => ({ openExternal: electronMocks.openExternal }));

vi.mock('../../shared/logger', () => ({
  Logger: class {
    debug = vi.fn();
    info = vi.fn();
    warn = vi.fn();
    error = vi.fn();
  },
}));

import { BROWSER_PANEL_PARTITION } from '../../shared/constants';
import {
  buildBrowserViewWebPreferences,
  isBrowserGuestNavigationAllowed,
  isWebviewPopupWindow,
  secureMainOwnedBrowserContents,
  setupWebviewSecurity,
} from '../webview-security';

type Listener = (...args: any[]) => any;
type OpenResult = { action: 'allow' | 'deny'; overrideBrowserWindowOptions?: any };

let nextId = 500;

/** Pass fake contents through web-contents-created and return its handlers. */
function createdContents(type: string) {
  const listeners = new Map<string, Listener[]>();
  let openHandler: ((details: { url: string }) => OpenResult) | undefined;
  const contents = {
    id: nextId++,
    session: { name: 'browser-panel-session' },
    getType: () => type,
    getURL: () => 'https://page.test/',
    on: vi.fn((name: string, listener: Listener) => {
      listeners.set(name, [...(listeners.get(name) ?? []), listener]);
    }),
    once: vi.fn((name: string, listener: Listener) => {
      listeners.set(name, [...(listeners.get(name) ?? []), listener]);
    }),
    setWindowOpenHandler: vi.fn((handler: typeof openHandler) => {
      openHandler = handler;
    }),
  };
  const created = electronMocks.appOn.mock.calls.find(([name]) => name === 'web-contents-created');
  if (!created) throw new Error('web-contents-created listener not registered');
  (created[1] as Listener)(undefined, contents);
  const fire = (name: string, ...args: unknown[]) => {
    for (const listener of listeners.get(name) ?? []) listener(...args);
  };
  return { contents, fire, open: (url: string) => openHandler!({ url }), listeners };
}

function navigate(fire: (name: string, ...args: unknown[]) => void, url: string) {
  const event = { preventDefault: vi.fn() };
  fire('will-navigate', event, url);
  return event.preventDefault.mock.calls.length > 0;
}

describe('main-owned browser view security parity', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setupWebviewSecurity();
  });

  it('builds the same web preferences that will-attach-webview enforces', () => {
    const { fire } = createdContents('window');
    const webviewPreferences: Electron.WebPreferences = {
      preload: '/evil.js',
      nodeIntegration: true,
      contextIsolation: false,
      sandbox: false,
      webSecurity: false,
      allowRunningInsecureContent: true,
      webviewTag: true,
    };
    fire('will-attach-webview', {}, webviewPreferences, { partition: BROWSER_PANEL_PARTITION });

    const { partition, backgroundThrottling, ...viewPreferences } =
      buildBrowserViewWebPreferences();

    expect(partition).toBe(BROWSER_PANEL_PARTITION);
    expect(backgroundThrottling).toBe(true);
    expect(viewPreferences).toEqual(webviewPreferences);
    expect(viewPreferences).toMatchObject({
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      webSecurity: true,
      webviewTag: false,
    });
    expect('preload' in viewPreferences).toBe(false);
  });

  it('applies the guest navigation rules instead of the app-window rules', () => {
    const { contents, fire } = createdContents('browserView');
    // Before it is marked, the view is treated like an app window: an
    // external page leaves for the system browser.
    expect(navigate(fire, 'https://site.test/')).toBe(true);
    expect(electronMocks.openExternal).toHaveBeenCalledTimes(1);

    secureMainOwnedBrowserContents(contents as unknown as Electron.WebContents);
    electronMocks.openExternal.mockClear();

    expect(navigate(fire, 'https://site.test/next')).toBe(false);
    expect(electronMocks.openExternal).not.toHaveBeenCalled();
    expect(navigate(fire, 'javascript:alert(1)')).toBe(true);
  });

  it('opens web popups in a sandboxed window on the same session', () => {
    const { contents, open } = createdContents('browserView');
    secureMainOwnedBrowserContents(contents as unknown as Electron.WebContents);

    const result = open('https://accounts.test/oauth');
    expect(result.action).toBe('allow');
    expect(result.overrideBrowserWindowOptions.webPreferences).toMatchObject({
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      session: contents.session,
    });
    expect(open('file:///etc/passwd')).toEqual({ action: 'deny' });
  });

  it('tracks its popups as web popups and never registers one as the HUD', () => {
    const { contents, fire } = createdContents('browserView');
    secureMainOwnedBrowserContents(contents as unknown as Electron.WebContents);
    const popup = {
      id: 77,
      on: vi.fn(),
      webContents: { id: 901, isDestroyed: () => false, on: vi.fn() },
    };

    fire('did-create-window', popup, { url: 'https://evil.test/hud' });

    expect(isWebviewPopupWindow(popup as unknown as Electron.BrowserWindow)).toBe(true);
    expect((popup as { backendId?: string }).backendId).toBeUndefined();
  });

  it('shares the guest URL rule with the service', () => {
    expect(isBrowserGuestNavigationAllowed('https://a.test/')).toBe(true);
    expect(isBrowserGuestNavigationAllowed('javascript:alert(1)')).toBe(false);
    expect(isBrowserGuestNavigationAllowed('not a url')).toBe(false);
  });
});
