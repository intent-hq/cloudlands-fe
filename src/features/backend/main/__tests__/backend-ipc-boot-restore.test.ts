/**
 * T19 — Restore last-used backend on boot (with graceful fallback).
 *
 * Reverses the earlier T8 "always reset to local at boot" behavior:
 *   - A persisted REMOTE `activeId` that is reachable at boot is restored (the
 *     FE stays on it; the active id is never rewritten to local).
 *   - An UNREACHABLE / timed-out remote falls back to the always-running local
 *     sidecar (active id → local) and latches a non-blocking boot-fallback
 *     notice, replayed on the first `connections:list` fetch. The bounded probe
 *     timeout guarantees no hang on a black-hole remote.
 *   - A cert mismatch surfaces via the existing failure path (the client `error`
 *     handler), so the redundant "couldn't reach" notice is suppressed.
 *
 * The JsonRpcClient is faked with a controllable `host.status` probe so
 * reachable / unreachable / hang / cert-mismatch can be exercised without a live
 * socket. `electron` is globally mocked in `src/test-setup.ts`.
 */

import { ipcMain } from 'electron';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// ---------------------------------------------------------------------------
// Controllable fake JsonRpcClient
// ---------------------------------------------------------------------------

const lifecycle = vi.hoisted(() => ({ events: [] as Array<{ type: string; seq: number }> }));
const boot = vi.hoisted(() => ({
  probe: 'resolve' as 'resolve' | 'reject' | 'hang',
  certMismatch: false,
  // The module under test is re-imported per test (vi.resetModules), so its
  // PinMismatchError class differs from any statically-imported one. loadModule
  // stashes the fresh class here so the fake emits an error the module's
  // `instanceof PinMismatchError` check actually recognizes.
  makePinMismatch: null as null | (() => Error),
}));

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
      // A pinned-cert mismatch surfaces as a client `error` on connect — the
      // module's error handler broadcasts the failure modal (not a silent
      // re-trust). Emit AFTER the listener was attached in getBackendClient.
      if (boot.certMismatch && boot.makePinMismatch) {
        this.emit('error', boot.makePinMismatch());
      }
    }
    dispose(): void {
      lifecycle.events.push({ type: 'dispose', seq: this.id });
    }
    request = vi.fn((method: string) => {
      if (method === 'host.status') {
        if (boot.probe === 'reject') return Promise.reject(new Error('unreachable'));
        if (boot.probe === 'hang') return new Promise(() => {});
      }
      return Promise.resolve({});
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
// Fixtures
// ---------------------------------------------------------------------------

const REMOTE = {
  id: 'remote-1',
  label: 'Studio Mac',
  host: '10.0.0.5',
  port: 8443,
  fingerprint: 'AA:BB:CC:DD',
  hostname: null as string | null,
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
  // Same (reset-aware) module graph the code under test uses, so instanceof holds.
  const { PinMismatchError } = await import('../backend-connection');
  boot.makePinMismatch = () => new PinMismatchError('AA:BB', 'CC:DD');
  mod.__setBootReconnectTimeoutForTesting(20); // short, real timer
  return mod;
}

function findHandler(channel: string) {
  const call = vi.mocked(ipcMain.handle).mock.calls.find(([c]) => c === channel);
  return call?.[1] as ((event: unknown, data: unknown) => Promise<unknown>) | undefined;
}

beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
  lifecycle.events = [];
  boot.probe = 'resolve';
  boot.certMismatch = false;
  store.getActiveId.mockResolvedValue('remote-1');
  store.list.mockResolvedValue([LOCAL, REMOTE]);
  store.setActiveId.mockResolvedValue(undefined);
  store.getDecryptedToken.mockResolvedValue('secret-token');
  store.setHostname.mockResolvedValue(undefined);
});

afterEach(() => {
  vi.doUnmock('../backend.ipc');
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('reconcileActiveConnectionOnBoot — T19 restore', () => {
  it('restores a reachable remote (stays; no fallback notice, active id kept)', async () => {
    boot.probe = 'resolve';
    const mod = await loadModule();

    await mod.reconcileActiveConnectionOnBoot();

    expect(store.setActiveId).not.toHaveBeenCalledWith('local');
    expect(mod.__getBootFallbackNoticeForTesting()).toBeNull();
    // Built exactly one client (the restored remote) and did not dispose it.
    expect(lifecycle.events.filter((e) => e.type === 'construct')).toHaveLength(1);
    expect(lifecycle.events.some((e) => e.type === 'dispose')).toBe(false);
  });

  it('falls back to local with a notice when the remote is unreachable', async () => {
    boot.probe = 'reject';
    const mod = await loadModule();

    await mod.reconcileActiveConnectionOnBoot();

    expect(store.setActiveId).toHaveBeenCalledWith('local');
    expect(mod.__getBootFallbackNoticeForTesting()).toEqual({
      id: 'remote-1',
      label: 'Studio Mac',
    });
    // The remote client was torn down before falling back.
    expect(lifecycle.events.some((e) => e.type === 'dispose')).toBe(true);
  });

  it('falls back without hanging when the remote never answers (bounded timeout)', async () => {
    boot.probe = 'hang';
    const mod = await loadModule();

    // Resolves within the test timeout thanks to the bounded probe timer.
    await mod.reconcileActiveConnectionOnBoot();

    expect(store.setActiveId).toHaveBeenCalledWith('local');
    expect(mod.__getBootFallbackNoticeForTesting()).not.toBeNull();
  });

  it('delivers the notice via connections:get-boot-fallback, then consumes it', async () => {
    boot.probe = 'reject';
    const mod = await loadModule();

    await mod.reconcileActiveConnectionOnBoot();
    mod.registerBackendHandlers();
    const handler = findHandler('connections:get-boot-fallback');
    expect(handler).toBeDefined();

    // First pull delivers the latched notice; a second pull is empty (consume-once).
    await expect(handler!({}, undefined)).resolves.toEqual({
      bootFallback: { id: 'remote-1', label: 'Studio Mac' },
    });
    await expect(handler!({}, undefined)).resolves.toEqual({ bootFallback: null });
  });

  it('suppresses the notice on a cert mismatch (the failure modal already fired)', async () => {
    boot.certMismatch = true;
    boot.probe = 'hang'; // a mismatched cert never completes the connect
    const mod = await loadModule();

    await mod.reconcileActiveConnectionOnBoot();

    expect(store.setActiveId).toHaveBeenCalledWith('local');
    // The cert-mismatch modal is the surfacing; no redundant "couldn't reach".
    expect(mod.__getBootFallbackNoticeForTesting()).toBeNull();
  });

  it('falls back to local for a forgotten/incomplete remote (no stored token)', async () => {
    store.getDecryptedToken.mockResolvedValue(null); // buildConfig throws
    const mod = await loadModule();

    await mod.reconcileActiveConnectionOnBoot();

    expect(store.setActiveId).toHaveBeenCalledWith('local');
    expect(mod.__getBootFallbackNoticeForTesting()).toEqual({ id: 'remote-1', label: 'remote-1' });
    // Nothing was built (config resolution failed before any client construct).
    expect(lifecycle.events.some((e) => e.type === 'construct')).toBe(false);
  });

  it('is a no-op when the persisted active id is already local', async () => {
    store.getActiveId.mockResolvedValue('local');
    const mod = await loadModule();

    await mod.reconcileActiveConnectionOnBoot();

    expect(store.setActiveId).not.toHaveBeenCalled();
    expect(lifecycle.events.some((e) => e.type === 'construct')).toBe(false);
  });
});
