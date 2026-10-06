import nativeFixture from '$shared/types/__fixtures__/native-review-v1.json';
import { copyNoteSaveData, parseNoteSaveIdentity } from '$shared/types/note-save-connection';
/**
 * Unit tests for the Electron-IPC `BackendTransport` broadcast fan-outs.
 *
 * `onReconnected` and `onNotification` must each register at most ONE
 * underlying preload-bridge listener (`backend:status`,
 * intent-hq/monorepo#1424; `backend:notification`, intent-hq/monorepo#2034)
 * and fan out to any number of subscribers, so the IPC listener count no
 * longer scales with subscriber modules.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { IPC_CHANNELS } from '$shared/ipc-registry';
import type { BackendNotification } from './backend-transport-types';
import {
  createElectronIpcBackendTransport,
  inspectChannelFanoutSubscribers,
} from './electron-ipc-transport';

const STATUS = IPC_CHANNELS.BACKEND.STATUS;
const NOTIFICATION = IPC_CHANNELS.BACKEND.NOTIFICATION;

/** Minimal preload-bridge fake tracking per-channel listener registrations. */
function createFakeApi() {
  const listeners = new Map<string, Map<string, (payload: unknown) => void>>();
  let counter = 0;
  return {
    invoke: vi.fn(async (_channel: string, _payload: unknown) => ({ ok: true, result: undefined })),
    on(channel: string, callback: (payload: unknown) => void): string {
      const id = `l${++counter}`;
      let channelListeners = listeners.get(channel);
      if (!channelListeners) {
        channelListeners = new Map();
        listeners.set(channel, channelListeners);
      }
      channelListeners.set(id, callback);
      return id;
    },
    offById(channel: string, listenerId: string): void {
      listeners.get(channel)?.delete(listenerId);
    },
    emit(channel: string, payload: unknown): void {
      for (const callback of [...(listeners.get(channel)?.values() ?? [])]) callback(payload);
    },
    listenerCount(channel: string): number {
      return listeners.get(channel)?.size ?? 0;
    },
  };
}

function installFakeApi() {
  const api = createFakeApi();
  (window as unknown as { electronAPI?: unknown }).electronAPI = api;
  return api;
}

afterEach(() => {
  delete (window as unknown as { electronAPI?: unknown }).electronAPI;
  vi.restoreAllMocks();
});

describe('explicit note connection transport', () => {
  const freshTransport = async () => {
    vi.resetModules();
    return (await import('./electron-ipc-transport')).createElectronIpcBackendTransport();
  };
  const channels = IPC_CHANNELS.BACKEND.NOTE_SAVE_CONNECTION;
  const op = {
    scope: { backendId: 'b', workspaceId: 'w', noteId: 'n', noteInstanceId: 'i' },
    operationId: 'o',
    baseRevision: 'r',
    headerDigest: 'a'.repeat(64),
    payloadDigest: 'b'.repeat(64),
    expiresAt: '2099-01-01T00:00:00.000Z',
    viewLength: 59 as const,
  };
  it('refuses absent bridge and DTO getters/overbounds before IPC', async () => {
    await expect((await freshTransport()).captureNoteSaveConnection!(op)).rejects.toThrow();
    const api = installFakeApi(),
      getter = vi.fn(() => op.scope);
    const bad = { ...op };
    Object.defineProperty(bad, 'scope', { get: getter, enumerable: true });
    expect(() => parseNoteSaveIdentity(bad)).toThrow();
    expect(getter).not.toHaveBeenCalled();
    expect(() => copyNoteSaveData({ value: 'x'.repeat(16385) })).toThrow();
    expect(() => parseNoteSaveIdentity({ ...op, principal: 'forged' })).toThrow();
    expect(api.invoke).not.toHaveBeenCalled();
  });
  it.each(['known', 'lost', 'foreign'] as const)(
    'caches only the original %s release acknowledgement',
    async (mode) => {
      const api = installFakeApi();
      api.invoke.mockImplementation(async (channel) => {
        if (channel === channels.CAPTURE) return { ok: true, result: { id: 'slot' } } as any;
        if (mode === 'lost') throw new Error('controlled lost IPC ACK');
        return {
          ok: true,
          result: {
            id: mode === 'foreign' ? 'other' : 'slot',
            operationId: op.operationId,
            released: true,
          },
        } as any;
      });
      const bound = await (await freshTransport()).captureNoteSaveConnection!(op);
      const release = bound.release();
      expect(bound.release()).toBe(release);
      if (mode === 'known') await release;
      else await expect(release).rejects.toThrow();
      expect(bound.current()).toBe(false);
      expect(api.invoke.mock.calls.filter(([c]) => c === channels.RELEASE)).toHaveLength(1);
      expect(api.listenerCount(channels.RETIRED)).toBe(0);
    },
  );
  it('keeps late response DATA and joins held IO before one release', async () => {
    const api = installFakeApi();
    let finish!: (v: any) => void;
    api.invoke.mockImplementation(async (channel) => {
      if (channel === channels.CAPTURE) return { ok: true, result: { id: 'slot' } } as any;
      if (channel === channels.REQUEST)
        return new Promise((resolve) => {
          finish = resolve;
        });
      return {
        ok: true,
        result: { id: 'slot', operationId: op.operationId, released: true },
      } as any;
    });
    const bound = await (await freshTransport()).captureNoteSaveConnection!(op);
    const request = bound.request({ kind: 'commit' });
    await expect(bound.request({ kind: 'commit' })).rejects.toThrow();
    api.emit(channels.RETIRED, { id: 'slot' });
    const release = bound.release();
    await Promise.resolve();
    expect(api.invoke.mock.calls.filter(([c]) => c === channels.RELEASE)).toHaveLength(0);
    finish({
      ok: true,
      result: {
        id: 'slot',
        current: true,
        settlement: { status: 'fulfilled', value: { committed: true } },
      },
    });
    await expect(request).resolves.toMatchObject({
      current: false,
      settlement: { value: { committed: true } },
    });
    await release;
  });
  it('owns a product retired during capture and releases its exact original handle', async () => {
    const api = installFakeApi();
    api.invoke.mockImplementation(async (channel) => {
      if (channel === channels.CAPTURE) {
        api.emit(channels.RETIRED, { id: 'slot' });
        return { ok: true, result: { id: 'slot' } } as any;
      }
      return {
        ok: true,
        result: { id: 'slot', operationId: op.operationId, released: true },
      } as any;
    });
    await expect((await freshTransport()).captureNoteSaveConnection!(op)).rejects.toThrow();
    expect(api.invoke.mock.calls.filter(([c]) => c === channels.RELEASE)).toEqual([
      [channels.RELEASE, { id: 'slot' }],
    ]);
  });
  it('rejects bridge descriptor loss without invoking its getter in the final check', async () => {
    const api = installFakeApi();
    api.invoke.mockImplementation(
      async (channel) =>
        ({
          ok: true,
          result:
            channel === channels.CAPTURE
              ? { id: 'slot' }
              : { id: 'slot', operationId: op.operationId, released: true },
        }) as any,
    );
    const bound = await (await freshTransport()).captureNoteSaveConnection!(op);
    const check = bound.captureCurrent();
    expect(check?.()).toBe(true);
    const get = vi.fn(() => api);
    Object.defineProperty(window, 'electronAPI', { configurable: true, get });
    expect(check?.()).toBe(false);
    expect(get).not.toHaveBeenCalled();
    Object.defineProperty(window, 'electronAPI', {
      configurable: true,
      writable: true,
      value: api,
    });
    expect(bound.current()).toBe(false);
    await bound.release();
  });
  it('does not let a nested capture refresh an outer pure checkpoint', async () => {
    const api = installFakeApi();
    api.invoke.mockImplementation(
      async (channel) =>
        ({
          ok: true,
          result:
            channel === channels.CAPTURE
              ? { id: 'slot' }
              : { id: 'slot', operationId: op.operationId, released: true },
        }) as any,
    );
    const bound = await (await freshTransport()).captureNoteSaveConnection!(op);
    const outer = bound.captureCurrent(),
      inner = bound.captureCurrent();
    expect(inner?.()).toBe(true);
    expect(outer?.()).toBe(false);
    expect(inner?.()).toBe(false);
    await bound.release();
  });
  it('blocks capture reentry before subscription callbacks and retains unknown listener debt', async () => {
    const api = installFakeApi(),
      transport = await freshTransport();
    const on = api.on.bind(api);
    let nested: Promise<unknown> | undefined;
    vi.spyOn(api, 'on').mockImplementation((channel, callback) => {
      on(channel, callback);
      nested = transport.captureNoteSaveConnection!(op).catch((e) => e);
      throw new Error('controlled subscription registered then threw');
    });
    await expect(transport.captureNoteSaveConnection!(op)).rejects.toThrow('registered');
    expect(await nested).toBeInstanceOf(Error);
    await expect(transport.captureNoteSaveConnection!(op)).rejects.toThrow();
    expect(api.on).toHaveBeenCalledOnce();
    expect(api.invoke).not.toHaveBeenCalled();
  });
  it('refuses the actual browser transport without an optional binding or ordinary fallback', async () => {
    delete (window as unknown as { electronAPI?: unknown }).electronAPI;
    vi.stubEnv('VITE_INTENTD_WS_URL', 'ws://localhost:9100/rpc');
    vi.resetModules();
    try {
      const { resolveBackendTransport } = await import('./backend-transport-factory');
      const transport = resolveBackendTransport(),
        send = vi.spyOn(transport, 'request');
      const { captureNoteSaveConnection } = await import('./backend-transport');
      expect(transport.captureNoteSaveConnection).toBeUndefined();
      expect(() => captureNoteSaveConnection(op)).toThrow();
      expect(send).not.toHaveBeenCalled();
    } finally {
      vi.unstubAllEnvs();
    }
  });
});

describe('electron-ipc-transport onReconnected fan-out', () => {
  it('registers a single backend:status listener for many subscribers and fans out', () => {
    const api = installFakeApi();
    const transport = createElectronIpcBackendTransport();

    const handlers = Array.from({ length: 20 }, () => vi.fn());
    const disposers = handlers.map((handler) => transport.onReconnected(handler));

    expect(api.listenerCount(STATUS)).toBe(1);

    api.emit(STATUS, { status: 'connected', reconnected: true });
    for (const handler of handlers) expect(handler).toHaveBeenCalledOnce();

    disposers.forEach((dispose) => dispose());
  });

  it('does not fire handlers on non-reconnect payloads', () => {
    const api = installFakeApi();
    const transport = createElectronIpcBackendTransport();
    const handler = vi.fn();
    const dispose = transport.onReconnected(handler);

    api.emit(STATUS, { status: 'connected' });
    api.emit(STATUS, { status: 'disconnected' });
    api.emit(STATUS, { status: 'disconnected', reconnected: true });
    api.emit(STATUS, undefined);
    expect(handler).not.toHaveBeenCalled();

    api.emit(STATUS, { status: 'connected', reconnected: true });
    expect(handler).toHaveBeenCalledOnce();
    dispose();
  });

  it('isolates a throwing handler so remaining handlers still run', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const api = installFakeApi();
    const transport = createElectronIpcBackendTransport();

    const first = vi.fn(() => {
      throw new Error('boom');
    });
    const second = vi.fn();
    const disposeFirst = transport.onReconnected(first);
    const disposeSecond = transport.onReconnected(second);

    api.emit(STATUS, { status: 'connected', reconnected: true });
    expect(first).toHaveBeenCalledOnce();
    expect(second).toHaveBeenCalledOnce();
    expect(warn).toHaveBeenCalledOnce();

    disposeFirst();
    disposeSecond();
  });

  it('removes individual handlers on dispose and the IPC listener with the last one', () => {
    const api = installFakeApi();
    const transport = createElectronIpcBackendTransport();

    const first = vi.fn();
    const second = vi.fn();
    const disposeFirst = transport.onReconnected(first);
    const disposeSecond = transport.onReconnected(second);

    disposeFirst();
    api.emit(STATUS, { status: 'connected', reconnected: true });
    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledOnce();
    expect(api.listenerCount(STATUS)).toBe(1);

    disposeSecond();
    expect(api.listenerCount(STATUS)).toBe(0);

    // Re-subscribing after the last disposal re-registers the shared listener.
    const third = vi.fn();
    const disposeThird = transport.onReconnected(third);
    expect(api.listenerCount(STATUS)).toBe(1);
    api.emit(STATUS, { status: 'connected', reconnected: true });
    expect(third).toHaveBeenCalledOnce();
    disposeThird();
    expect(api.listenerCount(STATUS)).toBe(0);
  });

  it('keeps duplicate subscriptions of the same handler independent', () => {
    const api = installFakeApi();
    const transport = createElectronIpcBackendTransport();

    const handler = vi.fn();
    const disposeFirst = transport.onReconnected(handler);
    const disposeSecond = transport.onReconnected(handler);

    api.emit(STATUS, { status: 'connected', reconnected: true });
    expect(handler).toHaveBeenCalledTimes(2);

    disposeFirst();
    api.emit(STATUS, { status: 'connected', reconnected: true });
    expect(handler).toHaveBeenCalledTimes(3);
    expect(api.listenerCount(STATUS)).toBe(1);

    disposeSecond();
    expect(api.listenerCount(STATUS)).toBe(0);
  });

  it('makes disposers idempotent (double-dispose cannot drop a later subscriber)', () => {
    const api = installFakeApi();
    const transport = createElectronIpcBackendTransport();

    const first = vi.fn();
    const dispose = transport.onReconnected(first);
    dispose();

    const second = vi.fn();
    const disposeSecond = transport.onReconnected(second);
    dispose();

    expect(api.listenerCount(STATUS)).toBe(1);
    api.emit(STATUS, { status: 'connected', reconnected: true });
    expect(second).toHaveBeenCalledOnce();
    disposeSecond();
  });

  it('returns a no-op disposer when the bridge is unavailable', () => {
    const transport = createElectronIpcBackendTransport();
    const dispose = transport.onReconnected(vi.fn());
    expect(() => dispose()).not.toThrow();
  });
});

describe('electron-ipc-transport onNotification fan-out', () => {
  const notification = (method: string): BackendNotification => ({ method, params: { method } });

  it('registers a single backend:notification listener for many subscribers and fans out', () => {
    const api = installFakeApi();
    const transport = createElectronIpcBackendTransport();

    // The renderer has ~11 modules subscribing at boot; one listener each used
    // to breach ipcRenderer's default cap of 10 (intent-hq/monorepo#2034).
    const handlers = Array.from({ length: 20 }, () => vi.fn());
    const disposers = handlers.map((handler) => transport.onNotification(handler));

    expect(api.listenerCount(NOTIFICATION)).toBe(1);

    const event = notification('events.event');
    api.emit(NOTIFICATION, event);
    for (const handler of handlers) expect(handler).toHaveBeenCalledExactlyOnceWith(event);

    disposers.forEach((dispose) => dispose());
    expect(api.listenerCount(NOTIFICATION)).toBe(0);
  });

  it('isolates a throwing handler so remaining handlers still run', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const api = installFakeApi();
    const transport = createElectronIpcBackendTransport();

    const first = vi.fn(() => {
      throw new Error('boom');
    });
    const second = vi.fn();
    const disposeFirst = transport.onNotification(first);
    const disposeSecond = transport.onNotification(second);

    api.emit(NOTIFICATION, notification('events.event'));
    expect(first).toHaveBeenCalledOnce();
    expect(second).toHaveBeenCalledOnce();
    expect(warn).toHaveBeenCalledOnce();

    disposeFirst();
    disposeSecond();
  });

  it('removes individual handlers on dispose and the IPC listener with the last one', () => {
    const api = installFakeApi();
    const transport = createElectronIpcBackendTransport();

    const first = vi.fn();
    const second = vi.fn();
    const disposeFirst = transport.onNotification(first);
    const disposeSecond = transport.onNotification(second);

    disposeFirst();
    api.emit(NOTIFICATION, notification('events.event'));
    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledOnce();
    expect(api.listenerCount(NOTIFICATION)).toBe(1);

    disposeSecond();
    expect(api.listenerCount(NOTIFICATION)).toBe(0);

    // Re-subscribing after the last disposal re-registers the shared listener.
    const third = vi.fn();
    const disposeThird = transport.onNotification(third);
    expect(api.listenerCount(NOTIFICATION)).toBe(1);
    api.emit(NOTIFICATION, notification('events.event'));
    expect(third).toHaveBeenCalledOnce();
    disposeThird();
    expect(api.listenerCount(NOTIFICATION)).toBe(0);
  });

  it('keeps duplicate subscriptions of the same handler independent', () => {
    const api = installFakeApi();
    const transport = createElectronIpcBackendTransport();

    const handler = vi.fn();
    const disposeFirst = transport.onNotification(handler);
    const disposeSecond = transport.onNotification(handler);

    api.emit(NOTIFICATION, notification('events.event'));
    expect(handler).toHaveBeenCalledTimes(2);

    // Double-dispose of one duplicate must not drop the other subscription.
    disposeFirst();
    disposeFirst();
    api.emit(NOTIFICATION, notification('events.event'));
    expect(handler).toHaveBeenCalledTimes(3);
    expect(api.listenerCount(NOTIFICATION)).toBe(1);

    disposeSecond();
    expect(api.listenerCount(NOTIFICATION)).toBe(0);
  });

  it('makes disposers idempotent (double-dispose cannot drop a later subscriber)', () => {
    const api = installFakeApi();
    const transport = createElectronIpcBackendTransport();

    const first = vi.fn();
    const dispose = transport.onNotification(first);
    dispose();

    const second = vi.fn();
    const disposeSecond = transport.onNotification(second);
    dispose();

    expect(api.listenerCount(NOTIFICATION)).toBe(1);
    api.emit(NOTIFICATION, notification('events.event'));
    expect(second).toHaveBeenCalledOnce();
    disposeSecond();
  });

  it('returns a no-op disposer when the bridge is unavailable', () => {
    const transport = createElectronIpcBackendTransport();
    const dispose = transport.onNotification(vi.fn());
    expect(() => dispose()).not.toThrow();
  });
});

describe('electron-ipc-transport listener counts across mount/unmount cycles', () => {
  it('returns every backend:* channel to baseline after repeated subscribe/dispose', () => {
    const api = installFakeApi();
    const transport = createElectronIpcBackendTransport();

    for (let cycle = 0; cycle < 25; cycle += 1) {
      // Mount: the boot-time subscriber set (11 notification consumers plus
      // the reconnect subscribers) re-registers on every window reload.
      const disposers = [
        ...Array.from({ length: 11 }, () => transport.onNotification(vi.fn())),
        ...Array.from({ length: 5 }, () => transport.onReconnected(vi.fn())),
      ];

      // Never more than one bridge listener per channel, in any cycle.
      expect(api.listenerCount(NOTIFICATION)).toBe(1);
      expect(api.listenerCount(STATUS)).toBe(1);

      // Unmount.
      disposers.forEach((dispose) => dispose());
      expect(api.listenerCount(NOTIFICATION)).toBe(0);
      expect(api.listenerCount(STATUS)).toBe(0);
    }
  });
});

describe('inspectChannelFanoutSubscribers', () => {
  it('rises and falls with subscribe/dispose, per channel', () => {
    installFakeApi();
    const transport = createElectronIpcBackendTransport();

    expect(inspectChannelFanoutSubscribers()).toEqual({});

    const notificationDisposers = Array.from({ length: 11 }, () =>
      transport.onNotification(vi.fn()),
    );
    const statusDisposers = Array.from({ length: 5 }, () => transport.onReconnected(vi.fn()));

    expect(inspectChannelFanoutSubscribers()).toEqual({
      [NOTIFICATION]: 11,
      [STATUS]: 5,
    });
    // Sorted by channel, so the fingerprint's per-channel fields keep a stable
    // order between samples.
    expect(Object.keys(inspectChannelFanoutSubscribers())).toEqual([NOTIFICATION, STATUS].sort());

    notificationDisposers.pop()?.();
    statusDisposers.pop()?.();
    expect(inspectChannelFanoutSubscribers()).toEqual({
      [NOTIFICATION]: 10,
      [STATUS]: 4,
    });

    // The last disposer for a channel drops it from the report entirely; the
    // aggregate the fingerprint emits reads that as 0.
    notificationDisposers.forEach((dispose) => dispose());
    expect(inspectChannelFanoutSubscribers()).toEqual({ [STATUS]: 4 });

    statusDisposers.forEach((dispose) => dispose());
    expect(inspectChannelFanoutSubscribers()).toEqual({});
  });

  it('sees accumulation that the IPC listener count cannot', () => {
    // The point of the whole exercise: after the fan-out, undisposed
    // subscribers pile up inside the handler Set while the bridge listener
    // count sits at 1 (intent-hq/monorepo#2034). The IPC number is a tripwire,
    // this one is the gauge.
    const api = installFakeApi();
    const transport = createElectronIpcBackendTransport();

    const leaked = Array.from({ length: 40 }, () => transport.onNotification(vi.fn()));

    expect(api.listenerCount(NOTIFICATION)).toBe(1);
    expect(inspectChannelFanoutSubscribers()[NOTIFICATION]).toBe(40);

    leaked.forEach((dispose) => dispose());
  });

  it('counts duplicate subscriptions of one handler separately, and ignores double-dispose', () => {
    installFakeApi();
    const transport = createElectronIpcBackendTransport();

    const handler = vi.fn();
    const first = transport.onNotification(handler);
    const second = transport.onNotification(handler);
    expect(inspectChannelFanoutSubscribers()[NOTIFICATION]).toBe(2);

    first();
    first();
    expect(inspectChannelFanoutSubscribers()[NOTIFICATION]).toBe(1);

    second();
    expect(inspectChannelFanoutSubscribers()).toEqual({});
  });

  it('sums subscribers across transports and reports nothing when the bridge is absent', () => {
    installFakeApi();
    const first = createElectronIpcBackendTransport();
    const second = createElectronIpcBackendTransport();

    const disposers = [first.onNotification(vi.fn()), second.onNotification(vi.fn())];
    expect(inspectChannelFanoutSubscribers()[NOTIFICATION]).toBe(2);
    disposers.forEach((dispose) => dispose());

    // No bridge (web/mock builds): `onNotification` returns a no-op disposer
    // without ever reaching the fan-out, so nothing is registered.
    delete (window as unknown as { electronAPI?: unknown }).electronAPI;
    const unavailable = createElectronIpcBackendTransport();
    unavailable.onNotification(vi.fn());
    expect(inspectChannelFanoutSubscribers()).toEqual({});
  });
});

describe('electron-ipc-transport param serialization (structured clone)', () => {
  /**
   * `ipcRenderer.invoke` structured-clones its arguments, and Svelte 5
   * `$state` values reach the transport as Proxy objects, which structured
   * clone rejects with "An object could not be cloned". The fake enforces the
   * same boundary so the regression (proxied `settings.update` params from
   * the listen-target selector) fails without the transport's JSON pass.
   */
  function installCloningApi() {
    const api = installFakeApi();
    const received: unknown[] = [];
    api.invoke.mockImplementation(async (_channel: string, payload: unknown) => {
      received.push(structuredClone(payload));
      return { ok: true, result: undefined };
    });
    return { api, received };
  }

  /** Stand-in for a Svelte `$state` proxy: structuredClone throws on it. */
  const proxied = <T extends object>(value: T): T => new Proxy(value, {});

  it('request(): proxied params survive the IPC structured-clone boundary as plain JSON', async () => {
    const { received } = installCloningApi();
    const transport = createElectronIpcBackendTransport();

    const params = proxied([
      { path: 'server.bindAddress', value: proxied(['192.168.1.2']) },
      { path: 'server.tunnel.enabled', value: true },
      { path: 'server.tunnel.only', value: false },
    ]);
    expect(() => structuredClone(params)).toThrow(); // the regression precondition

    await transport.request('settings.update', params);

    expect(received).toEqual([
      {
        method: 'settings.update',
        params: [
          { path: 'server.bindAddress', value: ['192.168.1.2'] },
          { path: 'server.tunnel.enabled', value: true },
          { path: 'server.tunnel.only', value: false },
        ],
      },
    ]);
  });

  it('request(): omitted params stay undefined', async () => {
    const { received } = installCloningApi();
    const transport = createElectronIpcBackendTransport();

    await transport.request('system.status');

    expect(received).toEqual([{ method: 'system.status', params: undefined }]);
  });

  it('subscribe(): proxied params survive the IPC structured-clone boundary', async () => {
    const { received } = installCloningApi();
    const transport = createElectronIpcBackendTransport();

    await transport.subscribe(proxied({ events: proxied(['task:*']) }));

    expect(received).toEqual([{ events: ['task:*'] }]);
  });
});

it('carries workspace context through Electron subscription cleanup and preserves direct omission', async () => {
  const api = installFakeApi();
  const transport = createElectronIpcBackendTransport();
  await transport.unsubscribe('sub-a', 'workspace-a');
  await transport.unsubscribe('direct');
  expect(api.invoke.mock.calls).toEqual([
    [IPC_CHANNELS.BACKEND.UNSUBSCRIBE, { subscriptionId: 'sub-a', workspaceId: 'workspace-a' }],
    [IPC_CHANNELS.BACKEND.UNSUBSCRIBE, { subscriptionId: 'direct' }],
  ]);
});

describe('captured repository transport', () => {
  const root = { workspaceId: 'same', kind: 'primary' as const };
  it('holds the original bridge and root across queue waits and never uses ordinary request', async () => {
    const api = installFakeApi();
    const payload = { root: { ...root } };
    api.invoke.mockResolvedValueOnce({ ok: true, result: { id: 'opaque' } } as never);
    const route = await createElectronIpcBackendTransport().captureRepositoryRoute!(payload.root);
    payload.root.workspaceId = 'changed';
    api.invoke.mockResolvedValueOnce({
      ok: true,
      result: {
        operationId: 'operation',
        current: true,
        settlement: { status: 'fulfilled', value: { branch: 'main' } },
      },
    } as never);
    expect(await route.request('git.status', { workspaceId: 'same' })).toMatchObject({
      current: true,
      settlement: { value: { branch: 'main' } },
    });
    expect(api.invoke.mock.calls).toEqual([
      [IPC_CHANNELS.BACKEND.REPOSITORY.CAPTURE, { root }],
      [
        IPC_CHANNELS.BACKEND.REPOSITORY.REQUEST,
        { id: 'opaque', root, method: 'git.status', params: { workspaceId: 'same' } },
      ],
    ]);
    installFakeApi();
    await expect(route.request('git.status', { workspaceId: 'same' })).rejects.toMatchObject({
      code: 'REPOSITORY_ROUTE_UNAVAILABLE',
    });
    await route.release();
    expect(api.invoke).toHaveBeenLastCalledWith(IPC_CHANNELS.BACKEND.REPOSITORY.RELEASE, {
      id: 'opaque',
      root,
    });
  });
  it('retains an old fulfilled/failed operation while suppressing current application after bridge replacement', async () => {
    const api = installFakeApi();
    api.invoke.mockResolvedValueOnce({ ok: true, result: { id: 'opaque' } } as never);
    const route = await createElectronIpcBackendTransport().captureRepositoryRoute!(root);
    let finish!: (result: any) => void;
    api.invoke.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    const pending = route.request('git.status', { workspaceId: 'same' });
    installFakeApi();
    const value = {
      success: false,
      steps: [{ step: 'commit', success: true }],
      error: 'push failed',
    };
    finish({
      ok: true,
      result: { operationId: 'old', current: true, settlement: { status: 'fulfilled', value } },
    });
    expect(await pending).toEqual({
      operationId: 'old',
      current: false,
      settlement: { status: 'fulfilled', value },
    });
    await route.release();
  });
  it('rejects overrides/released handles and passes uncertain settlement without success fallback', async () => {
    const api = installFakeApi();
    api.invoke.mockResolvedValueOnce({ ok: true, result: { id: 'opaque' } } as never);
    const route = await createElectronIpcBackendTransport().captureRepositoryRoute!(root);
    await expect(
      route.request('git.status', { workspaceId: 'same' }, { localMachine: true } as never),
    ).rejects.toMatchObject({ code: 'REPOSITORY_ROUTE_UNAVAILABLE' });
    const uncertain = {
      operationId: 'old',
      current: false,
      settlement: {
        status: 'rejected',
        error: { code: 'TRANSPORT_ERROR', message: 'Lost socket' },
      },
    };
    api.invoke.mockResolvedValueOnce({ ok: true, result: uncertain } as never);
    expect(await route.request('git.status', { workspaceId: 'same' })).toEqual(uncertain);
    await route.release();
    await route.release();
    await expect(route.request('git.status', { workspaceId: 'same' })).rejects.toThrow();
    expect(api.invoke).toHaveBeenCalledTimes(3);
  });
  it('does not fall back when the authoritative feed is unavailable', async () => {
    const api = installFakeApi();
    api.invoke.mockResolvedValueOnce({
      ok: false,
      error: { code: 'REPOSITORY_ROUTE_UNAVAILABLE', message: 'Unavailable' },
    } as never);
    await expect(
      createElectronIpcBackendTransport().captureRepositoryRoute!(root),
    ).rejects.toMatchObject({ code: 'REPOSITORY_ROUTE_UNAVAILABLE' });
    expect(api.invoke).toHaveBeenCalledTimes(1);
  });
  it('releases the old main capture if the bridge changes while capture awaits', async () => {
    const api = installFakeApi();
    let finish!: (value: any) => void;
    api.invoke.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    const pending = createElectronIpcBackendTransport().captureRepositoryRoute!(root);
    installFakeApi();
    finish({ ok: true, result: { id: 'old' } });
    await expect(pending).rejects.toMatchObject({ code: 'REPOSITORY_ROUTE_UNAVAILABLE' });
    expect(api.invoke).toHaveBeenLastCalledWith(IPC_CHANNELS.BACKEND.REPOSITORY.RELEASE, {
      id: 'old',
      root,
    });
  });
});

describe('owner-frame repository retirement events', () => {
  const channels = IPC_CHANNELS.BACKEND.REPOSITORY;
  const root = { workspaceId: 'same', kind: 'primary' as const };
  it('subscribes before acquisition and disposes a response retired during the await', async () => {
    const api = installFakeApi();
    api.invoke.mockImplementationOnce(async () => {
      expect(api.listenerCount(channels.RETIRED)).toBe(1);
      api.emit(channels.RETIRED, { id: 'retired-before-reply' });
      return { ok: true, result: { id: 'retired-before-reply' } } as never;
    });
    await expect(
      createElectronIpcBackendTransport().captureRepositoryRoute!(root),
    ).rejects.toMatchObject({ code: 'REPOSITORY_ROUTE_UNAVAILABLE' });
    expect(api.listenerCount(channels.RETIRED)).toBe(0);
    expect(api.invoke).toHaveBeenLastCalledWith(channels.RELEASE, {
      id: 'retired-before-reply',
      root,
    });
  });
  it('retirement is correlated to one route and cleans its subscription on release', async () => {
    const api = installFakeApi();
    api.invoke.mockResolvedValueOnce({ ok: true, result: { id: 'one' } } as never);
    const route = await createElectronIpcBackendTransport().captureRepositoryRoute!(root);
    const retired = vi.fn();
    route.onRetired(retired);
    api.emit(channels.RETIRED, { id: 'another' });
    expect(retired).not.toHaveBeenCalled();
    api.emit(channels.RETIRED, { id: 'one' });
    api.emit(channels.RETIRED, { id: 'one' });
    expect(retired).toHaveBeenCalledOnce();
    await expect(
      route.request('workspace.repositoryContext', { workspaceId: 'same' }),
    ).rejects.toThrow();
    await route.release();
    expect(api.listenerCount(channels.RETIRED)).toBe(0);
  });
  it('retains the original settlement but marks it ineligible after an in-flight retirement', async () => {
    const api = installFakeApi();
    api.invoke.mockResolvedValueOnce({ ok: true, result: { id: 'one' } } as never);
    const route = await createElectronIpcBackendTransport().captureRepositoryRoute!(root);
    api.invoke.mockImplementationOnce(async () => {
      api.emit(channels.RETIRED, { id: 'one' });
      return {
        ok: true,
        result: {
          operationId: 'original',
          current: true,
          settlement: { status: 'fulfilled', value: { ownReceipt: true } },
        },
      } as never;
    });
    expect(await route.request('workspace.repositoryContext', { workspaceId: 'same' })).toEqual({
      operationId: 'original',
      current: false,
      settlement: { status: 'fulfilled', value: { ownReceipt: true } },
    });
    await route.release();
  });
});

describe('selection session over the actual renderer IPC transport', () => {
  const channels = IPC_CHANNELS.BACKEND.REPOSITORY_SELECTION;
  const root = { workspaceId: 'ws', kind: 'primary' as const };
  const preview = {
    root,
    scope: { daemonId: 'A', authorityScopeId: 'server', authorityGeneration: '1' },
    snapshot: {
      root,
      rootIncarnation: '1',
      selectionRevision: '0',
      selection: { kind: 'neverSaved' },
    },
    expiresAfterMs: 300000,
  };
  const observation = {
    current: false,
    uncertain: false,
    attempt: {
      status: 'settled',
      receipt: {
        result: { kind: 'failed', code: 'admission-retired' },
        persistence: { kind: 'committed', selectionRevision: '1' },
      },
    },
  };
  it('retains failed plus committed through normal retirement and reconciles only its original handle', async () => {
    const api = installFakeApi();
    api.invoke.mockImplementation(
      async (channel) =>
        ({
          ok: true,
          result: channel === channels.CAPTURE ? { id: 'local-route', preview } : observation,
        }) as never,
    );
    const session = await createElectronIpcBackendTransport().captureRepositorySelection!(root);
    const retired = vi.fn();
    session.onRetired(retired);
    api.emit(channels.RETIRED, { id: 'local-route', kind: 'admission' });
    expect(retired).toHaveBeenCalledWith('admission');
    const result = await session.reconcile();
    expect(result).toEqual(observation);
    expect(api.invoke).toHaveBeenLastCalledWith(channels.RECONCILE, { id: 'local-route', root });
    await session.release();
    expect(api.listenerCount(channels.RETIRED)).toBe(0);
  });
  it('owns the original bridge, rejects changed claim, and does not repeat a confirmation', async () => {
    const api = installFakeApi();
    api.invoke.mockImplementation(
      async (channel) =>
        ({
          ok: true,
          result: channel === channels.CAPTURE ? { id: 'route', preview } : observation,
        }) as never,
    );
    const session = await createElectronIpcBackendTransport().captureRepositorySelection!(root);
    await session.confirm({ kind: 'reset' });
    await session.confirm({ kind: 'reset' });
    expect(api.invoke.mock.calls.filter(([name]) => name === channels.CONFIRM)).toHaveLength(1);
    await expect(
      session.confirm({ kind: 'save', choice: { mode: 'automatic' } }),
    ).rejects.toThrow();
    installFakeApi();
    await expect(session.reconcile()).rejects.toThrow();
    await session.release();
    expect(api.invoke).toHaveBeenLastCalledWith(channels.RELEASE, { id: 'route', root });
  });
  it('never marks a cached original attempt current after retirement or bridge replacement', async () => {
    const api = installFakeApi();
    api.invoke.mockImplementation(
      async (channel) =>
        ({
          ok: true,
          result:
            channel === channels.CAPTURE
              ? { id: 'route', preview }
              : {
                  current: true,
                  attempt: { status: 'pending' },
                  uncertain: false,
                },
        }) as never,
    );
    const session = await createElectronIpcBackendTransport().captureRepositorySelection!(root);
    expect((await session.confirm({ kind: 'reset' })).current).toBe(true);
    api.emit(channels.RETIRED, { id: 'route', kind: 'admission' });
    expect(await session.confirm({ kind: 'reset' })).toEqual({
      current: false,
      attempt: { status: 'pending' },
      uncertain: false,
    });
    installFakeApi();
    expect((await session.confirm({ kind: 'reset' })).current).toBe(false);
    expect(api.invoke.mock.calls.filter(([name]) => name === channels.CONFIRM)).toHaveLength(1);
    await session.release();
  });
  it('disposes a known original local reference when capture metadata is malformed', async () => {
    const api = installFakeApi();
    api.invoke.mockImplementation(
      async (channel) =>
        ({
          ok: true,
          result: channel === channels.CAPTURE ? { id: 'route', preview: {} } : { released: true },
        }) as never,
    );
    await expect(
      createElectronIpcBackendTransport().captureRepositorySelection!(root),
    ).rejects.toThrow();
    expect(api.invoke).toHaveBeenLastCalledWith(channels.RELEASE, { id: 'route', root });
    expect(api.listenerCount(channels.RETIRED)).toBe(0);
  });
  it('reconciles a retirement during capture before publishing an editing session', async () => {
    const api = installFakeApi();
    api.invoke.mockImplementation(async (channel) => {
      if (channel === channels.CAPTURE) {
        api.emit(channels.RETIRED, { id: 'route', kind: 'admission' });
        return { ok: true, result: { id: 'route', preview } } as never;
      }
      return { ok: true, result: { released: true } } as never;
    });
    await expect(
      createElectronIpcBackendTransport().captureRepositorySelection!(root),
    ).rejects.toThrow();
    expect(api.listenerCount(channels.RETIRED)).toBe(0);
  });
});

describe('native review original renderer bridge', () => {
  const channels = IPC_CHANNELS.BACKEND.NATIVE_REVIEW;
  const root = { workspaceId: 'ws', kind: 'primary' as const };
  const input = {
    workspaceId: root.workspaceId,
    action: 'create-pr' as const,
    review: { root, choice: { kind: 'saved' as const } },
  };
  const preview = {
    ...nativeFixture.prepare,
    reviewPreparation: { ...nativeFixture.prepare.reviewPreparation, root },
    root,
    expiresAfterMs: 300000,
  };
  it.each([
    ['execute', true],
    ['execute', false],
    ['reconciliation', true],
    ['reconciliation', false],
  ] as const)(
    'preserves %s uncertainty %s when later reconciliation fails',
    async (source, uncertain) => {
      const api = installFakeApi();
      const reviewExecution = {
        ...nativeFixture.execute.reviewExecution,
        outcome: uncertain
          ? { status: 'uncertain', stage: 'create-pr', message: 'Original response lost' }
          : nativeFixture.execute.reviewExecution.outcome,
      };
      const original = {
        current: false,
        uncertain,
        execute:
          source === 'execute'
            ? {
                ...nativeFixture.execute,
                operationId: 'native',
                root,
                state: 'settled',
                reviewExecution,
              }
            : null,
        reconciliation:
          source === 'reconciliation'
            ? { operationId: 'native', root, state: 'settled', reviewExecution }
            : null,
      };
      api.invoke
        .mockResolvedValueOnce({ ok: true, result: { id: 'native', preview } } as never)
        .mockResolvedValueOnce({ ok: true, result: original } as never)
        .mockRejectedValueOnce(new Error('Receipt retrieval failed'))
        .mockResolvedValue({ ok: true, result: { released: true } } as never);
      const session = await createElectronIpcBackendTransport().prepareNativeReview!(input);
      expect(await (source === 'execute' ? session.confirm({}) : session.reconcile())).toEqual(
        original,
      );
      api.emit(channels.RETIRED, { id: 'native', kind: 'admission' });
      expect(await session.reconcile()).toEqual(original);
      expect(api.invoke.mock.calls.filter(([name]) => name === channels.EXECUTE)).toHaveLength(
        source === 'execute' ? 1 : 0,
      );
      await session.release();
    },
  );
  it('reserves one text command and preserves uncertainty without fake execution data', async () => {
    const api = installFakeApi();
    api.invoke.mockImplementation(
      async (channel) =>
        ({
          ok: true,
          result:
            channel === channels.PREPARE
              ? { id: 'native', preview }
              : { current: false, uncertain: true, execute: null, reconciliation: null },
        }) as never,
    );
    const session = await createElectronIpcBackendTransport().prepareNativeReview!(input);
    const first = session.confirm({ prTitle: 'T' });
    expect(session.confirm({ prTitle: 'T' })).toBe(first);
    await expect(session.confirm({ prTitle: 'other' })).rejects.toThrow();
    expect(await first).toEqual({
      current: false,
      uncertain: true,
      execute: null,
      reconciliation: null,
    });
    expect(api.invoke.mock.calls.filter(([name]) => name === channels.EXECUTE)).toHaveLength(1);
    expect(api.invoke).toHaveBeenCalledWith(channels.EXECUTE, {
      id: 'native',
      root,
      command: { prTitle: 'T' },
    });
    installFakeApi();
    await expect(session.reconcile()).rejects.toThrow();
    await session.release();
    expect(api.invoke).toHaveBeenLastCalledWith(channels.RELEASE, { id: 'native', root });
  });
  it('retains retirement during preparation and releases malformed known references', async () => {
    const api = installFakeApi();
    api.invoke.mockImplementation(async (channel) => {
      if (channel === channels.PREPARE) {
        api.emit(channels.RETIRED, { id: 'native', kind: 'closed' });
        return { ok: true, result: { id: 'native', preview } } as never;
      }
      return { ok: true, result: { released: true } } as never;
    });
    await expect(createElectronIpcBackendTransport().prepareNativeReview!(input)).rejects.toThrow();
    expect(api.listenerCount(channels.RETIRED)).toBe(0);
    expect(api.invoke).toHaveBeenLastCalledWith(channels.RELEASE, { id: 'native', root });
  });
  it('reserves dispatch before synchronous IPC reentrancy and releases without waiting for execution', async () => {
    const api = installFakeApi();
    let nested: Promise<unknown> | undefined;
    let complete!: (value: unknown) => void;
    api.invoke.mockImplementation((channel) => {
      if (channel === channels.PREPARE)
        return Promise.resolve({ ok: true, result: { id: 'native', preview } }) as never;
      if (channel === channels.EXECUTE) {
        nested = session.reconcile().catch((error) => error);
        return new Promise((resolve) => {
          complete = resolve as never;
        }) as never;
      }
      return Promise.resolve({ ok: true, result: { released: true } }) as never;
    });
    const session = await createElectronIpcBackendTransport().prepareNativeReview!(input);
    const run = session.confirm({ prTitle: 'T' });
    expect(await nested).toBeInstanceOf(Error);
    expect(api.invoke.mock.calls.filter(([name]) => name === channels.RECONCILE)).toHaveLength(0);
    await session.release();
    expect(api.invoke).toHaveBeenLastCalledWith(channels.RELEASE, { id: 'native', root });
    complete({
      ok: true,
      result: { current: true, uncertain: true, execute: null, reconciliation: null },
    });
    expect(await run).toMatchObject({ current: false, uncertain: true });
  });
  it('prepares one child through the original bridge and never exposes daemon correlations', async () => {
    const api = installFakeApi();
    api.invoke
      .mockResolvedValueOnce({ ok: true, result: { id: 'parent', preview } } as never)
      .mockResolvedValueOnce({ ok: true, result: { id: 'child', preview } } as never)
      .mockResolvedValue({ ok: true, result: { released: true } } as never);
    const marked = {
      ...input,
      action: 'commit' as const,
      review: { ...input.review, targetBranch: 'trunk', companion: { kind: 'create-pr' as const } },
    };
    const parent = await createElectronIpcBackendTransport().prepareNativeReview!(marked);
    api.emit(channels.RETIRED, { id: 'parent', kind: 'admission' });
    const first = parent.prepareCompanion!();
    expect(parent.prepareCompanion!()).toBe(first);
    const child = await first;
    expect(child.prepareCompanion).toBeUndefined();
    expect(api.invoke.mock.calls.filter(([name]) => name === channels.PREPARE)).toEqual([
      [channels.PREPARE, { input: marked }],
      [channels.PREPARE, { companionOf: 'parent', root }],
    ]);
    installFakeApi();
    await parent.release();
    await vi.waitFor(() =>
      expect(api.invoke).toHaveBeenCalledWith(channels.RELEASE, { id: 'child', root }),
    );
    expect(api.listenerCount(channels.RETIRED)).toBe(0);
  });
  it('retains a child capture refusal instead of recapturing through a changed bridge', async () => {
    const api = installFakeApi();
    api.invoke
      .mockResolvedValueOnce({ ok: true, result: { id: 'parent', preview } } as never)
      .mockRejectedValueOnce(new Error('original refused'));
    const parent = await createElectronIpcBackendTransport().prepareNativeReview!({
      ...input,
      action: 'commit',
      review: { ...input.review, targetBranch: 'trunk', companion: { kind: 'create-pr' } },
    });
    const failed = parent.prepareCompanion!();
    await expect(failed).rejects.toThrow();
    const replacement = installFakeApi();
    expect(parent.prepareCompanion!()).toBe(failed);
    await expect(parent.prepareCompanion!()).rejects.toThrow();
    expect(replacement.invoke).not.toHaveBeenCalled();
    expect(api.invoke.mock.calls.filter(([name]) => name === channels.PREPARE)).toHaveLength(2);
    api.invoke.mockResolvedValue({ ok: true, result: { released: true } } as never);
    await parent.release();
  });
});
