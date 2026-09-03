/**
 * T7 — multi-backend connect end-to-end wiring (integration).
 *
 * Unlike the focused unit suites (which mock the connections store and drive one
 * seam at a time), this exercises the WHOLE user journey through the registered
 * `connections:*` IPC handlers against the REAL {@link connectionsStore} — a
 * temp `userData` dir with a reversible `safeStorage` double — so token
 * encryption-at-rest, decryption at open time, active-id persistence, and the
 * window open/focus hooks all run as one flow:
 *
 *   add remote → capture + confirm fingerprint → open (remote window alongside
 *   local) → cert mismatch → failure modal.
 *
 * A second scenario is the T9 regression guard: a main-process service that
 * attached its daemon-notification / status / reconnect listener ONCE (via
 * `onBackendNotification` / `onBackendStatus` / `onBackendReconnected`) keeps
 * receiving events after a remote client is built, disposed, and rebuilt, so
 * terminal output/exit, script state, `agent:idle`, and `settings:changed`
 * still drive the app on the current client.
 *
 * FE-only: no daemon/protocol involvement. See PROTOCOL.md §1.1–2.3 for the
 * daemon-side wire contract this rides on (WSS + self-signed-cert fingerprint +
 * bearer token), and the monorepo's docs/fe/MULTI_BACKEND_CONNECT.md for the FE
 * architecture.
 *
 * The JSON-RPC client is faked (no live socket) but is otherwise driven exactly
 * as production does — constructed by `getBackendClient`, its `notification` /
 * `status` / `reconnected` / `error` events emitted to assert the forwarders and
 * the cert-mismatch failure path.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';

// ---------------------------------------------------------------------------
// Electron: temp userData + reversible safeStorage + inspectable ipcMain /
// BrowserWindow. Provided in-file (overriding the global test-setup stub) so
// the REAL connections store persists to a temp dir and the changed-list
// broadcasts reach observable window doubles.
// ---------------------------------------------------------------------------

interface FakeWindow {
  id: number;
  backendId: string;
  destroyed: boolean;
  isDestroyed(): boolean;
  focus(): void;
  webContents: { send: ReturnType<typeof vi.fn> };
}

const electronState = vi.hoisted(() => ({
  userDataDir: '',
  windows: [] as unknown[],
  handlers: new Map<string, (event: unknown, data: unknown) => unknown>(),
  // When true, safeStorage.decryptString throws — simulates a locked keychain
  // / undecryptable stored secret for the secret-unavailable open path.
  decryptShouldFail: false,
}));

/** Steerable per-method RPC responder for the fake client (tests override). */
const rpc = vi.hoisted(() => ({
  handler: (async () => ({})) as (method: string) => Promise<unknown>,
}));

vi.mock('electron', () => ({
  __esModule: true,
  app: {
    getPath: () => electronState.userDataDir,
    isPackaged: false,
    emit: () => {},
    // Keychain-sync lifecycle focus trigger (T3); inert here (pref off).
    on: () => {},
    removeListener: () => {},
  },
  ipcMain: {
    handle: (channel: string, handler: (event: unknown, data: unknown) => unknown) => {
      electronState.handlers.set(channel, handler);
    },
    on: () => {},
    removeHandler: (channel: string) => electronState.handlers.delete(channel),
  },
  BrowserWindow: {
    getAllWindows: () => (electronState.windows as FakeWindow[]).filter((w) => !w.isDestroyed()),
    fromWebContents: (webContents: FakeWindow['webContents']) =>
      (electronState.windows as FakeWindow[]).find((w) => w.webContents === webContents) ?? null,
  },
  safeStorage: {
    isEncryptionAvailable: () => true,
    // Reversible "encryption" so we can assert the token round-trips through
    // real encrypt-at-rest → decrypt-at-open without a keyring.
    encryptString: (s: string) => Buffer.from(`enc:${s}`, 'utf8'),
    decryptString: (b: Buffer) => {
      if (electronState.decryptShouldFail) throw new Error('keychain locked');
      return b.toString('utf8').replace(/^enc:/, '');
    },
  },
}));

// ---------------------------------------------------------------------------
// Fake JSON-RPC client (no live socket) — same shape the unit suites use, plus
// getConfig() returns the config it was built with so we can assert each
// pooled client's transport (uds/ws for local, pinned wss for remotes).
// ---------------------------------------------------------------------------

vi.mock('../json-rpc-client', () => {
  let seq = 0;
  class FakeJsonRpcClient {
    readonly id = ++seq;
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
    request = vi.fn(async (method: string) => rpc.handler(method));
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

// Deterministic intentd version pin (the real reader would read the repo's
// live intentd.version file, making list-shape assertions drift on every bump).
vi.mock('../intentd-version-pin', () => ({
  readPinnedVersion: vi.fn(() => '0.1.0'),
}));

// Keep the real PinMismatchError + resolveBackendConfig; stub only the network
// fingerprint capture (trust-on-first-use dials the remote's TLS socket).
const mockCaptureFingerprint = vi.hoisted(() => vi.fn());
vi.mock('../backend-connection', async (importActual) => {
  const actual = await importActual<typeof import('../backend-connection')>();
  return { ...actual, captureFingerprint: mockCaptureFingerprint };
});

// NOTE: `../connections-store` is intentionally NOT mocked — this suite drives
// the real persistence layer against the temp userData dir above.

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const REMOTE_INPUT = {
  label: 'Studio Mac',
  host: '10.0.0.5',
  port: 8443,
  token: 'secret-token',
};
const FINGERPRINT = 'AA:BB:CC:DD';

/** Add a live renderer-window double; returns its `send` spy. */
function openWindow(backendId = 'local'): ReturnType<typeof vi.fn> {
  const send = vi.fn();
  const win: FakeWindow = {
    id: electronState.windows.length + 1,
    backendId,
    destroyed: false,
    isDestroyed() {
      return this.destroyed;
    },
    focus: vi.fn(),
    webContents: { send },
  };
  electronState.windows.push(win);
  return send;
}

/** The one currently-live window's `send` spy (last opened, not destroyed). */
function liveWindowSend(): ReturnType<typeof vi.fn> {
  const live = (electronState.windows as FakeWindow[]).filter((w) => !w.isDestroyed());
  return live[live.length - 1].webContents.send;
}

/**
 * Import a fresh backend.ipc and install an openOrFocus window hook that
 * SIMULATES the open action against the window doubles: focus an existing
 * window for the backend, or open a fresh one. This lets the integration flow
 * observe opens without pulling in the heavy real window module (covered by
 * window-sessions-multibackend.test.ts).
 */
async function loadModule() {
  const mod = await import('../backend.ipc');
  const openOrFocus = vi.fn(async (backendId: string) => {
    const existing = (electronState.windows as FakeWindow[]).find(
      (window) => !window.isDestroyed() && window.backendId === backendId,
    );
    if (existing) existing.focus();
    else openWindow(backendId);
  });
  mod.__setBackendWindowHooksForTesting({ openOrFocus });
  return { mod, openOrFocus };
}

/** Invoke a registered IPC handler by channel (params validated as in prod). */
function invoke<T = unknown>(
  channel: string,
  params?: unknown,
  sender?: FakeWindow['webContents'],
): Promise<T> {
  const handler = electronState.handlers.get(channel);
  if (!handler) throw new Error(`no handler registered for ${channel}`);
  return Promise.resolve(handler(sender ? { sender } : {}, params)) as Promise<T>;
}

let tmpDir: string;

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'multi-backend-e2e-'));
  electronState.userDataDir = tmpDir;
  electronState.windows = [];
  electronState.handlers = new Map();
  electronState.decryptShouldFail = false;
  rpc.handler = async () => ({});
  vi.resetModules();
  vi.clearAllMocks();
  mockCaptureFingerprint.mockResolvedValue({
    ok: true,
    fingerprint: FINGERPRINT,
    tokenValid: true,
  });
});

afterEach(async () => {
  const store = await import('../connections-store');
  await store.__drainWriteChainForTesting();
  await fs.rm(tmpDir, { recursive: true, force: true });
  vi.doUnmock('../backend.ipc');
});

// ---------------------------------------------------------------------------
// Full journey: add → confirm → open → mismatch → failure modal
// ---------------------------------------------------------------------------

describe('multi-backend connect — end-to-end journey', () => {
  it('opens a remote window without destroying the local window or client', async () => {
    const { mod, openOrFocus } = await loadModule();
    mod.registerBackendHandlers();
    openWindow('local');
    const localClient = mod.getBackendClient();

    const added = await invoke<{ connection: { id: string } }>('connections:add', {
      ...REMOTE_INPUT,
      fingerprint: FINGERPRINT,
    });
    const remoteId = added.connection.id;

    await expect(invoke('connections:open', { id: remoteId })).resolves.toEqual({
      status: 'opened',
      id: remoteId,
    });

    const live = (electronState.windows as FakeWindow[]).filter((window) => !window.isDestroyed());
    expect(live.map((window) => window.backendId)).toEqual(['local', remoteId]);
    expect(openOrFocus).toHaveBeenCalledWith(remoteId);
    expect(mod.getBackendClient()).toBe(localClient);
    expect(mod.getBackendClientForConnection('local')).toBe(localClient);
    expect(mod.getBackendClientForConnection(remoteId)).toBeDefined();
    const [localWindow, remoteWindow] = live;
    await expect(
      invoke('connections:list', undefined, localWindow.webContents),
    ).resolves.toMatchObject({ activeId: 'local', windowBackendId: 'local' });
    await expect(
      invoke('connections:list', undefined, remoteWindow.webContents),
    ).resolves.toMatchObject({ activeId: 'local', windowBackendId: remoteId });
  });

  it('adds a remote, confirms its fingerprint, and opens it with the decrypted stored token', async () => {
    const { mod, openOrFocus } = await loadModule();
    mod.registerBackendHandlers();

    // Boot: only the synthesized local entry exists and it is active. No remote
    // is connected yet, so there is no sticky protocol mismatch to replay.
    await expect(invoke('connections:list')).resolves.toEqual({
      connections: [expect.objectContaining({ id: 'local', isLocal: true })],
      activeId: 'local',
      windowBackendId: 'local',
      protocolMismatch: null,
      authRejected: null,
      certMismatch: null,
      certWarnings: null,
      pinnedVersion: '0.1.0',
      connectedIds: [],
    });

    // Trust-on-first-use: capture the remote's presented fingerprint.
    await expect(
      invoke('connections:capture-fingerprint', {
        host: REMOTE_INPUT.host,
        port: REMOTE_INPUT.port,
        token: REMOTE_INPUT.token,
      }),
    ).resolves.toEqual({ fingerprint: FINGERPRINT, tokenValid: true });

    // Add the confirmed remote (token encrypted at rest by the real store).
    const added = await invoke<{ connection: { id: string; label: string; fingerprint: string } }>(
      'connections:add',
      { ...REMOTE_INPUT, fingerprint: FINGERPRINT },
    );
    const remoteId = added.connection.id;
    expect(added.connection).toMatchObject({ label: 'Studio Mac', fingerprint: FINGERPRINT });
    // The returned record never carries the token back to the renderer.
    expect(added.connection).not.toHaveProperty('token');

    // Token is encrypted at rest (marker set, base64 ciphertext, no plaintext);
    // the decrypt round-trip is proven end-to-end by the wss config below.
    const onDisk = await fs.readFile(path.join(tmpDir, 'backend-connections.json'), 'utf8');
    const persisted = JSON.parse(onDisk) as {
      connections: Array<{ encToken: { encrypted: boolean; value: string } }>;
    };
    expect(persisted.connections[0].encToken.encrypted).toBe(true);
    expect(onDisk).not.toContain('secret-token'); // no plaintext token on disk
    expect(Buffer.from(persisted.connections[0].encToken.value, 'base64').toString('utf8')).toBe(
      'enc:secret-token',
    );

    // List now reports local + the remote.
    const listed = await invoke<{ connections: Array<{ id: string }>; activeId: string }>(
      'connections:list',
    );
    expect(listed.connections.map((c) => c.id)).toEqual(['local', remoteId]);
    expect(listed.activeId).toBe('local');

    // A live (local) window is up before the open.
    openWindow('local');
    mod.getBackendClient(); // client #1 (local)

    // Open the remote: its window opens alongside local's, and its pooled
    // client is the pinned wss target built from the DECRYPTED stored token.
    await expect(invoke('connections:open', { id: remoteId })).resolves.toEqual({
      status: 'opened',
      id: remoteId,
    });
    expect(openOrFocus).toHaveBeenCalledWith(remoteId);

    const remoteConfig = mod.getBackendClientForId(remoteId).getConfig() as Record<string, unknown>;
    expect(remoteConfig).toMatchObject({
      transport: 'wss',
      host: '10.0.0.5',
      port: 8443,
      fingerprint: FINGERPRINT,
      token: 'secret-token', // decrypted end-to-end from the real store
    });

    // The open never flips the persisted whole-app selection; the always-on
    // local member (never a wss transport) keeps serving local windows.
    await expect(invoke('connections:list')).resolves.toMatchObject({ activeId: 'local' });
    const localConfig = mod.getBackendClient().getConfig() as Record<string, unknown>;
    expect(localConfig.transport).not.toBe('wss');
  });

  it('re-pairing an active duplicate refreshes its client without window teardown', async () => {
    // Earlier app versions allowed repeated host:port entries. Seed such a file
    // where a NON-first duplicate is the active backend, then re-pair the same
    // host:port: the collapse must keep the ACTIVE record's id so the add
    // handler takes the active client-refresh path (switched: true)
    // instead of treating it as a non-active upsert.
    await fs.writeFile(
      path.join(tmpDir, 'backend-connections.json'),
      JSON.stringify({
        connections: [
          {
            id: 'dup-1',
            label: 'Old pairing',
            host: REMOTE_INPUT.host,
            port: REMOTE_INPUT.port,
            fingerprint: 'OLD:FP',
            encToken: { encrypted: false, value: 'stale-token' },
          },
          {
            id: 'dup-2',
            label: 'Active pairing',
            host: REMOTE_INPUT.host,
            port: REMOTE_INPUT.port,
            fingerprint: 'OLD:FP',
            encToken: { encrypted: false, value: 'stale-token' },
          },
        ],
        activeId: 'dup-2',
      }),
      'utf8',
    );

    const { mod, openOrFocus } = await loadModule();
    mod.registerBackendHandlers();
    openWindow();
    mod.getBackendClient();

    const result = await invoke<{ connection: { id: string }; switched: boolean }>(
      'connections:add',
      { ...REMOTE_INPUT, token: 'rotated-token', fingerprint: FINGERPRINT },
    );

    // The ACTIVE duplicate's id survived the collapse and the live client was
    // rebuilt without opening or closing any window.
    expect(result).toMatchObject({ connection: { id: 'dup-2' }, switched: true });
    expect(openOrFocus).not.toHaveBeenCalled();

    // The rebuilt client carries the rotated token, and only one record remains.
    const config = mod.getBackendClientForId('dup-2').getConfig() as Record<string, unknown>;
    expect(config).toMatchObject({ transport: 'wss', token: 'rotated-token' });
    const listed = await invoke<{ connections: Array<{ id: string }>; activeId: string }>(
      'connections:list',
    );
    expect(listed.connections.map((c) => c.id)).toEqual(['local', 'dup-2']);
    expect(listed.activeId).toBe('dup-2');
  });

  it('surfaces a single cert-mismatch failure modal when the pinned remote presents a changed cert', async () => {
    const { mod } = await loadModule();
    mod.registerBackendHandlers();

    // Pair + activate the remote via the real handlers.
    await invoke('connections:capture-fingerprint', {
      host: REMOTE_INPUT.host,
      port: REMOTE_INPUT.port,
      token: REMOTE_INPUT.token,
    });
    const added = await invoke<{ connection: { id: string } }>('connections:add', {
      ...REMOTE_INPUT,
      fingerprint: FINGERPRINT,
    });
    const remoteId = added.connection.id;

    openWindow();
    await invoke('connections:open', { id: remoteId }); // remote client now live

    const { PinMismatchError } = await import('../backend-connection');
    const client = mod.getBackendClientForId(remoteId) as unknown as {
      emit(e: string, arg: unknown): void;
    };

    // The pinned wss transport re-raises the mismatch on every reconnect retry;
    // the renderer must see exactly ONE blocking failure modal.
    const send = liveWindowSend();
    client.emit('error', new PinMismatchError(FINGERPRINT, 'EE:FF:00:11'));
    client.emit('error', new PinMismatchError(FINGERPRINT, 'EE:FF:00:11'));

    const mismatches = send.mock.calls.filter(([c]) => c === 'connections:cert-mismatch');
    expect(mismatches).toHaveLength(1);
    expect(mismatches[0][1]).toEqual({
      id: remoteId,
      host: '10.0.0.5',
      port: 8443,
      expectedFingerprint: FINGERPRINT,
      actualFingerprint: 'EE:FF:00:11',
    });
  });

  it('opens the remote window even when the probe finds the remote unreachable', async () => {
    // The saved backend is down at open time: the open must still resolve,
    // create the window, and RETAIN the pooled client (its reconnect loop
    // keeps retrying) so the renderer's connection-lost overlay owns recovery.
    rpc.handler = async (method) => {
      if (method === 'host.status') throw new Error('connect ETIMEDOUT');
      return {};
    };
    const { mod, openOrFocus } = await loadModule();
    mod.registerBackendHandlers();
    openWindow('local');

    const added = await invoke<{ connection: { id: string } }>('connections:add', {
      ...REMOTE_INPUT,
      fingerprint: FINGERPRINT,
    });
    const remoteId = added.connection.id;

    await expect(invoke('connections:open', { id: remoteId })).resolves.toEqual({
      status: 'opened',
      id: remoteId,
    });

    expect(openOrFocus).toHaveBeenCalledWith(remoteId);
    const live = (electronState.windows as FakeWindow[]).filter((window) => !window.isDestroyed());
    expect(live.map((window) => window.backendId)).toEqual(['local', remoteId]);
    expect(mod.getBackendClientForConnection(remoteId)).toBeDefined();
  });

  it('opens the window on a cert-mismatch probe failure and replays the latched modal to it', async () => {
    // Pair, then the remote presents a changed cert at open time: the probe
    // fails but the window opens; the retained client's transport raises the
    // typed mismatch, whose latched event is replayed to the new window via
    // its initial connections:list fetch — trust modal instead of a dead click.
    const { PinMismatchError } = await import('../backend-connection');
    rpc.handler = async (method) => {
      if (method === 'host.status') throw new PinMismatchError(FINGERPRINT, 'EE:FF:00:11');
      return {};
    };
    const { mod, openOrFocus } = await loadModule();
    mod.registerBackendHandlers();

    const added = await invoke<{ connection: { id: string } }>('connections:add', {
      ...REMOTE_INPUT,
      fingerprint: FINGERPRINT,
    });
    const remoteId = added.connection.id;

    await expect(invoke('connections:open', { id: remoteId })).resolves.toEqual({
      status: 'opened',
      id: remoteId,
    });
    expect(openOrFocus).toHaveBeenCalledWith(remoteId);

    // The retained client's reconnect loop re-raises the mismatch as a
    // transport error; the window created by the open learns it from the
    // sticky replay on its initial list fetch.
    const client = mod.getBackendClientForId(remoteId) as unknown as {
      emit(e: string, arg: unknown): void;
    };
    client.emit('error', new PinMismatchError(FINGERPRINT, 'EE:FF:00:11'));
    const remoteWindow = (electronState.windows as FakeWindow[]).find(
      (window) => window.backendId === remoteId,
    )!;
    await expect(
      invoke('connections:list', undefined, remoteWindow.webContents),
    ).resolves.toMatchObject({
      certMismatch: {
        id: remoteId,
        host: '10.0.0.5',
        port: 8443,
        expectedFingerprint: FINGERPRINT,
        actualFingerprint: 'EE:FF:00:11',
      },
    });
  });

  it('keeps the no-window structured failure when the stored secret is unavailable', async () => {
    // A locked keychain / undecryptable secret means there is nothing for a
    // window to retry against: the open returns the structured
    // secret-unavailable result and opens NO window.
    const { mod, openOrFocus } = await loadModule();
    mod.registerBackendHandlers();

    const added = await invoke<{ connection: { id: string } }>('connections:add', {
      ...REMOTE_INPUT,
      fingerprint: FINGERPRINT,
    });
    const remoteId = added.connection.id;

    electronState.decryptShouldFail = true;
    await expect(invoke('connections:open', { id: remoteId })).resolves.toEqual({
      status: 'secret-unavailable',
    });
    expect(openOrFocus).not.toHaveBeenCalled();
    const live = (electronState.windows as FakeWindow[]).filter((window) => !window.isDestroyed());
    expect(live).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// T9 regression guard: daemon events survive a remote client's build/dispose
// ---------------------------------------------------------------------------

describe('multi-backend connect — notifications survive client churn (T9 guard)', () => {
  it('keeps delivering terminal/script/idle/settings events after a remote client comes and goes', async () => {
    const { mod } = await loadModule();
    mod.registerBackendHandlers();
    mod.getBackendClient(); // client #1 (local)

    // A main-process service attaches its listeners ONCE, up front — exactly as
    // the terminal registry / script manager / notification+app-settings
    // services do at registration time.
    const onNotification = vi.fn();
    const onStatus = vi.fn();
    const onReconnect = vi.fn();
    mod.onBackendNotification(onNotification);
    mod.onBackendStatus(onStatus);
    mod.onBackendReconnected(onReconnect);

    // Pair a remote, open it (builds its pooled client), then dispose it —
    // the local member persists throughout.
    await invoke('connections:capture-fingerprint', {
      host: REMOTE_INPUT.host,
      port: REMOTE_INPUT.port,
      token: REMOTE_INPUT.token,
    });
    const added = await invoke<{ connection: { id: string } }>('connections:add', {
      ...REMOTE_INPUT,
      fingerprint: FINGERPRINT,
    });
    openWindow();
    await invoke('connections:open', { id: added.connection.id });
    mod.disconnectBackendClient(added.connection.id);

    // The representative daemon event kinds must still reach the handler that
    // was registered BEFORE any client churn — on the always-on local client.
    const client = mod.getBackendClient() as unknown as { emit(e: string, arg: unknown): void };
    const events = [
      { method: 'events.event', params: { event: { type: 'terminal:data' } } },
      { method: 'events.event', params: { event: { type: 'terminal:exit' } } },
      { method: 'events.event', params: { event: { type: 'script:state' } } },
      { method: 'events.event', params: { event: { type: 'agent:idle' } } },
      { method: 'events.event', params: { event: { type: 'settings:changed' } } },
    ];
    for (const ev of events) client.emit('notification', ev);

    expect(onNotification).toHaveBeenCalledTimes(events.length);
    for (const ev of events) expect(onNotification).toHaveBeenCalledWith(ev);

    // The connect-retry status listener likewise survives the churn, and the
    // local reconnect forwarder still reaches the handler.
    client.emit('status', 'connected');
    expect(onStatus).toHaveBeenCalledWith('connected');
    client.emit('reconnected');
    expect(onReconnect).toHaveBeenCalledTimes(1);
  });
});
