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
const hostStatus = vi.hoisted(() => ({ value: {} as unknown }));

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
    request = vi.fn(async (method: string) => (method === 'host.status' ? hostStatus.value : {}));
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
