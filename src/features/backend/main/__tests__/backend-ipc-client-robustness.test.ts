/**
 * T8/T9 — client-rebuild robustness: stable forwarders.
 *
 * Correctness gaps closed here:
 *   - **Reconnect forwarder** (T8): main-process services attach reconnect
 *     handlers ONCE via `onBackendReconnected`. Those handlers must survive a
 *     pooled-client dispose + rebuild and still fire on a later reconnect,
 *     replaying subscriptions against the NEW client.
 *   - **Notification / status forwarders** (T9): services attach their daemon
 *     `notification` (and connect-retry `status`) listeners ONCE via
 *     `onBackendNotification` / `onBackendStatus`. A notification/status event
 *     on a freshly built client must reach a handler registered before the
 *     client ever existed — otherwise terminal/script/idle/settings events are
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
    getConnectedVia(): null {
      return null;
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
    openOrFocus: vi.fn(async () => {}),
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
  it('replays a registered handler on a reconnect of a client built after registration', async () => {
    const mod = await loadModule();
    mod.getBackendClient(); // local pool member

    // A main-process service attaches its resubscribe handler ONCE, up front,
    // scoped to the remote backend it cares about.
    const handler = vi.fn();
    mod.onBackendReconnected(handler, 'remote-1');

    // Open the remote: its pooled client is built.
    await mod.openBackendWindow('remote-1');

    // A reconnect of the NEW client must reach the handler, even though it
    // was registered before the client ever existed.
    const newClient = mod.getBackendClientForId('remote-1') as unknown as {
      emit(e: string): void;
    };
    newClient.emit('reconnected');
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it('keeps forwarding across a dispose + rebuild (handler attached once, never re-registered)', async () => {
    const mod = await loadModule();
    mod.getBackendClient();
    const handler = vi.fn();
    mod.onBackendReconnected(handler, 'remote-1');

    await mod.openBackendWindow('remote-1');
    mod.disconnectBackendClient('remote-1');
    await mod.openBackendWindow('remote-1');

    // The rebuilt client still forwards its own reconnects to the handler.
    const rebuilt = mod.getBackendClientForId('remote-1') as unknown as {
      emit(e: string): void;
    };
    rebuilt.emit('reconnected');
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it('stops forwarding after the disposer runs', async () => {
    const mod = await loadModule();
    mod.getBackendClient();
    const handler = vi.fn();
    const dispose = mod.onBackendReconnected(handler);

    dispose();
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

  it('delivers a NEW client notification to a handler registered before the client existed', async () => {
    const mod = await loadModule();
    mod.getBackendClient(); // local pool member

    // A main-process service attaches its notification listener ONCE, up
    // front, scoped to the remote backend it cares about.
    const handler = vi.fn();
    mod.onBackendNotification(handler, 'remote-1');

    // Open the remote: its pooled client is built.
    await mod.openBackendWindow('remote-1');

    // A daemon notification on the NEW client must still reach the handler,
    // even though it was registered before the client ever existed.
    const newClient = mod.getBackendClientForId('remote-1') as unknown as {
      emit(e: string, arg?: unknown): void;
    };
    newClient.emit('notification', NOTIFICATION);
    expect(handler).toHaveBeenCalledTimes(1);
    expect(handler).toHaveBeenCalledWith(NOTIFICATION);
  });

  it('keeps delivering on the local client while remotes come and go', async () => {
    const mod = await loadModule();
    mod.getBackendClient();
    const handler = vi.fn();
    mod.onBackendNotification(handler); // defaults to the local backend

    await mod.openBackendWindow('remote-1');
    mod.disconnectBackendClient('remote-1');

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
    await mod.openBackendWindow('remote-1');
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
  it('delivers a NEW client status transition to a handler registered before the client existed', async () => {
    const mod = await loadModule();
    mod.getBackendClient();
    const handler = vi.fn();
    mod.onBackendStatus(handler, 'remote-1');

    await mod.openBackendWindow('remote-1');

    const newClient = mod.getBackendClientForId('remote-1') as unknown as {
      emit(e: string, arg?: unknown): void;
    };
    newClient.emit('status', 'connected');
    expect(handler).toHaveBeenCalledWith('connected');
  });
});

// ---------------------------------------------------------------------------
// Connection-operation serialization (monorepo#2221): openBackendWindow
// invocations queue behind a module-level promise-chain mutex, so overlapping
// operations can never interleave across the orchestration's await points.
// ---------------------------------------------------------------------------

describe('openBackendWindow serialization', () => {
  it('runs overlapping opens strictly sequentially', async () => {
    const mod = await loadModule();
    // Park the first open at its window-hook await point.
    let releaseFirst!: () => void;
    const gate = new Promise<void>((r) => (releaseFirst = r));
    const openOrFocus = vi.fn(async () => {
      if (openOrFocus.mock.calls.length === 1) await gate;
    });
    mod.__setBackendWindowHooksForTesting({ openOrFocus });

    const first = mod.openBackendWindow('remote-1');
    await vi.waitFor(() => expect(openOrFocus).toHaveBeenCalledTimes(1));
    const second = mod.openBackendWindow('local');

    // The queued open makes no progress while the first is still in flight.
    await Promise.resolve();
    await Promise.resolve();
    expect(openOrFocus).toHaveBeenCalledTimes(1);

    releaseFirst();
    await expect(first).resolves.toEqual({ id: 'remote-1' });
    await expect(second).resolves.toEqual({ id: 'local' });

    expect(openOrFocus.mock.calls.map(([id]) => id)).toEqual(['remote-1', 'local']);
    // Strict client lifecycle: each open builds+starts its pooled client
    // (remote then local) — never interleaved, nothing disposed.
    expect(lifecycle.events.map((e) => e.type)).toEqual([
      'construct',
      'start',
      'construct',
      'start',
    ]);
  });

  it('a rejected open does not block the opens queued behind it', async () => {
    const mod = await loadModule();

    const first = mod.openBackendWindow('unknown-id');
    const second = mod.openBackendWindow('remote-1');

    await expect(first).rejects.toThrow('Unknown or incomplete connection');
    await expect(second).resolves.toEqual({ id: 'remote-1' });
  });
});

// ---------------------------------------------------------------------------
// Open-only recovery — "Open local" from a remote window's stopped overlay:
// openLocalAndSpawn spawns the sidecar (if needed) and opens/focuses the local
// backend's windows in one main-side action. No window is ever retargeted.
// ---------------------------------------------------------------------------

describe('openLocalAndSpawn — open-only recovery', () => {
  it('spawns the sidecar then opens the local windows without retargeting any window', async () => {
    // The initiating window targets a remote backend; recovery must NOT
    // retarget it (or any other window) to local.
    store.getActiveId.mockResolvedValue('remote-1');
    // Force the local build onto UDS so performSpawnSidecar's uds guard passes
    // (a dev/test build otherwise resolves to the loopback ws transport).
    const priorSocket = process.env.INTENTD_SOCKET;
    process.env.INTENTD_SOCKET = '/tmp/intent-open-spawn-test.sock';
    vi.mocked(spawnSidecarOnDemand).mockResolvedValue({
      ok: true,
      spawned: true,
    } as unknown as Awaited<ReturnType<typeof spawnSidecarOnDemand>>);

    try {
      const mod = await import('../backend.ipc');
      const openOrFocus = vi.fn(async () => {});
      mod.__setBackendWindowHooksForTesting({ openOrFocus });

      const result = await mod.openLocalAndSpawn();

      // Spawn was initiated in main, then the local backend's windows were
      // opened/focused — and no other window was touched: no active flip.
      expect(spawnSidecarOnDemand).toHaveBeenCalledTimes(1);
      expect(openOrFocus).toHaveBeenCalledWith('local');
      expect(store.setActiveId).not.toHaveBeenCalled();
      expect(result.ok).toBe(true);
      expect(result.spawned).toBe(true);
    } finally {
      if (priorSocket === undefined) delete process.env.INTENTD_SOCKET;
      else process.env.INTENTD_SOCKET = priorSocket;
    }
  });

  it('does not open any window when the spawn fails', async () => {
    const priorSocket = process.env.INTENTD_SOCKET;
    process.env.INTENTD_SOCKET = '/tmp/intent-open-spawn-test.sock';
    vi.mocked(spawnSidecarOnDemand).mockResolvedValue({
      ok: false,
      spawned: false,
      reason: 'binary not found',
    } as unknown as Awaited<ReturnType<typeof spawnSidecarOnDemand>>);

    try {
      const mod = await import('../backend.ipc');
      const openOrFocus = vi.fn(async () => {});
      mod.__setBackendWindowHooksForTesting({ openOrFocus });

      const result = await mod.openLocalAndSpawn();

      // A failed spawn surfaces its own error; opening a local window against
      // a socket nobody serves would be pointless.
      expect(openOrFocus).not.toHaveBeenCalled();
      expect(result.ok).toBe(false);
      expect(result.reason).toBe('binary not found');
    } finally {
      if (priorSocket === undefined) delete process.env.INTENTD_SOCKET;
      else process.env.INTENTD_SOCKET = priorSocket;
    }
  });

  it('retries the open while the freshly spawned daemon is still binding the socket', async () => {
    store.getActiveId.mockResolvedValue('remote-1');
    const priorSocket = process.env.INTENTD_SOCKET;
    process.env.INTENTD_SOCKET = '/tmp/intent-open-spawn-test.sock';
    vi.mocked(spawnSidecarOnDemand).mockResolvedValue({
      ok: true,
      spawned: true,
    } as unknown as Awaited<ReturnType<typeof spawnSidecarOnDemand>>);

    try {
      const mod = await import('../backend.ipc');
      // First open attempt fails (daemon not serving yet) via the openOrFocus
      // hook; the retry loop must try again and succeed.
      const openOrFocus = vi
        .fn(async () => {})
        .mockRejectedValueOnce(new Error('connect ECONNREFUSED'));
      mod.__setBackendWindowHooksForTesting({ openOrFocus });

      const result = await mod.openLocalAndSpawn();

      expect(openOrFocus).toHaveBeenCalledTimes(2);
      expect(result.ok).toBe(true);
    } finally {
      if (priorSocket === undefined) delete process.env.INTENTD_SOCKET;
      else process.env.INTENTD_SOCKET = priorSocket;
    }
  }, 10_000);

  it('scopes the spawn status broadcast to local windows only', async () => {
    // The spawn broadcast carries the LOCAL client's status; a remote window's
    // backend is still dead, so an unscoped broadcast would wrongly dismiss
    // its stopped overlay.
    const priorSocket = process.env.INTENTD_SOCKET;
    process.env.INTENTD_SOCKET = '/tmp/intent-open-spawn-test.sock';
    vi.mocked(spawnSidecarOnDemand).mockResolvedValue({
      ok: true,
      spawned: true,
    } as unknown as Awaited<ReturnType<typeof spawnSidecarOnDemand>>);

    const localSend = vi.fn();
    const remoteSend = vi.fn();
    const localWindow = {
      id: 1,
      backendId: 'local',
      isDestroyed: () => false,
      webContents: { send: localSend },
    };
    const remoteWindow = {
      id: 2,
      backendId: 'remote-1',
      isDestroyed: () => false,
      webContents: { send: remoteSend },
    };
    vi.mocked(BrowserWindow.getAllWindows).mockReturnValue([localWindow, remoteWindow] as never);
    vi.mocked(BrowserWindow.fromWebContents).mockImplementation((sender) => {
      if (sender === localWindow.webContents) return localWindow as never;
      if (sender === remoteWindow.webContents) return remoteWindow as never;
      return null;
    });

    try {
      const mod = await import('../backend.ipc');
      mod.__setBackendWindowHooksForTesting({
        captureAndClose: vi.fn(async () => {}),
        restore: vi.fn(() => {}),
        openOrFocus: vi.fn(async () => {}),
      });

      const result = await mod.openLocalAndSpawn();

      expect(result.ok).toBe(true);
      const localStatusCalls = localSend.mock.calls.filter(([ch]) => ch === 'backend:status');
      const remoteStatusCalls = remoteSend.mock.calls.filter(([ch]) => ch === 'backend:status');
      expect(localStatusCalls.length).toBeGreaterThan(0);
      expect(remoteStatusCalls).toHaveLength(0);
    } finally {
      if (priorSocket === undefined) delete process.env.INTENTD_SOCKET;
      else process.env.INTENTD_SOCKET = priorSocket;
    }
  });

  it('bounds each host.status probe by the remaining deadline budget', async () => {
    // The client's flat request default is 30s — longer than the whole 15s
    // open deadline. Each probe must carry an explicit timeout within the
    // remaining budget so a socket that accepts but never answers cannot hold
    // the IPC past the documented deadline.
    store.getActiveId.mockResolvedValue('remote-1');
    const priorSocket = process.env.INTENTD_SOCKET;
    process.env.INTENTD_SOCKET = '/tmp/intent-open-spawn-test.sock';
    vi.mocked(spawnSidecarOnDemand).mockResolvedValue({
      ok: true,
      spawned: true,
    } as unknown as Awaited<ReturnType<typeof spawnSidecarOnDemand>>);

    try {
      const mod = await import('../backend.ipc');
      mod.__setBackendWindowHooksForTesting({
        captureAndClose: vi.fn(async () => {}),
        restore: vi.fn(() => {}),
        openOrFocus: vi.fn(async () => {}),
      });

      const result = await mod.openLocalAndSpawn();
      expect(result.ok).toBe(true);

      const client = mod.getBackendClientForId('local') as unknown as {
        request: ReturnType<typeof vi.fn>;
      };
      const probes = client.request.mock.calls.filter(([method]) => method === 'host.status');
      expect(probes.length).toBeGreaterThan(0);
      for (const [, , options] of probes) {
        const timeoutMs = (options as { timeoutMs?: number } | undefined)?.timeoutMs;
        expect(typeof timeoutMs).toBe('number');
        expect(timeoutMs).toBeGreaterThan(0);
        expect(timeoutMs).toBeLessThanOrEqual(15_000);
      }
    } finally {
      if (priorSocket === undefined) delete process.env.INTENTD_SOCKET;
      else process.env.INTENTD_SOCKET = priorSocket;
    }
  });
});
