/**
 * T7 — multi-backend connect end-to-end wiring (integration).
 *
 * Unlike the focused unit suites (which mock the connections store and drive one
 * seam at a time), this exercises the WHOLE user journey through the registered
 * `connections:*` IPC handlers against the REAL {@link connectionsStore} — a
 * temp `userData` dir with a reversible `safeStorage` double — so token
 * encryption-at-rest, decryption at switch time, active-id persistence, and the
 * window teardown/reload hooks all run as one flow:
 *
 *   add remote → capture + confirm fingerprint → switch (windows close + reload)
 *   → switch back to local → cert mismatch → failure modal.
 *
 * A second scenario is the T9 regression guard (Wave-4): a main-process service
 * that attached its daemon-notification / status / reconnect listener ONCE (via
 * `onBackendNotification` / `onBackendStatus` / `onBackendReconnected`) keeps
 * receiving events after a full switch cycle (local → remote → local), so
 * terminal output/exit, script state, `agent:idle`, and `settings:changed`
 * still drive the app on the post-switch client.
 *
 * FE-only: no daemon/protocol involvement. See PROTOCOL.md §1.1–2.3 for the
 * daemon-side wire contract this rides on (WSS + self-signed-cert fingerprint +
 * bearer token), and docs/MULTI_BACKEND_CONNECT.md for the FE architecture.
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
// the REAL connections store persists to a temp dir and the switch broadcasts
// reach observable window doubles.
// ---------------------------------------------------------------------------

interface FakeWindow {
  id: number;
  destroyed: boolean;
  isDestroyed(): boolean;
  webContents: { send: ReturnType<typeof vi.fn> };
}

const electronState = vi.hoisted(() => ({
  userDataDir: '',
  windows: [] as unknown[],
  handlers: new Map<string, (event: unknown, data: unknown) => unknown>(),
}));

vi.mock('electron', () => ({
  __esModule: true,
  app: {
    getPath: () => electronState.userDataDir,
    isPackaged: false,
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
  },
  safeStorage: {
    isEncryptionAvailable: () => true,
    // Reversible "encryption" so we can assert the token round-trips through
    // real encrypt-at-rest → decrypt-at-switch without a keyring.
    encryptString: (s: string) => Buffer.from(`enc:${s}`, 'utf8'),
    decryptString: (b: Buffer) => b.toString('utf8').replace(/^enc:/, ''),
  },
}));

// ---------------------------------------------------------------------------
// Fake JSON-RPC client (no live socket) — same shape the unit suites use, plus
// getConfig() returns the config it was built with so we can assert the live
// transport followed the switch (uds/ws → wss → back).
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
function openWindow(): ReturnType<typeof vi.fn> {
  const send = vi.fn();
  const win: FakeWindow = {
    id: electronState.windows.length + 1,
    destroyed: false,
    isDestroyed() {
      return this.destroyed;
    },
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
 * Import a fresh backend.ipc and install window hooks that SIMULATE the T4
 * teardown/reload against the window doubles: capture destroys every live
 * window (windows close), restore opens a fresh one (reload). This lets the
 * integration flow observe close+reload and route post-switch broadcasts to the
 * new window, without pulling in the heavy real window module (covered by
 * window-sessions-multibackend.test.ts).
 */
async function loadModule() {
  const mod = await import('../backend.ipc');
  const captureAndClose = vi.fn(async () => {
    for (const w of electronState.windows as FakeWindow[]) w.destroyed = true;
  });
  const restore = vi.fn(async () => {
    openWindow();
  });
  mod.__setBackendWindowHooksForTesting({ captureAndClose, restore });
  return { mod, captureAndClose, restore };
}

/** Invoke a registered IPC handler by channel (params validated as in prod). */
function invoke<T = unknown>(channel: string, params?: unknown): Promise<T> {
  const handler = electronState.handlers.get(channel);
  if (!handler) throw new Error(`no handler registered for ${channel}`);
  return Promise.resolve(handler({}, params)) as Promise<T>;
}

let tmpDir: string;

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'multi-backend-e2e-'));
  electronState.userDataDir = tmpDir;
  electronState.windows = [];
  electronState.handlers = new Map();
  vi.resetModules();
  vi.clearAllMocks();
  mockCaptureFingerprint.mockResolvedValue({ ok: true, fingerprint: FINGERPRINT });
});

afterEach(async () => {
  const store = await import('../connections-store');
  await store.__drainWriteChainForTesting();
  await fs.rm(tmpDir, { recursive: true, force: true });
  vi.doUnmock('../backend.ipc');
});

// ---------------------------------------------------------------------------
// Full journey: add → confirm → switch → back → mismatch → failure modal
// ---------------------------------------------------------------------------

describe('multi-backend connect — end-to-end journey', () => {
  it('adds a remote, confirms its fingerprint, switches (close+reload), and back to local', async () => {
    const { mod, captureAndClose, restore } = await loadModule();
    mod.registerBackendHandlers();

    // Boot: only the synthesized local entry exists and it is active. No remote
    // is connected yet, so there is no sticky protocol mismatch to replay.
    await expect(invoke('connections:list')).resolves.toEqual({
      connections: [expect.objectContaining({ id: 'local', isLocal: true })],
      activeId: 'local',
      protocolMismatch: null,
    });

    // Trust-on-first-use: capture the remote's presented fingerprint.
    await expect(
      invoke('connections:capture-fingerprint', {
        host: REMOTE_INPUT.host,
        port: REMOTE_INPUT.port,
        token: REMOTE_INPUT.token,
      }),
    ).resolves.toEqual({ fingerprint: FINGERPRINT });

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

    // A live (local) window is up before the switch.
    openWindow();
    mod.getBackendClient(); // client #1 (local)

    // Switch to the remote: windows close + reload, and the live transport
    // becomes the pinned wss target built from the DECRYPTED stored token.
    await expect(invoke('connections:switch', { id: remoteId })).resolves.toEqual({
      activeId: remoteId,
    });
    expect(captureAndClose).toHaveBeenCalledWith('local');
    expect(restore).toHaveBeenCalledWith(remoteId);

    const remoteConfig = mod.getBackendClient().getConfig() as Record<string, unknown>;
    expect(remoteConfig).toMatchObject({
      transport: 'wss',
      host: '10.0.0.5',
      port: 8443,
      fingerprint: FINGERPRINT,
      token: 'secret-token', // decrypted end-to-end from the real store
    });

    // Active selection persisted through the real store.
    await expect(invoke('connections:list')).resolves.toMatchObject({ activeId: remoteId });

    // Switch back to local: fast path, transport is no longer the pinned wss.
    await expect(invoke('connections:switch', { id: 'local' })).resolves.toEqual({
      activeId: 'local',
    });
    const localConfig = mod.getBackendClient().getConfig() as Record<string, unknown>;
    expect(localConfig.transport).not.toBe('wss');
    await expect(invoke('connections:list')).resolves.toMatchObject({ activeId: 'local' });
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
    await invoke('connections:switch', { id: remoteId }); // now pinned to the remote

    const { PinMismatchError } = await import('../backend-connection');
    const client = mod.getBackendClient() as unknown as { emit(e: string, arg: unknown): void };

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
});

// ---------------------------------------------------------------------------
// T9 regression guard (Wave-4): daemon events survive a full switch cycle
// ---------------------------------------------------------------------------

describe('multi-backend connect — notifications survive a switch (T9 guard)', () => {
  it('keeps delivering terminal/script/idle/settings events after local → remote → local', async () => {
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

    // Pair a remote and run a full switch cycle: local → remote → local. Each
    // hop disposes the live client and builds a fresh one.
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
    await invoke('connections:switch', { id: added.connection.id });
    await invoke('connections:switch', { id: 'local' });

    // Each switch nudges the reconnect forwarder once so services resubscribe
    // against the new target.
    expect(onReconnect).toHaveBeenCalledTimes(2);

    // The four representative daemon event kinds must still reach the handler
    // that was registered BEFORE any client swap — on the current (post-switch)
    // client.
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

    // The connect-retry status listener likewise survives the swaps.
    client.emit('status', 'connected');
    expect(onStatus).toHaveBeenCalledWith('connected');
  });
});
