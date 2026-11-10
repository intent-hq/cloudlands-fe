import { beforeEach, describe, expect, it, vi } from 'vitest';

const electronMocks = vi.hoisted(() => ({
  defaultSession: {},
  fromWebContents: vi.fn(),
}));

vi.mock('electron', () => ({
  BrowserWindow: { fromWebContents: electronMocks.fromWebContents },
  session: { defaultSession: electronMocks.defaultSession },
}));

import { EventEmitter } from 'node:events';
import { bindViewToBackend } from '../window-backend';
import {
  createAuthorizedIpcHandler,
  createTrustedBrowserBridgeIpcContext,
  IpcAuthorizationError,
  isTrustedRendererUrl,
} from '../ipc-authorization';

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
    const handler = vi.fn(async () => 'ok');
    const authorized = createAuthorizedIpcHandler('file:read', handler);

    await expect(authorized(appEvent(), { path: 'README.md' })).resolves.toBe('ok');
    expect(handler).toHaveBeenCalledOnce();
  });

  it('rejects an unexpected sender', async () => {
    const event = appEvent();
    electronMocks.fromWebContents.mockReturnValue(null);
    const authorized = createAuthorizedIpcHandler('file:read', vi.fn());

    await expect(authorized(event)).rejects.toEqual(
      expect.objectContaining<IpcAuthorizationError>({ reason: 'sender is not an app window' }),
    );
  });

  it('rejects a subframe even when it belongs to an app window', async () => {
    const event = appEvent({ senderFrame: { url: 'app://workspaces/embedded' } });
    const authorized = createAuthorizedIpcHandler('file:read', vi.fn());

    await expect(authorized(event)).rejects.toEqual(
      expect.objectContaining<IpcAuthorizationError>({ reason: 'subframe invocation' }),
    );
  });

  it('rejects a window outside the default app session', async () => {
    const event = appEvent();
    event.sender.session = {};
    const authorized = createAuthorizedIpcHandler('file:read', vi.fn());

    await expect(authorized(event)).rejects.toEqual(
      expect.objectContaining<IpcAuthorizationError>({ reason: 'unexpected session' }),
    );
  });

  it('rejects a top-level window after it navigates away from the app origin', async () => {
    const event = appEvent();
    event.senderFrame.url = 'https://example.com';
    const authorized = createAuthorizedIpcHandler('file:read', vi.fn());

    await expect(authorized(event)).rejects.toEqual(
      expect.objectContaining<IpcAuthorizationError>({ reason: 'unexpected renderer URL' }),
    );
  });

  it('allows only the symbol-branded browser bridge context', async () => {
    const handler = vi.fn(async () => 'ok');
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

  describe('Unified window machine views', () => {
    function viewEvent(hostDestroyed = false) {
      const mainFrame = { url: 'app://workspaces/?embedded=1' };
      const sender = Object.assign(new EventEmitter(), {
        isDestroyed: () => false,
        getType: () => 'browserView',
        mainFrame,
        session: electronMocks.defaultSession,
      });
      const host = { isDestroyed: () => hostDestroyed, webContents: {} };
      electronMocks.fromWebContents.mockReturnValue(host);
      return { event: { sender, senderFrame: mainFrame } as any, sender, host };
    }

    it('admits a view through its own binding', async () => {
      const { event, sender, host } = viewEvent();
      bindViewToBackend(sender as any, host as any, 'studio');
      const handler = vi.fn(async () => 'ok');
      await expect(createAuthorizedIpcHandler('file:read', handler)(event)).resolves.toBe('ok');
    });

    it('refuses an unbound view even though its window is an app window', async () => {
      const { event } = viewEvent();
      await expect(createAuthorizedIpcHandler('file:read', vi.fn())(event)).rejects.toEqual(
        expect.objectContaining<IpcAuthorizationError>({ reason: 'unexpected sender' }),
      );
    });

    it('refuses a view whose host window has closed', async () => {
      const { event, sender, host } = viewEvent(true);
      bindViewToBackend(sender as any, host as any, 'studio');
      await expect(createAuthorizedIpcHandler('file:read', vi.fn())(event)).rejects.toEqual(
        expect.objectContaining<IpcAuthorizationError>({ reason: 'view host closed' }),
      );
    });
  });
});
