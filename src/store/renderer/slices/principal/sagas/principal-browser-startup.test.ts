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
  let recoverySupported = false;
  let holdPrincipal = false;
  const principalReplies: Array<() => void> = [];
  let receive: (event: { data: string }) => void;
  const frames: { id: number; method: string; params?: unknown }[] = [];

  class Socket {
    onopen: (() => void) | null = null;
    onmessage: ((event: { data: string }) => void) | null = null;
    onclose: (() => void) | null = null;
    onerror: (() => void) | null = null;
    constructor(readonly url: string) {
      receive = (event) => this.onmessage?.(event);
      queueMicrotask(() => this.onopen?.());
    }
    close() {}
    send(data: string) {
      const frame = JSON.parse(data);
      frames.push(frame);
      // Bound a regressed handshake loop so the real startup test fails instead of starving timers.
      if (
        frame.method === 'client.hello' &&
        frames.filter((item) => item.method === 'client.hello').length > 3
      ) {
        queueMicrotask(() =>
          this.onmessage?.({
            data: JSON.stringify({
              jsonrpc: '2.0',
              id: frame.id,
              error: { code: -32003, message: 'Repeated hello during startup' },
            }),
          }),
        );
        return;
      }
      let result: unknown = {};
      if (frame.method === 'client.hello')
        result = {
          clientId: 'browser-startup-client',
          server: {
            capabilities: { hostMembership: 1, eventStreamRecovery: recoverySupported ? 1 : 0 },
          },
        };
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
      if (frame.method === 'system.status')
        result = {
          running: true,
          listenMode: 'wss',
          transports: ['wss'],
          port: null,
          protocolVersion: '2.6',
          host: { os: 'linux', arch: 'x86_64', hasDisplay: false, locality: 'remote' },
        };
      if (frame.method === 'events.fence') result = frame.params;
      if (frame.method === 'git.status')
        result = {
          branch: 'recovered',
          ahead: 0,
          behind: 0,
          files: [{ path: 'final.ts', status: 'modified', staged: true }],
        };
      if (frame.method === 'events.subscribe')
        result = {
          subscriptionId: `subscription-${frame.id}`,
          ...(recoverySupported ? { lossRecovery: 1 } : {}),
        };
      const reply = () =>
        this.onmessage?.({ data: JSON.stringify({ jsonrpc: '2.0', id: frame.id, result }) });
      if (frame.method === 'principal.me' && holdPrincipal) principalReplies.push(reply);
      else queueMicrotask(reply);
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
    recoverySupported = false;
    holdPrincipal = false;
    principalReplies.length = 0;
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

  it('starts supported recovery through the real browser and production root owners', async () => {
    recoverySupported = true;
    const store = await boot();
    const { selectHostRole } = await import('../principal-selectors');
    await vi.waitFor(() => expect(selectHostRole.select(store.state)).toBe('owner'));
    expect(frames.filter((frame) => frame.method === 'events.subscribe')).toHaveLength(1);
    expect(frames.filter((frame) => frame.method === 'client.hello')).toHaveLength(1);
    expect(frames.find((frame) => frame.method === 'events.subscribe')?.params).toMatchObject({
      lossRecovery: 1,
    });
    expect(store.state.workspaceEvents.subscriptionPending).toBe(false);
  });

  it('rejects a held principal reply across same-socket identity renewal', async () => {
    recoverySupported = true;
    holdPrincipal = true;
    const store = await boot();
    const { selectHostRole } = await import('../principal-selectors');
    const { backendRequest } = await import('$lib/client/live/backend-transport');
    await vi.waitFor(() => expect(principalReplies).toHaveLength(1));
    const observed: Array<ReturnType<typeof selectHostRole.select>> = [];
    const { getContext } = await import('typed-redux-saga');
    store.runSaga(function* () {
      const redux = yield* getContext<{ subscribe(listener: () => void): () => void }>(
        'reduxStore',
      );
      cancel.push(redux.subscribe(() => observed.push(selectHostRole.select(store.state))));
    });
    role = 'guest';
    await backendRequest('client.hello', {});
    expect(selectHostRole.select(store.state)).toBeNull();
    principalReplies.shift()!();
    await vi.waitFor(() => expect(principalReplies).toHaveLength(1));
    expect(selectHostRole.select(store.state)).toBeNull();
    expect(observed).not.toContain('owner');
    holdPrincipal = false;
    principalReplies.shift()!();
    await vi.waitFor(() => expect(selectHostRole.select(store.state)).toBe('guest'));
    expect(observed).not.toContain('owner');
    expect(frames.filter((frame) => frame.method === 'client.hello')).toHaveLength(2);
    expect(frames.filter((frame) => frame.method === 'events.subscribe')).toHaveLength(2);
    expect(frames.filter((frame) => frame.method === 'principal.me')).toHaveLength(2);
  });

  it('recovers selected Git state after a final file loss with production owners and no later push', async () => {
    recoverySupported = true;
    const store = await boot();
    const { selectPrincipalActionContext } = await import('../principal-selectors');
    await vi.waitFor(() => expect(selectPrincipalActionContext.select(store.state)).not.toBeNull());
    const { replaceWorkspaceList, setWorkspaceHasLoaded } =
      await import('../../workspace/workspace-slice');
    const { WorkspaceId } = await import('$shared/types/branded-ids');
    const { openWorkspaceTab } = await import('../../tab-state/tab-state-slice');
    const { setGitStatus } = await import('../../git/git-slice');
    const workspaceId = 'startup-workspace';
    store.dispatch(
      replaceWorkspaceList([
        {
          id: WorkspaceId(workspaceId),
          title: 'Startup',
          myRole: 'owner',
          canManage: true,
        } as import('$shared/types').Workspace,
      ]),
    );
    store.dispatch(
      setWorkspaceHasLoaded(
        true,
        'browser-websocket',
        selectPrincipalActionContext.select(store.state),
      ),
    );
    store.dispatch(
      setGitStatus(workspaceId, {
        branch: 'old',
        ahead: 0,
        behind: 0,
        files: [],
      } as import('$shared/types').GitStatus),
    );
    store.dispatch(openWorkspaceTab(workspaceId));
    await vi.waitFor(() =>
      expect(frames.filter((frame) => frame.method === 'events.subscribe')).toHaveLength(2),
    );
    const scoped = frames.find(
      (frame) =>
        frame.method === 'events.subscribe' &&
        (frame.params as { workspaceId?: string }).workspaceId === workspaceId,
    )!;
    await new Promise((resolve) => setTimeout(resolve, 0));
    receive({
      data: JSON.stringify({
        jsonrpc: '2.0',
        method: 'events.lost',
        params: {
          subscriptionId: `subscription-${scoped.id}`,
          generation: '1',
          scope: { workspaceId },
        },
      }),
    });
    await vi.waitFor(() =>
      expect(store.state.git.byWorkspaceId[workspaceId]?.status?.branch).toBe('recovered'),
    );
    expect(store.state.git.byWorkspaceId[workspaceId]?.status?.files).toEqual([
      { path: 'final.ts', status: 'modified', staged: true },
    ]);
    expect(frames.filter((frame) => frame.method === 'git.status')).toHaveLength(1);
    expect(frames.filter((frame) => frame.method === 'events.fence')).toHaveLength(2);
    expect(frames.filter((frame) => frame.method === 'client.hello')).toHaveLength(1);
    expect(frames.filter((frame) => frame.method === 'events.subscribe')).toHaveLength(2);
  });

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
