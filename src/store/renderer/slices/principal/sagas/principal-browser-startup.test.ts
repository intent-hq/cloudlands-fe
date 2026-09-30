/** @vitest-environment jsdom */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/** Mock only the daemon wire: browser bridge, connection binding and role sagas are real. */
describe('principal discovery through browser startup', () => {
  const originalApi = window.electronAPI;
  let dispose: (() => void) | undefined;
  const cancel: (() => void)[] = [];
  let transport: { dispose?: () => void } | undefined;
  let role: 'owner' | 'member' | 'guest' = 'owner';
  let malformed = false;
  const frames: { id: number; method: string; params?: unknown }[] = [];

  class Socket {
    onopen: (() => void) | null = null;
    onmessage: ((event: { data: string }) => void) | null = null;
    onclose: (() => void) | null = null;
    onerror: (() => void) | null = null;
    constructor(readonly url: string) {
      queueMicrotask(() => this.onopen?.());
    }
    close() {}
    send(data: string) {
      const frame = JSON.parse(data);
      frames.push(frame);
      let result: unknown = {};
      if (frame.method === 'client.hello')
        result = { server: { capabilities: { hostMembership: 1 } } };
      if (frame.method === 'principal.me')
        result = malformed
          ? { id: 'caller' }
          : {
              id: 'caller',
              login: null,
              displayName: null,
              avatarUrl: null,
              isAdministrator: role === 'owner',
              hostRole: role,
              hostMembershipRevision: 0,
            };
      if (frame.method === 'events.subscribe')
        result = { subscriptionId: `subscription-${frame.id}` };
      queueMicrotask(() =>
        this.onmessage?.({ data: JSON.stringify({ jsonrpc: '2.0', id: frame.id, result }) }),
      );
    }
  }

  beforeEach(async () => {
    vi.resetModules();
    vi.stubEnv('DEV', true);
    vi.stubEnv('INTENT_BUILD_TARGET', 'web');
    vi.stubEnv('VITE_INTENTD_WS_URL', 'ws://127.0.0.1:7376/intentd/ws?token=test-secret');
    delete (window as Partial<Window>).electronAPI;
    vi.stubGlobal('WebSocket', Socket);
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    frames.length = 0;
    role = 'owner';
    malformed = false;
    await import('$lib/browser-mock');
  });
  afterEach(() => {
    cancel.splice(0).forEach((stop) => stop());
    transport?.dispose?.();
    dispose?.();
    transport = undefined;
    dispose = undefined;
    window.electronAPI = originalApi;
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  async function boot() {
    const { store } = await import('../../../store');
    const { connectionsSaga } = await import('../../connections/sagas/connections-saga');
    const { daemonHealthSaga } = await import('../../daemon-health/sagas/daemon-health-saga');
    const { daemonEventsSaga } = await import('../../workspace-events/sagas/daemon-events-saga');
    const { principalSaga } = await import('./principal-saga');
    const { resolveBackendTransport } = await import('$lib/client/live/backend-transport-factory');
    dispose = store.init();
    cancel.push(
      store.runSaga(connectionsSaga),
      store.runSaga(daemonHealthSaga),
      store.runSaga(daemonEventsSaga),
      store.runSaga(principalSaga),
    );
    transport = resolveBackendTransport() as typeof transport;
    return store;
  }

  it.each(['owner', 'member', 'guest'] as const)(
    'discovers the real browser %s without an Electron registry response',
    async (callerRole) => {
      role = callerRole;
      const store = await boot();
      const { selectHostRole, selectCanAdministerHost, selectCanCreateWorkspace } =
        await import('../principal-selectors');
      await vi.waitFor(() => expect(selectHostRole.select(store.state)).toBe(callerRole));
      expect(store.state.connections.windowBackendId).toBe('browser-websocket');
      expect(store.state.connections.hasReceivedList).toBe(true);
      expect(store.state.daemonHealth.health).toBe('healthy');
      expect(frames.filter((frame) => frame.method === 'principal.me')).toEqual([
        expect.objectContaining({ method: 'principal.me', params: {} }),
      ]);
      expect(frames.some((frame) => frame.method === 'client.hello')).toBe(true);
      expect(selectCanAdministerHost.select(store.state)).toBe(callerRole === 'owner');
      expect(selectCanCreateWorkspace.select(store.state)).toBe(callerRole !== 'guest');
    },
  );

  it('does not confer owner authority when the actual browser principal is malformed', async () => {
    malformed = true;
    const store = await boot();
    const { selectHostRole, selectCanAdministerHost } = await import('../principal-selectors');
    await vi.waitFor(() => expect(store.state.principal.status).toBe('error'));
    expect(selectHostRole.select(store.state)).toBeNull();
    expect(selectCanAdministerHost.select(store.state)).toBe(false);
  });

  it('keeps Electron unresolved until the real preload binds its window, even with a browser URL configured', async () => {
    vi.stubEnv('INTENT_BUILD_TARGET', 'electron');
    vi.spyOn(navigator, 'userAgent', 'get').mockReturnValue('Mozilla/5.0 Electron/33.0.0');
    delete (window as Partial<Window>).electronAPI;
    const store = await boot();
    const { selectHostRole } = await import('../principal-selectors');
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(store.state.connections.hasReceivedList).toBe(false);
    expect(selectHostRole.select(store.state)).toBeNull();
    expect(frames.some((frame) => frame.method === 'principal.me')).toBe(false);
  });

  it('does not turn a mock-only preview into an authenticated browser backend', async () => {
    vi.stubEnv('VITE_INTENTD_WS_URL', '');
    const store = await boot();
    const { selectHostRole } = await import('../principal-selectors');
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(store.state.connections.windowBackendId).not.toBe('browser-websocket');
    expect(selectHostRole.select(store.state)).toBeNull();
    expect(frames).toEqual([]);
  });
});
