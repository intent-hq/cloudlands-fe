import type { IpcMainInvokeEvent } from 'electron';
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
    await reject(appEvent(), 'unexpected sender');
    await reject(createTrustedBrowserBridgeIpcContext(), 'browser bridge cannot act as a web page');
    await reject(
      guestEvent({ sender: { session: electronMocks.defaultSession } }),
      'unexpected session',
    );
    await reject(guestEvent({ sender: { isDestroyed: () => true } }), 'unexpected sender');
  });

  it('rejects a guest whose host is not a trusted app window', async () => {
    await reject(guestEvent({ sender: { hostWebContents: null } }), 'webview has no app host');
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
