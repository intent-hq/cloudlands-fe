/**
 * T8/T9 — switch robustness: boot reconciliation + stable forwarders.
 *
 * Switching-correctness gaps closed here:
 *   - **Boot reconciliation** (T8): the live client is always built from the
 *     local/env default at startup, but the connections store may persist a
 *     remote `activeId` from a prior session. `reconcileActiveConnectionOnBoot`
 *     resets a stale remote active-id to `local` so `connections:list` agrees
 *     with the live (local) transport.
 *   - **Reconnect forwarder** (T8): main-process services attach reconnect
 *     handlers ONCE via `onBackendReconnected`. Those handlers must survive a
 *     `switchBackend` (which disposes the old client and builds a new one) and
 *     still fire on a post-switch reconnect, replaying subscriptions against the
 *     NEW client.
 *   - **Notification / status forwarders** (T9): services attach their daemon
 *     `notification` (and connect-retry `status`) listeners ONCE via
 *     `onBackendNotification` / `onBackendStatus`. A notification/status event
 *     on the client built by a `switchBackend` must reach a handler registered
 *     before the switch — otherwise terminal/script/idle/settings events are
 *     silently dropped for the rest of the session.
 *
 * The real JsonRpcClient/window module/connections store are mocked so the
 * orchestration runs without a live socket or the Electron window graph.
 */

import { BrowserWindow } from 'electron';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// ---------------------------------------------------------------------------
// Mocks (mirror backend-ipc-connections.test.ts)
// ---------------------------------------------------------------------------

const lifecycle = vi.hoisted(() => ({ events: [] as Array<{ type: string; seq: number }> }));

vi.mock('../json-rpc-client', () => {
  let seq = 0;
  class FakeJsonRpcClient {
    private readonly id = ++seq;
    private readonly config: unknown;
    private readonly listeners = new Map<string, Array<(arg: unknown) => void>>();
    constructor(opts: { config: unknown }) {
      this.config = opts.config;
      lifecycle.events.push({ type: 'construct', seq: this.id });
    }
    on(event: string, handler: (arg: unknown) => void): this {
      const arr = this.listeners.get(event) ?? [];
      arr.push(handler);
      this.listeners.set(event, arr);
      return this;
    }
    off(): this {
      return this;
    }
    emit(event: string, arg?: unknown): void {
      for (const h of this.listeners.get(event) ?? []) h(arg);
    }
    start(): void {
      lifecycle.events.push({ type: 'start', seq: this.id });
    }
    dispose(): void {
      lifecycle.events.push({ type: 'dispose', seq: this.id });
    }
    request = vi.fn(async () => ({}));
    registerMethod(): () => void {
      return () => {};
    }
    getConfig(): unknown {
      return this.config;
    }
    getStatus(): string {
      return 'disconnected';
    }
  }
  return { JsonRpcClient: FakeJsonRpcClient };
});

vi.mock('../client-identity', () => ({
  getOrCreateClientId: vi.fn(async () => 'cli-test'),
  persistClientId: vi.fn(async () => {}),
}));

vi.mock('../intentd-sidecar', () => ({
  onSidecarGaveUp: vi.fn(),
  onSidecarStartupFailed: vi.fn(() => () => {}),
  getSidecarRunLog: vi.fn(() => ({ available: false })),
  getSidecarStartupFailure: vi.fn(() => null),
  spawnSidecarOnDemand: vi.fn(),
}));

vi.mock('../../../browser/main/browser-exec-reverse', () => ({
  registerBrowserExecReverseHandler: vi.fn(),
}));

const store = vi.hoisted(() => ({
  list: vi.fn(),
  getActiveId: vi.fn(),
  setActiveId: vi.fn(),
  add: vi.fn(),
  forget: vi.fn(),
  getDecryptedToken: vi.fn(),
}));
vi.mock('../connections-store', () => ({
  LOCAL_CONNECTION_ID: 'local',
  list: store.list,
  getActiveId: store.getActiveId,
  setActiveId: store.setActiveId,
  add: store.add,
  forget: store.forget,
  getDecryptedToken: store.getDecryptedToken,
}));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const REMOTE = {
  id: 'remote-1',
  label: 'Studio Mac',
  host: '10.0.0.5',
  port: 8443,
  fingerprint: 'AA:BB:CC:DD',
  isLocal: false,
};
const LOCAL = {
  id: 'local',
  label: 'This machine (local)',
  host: null,
  port: null,
  fingerprint: null,
  isLocal: true,
};

async function loadModule() {
  const mod = await import('../backend.ipc');
  mod.__setBackendWindowHooksForTesting({
    captureAndClose: vi.fn(async () => {}),
    restore: vi.fn(() => {}),
  });
  return mod;
}

beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
  lifecycle.events = [];
  store.getActiveId.mockResolvedValue('local');
  store.list.mockResolvedValue([LOCAL, REMOTE]);
  store.setActiveId.mockResolvedValue(undefined);
  store.getDecryptedToken.mockResolvedValue('secret-token');
  vi.mocked(BrowserWindow.getAllWindows).mockReturnValue([]);
});

afterEach(() => {
  vi.doUnmock('../backend.ipc');
});

// ---------------------------------------------------------------------------
// Boot reconciliation
// ---------------------------------------------------------------------------

describe('reconcileActiveConnectionOnBoot', () => {
  it('resets a stale remote active-id to local so connections:list reports local', async () => {
    // Persisted state from a prior session: a remote is marked active, but the
    // live client at boot is the local default.
    store.getActiveId.mockResolvedValueOnce('remote-1'); // reconcile read
    const mod = await loadModule();

    await mod.reconcileActiveConnectionOnBoot();

    expect(store.setActiveId).toHaveBeenCalledWith('local');
  });

  it('is a no-op when the persisted active-id is already local', async () => {
    store.getActiveId.mockResolvedValue('local');
    const mod = await loadModule();

    await mod.reconcileActiveConnectionOnBoot();

    expect(store.setActiveId).not.toHaveBeenCalled();
  });

  it('never throws when the store read/write fails (fail-soft at boot)', async () => {
    store.getActiveId.mockRejectedValueOnce(new Error('disk gone'));
    const mod = await loadModule();

    await expect(mod.reconcileActiveConnectionOnBoot()).resolves.toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Reconnect forwarder survives a client swap
// ---------------------------------------------------------------------------

describe('reconnect forwarder', () => {
  it('replays a registered handler on a reconnect of the NEW client after a switch', async () => {
    const mod = await loadModule();
    mod.getBackendClient(); // client #1 (local)

    // A main-process service attaches its resubscribe handler ONCE, up front.
    const handler = vi.fn();
    mod.onBackendReconnected(handler);

    // Switch to the remote: client #1 disposed, client #2 built. The switch
    // itself nudges the forwarder once so services resubscribe to the new target.
    await mod.switchBackend('remote-1');
    expect(handler).toHaveBeenCalledTimes(1);

    // A later reconnect of the NEW client must still reach the handler, even
    // though it was registered before #1 was ever disposed.
    const newClient = mod.getBackendClient() as unknown as { emit(e: string): void };
    newClient.emit('reconnected');
    expect(handler).toHaveBeenCalledTimes(2);
  });

  it('keeps forwarding across multiple switches (handler attached once, never re-registered)', async () => {
    const mod = await loadModule();
    mod.getBackendClient();
    const handler = vi.fn();
    mod.onBackendReconnected(handler);

    await mod.switchBackend('remote-1'); // 1 (switch nudge)
    await mod.switchBackend('local'); // 2 (switch nudge)
    expect(handler).toHaveBeenCalledTimes(2);

    // The live client after the second switch still forwards its own reconnects.
    const current = mod.getBackendClient() as unknown as { emit(e: string): void };
    current.emit('reconnected');
    expect(handler).toHaveBeenCalledTimes(3);
  });

  it('stops forwarding after the disposer runs', async () => {
    const mod = await loadModule();
    mod.getBackendClient();
    const handler = vi.fn();
    const dispose = mod.onBackendReconnected(handler);

    dispose();
    await mod.switchBackend('remote-1');
    const current = mod.getBackendClient() as unknown as { emit(e: string): void };
    current.emit('reconnected');

    expect(handler).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Notification forwarder survives a client swap (T9)
// ---------------------------------------------------------------------------

describe('notification forwarder', () => {
  const NOTIFICATION = {
    method: 'events.event',
    params: { subscriptionId: 'sub-1', event: { type: 'terminal:data' } },
  };

  it('delivers a NEW client notification to a handler registered before the switch', async () => {
    const mod = await loadModule();
    mod.getBackendClient(); // client #1 (local)

    // A main-process service attaches its notification listener ONCE, up front.
    const handler = vi.fn();
    mod.onBackendNotification(handler);

    // Switch to the remote: client #1 disposed, client #2 built.
    await mod.switchBackend('remote-1');

    // A daemon notification on the NEW client must still reach the handler,
    // even though it was registered before #1 was ever disposed.
    const newClient = mod.getBackendClient() as unknown as {
      emit(e: string, arg?: unknown): void;
    };
    newClient.emit('notification', NOTIFICATION);
    expect(handler).toHaveBeenCalledTimes(1);
    expect(handler).toHaveBeenCalledWith(NOTIFICATION);
  });

  it('keeps delivering after switching back to local (also a fresh client)', async () => {
    const mod = await loadModule();
    mod.getBackendClient();
    const handler = vi.fn();
    mod.onBackendNotification(handler);

    await mod.switchBackend('remote-1');
    await mod.switchBackend('local'); // switch-back builds yet another client

    const current = mod.getBackendClient() as unknown as {
      emit(e: string, arg?: unknown): void;
    };
    current.emit('notification', NOTIFICATION);
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it('stops delivering after the disposer runs', async () => {
    const mod = await loadModule();
    mod.getBackendClient();
    const handler = vi.fn();
    const dispose = mod.onBackendNotification(handler);

    dispose();
    await mod.switchBackend('remote-1');
    const current = mod.getBackendClient() as unknown as {
      emit(e: string, arg?: unknown): void;
    };
    current.emit('notification', NOTIFICATION);

    expect(handler).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Status forwarder survives a client swap (T9)
// ---------------------------------------------------------------------------

describe('status forwarder', () => {
  it('delivers a NEW client status transition to a handler registered before the switch', async () => {
    const mod = await loadModule();
    mod.getBackendClient();
    const handler = vi.fn();
    mod.onBackendStatus(handler);

    await mod.switchBackend('remote-1');

    const newClient = mod.getBackendClient() as unknown as {
      emit(e: string, arg?: unknown): void;
    };
    newClient.emit('status', 'connected');
    expect(handler).toHaveBeenCalledWith('connected');
  });
});
