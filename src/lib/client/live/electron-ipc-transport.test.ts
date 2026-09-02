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
    invoke: vi.fn(async () => ({ ok: true, result: undefined })),
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
