/**
 * T14 — label a remote connection by its hostname on switch.
 *
 * When `switchBackend` connects to a remote, it reuses the live client's
 * `host.status` capability probe (the same call the heartbeat issues) to read
 * the remote machine's hostname, persists it on the connection record, and
 * re-broadcasts the list so the menu can upgrade `host:port` to
 * `hostname (host:port)`. The capture is fire-and-forget: it must never block
 * or fail the switch, and it is skipped entirely for the local sidecar (UDS has
 * no remote hostname).
 *
 * The real JsonRpcClient/window module/connections store are mocked so the
 * orchestration runs without a live socket or the Electron window graph.
 */

import { BrowserWindow } from 'electron';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// `host.status` result the fake client answers with; individual tests override.
// `byHost` lets a test give each backend its own (possibly deferred) answer,
// keyed by the client config's `host` — for exercising a SLOW backend whose
// probe resolves only after later switches (serialization regression below).
const hostStatus = vi.hoisted(() => ({
  value: {} as unknown,
  byHost: new Map<string, () => Promise<unknown>>(),
}));

vi.mock('../json-rpc-client', () => {
  class FakeJsonRpcClient {
    private readonly config: unknown;
    private readonly listeners = new Map<string, Array<(arg: unknown) => void>>();
    constructor(opts: { config: unknown }) {
      this.config = opts.config;
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
    captureAndClose: vi.fn(async () => {}),
    restore: vi.fn(() => {}),
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
  store.getActiveId.mockResolvedValue('local');
  store.list.mockResolvedValue([LOCAL, REMOTE]);
  store.setActiveId.mockResolvedValue(undefined);
  store.getDecryptedToken.mockResolvedValue('secret-token');
  store.setHostname.mockResolvedValue(undefined);
  vi.mocked(BrowserWindow.getAllWindows).mockReturnValue([]);
});

afterEach(() => {
  vi.doUnmock('../backend.ipc');
});

describe('switchBackend hostname labeling', () => {
  it('captures the remote hostname via host.status and persists it after switching', async () => {
    hostStatus.value = { hostname: 'studio.local', os: 'macos', arch: 'aarch64' };
    const send = installWindow();
    const mod = await loadModule();

    await mod.switchBackend('remote-1');

    // Fire-and-forget: wait for the background capture to persist + re-broadcast.
    await vi.waitFor(() =>
      expect(store.setHostname).toHaveBeenCalledWith('remote-1', 'studio.local'),
    );
    // A connections:changed broadcast follows so the menu re-renders the label.
    await vi.waitFor(() =>
      expect(send.mock.calls.some(([c]) => c === 'connections:changed')).toBe(true),
    );
  });

  it('does not persist a hostname when host.status omits it (keeps host:port fallback)', async () => {
    hostStatus.value = { os: 'linux', arch: 'x86_64' }; // no hostname field
    const mod = await loadModule();

    await mod.switchBackend('remote-1');
    // Give any pending microtasks a chance to run before asserting the negative.
    await Promise.resolve();
    await Promise.resolve();

    expect(store.setHostname).not.toHaveBeenCalled();
  });

  it('does not attempt hostname capture when switching to the local sidecar', async () => {
    hostStatus.value = { hostname: 'studio.local' };
    store.getActiveId.mockResolvedValue('remote-1');
    const mod = await loadModule();

    await mod.switchBackend('local');
    await Promise.resolve();
    await Promise.resolve();

    expect(store.setHostname).not.toHaveBeenCalled();
  });

  it('never rejects a switch when hostname capture fails (fail-soft)', async () => {
    hostStatus.value = { hostname: 'studio.local' };
    store.setHostname.mockRejectedValue(new Error('disk gone'));
    const mod = await loadModule();

    await expect(mod.switchBackend('remote-1')).resolves.toEqual({ activeId: 'remote-1' });
  });
});

// ---------------------------------------------------------------------------
// Serialization regression (monorepo#2221): overlapping switches used to
// interleave across switchBackend's await points, so switch-to-B could reuse
// the client still pinned to slow backend A — its hostname capture then issued
// `host.status` against A's socket and persisted A's hostname onto B's record
// (and could leave the live transport on A while `activeId` said B).
// ---------------------------------------------------------------------------

describe('switchBackend serialization (monorepo#2221)', () => {
  const REMOTE_B = {
    id: 'remote-2',
    label: '10.0.0.6:8443',
    host: '10.0.0.6',
    port: 8443,
    fingerprint: 'EE:FF:00:11',
    hostname: null,
    isLocal: false,
  };

  it('a slow previous backend never overwrites the new backend label; the live client ends on B', async () => {
    store.list.mockResolvedValue([LOCAL, REMOTE, REMOTE_B]);

    // Backend A (remote-1) answers `host.status` only when the test says so;
    // backend B (remote-2) answers immediately with its own hostname.
    let resolveSlowA!: (value: unknown) => void;
    hostStatus.byHost.set('10.0.0.5', () => new Promise((r) => (resolveSlowA = r)));
    hostStatus.byHost.set('10.0.0.6', () => Promise.resolve({ hostname: 'beta.local' }));

    // Park switch-to-A at its first await point so switch-to-B is issued while
    // A's switch is still in flight.
    let releaseSwitchA!: () => void;
    const captureGate = new Promise<void>((r) => (releaseSwitchA = r));
    const captureAndClose = vi.fn(async () => {
      if (captureAndClose.mock.calls.length === 1) await captureGate;
    });
    const mod = await loadModule();
    mod.__setBackendWindowHooksForTesting({ captureAndClose, restore: vi.fn(() => {}) });

    const switchToA = mod.switchBackend('remote-1');
    await vi.waitFor(() => expect(captureAndClose).toHaveBeenCalledTimes(1));
    const switchToB = mod.switchBackend('remote-2');

    // Serialized: the queued switch-to-B makes no progress while A is in flight.
    await Promise.resolve();
    await Promise.resolve();
    expect(store.setActiveId).not.toHaveBeenCalled();

    releaseSwitchA();
    await expect(switchToA).resolves.toEqual({ activeId: 'remote-1' });
    await expect(switchToB).resolves.toEqual({ activeId: 'remote-2' });
    expect(store.setActiveId.mock.calls.map(([id]) => id)).toEqual(['remote-1', 'remote-2']);

    // B's own capture (against B's client) labels B with B's hostname.
    await vi.waitFor(() =>
      expect(store.setHostname).toHaveBeenCalledWith('remote-2', 'beta.local'),
    );

    // Slow A finally answers; let its dangling capture fully settle, then
    // assert A's hostname never landed on B's record.
    resolveSlowA({ hostname: 'alpha.local' });
    await new Promise((r) => setTimeout(r, 0));
    await new Promise((r) => setTimeout(r, 0));
    expect(store.setHostname).not.toHaveBeenCalledWith('remote-2', 'alpha.local');

    // The live client and the pinned connection identity both target B.
    expect((mod.getBackendClient().getConfig() as { host?: string }).host).toBe('10.0.0.6');
    expect(mod.__getActiveConnectionMetaForTesting()?.id).toBe('remote-2');
  });
});

// ---------------------------------------------------------------------------
// Stale-completion guard (monorepo#2221): a `host.status` result that resolves
// only after the active connection has switched away must be discarded — no
// setHostname persist, no connections:changed broadcast from the dangling
// capture. Mirrors the guard refreshRemoteHosts already has.
// ---------------------------------------------------------------------------

describe('captureRemoteHostname stale-completion guard (monorepo#2221)', () => {
  const REMOTE_B = {
    id: 'remote-2',
    label: '10.0.0.6:8443',
    host: '10.0.0.6',
    port: 8443,
    fingerprint: 'EE:FF:00:11',
    hostname: null,
    isLocal: false,
  };

  it('discards a host.status result that arrives after the active connection switched away', async () => {
    store.list.mockResolvedValue([LOCAL, REMOTE, REMOTE_B]);

    // Backend A (remote-1) answers `host.status` only when the test says so;
    // backend B (remote-2) answers immediately with its own hostname.
    let resolveSlowA!: (value: unknown) => void;
    hostStatus.byHost.set('10.0.0.5', () => new Promise((r) => (resolveSlowA = r)));
    hostStatus.byHost.set('10.0.0.6', () => Promise.resolve({ hostname: 'beta.local' }));

    const send = installWindow();
    const mod = await loadModule();

    // Switch to A completes (the capture is fire-and-forget and stays pending
    // on A's slow probe), then switch away to B before A's probe resolves.
    await mod.switchBackend('remote-1');
    await mod.switchBackend('remote-2');

    // B's own capture persists B's hostname as usual.
    await vi.waitFor(() =>
      expect(store.setHostname).toHaveBeenCalledWith('remote-2', 'beta.local'),
    );
    const broadcastsBeforeLateResult = send.mock.calls.filter(
      ([c]) => c === 'connections:changed',
    ).length;

    // Slow A finally answers; let its dangling capture fully settle.
    resolveSlowA({ hostname: 'alpha.local' });
    await new Promise((r) => setTimeout(r, 0));
    await new Promise((r) => setTimeout(r, 0));

    // The late result is dropped: no persist for A, no extra broadcast.
    expect(store.setHostname).not.toHaveBeenCalledWith('remote-1', 'alpha.local');
    expect(store.setHostname).toHaveBeenCalledTimes(1);
    expect(send.mock.calls.filter(([c]) => c === 'connections:changed').length).toBe(
      broadcastsBeforeLateResult,
    );
  });
});
