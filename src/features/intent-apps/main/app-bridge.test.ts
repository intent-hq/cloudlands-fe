import { describe, expect, it, vi } from 'vitest';
import type { IntentAppSession } from '../../../shared/intent-apps/intent-apps-types';
import {
  AppDisconnectedError,
  AppRpcError,
  BRIDGE_CALLS,
  handleBridgeCall,
  MAX_SHORTCUTS_PER_APP,
  toBridgeError,
  type BridgeContext,
} from './app-bridge';

function context(
  overrides: Partial<IntentAppSession> = {},
  request: BridgeContext['request'] = vi.fn(async () => ({})),
) {
  const session: IntentAppSession = {
    sessionId: 'as_1',
    appId: 'pomodoro-timer',
    bundleHash: 'sha256:a',
    level: 2,
    features: ['models', 'notifications'],
    entry: 'index.html',
    window: {
      width: 960,
      height: 640,
      minWidth: null,
      minHeight: null,
      resizable: true,
      alwaysOnTop: false,
    },
    ...overrides,
  };
  const shortcuts = new Set<string>();
  const ctx: BridgeContext = {
    session,
    info: {
      appId: session.appId,
      name: 'Pomodoro Timer',
      version: '1.0.0',
      bundleHash: session.bundleHash,
      level: session.level,
      features: session.features,
      platform: 'linux',
      bridgeVersion: 1,
    },
    request,
    showNotification: vi.fn(),
    setAlwaysOnTop: vi.fn(),
    close: vi.fn(),
    registerShortcut: vi.fn((accelerator: string) => {
      shortcuts.add(accelerator);
      return true;
    }),
    unregisterShortcut: vi.fn((accelerator: string) => shortcuts.delete(accelerator)),
    unregisterAllShortcuts: vi.fn(() => shortcuts.clear()),
    shortcutCount: () => shortcuts.size,
  };
  return ctx;
}

describe('app bridge — daemon calls on the app connection', () => {
  it('maps every storage call to its app.storage method and result', async () => {
    const request = vi.fn(async (method: string) => {
      if (method === 'app.storage.get') return { found: true, value: { n: 1 } };
      if (method === 'app.storage.set') return { usedBytes: 10 };
      if (method === 'app.storage.delete') return { deleted: true };
      return { keys: ['a'], nextCursor: null };
    });
    const ctx = context({}, request);
    expect(await handleBridgeCall(ctx, 'storage.get', ['k'])).toEqual({
      ok: true,
      result: { n: 1 },
    });
    expect(request).toHaveBeenLastCalledWith('app.storage.get', { key: 'k' });
    expect(await handleBridgeCall(ctx, 'storage.set', ['k', [1, 2]])).toEqual({
      ok: true,
      result: undefined,
    });
    expect(request).toHaveBeenLastCalledWith('app.storage.set', { key: 'k', value: [1, 2] });
    expect(await handleBridgeCall(ctx, 'storage.delete', ['k'])).toEqual({
      ok: true,
      result: true,
    });
    expect(request).toHaveBeenLastCalledWith('app.storage.delete', { key: 'k' });
    await handleBridgeCall(ctx, 'storage.list', [{ prefix: 'a', limit: 5, extra: 1 }]);
    expect(request).toHaveBeenLastCalledWith('app.storage.list', { prefix: 'a', limit: 5 });
  });

  it('resolves storage.get to undefined when the key is not found', async () => {
    const ctx = context(
      {},
      vi.fn(async () => ({ found: false, value: null })),
    );
    expect(await handleBridgeCall(ctx, 'storage.get', ['k'])).toEqual({
      ok: true,
      result: undefined,
    });
  });

  it('shows the OS notification only after app.notify answers', async () => {
    const request = vi.fn(async () => ({ notificationId: 'n1' }));
    const ctx = context({}, request);
    const response = await handleBridgeCall(ctx, 'notifications.show', [
      { title: 'Break', body: 'Stand up', tag: 't' },
    ]);
    expect(request).toHaveBeenCalledWith('app.notify', {
      title: 'Break',
      body: 'Stand up',
      tag: 't',
    });
    expect(response).toEqual({ ok: true, result: { notificationId: 'n1' } });
    expect(ctx.showNotification).toHaveBeenCalledWith({
      title: 'Break',
      body: 'Stand up',
      tag: 't',
    });

    const refused = context(
      {},
      vi.fn(async () => {
        throw new AppRpcError(-32603, 'slow down', { code: 'rate-limited', retryAfterMs: 500 });
      }),
    );
    expect(await handleBridgeCall(refused, 'notifications.show', [{ title: 'x' }])).toEqual({
      ok: false,
      error: { code: 'rate-limited', message: 'slow down', data: { retryAfterMs: 500 } },
    });
    expect(refused.showNotification).not.toHaveBeenCalled();
  });

  it('sends app.complete with the known keys and a transport bound over its timeoutMs', async () => {
    const request = vi.fn(async () => ({
      available: true,
      text: '42',
      provider: 'claude-code',
      model: 'claude-opus-5-5',
    }));
    const ctx = context({}, request);
    const response = await handleBridgeCall(ctx, 'models.complete', [
      { prompt: 'Answer?', model: 'claude-opus-5-5', timeoutMs: 5000, junk: true },
    ]);
    expect(request).toHaveBeenCalledWith(
      'app.complete',
      { prompt: 'Answer?', model: 'claude-opus-5-5', timeoutMs: 5000 },
      20_000,
    );
    expect(response).toEqual({
      ok: true,
      result: { text: '42', provider: 'claude-code', model: 'claude-opus-5-5' },
    });
  });

  it('rejects { available: false } with unavailable and the reason as message', async () => {
    const ctx = context(
      {},
      vi.fn(async () => ({ available: false, reason: 'No provider' })),
    );
    expect(await handleBridgeCall(ctx, 'models.complete', [{ prompt: 'x' }])).toEqual({
      ok: false,
      error: { code: 'unavailable', message: 'No provider' },
    });
  });

  it('does not pre-filter daemon calls: the daemon refuses them', async () => {
    const request = vi.fn(async () => {
      throw new AppRpcError(-32003, 'Forbidden', {
        code: 'forbidden',
        detail: 'feature models not approved',
      });
    });
    const ctx = context({ level: 1, features: [] }, request);
    expect(await handleBridgeCall(ctx, 'models.list', [])).toEqual({
      ok: false,
      error: {
        code: 'forbidden',
        message: 'Forbidden',
        data: { detail: 'feature models not approved' },
      },
    });
    expect(request).toHaveBeenCalledWith('app.models.list', {});
  });
});

describe('app bridge — host-local calls', () => {
  it('answers app.info from the session', async () => {
    const response = await handleBridgeCall(context(), 'app.info', []);
    expect(response).toMatchObject({
      ok: true,
      result: { appId: 'pomodoro-timer', level: 2, bridgeVersion: 1, platform: 'linux' },
    });
  });

  it('checks alwaysOnTop and globalShortcuts against the session features', async () => {
    const ctx = context();
    expect(await handleBridgeCall(ctx, 'window.setAlwaysOnTop', [true])).toMatchObject({
      ok: false,
      error: { code: 'forbidden' },
    });
    expect(await handleBridgeCall(ctx, 'shortcuts.register', ['Ctrl+Shift+P'])).toMatchObject({
      ok: false,
      error: { code: 'forbidden' },
    });
    expect(ctx.setAlwaysOnTop).not.toHaveBeenCalled();

    const granted = context({ features: ['alwaysOnTop', 'globalShortcuts'] });
    expect(await handleBridgeCall(granted, 'window.setAlwaysOnTop', [true])).toEqual({
      ok: true,
      result: undefined,
    });
    expect(granted.setAlwaysOnTop).toHaveBeenCalledWith(true);
    expect(await handleBridgeCall(granted, 'shortcuts.register', ['Ctrl+Shift+P'])).toEqual({
      ok: true,
      result: undefined,
    });
  });

  it('never grants host-local features at level 1', async () => {
    const ctx = context({ level: 1, features: ['alwaysOnTop'] });
    expect(await handleBridgeCall(ctx, 'window.setAlwaysOnTop', [true])).toMatchObject({
      ok: false,
      error: { code: 'forbidden' },
    });
  });

  it('limits shortcuts and reports a taken accelerator as shortcut-unavailable', async () => {
    const ctx = context({ features: ['globalShortcuts'] });
    for (let i = 0; i < MAX_SHORTCUTS_PER_APP; i += 1) {
      await handleBridgeCall(ctx, 'shortcuts.register', [`Ctrl+F${i + 1}`]);
    }
    expect(await handleBridgeCall(ctx, 'shortcuts.register', ['Ctrl+X'])).toMatchObject({
      ok: false,
      error: { code: 'shortcut-unavailable' },
    });
    const taken = context({ features: ['globalShortcuts'] });
    taken.registerShortcut = vi.fn(() => false);
    expect(await handleBridgeCall(taken, 'shortcuts.register', ['Ctrl+X'])).toMatchObject({
      ok: false,
      error: { code: 'shortcut-unavailable' },
    });
  });

  it('closes the window on window.close at any level', async () => {
    const ctx = context({ level: 1, features: [] });
    expect(await handleBridgeCall(ctx, 'window.close', [])).toEqual({
      ok: true,
      result: undefined,
    });
    expect(ctx.close).toHaveBeenCalled();
  });
});

describe('app bridge — names and errors', () => {
  it('maps exactly the contract names', () => {
    expect([...BRIDGE_CALLS].sort()).toEqual(
      [
        'app.info',
        'models.complete',
        'models.list',
        'notifications.show',
        'shortcuts.register',
        'shortcuts.unregister',
        'shortcuts.unregisterAll',
        'storage.delete',
        'storage.get',
        'storage.list',
        'storage.set',
        'window.close',
        'window.setAlwaysOnTop',
      ].sort(),
    );
  });

  it('answers not-supported for any other name, including prototype keys', async () => {
    for (const call of ['agent.start', 'constructor', '__proto__', 42]) {
      expect(await handleBridgeCall(context(), call, [])).toMatchObject({
        ok: false,
        error: { code: 'not-supported' },
      });
    }
  });

  it('maps transport and unknown failures', () => {
    expect(toBridgeError(new AppDisconnectedError())).toMatchObject({ code: 'disconnected' });
    expect(toBridgeError(new AppRpcError(-32601, 'Method not found'))).toMatchObject({
      code: 'not-supported',
    });
    expect(toBridgeError(new AppRpcError(-32602, 'bad', { code: 'invalid-key' }))).toEqual({
      code: 'invalid-key',
      message: 'bad',
    });
    expect(toBridgeError(new Error('boom'))).toEqual({ code: 'internal', message: 'boom' });
  });
});
