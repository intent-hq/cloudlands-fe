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

import { mockInvoke, resetMockIpcRouter, UnbridgedMockIpcChannelError } from '$shared/ipc-mock-router';

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
    const { createElectronIpcBackendTransport } = await import(
      './client/live/electron-ipc-transport'
    );
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
