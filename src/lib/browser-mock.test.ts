/**
 * Regression tests for the DEV gate on the browser mock (audit row 17).
 *
 * The mock electronAPI must only activate in dev builds (import.meta.env.DEV)
 * or under the explicit VITE_ENABLE_BROWSER_MOCK=true opt-in. In a non-DEV run
 * with no bridge, unbridged channels must reject loudly via
 * UnbridgedMockIpcChannelError instead of silently serving MOCK_WORKSPACES.
 * Every served mock response must log a [BrowserMock]-prefixed warning naming
 * the channel.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  mockInvoke,
  resetMockIpcRouter,
  UnbridgedMockIpcChannelError,
} from '$shared/ipc-mock-router';

/** Import a fresh copy of browser-mock so its auto-install side effect re-runs. */
async function importBrowserMock() {
  vi.resetModules();
  return await import('./browser-mock');
}

describe('browser-mock DEV gate', () => {
  const originalElectronAPI = (window as any).electronAPI;

  beforeEach(() => {
    delete (window as any).electronAPI;
    vi.stubEnv('VITE_ENABLE_BROWSER_MOCK', '');
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
    (window as any).electronAPI = originalElectronAPI;
  });

  it('does NOT install the mock when import.meta.env.DEV is false', async () => {
    vi.stubEnv('DEV', false);

    const { installBrowserMock, isBrowserMockEnabled } = await importBrowserMock();

    expect(isBrowserMockEnabled()).toBe(false);
    expect((window as any).electronAPI).toBeUndefined();
    expect(installBrowserMock()).toBe(false);
    expect((window as any).electronAPI).toBeUndefined();
  });

  it('non-DEV env with no bridge: channels reject instead of serving MOCK_WORKSPACES', async () => {
    vi.stubEnv('DEV', false);

    await importBrowserMock();

    // No mock electronAPI was installed, so renderer invokes route through the
    // mock IPC router — which, with no seeders registered, must reject loudly.
    expect((window as any).electronAPI).toBeUndefined();
    resetMockIpcRouter();
    await expect(mockInvoke('workspace:list')).rejects.toThrow(UnbridgedMockIpcChannelError);
  });

  it('installs the mock in DEV builds', async () => {
    vi.stubEnv('DEV', true);

    const { isBrowserMockEnabled } = await importBrowserMock();

    expect(isBrowserMockEnabled()).toBe(true);
    expect((window as any).electronAPI).toBeDefined();
  });

  it('installs the mock under the explicit VITE_ENABLE_BROWSER_MOCK=true opt-in', async () => {
    vi.stubEnv('DEV', false);
    vi.stubEnv('VITE_ENABLE_BROWSER_MOCK', 'true');

    const { isBrowserMockEnabled } = await importBrowserMock();

    expect(isBrowserMockEnabled()).toBe(true);
    expect((window as any).electronAPI).toBeDefined();
  });

  it('never overwrites a real electronAPI bridge', async () => {
    vi.stubEnv('DEV', true);
    const realBridge = { invoke: vi.fn() };
    (window as any).electronAPI = realBridge;

    const { installBrowserMock } = await importBrowserMock();

    expect(installBrowserMock()).toBe(false);
    expect((window as any).electronAPI).toBe(realBridge);
  });

  it('serves protocol-shaped backend lists to the live AppClient in browser mode', async () => {
    vi.stubEnv('DEV', true);
    vi.spyOn(console, 'warn').mockImplementation(() => {});

    await importBrowserMock();
    const api = (window as any).electronAPI;
    const invokeSpy = vi.spyOn(api, 'invoke');
    const { LiveAppClient } = await import('./client');
    const { backendRequest } = await import('./client/live/backend-transport');
    const { rememberNoteWorkspace } = await import('./client/live/live-support');
    const client = new LiveAppClient();

    const workspaces = await client.workspaces.list({ includeArchived: true });
    const agents = await client.agents.list(String(workspaces[0].id));
    const interrupted = await client.agents.listInterrupted();
    const files = await backendRequest<{ files?: string[] }>('search.fileNames', {
      workspaceId: String(workspaces[0].id),
      pattern: '',
      limit: 50,
    });
    rememberNoteWorkspace('mock-note', 'mock-ws-1');
    const comments = await client.comments.list('mock-note');
    const tasks = await client.tasks.list('mock-ws-1');
    const gitStatus = await client.git.status('mock-ws-1');

    expect(workspaces.map(({ id }) => String(id))).toEqual(['mock-ws-1', 'mock-ws-2']);
    expect(agents).toEqual([]);
    expect(interrupted).toEqual([]);
    expect(files).toEqual({ files: [] });
    expect(comments).toEqual([]);
    expect(tasks).toEqual({ tasks: [], stats: { total: 0, completed: 0, inProgress: 0 } });
    expect(gitStatus).toEqual({
      branch: '',
      ahead: 0,
      behind: 0,
      diverged: false,
      files: [],
      hasUncommittedChanges: false,
      hasUntrackedFiles: false,
    });
    expect(invokeSpy).toHaveBeenNthCalledWith(1, 'backend:request', {
      method: 'workspace.list',
      params: { includeArchived: true },
    });
    expect(invokeSpy).toHaveBeenNthCalledWith(2, 'backend:request', {
      method: 'agent.list',
      params: { workspaceId: 'mock-ws-1' },
    });
    expect(invokeSpy).toHaveBeenNthCalledWith(3, 'backend:request', {
      method: 'agent.listInterrupted',
      params: {},
    });
    expect(invokeSpy).toHaveBeenNthCalledWith(4, 'backend:request', {
      method: 'search.fileNames',
      params: { workspaceId: 'mock-ws-1', pattern: '', limit: 50 },
    });
    expect(invokeSpy).toHaveBeenNthCalledWith(5, 'backend:request', {
      method: 'comment.list',
      params: { workspaceId: 'mock-ws-1', noteId: 'mock-note', includeComments: true },
    });
    await expect(invokeSpy.mock.results[4].value).resolves.toEqual({
      ok: true,
      result: { threads: [] },
    });
    expect(invokeSpy).toHaveBeenNthCalledWith(6, 'backend:request', {
      method: 'task.list',
      params: { workspaceId: 'mock-ws-1' },
    });
    await expect(invokeSpy.mock.results[5].value).resolves.toEqual({
      ok: true,
      result: { tasks: [], stats: { total: 0, completed: 0, inProgress: 0 } },
    });
    expect(invokeSpy).toHaveBeenNthCalledWith(7, 'backend:request', {
      method: 'git.status',
      params: { workspaceId: 'mock-ws-1' },
    });
  });

  it('logs a [BrowserMock]-prefixed warning naming the channel for every served response', async () => {
    vi.stubEnv('DEV', true);
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    await importBrowserMock();

    const api = (window as any).electronAPI;
    expect(api).toBeDefined();

    const result = await api.invoke('workspace:list');
    expect(result.success).toBe(true);
    expect(result.data.length).toBeGreaterThan(0);
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringMatching(/\[BrowserMock\].*'workspace:list'/),
    );

    warnSpy.mockClear();
    await api.invoke('skills:list');
    expect(warnSpy).toHaveBeenCalledWith(expect.stringMatching(/\[BrowserMock\].*'skills:list'/));
  });
});

/**
 * Regression tests for intent-hq/monorepo#3606: a dev Electron window must
 * never install the browser mock over the preload bridge, even when the
 * bridge has not been exposed yet at the moment the mock module evaluates
 * (the preload can land after early renderer modules). The Electron check is
 * synchronous (user agent), so preload timing cannot change the outcome.
 */
describe('browser-mock never shadows the Electron preload bridge (monorepo#3606)', () => {
  const ELECTRON_UA =
    'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Cloudlands/2.3.0 Chrome/136.0.7103.115 Electron/36.4.0 Safari/537.36';
  const originalElectronAPI = (window as any).electronAPI;

  /** Own-property override of the prototype getter; deleted in afterEach to restore jsdom's UA. */
  function setUserAgent(value: string) {
    Object.defineProperty(window.navigator, 'userAgent', { value, configurable: true });
  }

  beforeEach(() => {
    delete (window as any).electronAPI;
    vi.stubEnv('DEV', true);
    vi.stubEnv('VITE_ENABLE_BROWSER_MOCK', '');
    vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    delete (window.navigator as any).userAgent;
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
    (window as any).electronAPI = originalElectronAPI;
  });

  it('DEV Electron renderer with no bridge yet: import does not install the mock, and the late preload bridge wins', async () => {
    setUserAgent(ELECTRON_UA);
    expect((window as any).electronAPI).toBeUndefined();

    const { installBrowserMock, isBrowserMockEnabled } = await importBrowserMock();

    // The DEV gate is open, yet the auto-install on import must not have fired.
    expect(isBrowserMockEnabled()).toBe(true);
    expect((window as any).electronAPI).toBeUndefined();
    expect(installBrowserMock()).toBe(false);
    expect((window as any).electronAPI).toBeUndefined();

    // Preload finishes after the renderer module evaluated: the real bridge
    // is installed unopposed and stays the bridge.
    const realBridge = { invoke: vi.fn(), versions: { electron: '36.4.0' } };
    (window as any).electronAPI = realBridge;
    expect(installBrowserMock()).toBe(false);
    expect((window as any).electronAPI).toBe(realBridge);
  });

  it('explicit VITE_ENABLE_BROWSER_MOCK opt-in does not override the Electron guard', async () => {
    setUserAgent(ELECTRON_UA);
    vi.stubEnv('DEV', false);
    vi.stubEnv('VITE_ENABLE_BROWSER_MOCK', 'true');

    const { installBrowserMock } = await importBrowserMock();

    expect(installBrowserMock()).toBe(false);
    expect((window as any).electronAPI).toBeUndefined();
  });

  it('plain browser (no Electron UA) with no bridge still installs the mock in DEV', async () => {
    setUserAgent(
      'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/136.0.0.0 Safari/537.36',
    );

    await importBrowserMock();

    const api = (window as any).electronAPI;
    expect(api).toBeDefined();
    expect(api.versions.electron).toBe('0.0.0-browser');
  });
});

/**
 * Regression tests for the `backend:*` transport envelope (STAB entry: mock
 * boots hit an unhandled BackendError).
 *
 * `electron-ipc-transport.ts` unwraps every `backend:request` /
 * `backend:subscribe` response as a `BackendResult` envelope
 * `{ ok: true, result }` / `{ ok: false, error: { code, message } }` (the
 * shape `backend.ipc.ts` produces). The mock used to fall through to the
 * legacy `{ success: false, error: string }` fallback, which unwrap() rejects
 * as a malformed envelope — every mock boot threw BackendError.
 */
describe('browser-mock backend:* transport envelope', () => {
  const originalElectronAPI = (window as any).electronAPI;
  let api: any;

  beforeEach(async () => {
    delete (window as any).electronAPI;
    vi.stubEnv('DEV', true);
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    await importBrowserMock();
    api = (window as any).electronAPI;
    expect(api).toBeDefined();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
    (window as any).electronAPI = originalElectronAPI;
  });

  it('backend:request workspace.list returns { ok: true, result: { workspaces } }', async () => {
    const res = await api.invoke('backend:request', { method: 'workspace.list' });
    expect(res.ok).toBe(true);
    expect(Array.isArray(res.result?.workspaces)).toBe(true);
    expect(res.result.workspaces.length).toBeGreaterThan(0);
    // Must NOT be the legacy CommandResponse shape
    expect(res).not.toHaveProperty('success');
  });

  it('backend:request serves boot-time reads (settings.list, repo.list) as ok envelopes', async () => {
    const settings = await api.invoke('backend:request', { method: 'settings.list' });
    expect(settings.ok).toBe(true);
    expect(Array.isArray(settings.result?.settings)).toBe(true);

    const repos = await api.invoke('backend:request', { method: 'repo.list' });
    expect(repos.ok).toBe(true);
    expect(Array.isArray(repos.result?.repos)).toBe(true);

    // Bare array per §5.10 — the MainLayout activity timeline reads this at boot.
    const events = await api.invoke('backend:request', { method: 'event.query' });
    expect(events.ok).toBe(true);
    expect(Array.isArray(events.result)).toBe(true);

    // The daemon-events-bridge firehose subscribes via backend:request.
    const sub = await api.invoke('backend:request', { method: 'events.subscribe' });
    expect(sub.ok).toBe(true);
    expect(typeof sub.result?.subscriptionId).toBe('string');
  });

  it('backend:request workspace.get resolves the workspace by id as { ok: true, result: { workspace } } (monorepo#2605)', async () => {
    const res = await api.invoke('backend:request', {
      method: 'workspace.get',
      params: { workspaceId: 'mock-ws-1' },
    });
    expect(res.ok).toBe(true);
    expect(res.result?.workspace?.id).toBe('mock-ws-1');
    expect(res.result.workspace.title).toBe('Example Project');
  });

  it('backend:request workspace.get for an unknown id returns a structured error envelope (PROTOCOL §5.1)', async () => {
    const res = await api.invoke('backend:request', {
      method: 'workspace.get',
      params: { workspaceId: 'no-such-ws' },
    });
    expect(res.ok).toBe(false);
    expect(res.error?.code).toBe('INVALID_PARAMS');
    expect(res.error?.message).toContain('no-such-ws');
    // Mirrors JsonRpcError.toErrorPayload(): data.code + numeric rpcCode
    // (isDaemonErrorResponse duck-types daemon rejections on rpcCode).
    expect(res.error?.data).toEqual({ code: 'INVALID_PARAMS' });
    expect(res.error?.rpcCode).toBe(-32602);
  });

  it('backend:request task.listAgentLinks returns the empty links + linksByNoteId shape (monorepo#2605, PROTOCOL §5.4)', async () => {
    const res = await api.invoke('backend:request', {
      method: 'task.listAgentLinks',
      params: { workspaceId: 'mock-ws-1' },
    });
    expect(res.ok).toBe(true);
    expect(res.result).toEqual({ links: [], linksByNoteId: {} });
  });

  it('backend:request serves the remaining workspace-open lifecycle reads as ok envelopes', async () => {
    // These are hit by the lifecycle read saga right after workspace.get /
    // task.listAgentLinks when a workspace opens in dev:web.
    const tokenUsage = await api.invoke('backend:request', {
      method: 'workspace.getTokenUsage',
      params: { workspaceId: 'mock-ws-1' },
    });
    expect(tokenUsage.ok).toBe(true);
    expect(tokenUsage.result?.tokenUsage?.totals).toEqual({
      inputTokens: 0,
      outputTokens: 0,
      cacheReadTokens: 0,
      cacheCreationTokens: 0,
    });
    expect(tokenUsage.result?.tokenUsage?.lastScanAt).toBeNull();

    const context = await api.invoke('backend:request', {
      method: 'workspace.getContext',
      params: { workspaceId: 'mock-ws-1' },
    });
    expect(context.ok).toBe(true);
    expect(Array.isArray(context.result?.items)).toBe(true);

    const scripts = await api.invoke('backend:request', {
      method: 'script.list',
      params: { workspaceId: 'mock-ws-1' },
    });
    expect(scripts.ok).toBe(true);
    expect(Array.isArray(scripts.result?.scripts)).toBe(true);

    // v4.0 envelope: { terminals, daemonBootId } — never the bare array.
    const terminals = await api.invoke('backend:request', {
      method: 'terminal.list',
      params: { workspaceId: 'mock-ws-1' },
    });
    expect(terminals.ok).toBe(true);
    expect(Array.isArray(terminals.result?.terminals)).toBe(true);
    expect(typeof terminals.result?.daemonBootId).toBe('string');

    const active = await api.invoke('backend:request', {
      method: 'agent.listActive',
      params: {},
    });
    expect(active.ok).toBe(true);
    expect(active.result).toEqual({ streams: [] });

    const monitors = await api.invoke('backend:request', {
      method: 'prMonitor.list',
      params: { workspaceId: 'mock-ws-1' },
    });
    expect(monitors.ok).toBe(true);
    expect(monitors.result).toEqual({ monitors: [] });

    const gitRoots = await api.invoke('backend:request', {
      method: 'gitRoot.list',
      params: { workspaceId: 'mock-ws-1' },
    });
    expect(gitRoots.ok).toBe(true);
    expect(gitRoots.result).toEqual({ gitRoots: [] });

    // §5.9 file.tree returns a bare array.
    const tree = await api.invoke('backend:request', {
      method: 'file.tree',
      params: { workspaceId: 'mock-ws-1', path: '.' },
    });
    expect(tree.ok).toBe(true);
    expect(tree.result).toEqual([]);

    // §5.19 file-tracking reads (refreshChanges in the lifecycle saga).
    const changes = await api.invoke('backend:request', {
      method: 'file-tracking.getChanges',
      params: { workspaceId: 'mock-ws-1' },
    });
    expect(changes.ok).toBe(true);
    expect(changes.result).toEqual({ changes: [], truncated: false, totalCount: 0 });

    const commits = await api.invoke('backend:request', {
      method: 'file-tracking.loadCommits',
      params: { workspaceId: 'mock-ws-1' },
    });
    expect(commits.ok).toBe(true);
    expect(commits.result).toEqual({ commits: [], boundarySha: null, nextToken: null });
  });

  it('resolves workspaces.get through the live client (workspace open path)', async () => {
    const { LiveAppClient } = await import('./client');
    const client = new LiveAppClient();
    const workspace = await client.workspaces.get('mock-ws-1');
    expect(workspace).not.toBeNull();
    expect(String(workspace?.id)).toBe('mock-ws-1');
  });

  it('backend:request for an unimplemented method returns a structured error envelope', async () => {
    const res = await api.invoke('backend:request', { method: 'no.suchMethod' });
    expect(res.ok).toBe(false);
    expect(typeof res.error?.code).toBe('string');
    expect(typeof res.error?.message).toBe('string');
    expect(res.error.message).toContain('no.suchMethod');
  });

  it('backend:request without a method returns INVALID_PARAMS (mirrors backend.ipc.ts)', async () => {
    const res = await api.invoke('backend:request', {});
    expect(res.ok).toBe(false);
    expect(res.error?.code).toBe('INVALID_PARAMS');
  });

  it('backend:subscribe returns { ok: true, result: { subscriptionId } }', async () => {
    const res = await api.invoke('backend:subscribe', { eventTypes: ['workspace:created'] });
    expect(res.ok).toBe(true);
    expect(typeof res.result?.subscriptionId).toBe('string');
  });

  it('backend:unsubscribe returns an ok envelope', async () => {
    const res = await api.invoke('backend:unsubscribe', { subscriptionId: 'sub-1' });
    expect(res.ok).toBe(true);
  });

  it('backend:get-status returns the bare { status } shape (no envelope)', async () => {
    const res = await api.invoke('backend:get-status');
    expect(typeof res?.status).toBe('string');
    expect(res).not.toHaveProperty('ok');
  });

  it('unwraps cleanly through the real electron-ipc transport (no BackendError on boot reads)', async () => {
    const { createElectronIpcBackendTransport } =
      await import('./client/live/electron-ipc-transport');
    const transport = createElectronIpcBackendTransport();
    const result = await transport.request<{ workspaces?: unknown[] }>('workspace.list');
    expect(Array.isArray(result.workspaces)).toBe(true);
    const sub = await transport.subscribe<{ subscriptionId?: string }>({ eventTypes: ['*'] });
    expect(typeof sub.subscriptionId).toBe('string');
  });
});

/**
 * Regression tests for the dev:web false "intentd is stopped" overlay.
 *
 * In dev:web (browser mock installed + VITE_INTENTD_WS_URL configured) the
 * daemon-health service reads `backend:get-status` and listens on
 * `backend:status` through `window.electronAPI` — the browser mock. The mock
 * used to hardcode `{ status: 'disconnected', transport: 'browser-mock' }`
 * and never emit `backend:status`, so the DaemonStoppedOverlay appeared even
 * while the BrowserWebSocketTransport was fully healthy. The mock must
 * reflect the live WS transport state and report the transport as
 * `{ mode: 'external-ws', target: <sanitized ws url> }`.
 */
describe('browser-mock daemon health with BrowserWebSocketTransport (dev:web)', () => {
  const originalElectronAPI = (window as any).electronAPI;

  class FakeWebSocket {
    static instances: FakeWebSocket[] = [];
    onopen: ((event?: unknown) => void) | null = null;
    onmessage: ((event: { data: unknown }) => void) | null = null;
    onerror: ((event?: unknown) => void) | null = null;
    onclose: ((event?: unknown) => void) | null = null;
    readonly sent: string[] = [];

    constructor(readonly url: string) {
      FakeWebSocket.instances.push(this);
    }

    send(data: string): void {
      this.sent.push(data);
    }

    close(): void {}

    open(): void {
      this.onopen?.();
    }

    receive(frame: unknown): void {
      this.onmessage?.({ data: JSON.stringify(frame) });
    }

    drop(): void {
      this.onclose?.();
    }
  }

  let api: any;

  beforeEach(async () => {
    delete (window as any).electronAPI;
    vi.stubEnv('DEV', true);
    vi.stubEnv('VITE_INTENTD_WS_URL', 'ws://127.0.0.1:5181/rpc?token=secret');
    FakeWebSocket.instances = [];
    vi.stubGlobal('WebSocket', FakeWebSocket);
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    await importBrowserMock();
    api = (window as any).electronAPI;
    expect(api).toBeDefined();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    (window as any).electronAPI = originalElectronAPI;
  });

  /** Resolve the (WS) transport via the factory and drive it to connected. */
  async function connectTransport() {
    const { resolveBackendTransport } = await import('./client/live/backend-transport-factory');
    const transport = resolveBackendTransport();
    const pending = transport.request<{ running?: boolean }>('system.status');
    const socket = FakeWebSocket.instances[0];
    expect(socket).toBeDefined();
    socket.open();
    await Promise.resolve();
    await Promise.resolve();
    const frame = JSON.parse(socket.sent[socket.sent.length - 1]) as { id: number };
    socket.receive({ jsonrpc: '2.0', id: frame.id, result: { running: true } });
    await pending;
    return { transport, socket };
  }

  it('backend:get-status reflects a healthy WS transport instead of hardcoded disconnected', async () => {
    const { transport } = await connectTransport();
    const res = await api.invoke('backend:get-status');
    expect(res.status).toBe('connected');
    // Sanitized target: no ?token= query, external-ws mode so the overlay
    // hides the spawn-sidecar button and locality treats the daemon as remote.
    expect(res.transport).toEqual({ mode: 'external-ws', target: 'ws://127.0.0.1:5181/rpc' });
    (transport as { dispose?: () => void }).dispose?.();
  });

  it('reports external-ws (status connecting) before the transport singleton exists', async () => {
    const res = await api.invoke('backend:get-status');
    expect(res.status).toBe('connecting');
    expect(res.transport).toEqual({ mode: 'external-ws', target: 'ws://127.0.0.1:5181/rpc' });
  });

  it('delivers backend:status push events to electronAPI.on listeners across drop and reconnect', async () => {
    const { transport, socket } = await connectTransport();
    const events: Array<{ status: string; transport?: unknown }> = [];
    api.on('backend:status', (payload: { status: string; transport?: unknown }) => {
      events.push(payload);
    });

    vi.useFakeTimers();
    socket.drop();
    expect(events).toContainEqual({
      status: 'disconnected',
      transport: { mode: 'external-ws', target: 'ws://127.0.0.1:5181/rpc' },
    });

    // Reconnect: backoff timer fires, a new socket opens, status goes healthy.
    vi.advanceTimersByTime(1_000);
    const reconnectSocket = FakeWebSocket.instances[FakeWebSocket.instances.length - 1];
    expect(reconnectSocket).not.toBe(socket);
    reconnectSocket.open();
    expect(events).toContainEqual({
      status: 'connected',
      transport: { mode: 'external-ws', target: 'ws://127.0.0.1:5181/rpc' },
    });
    // Mirrors backend.ipc.ts: the 2nd+ connect also carries the
    // `reconnected: true` marker AFTER the plain 'connected' event.
    expect(events[events.length - 1]).toEqual({
      status: 'connected',
      reconnected: true,
      transport: { mode: 'external-ws', target: 'ws://127.0.0.1:5181/rpc' },
    });
    (transport as { dispose?: () => void }).dispose?.();
  });

  it('keeps the legacy mock disconnected shape when no WS URL is configured', async () => {
    vi.stubEnv('VITE_INTENTD_WS_URL', '');
    delete (window as any).electronAPI;
    await importBrowserMock();
    api = (window as any).electronAPI;
    const res = await api.invoke('backend:get-status');
    expect(res).toEqual({ status: 'disconnected', transport: 'browser-mock' });
  });
});
