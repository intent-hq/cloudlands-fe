import type { IpcMainInvokeEvent, WebContents } from 'electron';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const electronMocks = vi.hoisted(() => ({
  defaultSession: {},
  browserPanelSession: {},
  fromWebContents: vi.fn(),
}));

vi.mock('electron', () => ({
  BrowserWindow: { fromWebContents: electronMocks.fromWebContents },
  session: {
    defaultSession: electronMocks.defaultSession,
    fromPartition: (partition: string) =>
      partition === 'persist:browser-panel' ? electronMocks.browserPanelSession : {},
  },
}));

import {
  BROWSER_PANEL_GUEST_IPC_CHANNELS,
  createAuthorizedIpcHandler,
  createBrowserPanelGuestIpcHandler,
  createTrustedBrowserBridgeIpcContext,
  IpcAuthorizationError,
  isTrustedRendererUrl,
} from '../ipc-authorization';
import {
  type BrowserPanelPageOwner,
  browserPanelPageOwner,
  notifyMainOwnedBrowserPageMoved,
  onMainOwnedBrowserPageMoved,
  setMainOwnedBrowserPageOwners,
} from '../browser-panel-pages';

/** What an authorized handler receives: an IPC event or the branded bridge context. */
type PrivilegedIpcContext =
  IpcMainInvokeEvent | ReturnType<typeof createTrustedBrowserBridgeIpcContext>;

function appEvent(overrides: Record<string, unknown> = {}) {
  const mainFrame = { url: 'app://workspaces/' };
  const sender = {
    isDestroyed: () => false,
    getType: () => 'window',
    mainFrame,
    session: electronMocks.defaultSession,
  };
  const owner = { isDestroyed: () => false, webContents: sender };
  electronMocks.fromWebContents.mockReturnValue(owner);
  return { sender, senderFrame: mainFrame, ...overrides } as any;
}

describe('privileged IPC authorization', () => {
  beforeEach(() => electronMocks.fromWebContents.mockReset());

  it('allows the top frame of an owned app window', async () => {
    const handler = vi.fn(async (_context: PrivilegedIpcContext, _request?: unknown) => 'ok');
    const authorized = createAuthorizedIpcHandler('file:read', handler);

    await expect(authorized(appEvent(), { path: 'README.md' })).resolves.toBe('ok');
    expect(handler).toHaveBeenCalledOnce();
  });

  it('rejects an unexpected sender', async () => {
    const event = appEvent();
    electronMocks.fromWebContents.mockReturnValue(null);
    const authorized = createAuthorizedIpcHandler('file:read', vi.fn());

    await expect(authorized(event)).rejects.toEqual(
      expect.objectContaining({ reason: 'sender is not an app window' }),
    );
  });

  it('rejects a subframe even when it belongs to an app window', async () => {
    const event = appEvent({ senderFrame: { url: 'app://workspaces/embedded' } });
    const authorized = createAuthorizedIpcHandler('file:read', vi.fn());

    await expect(authorized(event)).rejects.toEqual(
      expect.objectContaining({ reason: 'subframe invocation' }),
    );
  });

  it('rejects a window outside the default app session', async () => {
    const event = appEvent();
    event.sender.session = {};
    const authorized = createAuthorizedIpcHandler('file:read', vi.fn());

    await expect(authorized(event)).rejects.toEqual(
      expect.objectContaining({ reason: 'unexpected session' }),
    );
  });

  it('rejects a top-level window after it navigates away from the app origin', async () => {
    const event = appEvent();
    event.senderFrame.url = 'https://example.com';
    const authorized = createAuthorizedIpcHandler('file:read', vi.fn());

    await expect(authorized(event)).rejects.toEqual(
      expect.objectContaining({ reason: 'unexpected renderer URL' }),
    );
  });

  it('allows only the symbol-branded browser bridge context', async () => {
    const handler = vi.fn(async (_context: PrivilegedIpcContext, _request?: unknown) => 'ok');
    const authorized = createAuthorizedIpcHandler('agent-backend:stream-message', handler);

    await expect(authorized(createTrustedBrowserBridgeIpcContext())).resolves.toBe('ok');
    await expect(authorized({ kind: 'trusted-browser-bridge' } as any)).rejects.toBeInstanceOf(
      IpcAuthorizationError,
    );
  });

  it('allows only the packaged app origin or the exact development origin', () => {
    expect(isTrustedRendererUrl('app://workspaces/settings', { NODE_ENV: 'production' })).toBe(
      true,
    );
    expect(
      isTrustedRendererUrl('http://127.0.0.1:5197/workspace', {
        NODE_ENV: 'development',
        DEV_PORT: '5197',
      }),
    ).toBe(true);
    expect(isTrustedRendererUrl('https://example.com', { NODE_ENV: 'production' })).toBe(false);
    expect(
      isTrustedRendererUrl('http://127.0.0.1:5198', {
        NODE_ENV: 'development',
        DEV_PORT: '5197',
      }),
    ).toBe(false);
  });
});

function guestEvent(
  overrides: { host?: Record<string, unknown>; sender?: Record<string, unknown> } = {},
) {
  const host = {
    isDestroyed: () => false,
    getType: () => 'window',
    getURL: () => 'app://workspaces/',
    session: electronMocks.defaultSession,
    ...overrides.host,
  };
  const sender = {
    isDestroyed: () => false,
    getType: () => 'webview',
    session: electronMocks.browserPanelSession,
    hostWebContents: host,
    ...overrides.sender,
  };
  electronMocks.fromWebContents.mockImplementation((contents: unknown) =>
    contents === host ? { isDestroyed: () => false, webContents: host } : null,
  );
  return { sender, senderFrame: { isDestroyed: () => false, url: 'https://example.com/' } } as any;
}

describe('browser-panel guest IPC authorization', () => {
  beforeEach(() => electronMocks.fromWebContents.mockReset());
  const channel = 'passkeys:page-create';
  const reject = async (context: unknown, reason: string) =>
    expect(createBrowserPanelGuestIpcHandler(channel, vi.fn())(context as any)).rejects.toEqual(
      expect.objectContaining({ reason }),
    );

  it('admits only the four passkey page channels', () => {
    expect([...BROWSER_PANEL_GUEST_IPC_CHANNELS].sort()).toEqual([
      'passkeys:page-cancel',
      'passkeys:page-capabilities',
      'passkeys:page-create',
      'passkeys:page-get',
    ]);
  });

  it('allows a browser-panel webview hosted by an app window', async () => {
    const handler = vi.fn(async (_context: unknown) => 'ok');
    await expect(createBrowserPanelGuestIpcHandler(channel, handler)(guestEvent())).resolves.toBe(
      'ok',
    );
  });

  it('rejects an app window, the browser bridge, and webviews in other sessions', async () => {
    // An app window passes the type check (main-owned pages are 'window' too) and fails on its session.
    await reject(appEvent(), 'unexpected session');
    await reject(createTrustedBrowserBridgeIpcContext(), 'browser bridge cannot act as a web page');
    await reject(
      guestEvent({ sender: { session: electronMocks.defaultSession } }),
      'unexpected session',
    );
    await reject(guestEvent({ sender: { isDestroyed: () => true } }), 'unexpected sender');
  });

  it('rejects a guest whose host is not a trusted app window', async () => {
    await reject(guestEvent({ sender: { hostWebContents: null } }), 'page has no app host');
    await reject(
      guestEvent({ host: { getURL: () => 'https://evil.example/' } }),
      'unexpected host URL',
    );
    await reject(guestEvent({ host: { session: {} } }), 'unexpected session');
    const event = guestEvent();
    electronMocks.fromWebContents.mockReturnValue(null);
    await reject(event, 'sender is not an app window');
  });

  it('keeps app-only passkey channels closed to browser-panel guests', async () => {
    await expect(
      createAuthorizedIpcHandler('passkeys:device-list', vi.fn())(guestEvent()),
    ).rejects.toEqual(expect.objectContaining({ reason: 'unexpected sender' }));
  });
});

/** A main-owned page (WebContentsView) whose owner BrowserViewService reports. */
function mainOwnedEvent(
  overrides: {
    host?: Record<string, unknown>;
    sender?: Record<string, unknown>;
    frame?: Record<string, unknown>;
    shown?: boolean;
    known?: boolean;
  } = {},
) {
  const host = {
    isDestroyed: () => false,
    getType: () => 'window',
    getURL: () => 'app://workspaces/',
    session: electronMocks.defaultSession,
    ...overrides.host,
  };
  const sender = {
    id: 4242,
    isDestroyed: () => false,
    // A WebContentsView reports 'window'.
    getType: () => 'window',
    session: electronMocks.browserPanelSession,
    // A main-owned page has no webview host; a planted one must not count.
    hostWebContents: null,
    ...overrides.sender,
  };
  const pageOwner = vi.fn((id: number): BrowserPanelPageOwner | null =>
    overrides.known === false || id !== 4242
      ? null
      : { host: host as unknown as WebContents, shown: overrides.shown ?? true },
  );
  setMainOwnedBrowserPageOwners({ pageOwner });
  // The owner renderer is its window's own contents (a machine view passes the same check).
  electronMocks.fromWebContents.mockImplementation((contents: unknown) =>
    contents === host ? { isDestroyed: () => false, webContents: host } : null,
  );
  const event = {
    sender,
    senderFrame: { isDestroyed: () => false, url: 'https://example.com/', ...overrides.frame },
  } as any;
  return { event, host, pageOwner };
}

describe('browser-panel guest IPC authorization for main-owned pages', () => {
  beforeEach(() => {
    electronMocks.fromWebContents.mockReset();
    setMainOwnedBrowserPageOwners(null);
  });
  const channel = 'passkeys:page-get';
  const reject = async (context: unknown, reason: string) =>
    expect(createBrowserPanelGuestIpcHandler(channel, vi.fn())(context as any)).rejects.toEqual(
      expect.objectContaining({ reason }),
    );

  it('allows a main-owned page that a trusted app renderer owns, looked up by its id', async () => {
    const { event, pageOwner } = mainOwnedEvent();
    const handler = vi.fn(async (_context: unknown, _request?: unknown) => 'ok');
    // The request names another page; the owner comes from the sender only.
    await expect(
      createBrowserPanelGuestIpcHandler(channel, handler)(event, { webContentsId: 1 }),
    ).resolves.toBe('ok');
    expect(pageOwner).toHaveBeenCalledExactlyOnceWith(4242);
  });

  it('rejects a view or popup window that BrowserViewService did not make', async () => {
    // Another WebContentsView, an OAuth popup or a sign-in window in this session: all 'window'.
    await reject(mainOwnedEvent({ known: false }).event, 'page has no app host');
    // A planted webview-style host does not stand in for the service's answer.
    const { event, host } = mainOwnedEvent({ known: false });
    event.sender.hostWebContents = host;
    await reject(event, 'page has no app host');
  });

  it('rejects every main-owned page before BrowserViewService is connected', async () => {
    const { event } = mainOwnedEvent();
    setMainOwnedBrowserPageOwners(null);
    await reject(event, 'page has no app host');
  });

  it('rejects a main-owned view in another partition', async () => {
    await reject(
      mainOwnedEvent({ sender: { session: electronMocks.defaultSession } }).event,
      'unexpected session',
    );
  });

  it('rejects a destroyed view or frame', async () => {
    await reject(
      mainOwnedEvent({ sender: { isDestroyed: () => true } }).event,
      'unexpected sender',
    );
    await reject(mainOwnedEvent({ frame: { isDestroyed: () => true } }).event, 'frame is gone');
    const { event } = mainOwnedEvent();
    event.senderFrame = null;
    await reject(event, 'frame is gone');
  });

  it('rejects a page whose owner is not a trusted app renderer', async () => {
    await reject(
      mainOwnedEvent({ host: { isDestroyed: () => true } }).event,
      'page has no app host',
    );
    await reject(
      mainOwnedEvent({ host: { getType: () => 'webview' } }).event,
      'page has no app host',
    );
    await reject(
      mainOwnedEvent({ host: { getURL: () => 'https://evil.example/' } }).event,
      'unexpected host URL',
    );
    await reject(mainOwnedEvent({ host: { session: {} } }).event, 'unexpected session');
    const { event } = mainOwnedEvent();
    electronMocks.fromWebContents.mockReturnValue(null);
    await reject(event, 'sender is not an app window');
  });

  it('admits an owned page that is off screen (cancel and capabilities still answer)', async () => {
    const handler = vi.fn(async (_context: unknown) => 'ok');
    await expect(
      createBrowserPanelGuestIpcHandler(channel, handler)(mainOwnedEvent({ shown: false }).event),
    ).resolves.toBe('ok');
  });

  it('rejects other WebContents types', async () => {
    for (const type of ['backgroundPage', 'browserView', 'remote', 'offscreen']) {
      await reject(mainOwnedEvent({ sender: { getType: () => type } }).event, 'unexpected sender');
    }
  });

  it('keeps app-only passkey channels closed to main-owned pages', async () => {
    for (const appChannel of [
      'passkeys:device-list',
      'passkeys:device-delete',
      'passkeys:dialog-respond',
    ]) {
      const { event } = mainOwnedEvent();
      // A top-level page frame: the app guard then stops it on its session.
      event.sender.mainFrame = event.senderFrame;
      await expect(createAuthorizedIpcHandler(appChannel, vi.fn())(event)).rejects.toEqual(
        expect.objectContaining({ reason: 'unexpected session' }),
      );
    }
  });
});

describe('browser-panel page owners', () => {
  beforeEach(() => setMainOwnedBrowserPageOwners(null));

  it('answers a webview from its host and a main-owned page from the service', () => {
    const host = {};
    const webview = {
      isDestroyed: () => false,
      getType: () => 'webview',
      session: electronMocks.browserPanelSession,
      hostWebContents: host,
    } as any;
    expect(browserPanelPageOwner(webview)).toEqual({ host, shown: true });

    const page = { ...webview, id: 7, getType: () => 'window', hostWebContents: host };
    expect(browserPanelPageOwner(page)).toBeNull();
    const owner = { host: {}, shown: false };
    setMainOwnedBrowserPageOwners({ pageOwner: (id) => (id === 7 ? (owner as any) : null) });
    expect(browserPanelPageOwner(page)).toBe(owner);
    expect(browserPanelPageOwner({ ...page, session: electronMocks.defaultSession })).toBeNull();
    expect(browserPanelPageOwner({ ...page, isDestroyed: () => true })).toBeNull();
    expect(browserPanelPageOwner({ ...page, getType: () => 'offscreen' })).toBeNull();
  });

  it('tells listeners about moves until they stop listening', () => {
    const first = vi.fn();
    const second = vi.fn(() => {
      throw new Error('listener failed');
    });
    const stop = onMainOwnedBrowserPageMoved(first);
    const stopSecond = onMainOwnedBrowserPageMoved(second);
    notifyMainOwnedBrowserPageMoved(7);
    stop();
    notifyMainOwnedBrowserPageMoved(8);
    stopSecond();
    expect(first).toHaveBeenCalledExactlyOnceWith(7);
    expect(second).toHaveBeenCalledTimes(2);
  });
});
