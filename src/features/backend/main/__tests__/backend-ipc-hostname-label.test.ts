/**
 * T14 — label a remote connection by its hostname on open.
 *
 * When `openBackendWindow` connects to a remote, it reuses the live client's
 * `host.status` capability probe (the same call the heartbeat issues) to read
 * the remote machine's hostname, persists it on the connection record, and
 * re-broadcasts the list so the menu can upgrade `host:port` to
 * `hostname (host:port)`. The capture is fire-and-forget: it must never block
 * or fail the open, and it is skipped entirely for the local sidecar (UDS has
 * no remote hostname).
 *
 * The real JsonRpcClient/window module/connections store are mocked so the
 * orchestration runs without a live socket or the Electron window graph.
 */

import { app, BrowserWindow } from 'electron';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// `host.status` result the fake client answers with; individual tests override.
// `byHost` lets a test give each backend its own (possibly deferred) answer,
// keyed by the client config's `host` — for exercising a SLOW backend whose
// probe resolves only after later operations (serialization regression below).
const hostStatus = vi.hoisted(() => ({
  value: {} as unknown,
  byHost: new Map<string, () => Promise<unknown>>(),
}));

// Every fake client instance, in construction order, with its constructor
// options — lets tests fire client hooks (e.g. `onHelloResult`) directly to
// simulate a reconnect handshake without a live socket.
const fakeClients = vi.hoisted(
  () =>
    [] as Array<{
      getConfig(): unknown;
      opts: { onHelloResult?: (result: unknown) => void };
    }>,
);

vi.mock('../json-rpc-client', () => {
  class FakeJsonRpcClient {
    private readonly config: unknown;
    private readonly listeners = new Map<string, Array<(arg: unknown) => void>>();
    readonly opts: { config: unknown; onHelloResult?: (result: unknown) => void };
    constructor(opts: { config: unknown; onHelloResult?: (result: unknown) => void }) {
      this.config = opts.config;
      this.opts = opts;
      fakeClients.push(this);
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
    start(): void {}
    dispose(): void {}
    request = vi.fn(async (method: string) => {
      if (method !== 'host.status') return {};
      const host = (this.config as { host?: string } | null)?.host;
      const deferred = host !== undefined ? hostStatus.byHost.get(host) : undefined;
      return deferred ? deferred() : hostStatus.value;
    });
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
  getLocalDaemonProtocolVersion: vi.fn(() => null),
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
  setHostname: vi.fn(),
  setDetectedDeviceKind: vi.fn(),
  setDaemonVersion: vi.fn(),
  getDetectHosts: vi.fn(),
  setHosts: vi.fn(),
}));
vi.mock('../connections-store', () => ({
  LOCAL_CONNECTION_ID: 'local',
  list: store.list,
  getActiveId: store.getActiveId,
  setActiveId: store.setActiveId,
  add: store.add,
  forget: store.forget,
  getDecryptedToken: store.getDecryptedToken,
  setHostname: store.setHostname,
  setDetectedDeviceKind: store.setDetectedDeviceKind,
  setDaemonVersion: store.setDaemonVersion,
  getDetectHosts: store.getDetectHosts,
  setHosts: store.setHosts,
}));

const REMOTE = {
  id: 'remote-1',
  label: '10.0.0.5:8443',
  host: '10.0.0.5',
  port: 8443,
  fingerprint: 'AA:BB:CC:DD',
  hostname: null,
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

function installWindow() {
  const send = vi.fn();
  vi.mocked(BrowserWindow.getAllWindows).mockReturnValue([
    { id: 1, isDestroyed: () => false, webContents: { send } } as never,
  ]);
  return send;
}

beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
  hostStatus.value = {};
  hostStatus.byHost.clear();
  fakeClients.length = 0;
  store.getActiveId.mockResolvedValue('local');
  store.list.mockResolvedValue([LOCAL, REMOTE]);
  store.setActiveId.mockResolvedValue(undefined);
  store.getDecryptedToken.mockResolvedValue('secret-token');
  store.setHostname.mockResolvedValue(undefined);
  store.setDaemonVersion.mockResolvedValue(false);
  store.getDetectHosts.mockResolvedValue(false);
  store.setHosts.mockResolvedValue(undefined);
  store.setDetectedDeviceKind.mockResolvedValue(false);
  vi.mocked(BrowserWindow.getAllWindows).mockReturnValue([]);
});

afterEach(() => {
  vi.doUnmock('../backend.ipc');
});

describe('openBackendWindow hostname labeling', () => {
  it('captures the remote hostname via host.status and persists it after opening', async () => {
    hostStatus.value = {
      hostname: 'studio.local',
      os: 'macos',
      arch: 'aarch64',
      deviceKind: 'macStudio',
    };
    const send = installWindow();
    const mod = await loadModule();

    await mod.openBackendWindow('remote-1');

    // Fire-and-forget: wait for the background capture to persist + re-broadcast.
    await vi.waitFor(() =>
      expect(store.setHostname).toHaveBeenCalledWith('remote-1', 'studio.local'),
    );
    expect(store.setDetectedDeviceKind).toHaveBeenCalledWith('remote-1', 'macStudio');
    // A connections:changed broadcast follows so the menu re-renders the label.
    await vi.waitFor(() =>
      expect(send.mock.calls.some(([c]) => c === 'connections:changed')).toBe(true),
    );
    // The main process is notified too (Window menu entries carry backend labels).
    expect(vi.mocked(app.emit).mock.calls.some(([e]) => e === 'connections-changed')).toBe(true);
  });

  it('prefers a trimmed prettyHostname over hostname when host.status carries both', async () => {
    hostStatus.value = {
      hostname: 'studio.local',
      prettyHostname: '  Clement’s Mac Studio  ',
      os: 'macos',
      arch: 'aarch64',
    };
    const mod = await loadModule();

    await mod.openBackendWindow('remote-1');

    await vi.waitFor(() =>
      expect(store.setHostname).toHaveBeenCalledWith('remote-1', 'Clement’s Mac Studio'),
    );
  });

  it('falls back to hostname when prettyHostname is blank', async () => {
    hostStatus.value = { hostname: 'studio.local', prettyHostname: '   ' };
    const mod = await loadModule();

    await mod.openBackendWindow('remote-1');

    await vi.waitFor(() =>
      expect(store.setHostname).toHaveBeenCalledWith('remote-1', 'studio.local'),
    );
  });

  it('does not persist a hostname when host.status omits it (keeps host:port fallback)', async () => {
    hostStatus.value = { os: 'linux', arch: 'x86_64' }; // no hostname field
    const mod = await loadModule();

    await mod.openBackendWindow('remote-1');
    // Give any pending microtasks a chance to run before asserting the negative.
    await Promise.resolve();
    await Promise.resolve();

    expect(store.setHostname).not.toHaveBeenCalled();
  });

  it('does not attempt hostname capture when opening the local sidecar', async () => {
    hostStatus.value = { hostname: 'studio.local' };
    const mod = await loadModule();

    await mod.openBackendWindow('local');
    await Promise.resolve();
    await Promise.resolve();

    expect(store.setHostname).not.toHaveBeenCalled();
  });

  it('never rejects an open when hostname capture fails (fail-soft)', async () => {
    hostStatus.value = { hostname: 'studio.local' };
    store.setHostname.mockRejectedValue(new Error('disk gone'));
    const mod = await loadModule();

    await expect(mod.openBackendWindow('remote-1')).resolves.toEqual({ id: 'remote-1' });
  });
});

// ---------------------------------------------------------------------------
// Serialization (monorepo#2221/#2228): connection operations are enqueued one
// at a time, so overlapping opens cannot interleave across the await points —
// each backend's hostname capture runs against its own pooled client and each
// record gets its own label.
// ---------------------------------------------------------------------------

describe('openBackendWindow serialization (monorepo#2221)', () => {
  const REMOTE_B = {
    id: 'remote-2',
    label: '10.0.0.6:8443',
    host: '10.0.0.6',
    port: 8443,
    fingerprint: 'EE:FF:00:11',
    hostname: null,
    isLocal: false,
  };

  it('overlapping opens serialize; each backend keeps its own hostname and client', async () => {
    store.list.mockResolvedValue([LOCAL, REMOTE, REMOTE_B]);

    // Backend A (remote-1) answers `host.status` only when the test says so;
    // backend B (remote-2) answers immediately with its own hostname.
    const slowAResolvers: Array<(value: unknown) => void> = [];
    hostStatus.byHost.set('10.0.0.5', () => new Promise((r) => slowAResolvers.push(r)));
    hostStatus.byHost.set('10.0.0.6', () => Promise.resolve({ hostname: 'beta.local' }));

    const openOrFocus = vi.fn(async () => {});
    const mod = await loadModule();
    mod.__setBackendWindowHooksForTesting({ openOrFocus });

    // Open A: its inline `host.status` probe parks on the slow answer, so the
    // queued open-to-B makes no progress while A's operation is in flight.
    const openA = mod.openBackendWindow('remote-1');
    const openB = mod.openBackendWindow('remote-2');
    await vi.waitFor(() => expect(slowAResolvers.length).toBeGreaterThanOrEqual(1));
    expect(openOrFocus).not.toHaveBeenCalled();

    slowAResolvers[0]({ hostname: 'alpha.local' });
    await expect(openA).resolves.toEqual({ id: 'remote-1' });
    await expect(openB).resolves.toEqual({ id: 'remote-2' });
    expect(openOrFocus.mock.calls.map(([id]) => id)).toEqual(['remote-1', 'remote-2']);
    // The fire-and-forget capture issued its own (second) host.status against
    // A's slow deferred; answer it so the label persists.
    await vi.waitFor(() => expect(slowAResolvers.length).toBeGreaterThanOrEqual(2));
    slowAResolvers[1]({ hostname: 'alpha.local' });

    // Each backend's capture labels its own record.
    await vi.waitFor(() => {
      expect(store.setHostname).toHaveBeenCalledWith('remote-1', 'alpha.local');
      expect(store.setHostname).toHaveBeenCalledWith('remote-2', 'beta.local');
    });
    expect(store.setHostname).not.toHaveBeenCalledWith('remote-2', 'alpha.local');

    // Both pooled clients stay live, each pinned to its own host.
    expect((mod.getBackendClientForId('remote-1').getConfig() as { host?: string }).host).toBe(
      '10.0.0.5',
    );
    expect((mod.getBackendClientForId('remote-2').getConfig() as { host?: string }).host).toBe(
      '10.0.0.6',
    );
  });
});

// ---------------------------------------------------------------------------
// Stale-completion guard (monorepo#2221): a `host.status` result that resolves
// only after the backend's pooled client was disposed must be discarded — no
// setHostname persist, no connections:changed broadcast from the dangling
// capture. Mirrors the guard refreshRemoteHosts already has.
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Reconnect refresh: the `onHelloResult` hook runs on EVERY (re)connect
// handshake, and its remote branch re-triggers the hostname capture — so a
// backend machine rename propagates on the next reconnect (not just on the
// explicit open path), reaches the store, and re-broadcasts
// `connections:changed` so row labels update live.
// ---------------------------------------------------------------------------

describe('reconnect hello hostname refresh', () => {
  /** The pooled fake client pinned to `host`, else the connect fails the test. */
  function fakeClientForHost(host: string) {
    const client = fakeClients.find(
      (c) => (c.getConfig() as { host?: string } | null)?.host === host,
    );
    expect(client).toBeDefined();
    return client!;
  }

  it('re-captures the hostname on a reconnect hello and broadcasts the change', async () => {
    hostStatus.value = { hostname: 'studio.local' };
    const send = installWindow();
    const mod = await loadModule();

    await mod.connectBackendClient('remote-1');
    const client = fakeClientForHost('10.0.0.5');

    // Simulate the (re)connect handshake completing.
    client.opts.onHelloResult?.({});
    await vi.waitFor(() =>
      expect(store.setHostname).toHaveBeenCalledWith('remote-1', 'studio.local'),
    );
    await vi.waitFor(() =>
      expect(send.mock.calls.some(([c]) => c === 'connections:changed')).toBe(true),
    );
  });

  it('propagates a backend rename on the next reconnect hello', async () => {
    hostStatus.value = { hostname: 'studio.local' };
    const mod = await loadModule();

    await mod.connectBackendClient('remote-1');
    const client = fakeClientForHost('10.0.0.5');

    client.opts.onHelloResult?.({});
    await vi.waitFor(() =>
      expect(store.setHostname).toHaveBeenCalledWith('remote-1', 'studio.local'),
    );

    // The backend machine is renamed; the next reconnect hello re-captures it.
    hostStatus.value = { hostname: 'studio.local', prettyHostname: 'Renamed Studio' };
    client.opts.onHelloResult?.({});
    await vi.waitFor(() =>
      expect(store.setHostname).toHaveBeenCalledWith('remote-1', 'Renamed Studio'),
    );
  });

  it('does not capture a hostname on the local client hello', async () => {
    hostStatus.value = { hostname: 'studio.local' };
    const mod = await loadModule();

    await mod.connectBackendClient('local');
    const client = fakeClients.find(
      (c) => (c.getConfig() as { host?: string } | null)?.host === undefined,
    );
    expect(client).toBeDefined();

    client!.opts.onHelloResult?.({});
    await new Promise((r) => setTimeout(r, 0));
    await new Promise((r) => setTimeout(r, 0));

    expect(store.setHostname).not.toHaveBeenCalled();
  });
});

describe('captureRemoteHostname stale-completion guard (monorepo#2221)', () => {
  it('discards a host.status result that arrives after the client was disposed', async () => {
    // A's inline open probe answers immediately; the fire-and-forget capture's
    // second `host.status` stays pending until the test resolves it.
    let probeCount = 0;
    let resolveSlowCapture!: (value: unknown) => void;
    hostStatus.byHost.set('10.0.0.5', () => {
      probeCount += 1;
      if (probeCount === 1) return Promise.resolve({});
      return new Promise((r) => (resolveSlowCapture = r));
    });

    const send = installWindow();
    const mod = await loadModule();

    // Open A (its capture stays pending on the slow probe), then dispose A's
    // client — e.g. its last window was closed — before the probe resolves.
    await mod.openBackendWindow('remote-1');
    await vi.waitFor(() => expect(probeCount).toBe(2));
    mod.disconnectBackendClient('remote-1');

    const broadcastsBeforeLateResult = send.mock.calls.filter(
      ([c]) => c === 'connections:changed',
    ).length;

    // The capture finally answers; let it fully settle.
    resolveSlowCapture({ hostname: 'alpha.local' });
    await new Promise((r) => setTimeout(r, 0));
    await new Promise((r) => setTimeout(r, 0));

    // The late result is dropped: no persist for A, no extra broadcast.
    expect(store.setHostname).not.toHaveBeenCalled();
    expect(send.mock.calls.filter(([c]) => c === 'connections:changed').length).toBe(
      broadcastsBeforeLateResult,
    );
  });
});
