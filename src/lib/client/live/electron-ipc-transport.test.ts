/**
 * Unit tests for the Electron-IPC `BackendTransport` reconnect fan-out.
 *
 * `onReconnected` must register at most ONE underlying `backend:status`
 * listener on the preload bridge and fan out to any number of subscribers,
 * so the IPC listener count no longer scales with subscriber modules
 * (intent-hq/monorepo#1424).
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { IPC_CHANNELS } from "$shared/ipc-registry";
import { createElectronIpcBackendTransport } from "./electron-ipc-transport";

const STATUS = IPC_CHANNELS.BACKEND.STATUS;

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

describe("electron-ipc-transport onReconnected fan-out", () => {
  it("registers a single backend:status listener for many subscribers and fans out", () => {
    const api = installFakeApi();
    const transport = createElectronIpcBackendTransport();

    const handlers = Array.from({ length: 20 }, () => vi.fn());
    const disposers = handlers.map((handler) => transport.onReconnected(handler));

    expect(api.listenerCount(STATUS)).toBe(1);

    api.emit(STATUS, { status: "connected", reconnected: true });
    for (const handler of handlers) expect(handler).toHaveBeenCalledOnce();

    disposers.forEach((dispose) => dispose());
  });

  it("does not fire handlers on non-reconnect payloads", () => {
    const api = installFakeApi();
    const transport = createElectronIpcBackendTransport();
    const handler = vi.fn();
    const dispose = transport.onReconnected(handler);

    api.emit(STATUS, { status: "connected" });
    api.emit(STATUS, { status: "disconnected" });
    api.emit(STATUS, { status: "disconnected", reconnected: true });
    api.emit(STATUS, undefined);
    expect(handler).not.toHaveBeenCalled();

    api.emit(STATUS, { status: "connected", reconnected: true });
    expect(handler).toHaveBeenCalledOnce();
    dispose();
  });

  it("isolates a throwing handler so remaining handlers still run", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const api = installFakeApi();
    const transport = createElectronIpcBackendTransport();

    const first = vi.fn(() => {
      throw new Error("boom");
    });
    const second = vi.fn();
    const disposeFirst = transport.onReconnected(first);
    const disposeSecond = transport.onReconnected(second);

    api.emit(STATUS, { status: "connected", reconnected: true });
    expect(first).toHaveBeenCalledOnce();
    expect(second).toHaveBeenCalledOnce();
    expect(warn).toHaveBeenCalledOnce();

    disposeFirst();
    disposeSecond();
  });

  it("removes individual handlers on dispose and the IPC listener with the last one", () => {
    const api = installFakeApi();
    const transport = createElectronIpcBackendTransport();

    const first = vi.fn();
    const second = vi.fn();
    const disposeFirst = transport.onReconnected(first);
    const disposeSecond = transport.onReconnected(second);

    disposeFirst();
    api.emit(STATUS, { status: "connected", reconnected: true });
    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledOnce();
    expect(api.listenerCount(STATUS)).toBe(1);

    disposeSecond();
    expect(api.listenerCount(STATUS)).toBe(0);

    // Re-subscribing after the last disposal re-registers the shared listener.
    const third = vi.fn();
    const disposeThird = transport.onReconnected(third);
    expect(api.listenerCount(STATUS)).toBe(1);
    api.emit(STATUS, { status: "connected", reconnected: true });
    expect(third).toHaveBeenCalledOnce();
    disposeThird();
    expect(api.listenerCount(STATUS)).toBe(0);
  });

  it("makes disposers idempotent (double-dispose cannot drop a later subscriber)", () => {
    const api = installFakeApi();
    const transport = createElectronIpcBackendTransport();

    const first = vi.fn();
    const dispose = transport.onReconnected(first);
    dispose();

    const second = vi.fn();
    const disposeSecond = transport.onReconnected(second);
    dispose();

    expect(api.listenerCount(STATUS)).toBe(1);
    api.emit(STATUS, { status: "connected", reconnected: true });
    expect(second).toHaveBeenCalledOnce();
    disposeSecond();
  });

  it("returns a no-op disposer when the bridge is unavailable", () => {
    const transport = createElectronIpcBackendTransport();
    const dispose = transport.onReconnected(vi.fn());
    expect(() => dispose()).not.toThrow();
  });
});
