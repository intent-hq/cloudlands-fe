/**
 * T15 — protocol-compatibility check on remote connect (warn-but-allow).
 *
 * The shared JsonRpcClient's `onHelloResult` observer feeds the protocol-compat
 * check: it records the LOCAL sidecar's `protocolVersion` from the local
 * handshake, then — after a `switchBackend` to a remote — compares the remote's
 * handshake `protocolVersion` (major) against it. A major mismatch broadcasts a
 * single non-blocking `connections:protocol-mismatch`; a matching or unknown
 * version broadcasts nothing. The connection always proceeds (warn-but-allow).
 *
 * The real JsonRpcClient/window module/connections store are mocked so the
 * handshake + switch run without a live socket or the Electron window graph.
 */

import { BrowserWindow } from 'electron';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const ctorOpts = vi.hoisted(() => ({ list: [] as Array<Record<string, unknown>> }));

vi.mock('../json-rpc-client', () => {
  class FakeJsonRpcClient {
    constructor(opts: Record<string, unknown>) {
      ctorOpts.list.push(opts);
    }
    on(): this {
      return this;
    }
    off(): this {
      return this;
    }
    start(): void {}
    dispose(): void {}
    request = vi.fn(async () => ({}));
    registerMethod(): () => void {
      return () => {};
    }
    getConfig(): unknown {
      return { transport: 'uds', socketPath: '/tmp/test.sock' };
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
  getDecryptedToken: vi.fn(),
  setHostname: vi.fn(),
}));
vi.mock('../connections-store', () => ({
  LOCAL_CONNECTION_ID: 'local',
  list: store.list,
  getActiveId: store.getActiveId,
  setActiveId: store.setActiveId,
  getDecryptedToken: store.getDecryptedToken,
  setHostname: store.setHostname,
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

let send: ReturnType<typeof vi.fn>;

async function loadModule() {
  const mod = await import('../backend.ipc');
  mod.__setBackendWindowHooksForTesting({
    captureAndClose: vi.fn(async () => {}),
    restore: vi.fn(() => {}),
  });
  return mod;
}

/** Invoke the onHelloResult observer captured from the Nth client construction. */
function fireHello(index: number, result: unknown): void {
  const onHelloResult = ctorOpts.list[index]?.onHelloResult as (r: unknown) => void;
  onHelloResult(result);
}

function protocolMismatchCalls(): unknown[] {
  return send.mock.calls
    .filter(([channel]) => channel === 'connections:protocol-mismatch')
    .map(([, payload]) => payload);
}

beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
  ctorOpts.list = [];
  store.getActiveId.mockResolvedValue('local');
  store.list.mockResolvedValue([LOCAL, REMOTE]);
  store.setActiveId.mockResolvedValue(undefined);
  store.getDecryptedToken.mockResolvedValue('secret-token');
  store.setHostname.mockResolvedValue(undefined);
  send = vi.fn();
  vi.mocked(BrowserWindow.getAllWindows).mockReturnValue([
    { id: 1, isDestroyed: () => false, webContents: { send } } as never,
  ]);
});

afterEach(() => {
  vi.doUnmock('../backend.ipc');
});

describe('protocol-compat check on remote connect', () => {
  it('broadcasts connections:protocol-mismatch when the remote major differs from local', async () => {
    const mod = await loadModule();
    mod.getBackendClient(); // client #0 (local)
    fireHello(0, { clientId: 'c', protocolVersion: '1' }); // record local baseline

    await mod.switchBackend('remote-1'); // client #1 (remote)
    fireHello(1, { clientId: 'c', protocolVersion: '2.0' }); // remote handshake

    const calls = protocolMismatchCalls();
    expect(calls).toHaveLength(1);
    expect(calls[0]).toEqual({
      id: 'remote-1',
      host: '10.0.0.5',
      port: 8443,
      localProtocolVersion: '1',
      remoteProtocolVersion: '2.0',
    });
  });

  it('broadcasts nothing when the remote major matches local (minor differences are fine)', async () => {
    const mod = await loadModule();
    mod.getBackendClient();
    fireHello(0, { protocolVersion: '2.1' });

    await mod.switchBackend('remote-1');
    fireHello(1, { protocolVersion: '2.9' });

    expect(protocolMismatchCalls()).toHaveLength(0);
  });

  it('broadcasts nothing when the remote protocolVersion is unknown', async () => {
    const mod = await loadModule();
    mod.getBackendClient();
    fireHello(0, { protocolVersion: '1' });

    await mod.switchBackend('remote-1');
    fireHello(1, { clientId: 'c' }); // no protocolVersion

    expect(protocolMismatchCalls()).toHaveLength(0);
  });

  it('warns at most once per client even if the handshake repeats on reconnect', async () => {
    const mod = await loadModule();
    mod.getBackendClient();
    fireHello(0, { protocolVersion: '1' });

    await mod.switchBackend('remote-1');
    fireHello(1, { protocolVersion: '3' });
    fireHello(1, { protocolVersion: '3' }); // reconnect re-runs hello
    fireHello(1, { protocolVersion: '3' });

    expect(protocolMismatchCalls()).toHaveLength(1);
  });

  it('does not warn on the local handshake itself (no active remote)', async () => {
    const mod = await loadModule();
    mod.getBackendClient();
    fireHello(0, { protocolVersion: '1' });

    expect(protocolMismatchCalls()).toHaveLength(0);
  });
});
