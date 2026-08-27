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

import { app, BrowserWindow, ipcMain } from 'electron';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// ---------------------------------------------------------------------------
// Controllable fake JsonRpcClient
// ---------------------------------------------------------------------------

const lifecycle = vi.hoisted(() => ({ events: [] as Array<{ type: string; seq: number }> }));
const ctorOpts = vi.hoisted(() => ({ list: [] as Array<Record<string, unknown>> }));
const boot = vi.hoisted(() => ({
  probe: 'resolve' as 'resolve' | 'reject' | 'hang',
  certMismatch: false,
  // Steerable `server.pairingInfo` answer for the live self-fingerprint probe:
  // an object resolves as-is ({} is malformed → no fingerprint), 'reject'
  // simulates the local-only gating error.
  pairingInfo: {} as Record<string, unknown> | 'reject',
  // Per-call options of every `server.pairingInfo` request, in call order.
  pairingInfoOptions: [] as Array<{ timeoutMs?: number } | undefined>,
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
      ctorOpts.list.push(opts as unknown as Record<string, unknown>);
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
    request = vi.fn((method: string, _params?: unknown, options?: { timeoutMs?: number }) => {
      if (method === 'host.status') {
        if (boot.probe === 'reject') return Promise.reject(new Error('unreachable'));
        if (boot.probe === 'hang') return new Promise(() => {});
      }
      if (method === 'server.pairingInfo') {
        boot.pairingInfoOptions.push(options);
        if (boot.pairingInfo === 'reject') {
          return Promise.reject(new Error('server.* methods are local-only'));
        }
        return Promise.resolve(boot.pairingInfo);
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
  // Keychain-sync lifecycle wiring (T3); inert in these suites.
  onConnectionsMutated: () => () => {},
}));

// Stateful local-prefs double so the persisted self fingerprint (self-entry
// boot redirect) reads back what a test seeded.
const localPrefs = vi.hoisted(() => {
  const values = new Map<string, unknown>();
  return {
    values,
    setLocalPref: vi.fn(async (key: string, value: unknown) => {
      values.set(key, value);
    }),
    getLocalPref: vi.fn(async (key: string) => values.get(key)),
    deleteLocalPref: vi.fn(async (key: string) => {
      values.delete(key);
    }),
  };
});
vi.mock('../../../../main/local-prefs', () => ({
  setLocalPref: localPrefs.setLocalPref,
  getLocalPref: localPrefs.getLocalPref,
  deleteLocalPref: localPrefs.deleteLocalPref,
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
  ctorOpts.list = [];
  boot.probe = 'resolve';
  boot.certMismatch = false;
  boot.pairingInfo = {};
  boot.pairingInfoOptions = [];
  store.getActiveId.mockResolvedValue('remote-1');
  store.list.mockResolvedValue([LOCAL, REMOTE]);
  store.setActiveId.mockResolvedValue(undefined);
  store.getDecryptedToken.mockResolvedValue('secret-token');
  store.setHostname.mockResolvedValue(undefined);
  localPrefs.values.clear();
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
    // Two constructs: the live self-fingerprint probe's throwaway local client
    // (#1, disposed by the authoritative swap) and the restored remote (#2),
    // which stays live (never disposed).
    expect(lifecycle.events.filter((e) => e.type === 'construct')).toHaveLength(2);
    expect(lifecycle.events.some((e) => e.type === 'dispose' && e.seq === 2)).toBe(false);
    // The restore emits the menu-rebuild trigger so backend-gated items update (#1889).
    expect(vi.mocked(app.emit)).toHaveBeenCalledWith('backend-connection-changed');
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
    // No remote client was built (config resolution failed before any WSS
    // construct); the only construct is the self-fingerprint probe's local one.
    expect(
      ctorOpts.list.filter((o) => (o.config as { transport?: string })?.transport === 'wss'),
    ).toHaveLength(0);
  });

  it('is a no-op when the persisted active id is already local', async () => {
    store.getActiveId.mockResolvedValue('local');
    const mod = await loadModule();

    await mod.reconcileActiveConnectionOnBoot();

    expect(store.setActiveId).not.toHaveBeenCalled();
    expect(lifecycle.events.some((e) => e.type === 'construct')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Self-entry boot redirect: a persisted activeId pointing at this machine's
// OWN published (hidden) self entry resolves silently to local — that record
// IS this daemon, so it must never be restored as a WSS "remote", and no
// boot-fallback notice fires (nothing was unreachable).
// ---------------------------------------------------------------------------

describe('reconcileActiveConnectionOnBoot — hidden self entry resolves to local', () => {
  it('redirects to local silently (no client build, no fallback notice)', async () => {
    localPrefs.values.set('selfBackendFingerprint', 'AA:BB:CC:DD'); // matches REMOTE
    const mod = await loadModule();

    await mod.reconcileActiveConnectionOnBoot();

    expect(store.setActiveId).toHaveBeenCalledWith('local');
    expect(mod.__getBootFallbackNoticeForTesting()).toBeNull();
    // No remote client was ever constructed — the redirect short-circuits.
    expect(lifecycle.events.some((e) => e.type === 'construct')).toBe(false);
  });

  it('matches the self fingerprint case-insensitively', async () => {
    localPrefs.values.set('selfBackendFingerprint', 'aa:bb:cc:dd');
    const mod = await loadModule();

    await mod.reconcileActiveConnectionOnBoot();

    expect(store.setActiveId).toHaveBeenCalledWith('local');
    expect(lifecycle.events.some((e) => e.type === 'construct')).toBe(false);
  });

  it('takes the normal restore path when the fingerprint does not match', async () => {
    localPrefs.values.set('selfBackendFingerprint', '99:88:77:66');
    boot.probe = 'resolve';
    const mod = await loadModule();

    await mod.reconcileActiveConnectionOnBoot();

    // Restored the (genuinely remote) backend as usual. Two constructs: the
    // live-fingerprint probe's local client + the restored remote.
    expect(store.setActiveId).not.toHaveBeenCalledWith('local');
    expect(lifecycle.events.filter((e) => e.type === 'construct')).toHaveLength(2);
  });

  it('takes the normal restore path when no self fingerprint is persisted', async () => {
    boot.probe = 'resolve';
    const mod = await loadModule();

    await mod.reconcileActiveConnectionOnBoot();

    expect(store.setActiveId).not.toHaveBeenCalledWith('local');
    expect(lifecycle.events.filter((e) => e.type === 'construct')).toHaveLength(2);
  });

  it('redirects to local when the LIVE daemon fingerprint matches (nothing persisted)', async () => {
    // Never published from this machine (no stored fingerprint), but the
    // record synced in from another device and matches the live daemon cert.
    boot.pairingInfo = {
      token: 'a'.repeat(64),
      certFingerprint: 'AA:BB:CC:DD', // matches REMOTE
      port: 5181,
      path: '/ws',
      localIps: ['192.168.1.10'],
    };
    const mod = await loadModule();

    await mod.reconcileActiveConnectionOnBoot();

    expect(store.setActiveId).toHaveBeenCalledWith('local');
    expect(mod.__getBootFallbackNoticeForTesting()).toBeNull();
    // Only the probe's local client was built — never a WSS "remote" to self.
    expect(
      ctorOpts.list.filter((o) => (o.config as { transport?: string })?.transport === 'wss'),
    ).toHaveLength(0);
    // The boot-path probe is bounded (boot reconnect budget — 20ms here via
    // __setBootReconnectTimeoutForTesting), not the client's 30s default — a
    // hung local daemon must not stall the restore.
    expect(boot.pairingInfoOptions).toEqual([{ timeoutMs: 20 }]);
  });

  it('matches the live fingerprint case-insensitively', async () => {
    boot.pairingInfo = {
      token: 'a'.repeat(64),
      certFingerprint: 'aa:bb:cc:dd',
      port: 5181,
      path: '/ws',
      localIps: ['192.168.1.10'],
    };
    const mod = await loadModule();

    await mod.reconcileActiveConnectionOnBoot();

    expect(store.setActiveId).toHaveBeenCalledWith('local');
    expect(
      ctorOpts.list.filter((o) => (o.config as { transport?: string })?.transport === 'wss'),
    ).toHaveLength(0);
  });

  it('takes the normal restore path when the live probe fails (fail-soft)', async () => {
    boot.pairingInfo = 'reject';
    boot.probe = 'resolve';
    const mod = await loadModule();

    await mod.reconcileActiveConnectionOnBoot();

    expect(store.setActiveId).not.toHaveBeenCalledWith('local');
    expect(
      ctorOpts.list.filter((o) => (o.config as { transport?: string })?.transport === 'wss'),
    ).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// T22 review — after boot, getActiveId() and the live transport MUST agree, even
// when an early consumer (the About-panel provider-catalog task) built a LOCAL
// client BEFORE reconciliation ran. Reconciliation is authoritative: it disposes
// the stale client and swaps the live transport onto the resolved backend.
// ---------------------------------------------------------------------------

describe('reconcileActiveConnectionOnBoot — activeId/transport agreement', () => {
  /** Map a live client config back to the backend id it targets. */
  function liveTargetId(cfg: { transport?: string; host?: string }): string {
    return cfg.transport === 'wss' && cfg.host === REMOTE.host ? 'remote-1' : 'local';
  }

  it('reachable remote: an early LOCAL client is swapped, so activeId and transport both point at the remote', async () => {
    boot.probe = 'resolve';
    const mod = await loadModule();

    // The About-panel catalog task races reconciliation and builds a client from
    // the local/env default before reconcile pins the remote.
    const early = mod.getBackendClient();

    await mod.reconcileActiveConnectionOnBoot();

    // Reconciliation authoritatively swapped the live client to the remote — a
    // fresh instance, not the stale local one, and the stale one was disposed.
    const live = mod.getBackendClient();
    expect(live).not.toBe(early);
    expect(lifecycle.events.some((e) => e.type === 'dispose')).toBe(true);

    // activeId stays remote; the live transport targets the same remote → agree.
    expect(store.setActiveId).not.toHaveBeenCalledWith('local');
    expect(liveTargetId(live.getConfig() as { transport?: string; host?: string })).toBe(
      'remote-1',
    );
  });

  it('unreachable remote: falls back so activeId AND the live transport are both local', async () => {
    boot.probe = 'reject';
    const mod = await loadModule();

    // Same early-consumer race, but the remote is unreachable this time.
    mod.getBackendClient();

    await mod.reconcileActiveConnectionOnBoot();

    // Fell back to local: persisted activeId is local and so is the live transport.
    expect(store.setActiveId).toHaveBeenCalledWith('local');
    const live = mod.getBackendClient();
    expect(liveTargetId(live.getConfig() as { transport?: string; host?: string })).toBe('local');
  });
});

// ---------------------------------------------------------------------------
// Boot-origin protocol mismatch: a mismatch latched while boot restore pins the
// client to a persisted remote is tagged `origin: 'boot'` (renderer suppresses
// the advisory modal), and the tag survives the sticky `connections:list`
// replay. An explicit switch afterwards re-tags as 'switch' (modal-worthy).
// ---------------------------------------------------------------------------

describe('reconcileActiveConnectionOnBoot — boot-origin protocol mismatch', () => {
  /** Invoke the onHelloResult observer captured from the Nth client construction. */
  function fireHello(index: number, result: unknown): void {
    const onHelloResult = ctorOpts.list[index]?.onHelloResult as (r: unknown) => void;
    onHelloResult(result);
  }

  it('tags a mismatch from the boot-restored remote as boot-origin and replays it on connections:list', async () => {
    boot.probe = 'resolve';
    const mod = await loadModule();
    mod.__setLocalProtocolVersionForTesting('1');

    await mod.reconcileActiveConnectionOnBoot();
    // Client #0 is the self-fingerprint probe's local client; #1 is the remote.
    fireHello(1, { clientId: 'c', protocolVersion: '2' }); // restored remote's handshake

    expect(mod.__getActiveProtocolMismatchForTesting()).toEqual({
      id: 'remote-1',
      host: '10.0.0.5',
      port: 8443,
      localProtocolVersion: '1',
      remoteProtocolVersion: '2',
      origin: 'boot',
    });
    // The sticky replay carries the tag too.
    const list = await mod.__listConnectionsForTesting();
    expect(list.protocolMismatch?.origin).toBe('boot');
  });

  it('does not re-broadcast or re-tag on reconnect re-hellos (one-shot guard preserved)', async () => {
    boot.probe = 'resolve';
    const send = vi.fn();
    vi.mocked(BrowserWindow.getAllWindows).mockReturnValue([
      { id: 1, isDestroyed: () => false, webContents: { send } } as never,
    ]);
    const mod = await loadModule();
    mod.__setLocalProtocolVersionForTesting('1');

    await mod.reconcileActiveConnectionOnBoot();
    fireHello(1, { protocolVersion: '2' });
    fireHello(1, { protocolVersion: '2' }); // reconnect re-runs hello
    fireHello(1, { protocolVersion: '2' });

    const mismatchCalls = send.mock.calls.filter(
      ([channel]) => channel === 'connections:protocol-mismatch',
    );
    expect(mismatchCalls).toHaveLength(1);
    expect((mismatchCalls[0]?.[1] as { origin?: string }).origin).toBe('boot');
  });

  it('re-tags as switch-origin on an explicit switch after a boot restore', async () => {
    boot.probe = 'resolve';
    const mod = await loadModule();
    mod.__setBackendWindowHooksForTesting({
      captureAndClose: vi.fn(async () => {}),
      restore: vi.fn(() => {}),
    });
    mod.__setLocalProtocolVersionForTesting('1');

    await mod.reconcileActiveConnectionOnBoot(); // client #0 (probe) + #1 (boot-pinned remote)
    await mod.switchBackend('remote-1'); // client #2 (explicit switch)
    fireHello(2, { protocolVersion: '2' });

    expect(mod.__getActiveProtocolMismatchForTesting()?.origin).toBe('switch');
  });
});
