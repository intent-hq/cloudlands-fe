/**
 * T8/T9 — switch robustness: stable forwarders.
 *
 * Switching-correctness gaps closed here:
 *   - **Reconnect forwarder** (T8): main-process services attach reconnect
 *     handlers ONCE via `onBackendReconnected`. Those handlers must survive a
 *     `switchBackend` (which can dispose and rebuild a backend's pooled
 *     client) and still fire on a post-switch reconnect, replaying
 *     subscriptions against the NEW client.
 *   - **Notification / status forwarders** (T9): services attach their daemon
 *     `notification` (and connect-retry `status`) listeners ONCE via
 *     `onBackendNotification` / `onBackendStatus`. A notification/status event
 *     on a client built by a `switchBackend` must reach a handler registered
 *     before the switch — otherwise terminal/script/idle/settings events are
 *     silently dropped for the rest of the session.
 *
 * The real JsonRpcClient/window module/connections store are mocked so the
 * orchestration runs without a live socket or the Electron window graph.
 */

import { BrowserWindow } from 'electron';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { spawnSidecarOnDemand } from '../intentd-sidecar';

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
    getReconnectAttempts(): number {
      return 0;
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
  let activeId = 'local';
  store.getActiveId.mockImplementation(async () => activeId);
  store.setActiveId.mockImplementation(async (id: string) => {
    activeId = id;
  });
  store.list.mockResolvedValue([LOCAL, REMOTE]);
  store.getDecryptedToken.mockResolvedValue('secret-token');
  vi.mocked(BrowserWindow.getAllWindows).mockReturnValue([]);
});

afterEach(() => {
  vi.doUnmock('../backend.ipc');
});

// ---------------------------------------------------------------------------
// Reconnect forwarder survives a client swap
// ---------------------------------------------------------------------------

describe('reconnect forwarder', () => {
  it('replays a registered handler on a reconnect of the NEW client after a switch', async () => {
    const mod = await loadModule();
    mod.getBackendClient(); // local pool member

    // A main-process service attaches its resubscribe handler ONCE, up front,
    // scoped to the remote backend it cares about.
    const handler = vi.fn();
    mod.onBackendReconnected(handler, 'remote-1');

    // Switch to the remote: its pooled client is built. The switch itself
    // nudges the forwarder once so services resubscribe to the new target.
    await mod.switchBackend('remote-1');
    expect(handler).toHaveBeenCalledTimes(1);

    // A later reconnect of the NEW client must still reach the handler, even
    // though it was registered before the client ever existed.
    const newClient = mod.getBackendClientForId('remote-1') as unknown as {
      emit(e: string): void;
    };
    newClient.emit('reconnected');
    expect(handler).toHaveBeenCalledTimes(2);
  });

  it('keeps forwarding across multiple switches (handler attached once, never re-registered)', async () => {
    const mod = await loadModule();
    mod.getBackendClient();
    const handler = vi.fn();
    mod.onBackendReconnected(handler); // defaults to the local backend

    await mod.switchBackend('remote-1');
    await mod.switchBackend('local'); // switch-back nudges the local forwarder
    expect(handler).toHaveBeenCalledTimes(1);

    // The always-on local client still forwards its own reconnects.
    const current = mod.getBackendClient() as unknown as { emit(e: string): void };
    current.emit('reconnected');
    expect(handler).toHaveBeenCalledTimes(2);
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
    mod.getBackendClient(); // local pool member

    // A main-process service attaches its notification listener ONCE, up
    // front, scoped to the remote backend it cares about.
    const handler = vi.fn();
    mod.onBackendNotification(handler, 'remote-1');

    // Switch to the remote: its pooled client is built.
    await mod.switchBackend('remote-1');

    // A daemon notification on the NEW client must still reach the handler,
    // even though it was registered before the client ever existed.
    const newClient = mod.getBackendClientForId('remote-1') as unknown as {
      emit(e: string, arg?: unknown): void;
    };
    newClient.emit('notification', NOTIFICATION);
    expect(handler).toHaveBeenCalledTimes(1);
    expect(handler).toHaveBeenCalledWith(NOTIFICATION);
  });

  it('keeps delivering on the local client across switches away and back', async () => {
    const mod = await loadModule();
    mod.getBackendClient();
    const handler = vi.fn();
    mod.onBackendNotification(handler); // defaults to the local backend

    await mod.switchBackend('remote-1');
    await mod.switchBackend('local');

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
    const dispose = mod.onBackendNotification(handler, 'remote-1');

    dispose();
    await mod.switchBackend('remote-1');
    const current = mod.getBackendClientForId('remote-1') as unknown as {
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
    mod.onBackendStatus(handler, 'remote-1');

    await mod.switchBackend('remote-1');

    const newClient = mod.getBackendClientForId('remote-1') as unknown as {
      emit(e: string, arg?: unknown): void;
    };
    newClient.emit('status', 'connected');
    expect(handler).toHaveBeenCalledWith('connected');
  });
});

// ---------------------------------------------------------------------------
// Switch serialization (monorepo#2221): switchBackend invocations queue behind
// a module-level promise-chain mutex, so overlapping switches can never
// interleave across the orchestration's await points.
// ---------------------------------------------------------------------------

describe('switchBackend serialization', () => {
  it('runs overlapping switches strictly sequentially', async () => {
    const mod = await loadModule();
    // Park the first switch at its window-teardown await point.
    let releaseFirst!: () => void;
    const gate = new Promise<void>((r) => (releaseFirst = r));
    const captureAndClose = vi.fn(async () => {
      if (captureAndClose.mock.calls.length === 1) await gate;
    });
    mod.__setBackendWindowHooksForTesting({ captureAndClose, restore: vi.fn(() => {}) });

    const first = mod.switchBackend('remote-1');
    await vi.waitFor(() => expect(captureAndClose).toHaveBeenCalledTimes(1));
    const second = mod.switchBackend('local');

    // The queued switch makes no progress while the first is still in flight.
    await Promise.resolve();
    await Promise.resolve();
    expect(captureAndClose).toHaveBeenCalledTimes(1);
    expect(store.setActiveId).not.toHaveBeenCalled();

    releaseFirst();
    await expect(first).resolves.toEqual({ activeId: 'remote-1' });
    await expect(second).resolves.toEqual({ activeId: 'local' });

    expect(store.setActiveId.mock.calls.map(([id]) => id)).toEqual(['remote-1', 'local']);
    // Strict client lifecycle: switch 1 builds+starts the remote client (the
    // local member is built lazily alongside it), then switch 2 disposes the
    // outgoing remote and reuses the pooled local member — never interleaved.
    expect(lifecycle.events.map((e) => e.type)).toEqual([
      'construct',
      'start',
      'construct',
      'start',
      'dispose',
    ]);
    // The final switch targeted local, so no remote identity is pinned.
    expect(mod.isRemoteBackendActive()).toBe(false);
  });

  it('a rejected switch does not block the switches queued behind it', async () => {
    const mod = await loadModule();

    const first = mod.switchBackend('unknown-id');
    const second = mod.switchBackend('remote-1');

    await expect(first).rejects.toThrow('Unknown or incomplete connection');
    await expect(second).resolves.toEqual({ activeId: 'remote-1' });
  });
});

// ---------------------------------------------------------------------------
// Teardown-guard hardening: captureAndClose sets the window-all-closed
// suppression guard and restore clears it at its top. A throw from any step in
// between must not leak the guard (which would suppress window-all-closed
// handling for the rest of the session) — performSwitchBackend re-clears it in
// a finally via the idempotent clearTeardownGuard hook.
// ---------------------------------------------------------------------------

describe('switch teardown-guard hardening', () => {
  it('clears the teardown guard when a step between capture and restore throws', async () => {
    const mod = await loadModule();
    const captureAndClose = vi.fn(async () => {});
    const restore = vi.fn(() => {});
    const clearTeardownGuard = vi.fn(() => {});
    mod.__setBackendWindowHooksForTesting({ captureAndClose, restore, clearTeardownGuard });
    // Fail after the guard is set (captureAndClose ran) but before restore.
    store.setActiveId.mockRejectedValueOnce(new Error('disk gone'));

    await expect(mod.switchBackend('remote-1')).rejects.toThrow('disk gone');

    expect(captureAndClose).toHaveBeenCalledTimes(1);
    expect(restore).not.toHaveBeenCalled();
    expect(clearTeardownGuard).toHaveBeenCalledTimes(1);
  });

  it('clears the teardown guard when captureAndClose itself throws after setting it', async () => {
    // The flag is set partway through captureAndClose (before the destroy
    // loop), so a throw from the destroy loop leaks it unless captureAndClose
    // runs INSIDE the try/finally.
    const mod = await loadModule();
    const captureAndClose = vi.fn(async () => {
      throw new Error('destroy failed');
    });
    const restore = vi.fn(() => {});
    const clearTeardownGuard = vi.fn(() => {});
    mod.__setBackendWindowHooksForTesting({ captureAndClose, restore, clearTeardownGuard });

    await expect(mod.switchBackend('remote-1')).rejects.toThrow('destroy failed');

    expect(restore).not.toHaveBeenCalled();
    expect(clearTeardownGuard).toHaveBeenCalledTimes(1);
  });

  it('a rejecting guard clear never masks the original switch error', async () => {
    const mod = await loadModule();
    const captureAndClose = vi.fn(async () => {});
    const restore = vi.fn(() => {});
    const clearTeardownGuard = vi.fn(async () => {
      throw new Error('import failed');
    });
    mod.__setBackendWindowHooksForTesting({ captureAndClose, restore, clearTeardownGuard });
    store.setActiveId.mockRejectedValueOnce(new Error('disk gone'));

    // The try block's error surfaces, not the finally's.
    await expect(mod.switchBackend('remote-1')).rejects.toThrow('disk gone');
    expect(clearTeardownGuard).toHaveBeenCalledTimes(1);
  });

  it('a rejecting guard clear does not fail an otherwise-successful switch', async () => {
    const mod = await loadModule();
    const captureAndClose = vi.fn(async () => {});
    const restore = vi.fn(() => {});
    const clearTeardownGuard = vi.fn(async () => {
      throw new Error('import failed');
    });
    mod.__setBackendWindowHooksForTesting({ captureAndClose, restore, clearTeardownGuard });

    await expect(mod.switchBackend('remote-1')).resolves.toEqual({ activeId: 'remote-1' });
  });

  it('runs the (idempotent) guard clear after restore on a successful switch', async () => {
    const mod = await loadModule();
    const order: string[] = [];
    const captureAndClose = vi.fn(async () => {});
    const restore = vi.fn(() => {
      order.push('restore');
    });
    const clearTeardownGuard = vi.fn(() => {
      order.push('clearTeardownGuard');
    });
    mod.__setBackendWindowHooksForTesting({ captureAndClose, restore, clearTeardownGuard });

    await expect(mod.switchBackend('remote-1')).resolves.toEqual({ activeId: 'remote-1' });

    // restore clears the guard itself; the finally's clear runs after it and
    // must be a harmless no-op on the success path.
    expect(order).toEqual(['restore', 'clearTeardownGuard']);
  });
});

// ---------------------------------------------------------------------------
// T22 review — "Start local intentd" recovery is atomic in main: switching to
// local tears down every window (captureAndClose) before the switch resolves, so
// the spawn MUST NOT depend on the initiating renderer surviving. switchToLocalAndSpawn
// does the switch AND the spawn in one main-side action.
// ---------------------------------------------------------------------------

describe('switchToLocalAndSpawn — atomic recovery survives window teardown', () => {
  it('initiates the sidecar spawn even though switchBackend destroys the window', async () => {
    // Active backend is a remote → recovery must switch to local first.
    store.getActiveId.mockResolvedValue('remote-1');
    // Force the local build onto UDS so performSpawnSidecar's uds guard passes
    // (a dev/test build otherwise resolves to the loopback ws transport).
    const priorSocket = process.env.INTENTD_SOCKET;
    process.env.INTENTD_SOCKET = '/tmp/intent-switch-spawn-test.sock';
    vi.mocked(spawnSidecarOnDemand).mockResolvedValue({
      ok: true,
      spawned: true,
    } as unknown as Awaited<ReturnType<typeof spawnSidecarOnDemand>>);

    try {
      const mod = await import('../backend.ipc');
      // A window-teardown hook that destroys every window mid-switch — exactly
      // the condition that broke the old renderer-continuation recovery.
      const captureAndClose = vi.fn(async () => {
        vi.mocked(BrowserWindow.getAllWindows).mockReturnValue([]);
      });
      mod.__setBackendWindowHooksForTesting({ captureAndClose, restore: vi.fn(() => {}) });

      const result = await mod.switchToLocalAndSpawn();

      // The window WAS torn down during the switch...
      expect(captureAndClose).toHaveBeenCalledTimes(1);
      // ...yet the active backend flipped to local AND the sidecar spawn was
      // still initiated in main — recovery did not depend on the renderer.
      expect(store.setActiveId).toHaveBeenCalledWith('local');
      expect(spawnSidecarOnDemand).toHaveBeenCalledTimes(1);
      expect(result.ok).toBe(true);
    } finally {
      if (priorSocket === undefined) delete process.env.INTENTD_SOCKET;
      else process.env.INTENTD_SOCKET = priorSocket;
    }
  });

  it('decides the no-op switch inside the switch queue (monorepo#2228)', async () => {
    // Stateful active-id so the in-flight switch's setActiveId is visible to
    // the recovery's enqueued re-read.
    let activeId = 'remote-1';
    store.getActiveId.mockImplementation(async () => activeId);
    store.setActiveId.mockImplementation(async (id: string) => {
      activeId = id;
    });
    const priorSocket = process.env.INTENTD_SOCKET;
    process.env.INTENTD_SOCKET = '/tmp/intent-switch-spawn-test.sock';
    vi.mocked(spawnSidecarOnDemand).mockResolvedValue({
      ok: true,
      spawned: true,
    } as unknown as Awaited<ReturnType<typeof spawnSidecarOnDemand>>);

    try {
      const mod = await loadModule();
      // Park the user's own switch to local at its window-teardown await point.
      let releaseSwitch!: () => void;
      const gate = new Promise<void>((resolve) => (releaseSwitch = resolve));
      const captureAndClose = vi.fn(async () => {
        if (captureAndClose.mock.calls.length === 1) await gate;
      });
      mod.__setBackendWindowHooksForTesting({ captureAndClose, restore: vi.fn(() => {}) });

      const userSwitch = mod.switchBackend('local');
      await vi.waitFor(() => expect(captureAndClose).toHaveBeenCalledTimes(1));
      // Recovery kicks in while the user's switch is still in flight. A stale
      // pre-queue read would see 'remote-1' and perform a redundant second
      // switch-to-local (another full window teardown).
      const recovery = mod.switchToLocalAndSpawn();

      releaseSwitch();
      await expect(userSwitch).resolves.toEqual({ activeId: 'local' });
      const result = await recovery;

      // The no-op decision ran AFTER the user's switch inside the queue:
      // already local → no second teardown/switch, just the spawn.
      expect(captureAndClose).toHaveBeenCalledTimes(1);
      expect(store.setActiveId.mock.calls.map(([id]) => id)).toEqual(['local']);
      expect(spawnSidecarOnDemand).toHaveBeenCalledTimes(1);
      expect(result.ok).toBe(true);
    } finally {
      if (priorSocket === undefined) delete process.env.INTENTD_SOCKET;
      else process.env.INTENTD_SOCKET = priorSocket;
    }
  });

  it('spawns without switching when the active backend is already local', async () => {
    store.getActiveId.mockResolvedValue('local');
    const priorSocket = process.env.INTENTD_SOCKET;
    process.env.INTENTD_SOCKET = '/tmp/intent-switch-spawn-test.sock';
    vi.mocked(spawnSidecarOnDemand).mockResolvedValue({
      ok: true,
      spawned: true,
    } as unknown as Awaited<ReturnType<typeof spawnSidecarOnDemand>>);

    try {
      const mod = await loadModule();
      const captureAndClose = vi.fn(async () => {});
      mod.__setBackendWindowHooksForTesting({ captureAndClose, restore: vi.fn(() => {}) });

      const result = await mod.switchToLocalAndSpawn();

      // Already local: no switch (no window teardown), just the spawn.
      expect(captureAndClose).not.toHaveBeenCalled();
      expect(store.setActiveId).not.toHaveBeenCalled();
      expect(spawnSidecarOnDemand).toHaveBeenCalledTimes(1);
      expect(result.ok).toBe(true);
    } finally {
      if (priorSocket === undefined) delete process.env.INTENTD_SOCKET;
      else process.env.INTENTD_SOCKET = priorSocket;
    }
  });
});
