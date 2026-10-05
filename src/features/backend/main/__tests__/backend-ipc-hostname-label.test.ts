/**
 * T14 — label a remote connection by its hostname on open.
 *
 * When `openBackendWindow` connects to a remote, it issues a `host.status`
 * request on the live client (the same call the heartbeat issues) to read
 * the remote machine's hostname, persists it on the connection record, and
 * re-broadcasts the list so the menu can upgrade `host:port` to
 * `hostname (host:port)`. The capture is fire-and-forget: it must never block
 * or fail the open, and it is skipped entirely for the local sidecar (UDS has
 * no remote hostname).
 *
 * The real JsonRpcClient/window module/connections store are mocked so the
 * orchestration runs without a live socket or the Electron window graph.
 */

import { app, BrowserWindow, ipcMain } from 'electron';
import { buildWindowMenuEntries } from '../../../../main/window-menu-entries';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// `host.status` result the fake client answers with; individual tests override.
// `byHost` lets a test give each backend its own (possibly deferred) answer,
// keyed by the client config's `host` — for exercising a SLOW backend whose
// probe resolves only after later operations (serialization regression below).
const systemStatus = vi.hoisted(() => ({
  value: {} as unknown,
  role: 'guest' as 'guest' | 'member',
}));

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
      request: ReturnType<typeof vi.fn>;
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
      if (method === 'principal.me')
        return {
          id: 'prn_7',
          login: 'octocat',
          displayName: null,
          avatarUrl: null,
          isAdministrator: false,
          hostRole: systemStatus.role,
          hostMembershipRevision: 1,
        };
      if (method === 'system.status') return systemStatus.value;
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
    isConnectionLimited(): boolean {
      return false;
    }
    getConnectionLimitRetryAfterMs(): number | null {
      return null;
    }
  }
  return { JsonRpcClient: FakeJsonRpcClient };
});

vi.mock('../keychain-sync-lifecycle', () => ({
  KEYCHAIN_SYNC_ENABLED_KEY: 'keychainSyncEnabled',
  isKeychainSyncEnabled: vi.fn(async () => false),
  initKeychainSyncLifecycle: vi.fn(() => ({ dispose() {} })),
}));

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

// Guest sessions (multiplayer): a joined host resolves through this store
// instead of the connections registry, and its hostname capture persists to
// it. Empty by default; the guest test below seeds one record.
const guestStore = vi.hoisted(() => ({
  list: vi.fn(async () => []),
  findById: vi.fn(),
  getDecryptedToken: vi.fn(),
  setHostname: vi.fn(),
}));
vi.mock('../guest-sessions-store', () => ({
  list: guestStore.list,
  findById: guestStore.findById,
  forget: vi.fn(async () => true),
  leaveWorkspace: vi.fn(async () => true),
  setWorkspaces: vi.fn(async () => false),
  getDecryptedToken: guestStore.getDecryptedToken,
  setHostname: guestStore.setHostname,
  setTcAddress: vi.fn(async () => false),
  setHosts: vi.fn(async () => false),
  setPrincipal: vi.fn(async () => true),
  createInvitedSyncAdapter: vi.fn(() => ({})),
  onGuestSessionsMutated: () => () => {},
  onGuestCredentialReplaced: () => () => {},
  onGuestSessionRemovedBySync: () => () => {},
}));

const GUEST = {
  id: 'guest-1',
  label: 'tc.example.ts.net',
  host: 'tc.example.ts.net',
  hosts: ['tc.example.ts.net'],
  port: 8443,
  fingerprint: 'EE:FF:00:11',
  tcAddress: 'tc.example.ts.net',
  hostname: null,
  principalId: 'prn_7',
  login: 'octocat',
  tokenEncrypted: true,
  workspaces: [{ id: 'ws-guest', title: 'Guest project' }],
  updatedAt: 1,
};

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

function installWindow(backendId = 'local') {
  const send = vi.fn();
  const win = { id: 1, backendId, isDestroyed: () => false, webContents: { send } };
  vi.mocked(BrowserWindow.getAllWindows).mockReturnValue([win as never]);
  vi.mocked(BrowserWindow.fromWebContents).mockReturnValue(win as never);
  return send;
}

beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
  hostStatus.value = {};
  systemStatus.value = {};
  systemStatus.role = 'guest';
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
  guestStore.list.mockResolvedValue([]);
  guestStore.findById.mockResolvedValue(null);
  guestStore.getDecryptedToken.mockResolvedValue(null);
  guestStore.setHostname.mockResolvedValue(true);
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

  it('rejects override-only device kinds reported by host.status', async () => {
    hostStatus.value = { hostname: 'studio.local', deviceKind: 'robot' };
    const mod = await loadModule();

    await mod.openBackendWindow('remote-1');

    await vi.waitFor(() =>
      expect(store.setDetectedDeviceKind).toHaveBeenCalledWith('remote-1', null),
    );
  });

  it('prefers a trimmed prettyHostname over hostname when host.status carries both', async () => {
    hostStatus.value = {
      hostname: 'studio.local',
      prettyHostname: '  Clement’s Mac Studio  ',
      collaborationName: 'Collaborators only',
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

  it('captures a guest host’s pretty hostname through guest-safe system.status and broadcasts it', async () => {
    systemStatus.value = {
      hostname: 'studio.local',
      prettyHostname: 'Clement’s Mac Studio',
      host: { os: 'macos', arch: 'aarch64', locality: 'remote' },
    };
    guestStore.findById.mockImplementation(async (id: string) => (id === GUEST.id ? GUEST : null));
    guestStore.getDecryptedToken.mockResolvedValue('guest-token');
    const send = installWindow();
    const mod = await loadModule();

    await mod.openBackendWindow(GUEST.id);
    fakeClients.at(-1)?.opts.onHelloResult?.({ server: {} });

    await vi.waitFor(() =>
      expect(guestStore.setHostname).toHaveBeenCalledWith(
        GUEST.id,
        'Clement’s Mac Studio',
        expect.any(Function),
      ),
    );
    expect(
      fakeClients
        .at(-1)
        ?.request.mock.calls.some(
          ([method, params]) => method === 'system.status' && params === undefined,
        ),
    ).toBe(true);
    expect(
      fakeClients.at(-1)?.request.mock.calls.some(([method]) => method === 'host.status'),
    ).toBe(false);
    expect(
      vi.mocked(app.emit).mock.calls.some(([event]) => event === 'guest-sessions-changed'),
    ).toBe(true);
    // The guest record — not the paired-connection registry — is the write target.
    expect(store.setHostname).not.toHaveBeenCalled();
    expect(store.setDetectedDeviceKind).not.toHaveBeenCalled();
    await vi.waitFor(() =>
      expect(send.mock.calls.some(([c]) => c === 'guest-sessions:changed')).toBe(true),
    );
  });
});

describe('guest hostname connection lifetime', () => {
  async function openGuest() {
    guestStore.findById.mockImplementation(async (id: string) => (id === GUEST.id ? GUEST : null));
    guestStore.getDecryptedToken.mockResolvedValue('guest-token');
    const mod = await loadModule();
    await mod.openBackendWindow(GUEST.id);
    const client = fakeClients.at(-1)!;
    client.opts.onHelloResult?.({ server: {} });
    return { mod, client };
  }

  it('uses the shared name for invited sessions, and resets to the real friendly hostname', async () => {
    systemStatus.value = {
      hostname: 'studio.local',
      prettyHostname: 'Studio',
      collaborationName: 'Team machine',
    };
    const { client } = await openGuest();
    await vi.waitFor(() =>
      expect(guestStore.setHostname).toHaveBeenCalledWith(
        GUEST.id,
        'Team machine',
        expect.any(Function),
      ),
    );
    systemStatus.value = {
      hostname: 'studio.local',
      prettyHostname: 'Studio',
      collaborationName: null,
    };
    client.opts.onHelloResult?.({ server: {} });
    await vi.waitFor(() =>
      expect(guestStore.setHostname).toHaveBeenLastCalledWith(
        GUEST.id,
        'Studio',
        expect.any(Function),
      ),
    );
    expect(store.setHostname).not.toHaveBeenCalled();
  });

  for (const role of ['guest', 'member'] as const) {
    it(`refreshes ${role} labels from periodic status replies, including reset, without reopening`, async () => {
      systemStatus.role = role;
      systemStatus.value = {
        hostname: 'studio.local',
        prettyHostname: 'Studio',
        collaborationName: 'Before',
      };
      const { mod, client } = await openGuest();
      const send = installWindow(GUEST.id);
      let record = { ...GUEST, hostname: 'Before' };
      guestStore.list.mockImplementation(async () => [record]);
      guestStore.setHostname.mockImplementation(async (_id, name, guard) => {
        if (!guard()) return false;
        record = { ...record, hostname: name };
        return true;
      });
      mod.registerBackendHandlers();
      client.opts.onHelloResult?.({ server: { capabilities: { hostMembership: 1 } } });
      await vi.waitFor(() =>
        expect(guestStore.setHostname).toHaveBeenCalledWith(
          GUEST.id,
          'Before',
          expect.any(Function),
        ),
      );
      const request = vi
        .mocked(ipcMain.handle)
        .mock.calls.find(([channel]) => channel === 'backend:request')![1];
      for (const [override, expected] of [
        ['After', 'After'],
        [null, 'Studio'],
      ] as const) {
        systemStatus.value = {
          hostname: 'studio.local',
          prettyHostname: 'Studio',
          collaborationName: override,
        };
        const result = await request({ sender: {} } as never, { method: 'system.status' });
        expect(result).toMatchObject({ ok: true });
        await vi.waitFor(() =>
          expect(guestStore.setHostname).toHaveBeenLastCalledWith(
            GUEST.id,
            expected,
            expect.any(Function),
          ),
        );
        await vi.waitFor(() =>
          expect(
            send.mock.calls.filter(([channel]) => channel === 'guest-sessions:changed').at(-1)?.[1],
          ).toMatchObject({ sessions: [{ id: GUEST.id, hostname: expected }] }),
        );
        expect(
          buildWindowMenuEntries(
            [{ windowId: 1, isHud: false, backendId: GUEST.id, isFocused: true }],
            [],
            { mainWindowLabel: 'Intent', hudLabel: 'HUD', localBackendLabel: 'Local' },
            [record],
          )[0].label,
        ).toBe(`Intent [${expected}]`);
      }
      await vi.waitFor(() =>
        expect(send.mock.calls.some(([channel]) => channel === 'guest-sessions:changed')).toBe(
          true,
        ),
      );
      expect(
        vi.mocked(app.emit).mock.calls.some(([event]) => event === 'guest-sessions-changed'),
      ).toBe(true);
      expect(store.setHostname).not.toHaveBeenCalled();
    });
  }

  it('ignores an older status poll after a newer reply or lost authority', async () => {
    systemStatus.value = { hostname: 'studio.local' };
    const { mod, client } = await openGuest();
    installWindow(GUEST.id);
    mod.registerBackendHandlers();
    await vi.waitFor(() => expect(guestStore.setHostname).toHaveBeenCalled());
    guestStore.setHostname.mockClear();
    const request = vi
      .mocked(ipcMain.handle)
      .mock.calls.find(([channel]) => channel === 'backend:request')![1];
    let resolve!: (value: unknown) => void;
    systemStatus.value = new Promise((r) => {
      resolve = r;
    });
    const old = request({ sender: {} } as never, { method: 'system.status' });
    systemStatus.value = { hostname: 'studio.local', collaborationName: 'Current' };
    await request({ sender: {} } as never, { method: 'system.status' });
    await vi.waitFor(() =>
      expect(guestStore.setHostname).toHaveBeenCalledWith(
        GUEST.id,
        'Current',
        expect.any(Function),
      ),
    );
    resolve({ hostname: 'studio.local', collaborationName: 'Stale' });
    await old;
    await Promise.resolve();
    expect(guestStore.setHostname.mock.calls.map(([, name]) => name)).toEqual(['Current']);
    systemStatus.value = new Promise((r) => {
      resolve = r;
    });
    const lost = request({ sender: {} } as never, { method: 'system.status' });
    mod.disconnectBackendClient(GUEST.id);
    resolve({ hostname: 'studio.local', collaborationName: 'After disconnect' });
    await lost;
    expect(guestStore.setHostname.mock.calls.map(([, name]) => name)).toEqual(['Current']);
    expect(client).toBeDefined();
  });

  it('uses hostname when pretty name is blank and refreshes on reopen', async () => {
    systemStatus.value = { hostname: 'studio.local', prettyHostname: '  ' };
    const { mod } = await openGuest();
    await vi.waitFor(() =>
      expect(guestStore.setHostname).toHaveBeenCalledWith(
        GUEST.id,
        'studio.local',
        expect.any(Function),
      ),
    );
    mod.disconnectBackendClient(GUEST.id);
    systemStatus.value = { hostname: 'studio.local', prettyHostname: 'Renamed Studio' };
    await mod.openBackendWindow(GUEST.id);
    fakeClients.at(-1)!.opts.onHelloResult?.({ server: {} });
    await vi.waitFor(() =>
      expect(guestStore.setHostname).toHaveBeenLastCalledWith(
        GUEST.id,
        'Renamed Studio',
        expect.any(Function),
      ),
    );
  });

  for (const replacement of ['reconnect', 'reopen'] as const) {
    it(`ignores a delayed guest name from before ${replacement}`, async () => {
      let resolveOld!: (value: unknown) => void;
      systemStatus.value = new Promise((resolve) => {
        resolveOld = resolve;
      });
      const { mod, client } = await openGuest();
      await vi.waitFor(() =>
        expect(
          client.request.mock.calls.filter(([method]) => method === 'system.status').length,
        ).toBeGreaterThanOrEqual(2),
      );
      systemStatus.value = { hostname: 'current.local', prettyHostname: 'Current Studio' };
      if (replacement === 'reopen') {
        mod.disconnectBackendClient(GUEST.id);
        await mod.openBackendWindow(GUEST.id);
      }
      fakeClients.at(-1)!.opts.onHelloResult?.({ server: {} });
      await vi.waitFor(() =>
        expect(guestStore.setHostname).toHaveBeenCalledWith(
          GUEST.id,
          'Current Studio',
          expect.any(Function),
        ),
      );
      resolveOld({ hostname: 'stale.local', prettyHostname: 'Stale Studio' });
      await new Promise((resolve) => setTimeout(resolve, 0));
      expect(guestStore.setHostname.mock.calls.map(([, name]) => name)).toEqual(['Current Studio']);
    });
  }

  it('keeps the saved fallback when status has no name', async () => {
    const { client } = await openGuest();
    await vi.waitFor(() =>
      expect(client.request.mock.calls.some(([method]) => method === 'system.status')).toBe(true),
    );
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(guestStore.setHostname).not.toHaveBeenCalled();
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

    // Open A then B. A's slow `host.status` only parks its fire-and-forget
    // hostname capture — neither window waits on it, and the serialized
    // operations still open in request order.
    const openA = mod.openBackendWindow('remote-1');
    const openB = mod.openBackendWindow('remote-2');
    await expect(openA).resolves.toEqual({ id: 'remote-1' });
    await expect(openB).resolves.toEqual({ id: 'remote-2' });
    expect(openOrFocus.mock.calls.map(([id]) => id)).toEqual(['remote-1', 'remote-2']);

    // A's capture is still pending on the slow deferred; answer it so the
    // label persists.
    await vi.waitFor(() => expect(slowAResolvers.length).toBeGreaterThanOrEqual(1));
    slowAResolvers[0]({ hostname: 'alpha.local' });

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
    // The fire-and-forget capture's `host.status` stays pending until the test
    // resolves it.
    let probeCount = 0;
    let resolveSlowCapture!: (value: unknown) => void;
    hostStatus.byHost.set('10.0.0.5', () => {
      probeCount += 1;
      return new Promise((r) => (resolveSlowCapture = r));
    });

    const send = installWindow();
    const mod = await loadModule();

    // Open A (its capture stays pending on the slow probe), then dispose A's
    // client — e.g. its last window was closed — before the probe resolves.
    await mod.openBackendWindow('remote-1');
    await vi.waitFor(() => expect(probeCount).toBe(1));
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
