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
  let heldMethod: string | undefined;
  const heldReplies: Array<() => void> = [];
  const principalReplies: Array<() => void> = [];
  let receive: (event: { data: string }) => void;
  let wireReply: ((frame: { method: string; params?: unknown }) => unknown) | undefined;
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
        ['client.hello', 'events.subscribe'].includes(frame.method) &&
        frames.filter((item) => item.method === frame.method).length > 3
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
      if (frame.method === 'workspace.list') result = { workspaces: [] };
      if (frame.method === 'agent.listActive') result = { streams: [] };
      if (frame.method === 'agent.pendingPermissions') result = { requests: [] };
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
      const override = wireReply?.(frame);
      if (override !== undefined) result = override;
      const reply = () =>
        this.onmessage?.({ data: JSON.stringify({ jsonrpc: '2.0', id: frame.id, result }) });
      if (frame.method === 'principal.me' && holdPrincipal) principalReplies.push(reply);
      else if (frame.method === heldMethod) heldReplies.push(reply);
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
    wireReply = undefined;
    role = 'owner';
    malformed = false;
    recoverySupported = false;
    holdPrincipal = false;
    heldMethod = undefined;
    heldReplies.length = 0;
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

  it('applies an authoritative empty workspace envelope after global loss through production owners', async () => {
    recoverySupported = true;
    const store = await boot();
    const { selectPrincipalActionContext } = await import('../principal-selectors');
    await vi.waitFor(() => expect(selectPrincipalActionContext.select(store.state)).not.toBeNull());
    const { replaceWorkspaceList, setWorkspaceHasLoaded } =
      await import('../../workspace/workspace-slice');
    const { WorkspaceId, AgentId } = await import('$shared/types/branded-ids');
    const { bulkUpsertSessions } = await import('../../agent-session/agent-session-slice');
    const { createTestAgent } = await import('../../../../../test/factories/agent.factory');
    store.dispatch(
      replaceWorkspaceList([
        {
          id: WorkspaceId('removed-space'),
          title: 'Removed',
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
      bulkUpsertSessions([
        createTestAgent({
          id: AgentId('removed-agent'),
          workspaceId: WorkspaceId('removed-space'),
        }),
      ]),
    );
    expect(store.state.agentSessions.byAgentId['removed-agent']).toBeDefined();
    const global = frames.find((frame) => frame.method === 'events.subscribe')!;
    receive({
      data: JSON.stringify({
        jsonrpc: '2.0',
        method: 'events.lost',
        params: {
          subscriptionId: `subscription-${global.id}`,
          generation: '1',
          scope: { workspaceId: null },
        },
      }),
    });
    await vi.waitFor(() => expect(store.state.workspace.workspaces.ids).toEqual([]));
    expect(store.state.agentSessions.byAgentId['removed-agent']).toBeUndefined();
    expect(store.state.workspace.hasLoaded).toBe(true);
    expect(frames.filter((frame) => frame.method === 'client.hello')).toHaveLength(1);
    expect(frames.filter((frame) => frame.method === 'events.subscribe')).toHaveLength(1);
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

  async function bootLifecycle(supported = true) {
    recoverySupported = supported;
    const store = await boot();
    const { selectPrincipalActionContext } = await import('../principal-selectors');
    await vi.waitFor(() => expect(selectPrincipalActionContext.select(store.state)).not.toBeNull());
    const { replaceWorkspaceList, setWorkspaceHasLoaded } =
      await import('../../workspace/workspace-slice');
    const row = { id: 'lifecycle-probe', title: 'Old workspace', myRole: 'owner', canManage: true };
    store.dispatch(replaceWorkspaceList([row] as never));
    store.dispatch(
      setWorkspaceHasLoaded(
        true,
        'browser-websocket',
        selectPrincipalActionContext.select(store.state),
      ),
    );
    const { lifecycleReadSaga } =
      await import('../../workspace-lifecycle/sagas/lifecycle-read-saga');
    cancel.push(store.runSaga(lifecycleReadSaga));
    await vi.waitFor(() =>
      expect(frames.filter((f) => f.method === 'events.subscribe')).toHaveLength(1),
    );
    await new Promise((resolve) => setTimeout(resolve, 0));
    return { store, row, workspaceId: row.id };
  }
  async function globalLoss() {
    const sub = frames.find((f) => f.method === 'events.subscribe')!;
    receive({
      data: JSON.stringify({
        jsonrpc: '2.0',
        method: 'events.lost',
        params: {
          subscriptionId: `subscription-${sub.id}`,
          generation: '1',
          scope: { workspaceId: null },
        },
      }),
    });
    for (let i = 0; i < 100; i++) await Promise.resolve();
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
  const contextItem = (id: string) => ({
    id,
    type: 'browser-url',
    title: id,
    provider: 'browser',
    url: 'https://example.test',
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
  });
  it.each([false, true])(
    'cached inactive context recovers on next demand force=%s',
    async (force) => {
      const { store, row, workspaceId } = await bootLifecycle();
      let current = 'old';
      wireReply = (frame) =>
        frame.method === 'workspace.getContext'
          ? { items: [contextItem(current)] }
          : frame.method === 'workspace.list'
            ? { workspaces: [row] }
            : undefined;
      const { initContextForWorkspace } = await import('../../context/context-slice');
      store.dispatch(initContextForWorkspace(workspaceId));
      await vi.waitFor(() =>
        expect(store.state.context.byWorkspaceId[workspaceId]?.items.ids).toEqual(['old']),
      );
      expect(frames.filter((f) => f.method === 'workspace.getContext')).toHaveLength(1);
      expect(store.state.workspaceLifecycle.sessionPhaseByWorkspaceId[workspaceId]).toBeUndefined();
      current = 'new';
      await globalLoss();
      expect(frames.filter((f) => f.method === 'workspace.getContext')).toHaveLength(1);
      const fences = frames.filter((f) => f.method === 'events.fence').length;
      store.dispatch(initContextForWorkspace(workspaceId, force));
      await vi.waitFor(() =>
        expect(store.state.context.byWorkspaceId[workspaceId]?.items.ids).toEqual(['new']),
      );
      expect(frames.filter((f) => f.method === 'workspace.getContext')).toHaveLength(2);
      expect(frames.filter((f) => f.method === 'events.fence')).toHaveLength(fences + 2);
      expect(frames.filter((f) => f.method === 'client.hello')).toHaveLength(1);
    },
  );
  it('inactive activity recovers on next ordinary load request', async () => {
    const { store, row, workspaceId } = await bootLifecycle();
    let current = 'old';
    wireReply = (frame) =>
      frame.method === 'event.query'
        ? {
            items: [
              {
                id: current,
                type: 'agent:idle',
                workspaceId,
                timestamp: '2026-01-01T00:00:00Z',
                actor: { type: 'agent', id: 'agent' },
                data: { agentId: 'agent' },
              },
            ],
            nextToken: null,
          }
        : frame.method === 'workspace.list'
          ? { workspaces: [row] }
          : undefined;
    const { loadEventsRequested } = await import('../../workspace-events/workspace-events-slice');
    store.dispatch(loadEventsRequested(workspaceId));
    await vi.waitFor(() =>
      expect(
        store.state.workspaceEvents.byWorkspaceId[workspaceId]?.events.map((e) => e.id),
      ).toEqual(['old']),
    );
    expect(frames.filter((f) => f.method === 'event.query')).toHaveLength(1);
    current = 'new';
    await globalLoss();
    const fences = frames.filter((f) => f.method === 'events.fence').length;
    expect(frames.filter((f) => f.method === 'event.query')).toHaveLength(1);
    store.dispatch(loadEventsRequested(workspaceId));
    await vi.waitFor(() =>
      expect(
        store.state.workspaceEvents.byWorkspaceId[workspaceId]?.events.map((e) => e.id),
      ).toEqual(['new']),
    );
    expect(frames.filter((f) => f.method === 'event.query')).toHaveLength(2);
    expect(frames.filter((f) => f.method === 'events.fence')).toHaveLength(fences + 2);
  });
  it.each([false, true])('skills recover after final loss with mounted=%s', async (mounted) => {
    const { store, row, workspaceId } = await bootLifecycle();
    const { loadSkillsRequested } = await import('../../skills/skills-slice');
    let current = 'old';
    wireReply = (frame) =>
      frame.method === 'skill.list'
        ? [{ name: current, description: current, location: '/skills/test', scope: 'workspace' }]
        : frame.method === 'workspace.list'
          ? { workspaces: [row] }
          : undefined;
    const names = () =>
      store.state.skills.byWorkspaceId[workspaceId]?.skills.map((skill) => skill.name);
    store.dispatch(loadSkillsRequested(workspaceId));
    await vi.waitFor(() => expect(names()).toEqual(['old']));
    if (mounted) {
      const { workspaceMounted } =
        await import('../../workspace-lifecycle/workspace-lifecycle-slice');
      store.dispatch(workspaceMounted(workspaceId));
    }
    current = 'new';
    await globalLoss();
    if (!mounted) expect(frames.filter((frame) => frame.method === 'skill.list')).toHaveLength(1);
    const fences = frames.filter((frame) => frame.method === 'events.fence').length;
    if (!mounted) store.dispatch(loadSkillsRequested(workspaceId));
    await vi.waitFor(() => expect(names()).toEqual(['new']));
    expect(frames.filter((frame) => frame.method === 'skill.list')).toHaveLength(2);
    if (!mounted)
      expect(frames.filter((frame) => frame.method === 'events.fence')).toHaveLength(fences + 2);
  });

  it.each(['retire', 'push', 'legacy'] as const)(
    'skills preserve the %s boundary',
    async (mode) => {
      const { store, row, workspaceId } = await bootLifecycle(mode !== 'legacy');
      const { loadSkillsRequested } = await import('../../skills/skills-slice');
      const { workspaceMounted } =
        await import('../../workspace-lifecycle/workspace-lifecycle-slice');
      let current = 'old';
      wireReply = (frame) =>
        frame.method === 'skill.list'
          ? [{ name: current, description: current, location: '/skills/test', scope: 'project' }]
          : frame.method === 'workspace.list'
            ? { workspaces: [row] }
            : undefined;
      const names = () =>
        store.state.skills.byWorkspaceId[workspaceId]?.skills.map((skill) => skill.name) ?? [];
      store.dispatch(loadSkillsRequested(workspaceId));
      await vi.waitFor(() => expect(names()).toEqual(['old']));
      current = 'new';
      if (mode === 'retire') {
        await globalLoss();
        heldMethod = 'skill.list';
        store.dispatch(loadSkillsRequested(workspaceId));
        await vi.waitFor(() => expect(heldReplies).toHaveLength(1));
        transport?.dispose?.();
        await vi.waitFor(() => expect(names()).toEqual([]));
        heldReplies.shift()!();
        await new Promise((resolve) => setTimeout(resolve, 0));
        expect(names()).toEqual([]);
      } else if (mode === 'push') {
        store.dispatch(workspaceMounted(workspaceId));
        const sub = frames.find((frame) => frame.method === 'events.subscribe')!;
        receive({
          data: JSON.stringify({
            jsonrpc: '2.0',
            method: 'events.event',
            params: {
              subscriptionId: `subscription-${sub.id}`,
              event: { type: 'skills:changed', workspaceId, data: { workspaceId } },
            },
          }),
        });
        await vi.waitFor(() => expect(names()).toEqual(['new']));
        expect(frames.filter((frame) => frame.method === 'events.fence')).toHaveLength(0);
      } else {
        store.dispatch(loadSkillsRequested(workspaceId));
        await vi.waitFor(() => expect(names()).toEqual(['new']));
        expect(frames.filter((frame) => frame.method === 'events.fence')).toHaveLength(0);
      }
      expect(frames.filter((frame) => frame.method === 'skill.list')).toHaveLength(2);
      expect(frames.filter((frame) => frame.method === 'client.hello')).toHaveLength(1);
      expect(frames.filter((frame) => frame.method === 'events.subscribe')).toHaveLength(1);
    },
  );

  it('workspace list accepts the actual daemon response envelope', async () => {
    const { store, row, workspaceId } = await bootLifecycle();
    wireReply = (frame) =>
      frame.method === 'workspace.list'
        ? { workspaces: [{ ...row, title: 'Recovered workspace' }] }
        : undefined;
    await globalLoss();
    await vi.waitFor(() =>
      expect(store.state.workspace.workspaces.map[workspaceId]?.title).toBe('Recovered workspace'),
    );
    // Workspace projection and the independent failure registry each own one read.
    expect(frames.filter((f) => f.method === 'workspace.list')).toHaveLength(2);
  });

  it.each(['context', 'activity'] as const)(
    'retires a held next-demand %s recovery without applying its late reply',
    async (domain) => {
      const { store, row, workspaceId } = await bootLifecycle();
      const { initContextForWorkspace } = await import('../../context/context-slice');
      const { loadEventsRequested } = await import('../../workspace-events/workspace-events-slice');
      const method = domain === 'context' ? 'workspace.getContext' : 'event.query';
      const demand = () =>
        store.dispatch(
          domain === 'context'
            ? initContextForWorkspace(workspaceId)
            : loadEventsRequested(workspaceId),
        );
      const ids = () =>
        domain === 'context'
          ? (store.state.context.byWorkspaceId[workspaceId]?.items.ids ?? [])
          : (store.state.workspaceEvents.byWorkspaceId[workspaceId]?.events.map((e) => e.id) ?? []);
      let current = 'old';
      wireReply = (frame) =>
        frame.method === 'workspace.list'
          ? { workspaces: [row] }
          : frame.method === method
            ? domain === 'context'
              ? { items: [contextItem(current)] }
              : {
                  items: [
                    {
                      id: current,
                      type: 'agent:idle',
                      workspaceId,
                      timestamp: '2026-01-01T00:00:00Z',
                      actor: { type: 'agent', id: 'agent' },
                      data: { agentId: 'agent' },
                    },
                  ],
                  nextToken: null,
                }
            : undefined;
      demand();
      await vi.waitFor(() => expect(ids()).toEqual(['old']));
      await globalLoss();
      current = 'late';
      heldMethod = method;
      demand();
      await vi.waitFor(() => expect(heldReplies).toHaveLength(1));
      expect(frames.filter((frame) => frame.method === method)).toHaveLength(2);
      transport?.dispose?.();
      await vi.waitFor(() => expect(ids()).toEqual([]));
      heldReplies.shift()!();
      await new Promise((resolve) => setTimeout(resolve, 0));
      expect(ids()).toEqual([]);
      expect(frames.filter((frame) => frame.method === method)).toHaveLength(2);
    },
  );

  it.each([false, true])(
    'inactive agent metrics recover on ordinary demand after final loss (held control=%s)',
    async (heldControl) => {
      const { store, row, workspaceId } = await bootLifecycle();
      const { normalizeAgent } = await import('$lib/client/live/live-agents-client');
      const { bulkUpsertSessions } =
        await import('$store/renderer/slices/agent-session/agent-session-slice');
      const { setAgents } =
        await import('$store/renderer/slices/workspace-agents/workspace-agents-slice');
      const { updateAgentStats, requestAgentLineStats } =
        await import('$store/renderer/slices/changes/changes-slice');
      const { acquireAgentMetadataDemand } = await import('$features/agent/agent-metadata-demand');
      const { rendererEventRecovery } = await import('$features/events/renderer-event-recovery');
      const { agentMetadataRecoveryKey } = await import('$features/agent/agent-recovery-keys');
      const agentId = 'inactive-metrics-agent';
      const agent = { id: agentId, workspaceId, name: 'Recovered agent', status: 'idle' };
      const replies: Record<string, unknown> = {
        'workspace.list': { workspaces: [row] },
        'workspace.get': { workspace: row },
        'agent.list': {
          agents: [agent],
          retiredCount: 0,
          scopeCounts: { topLevel: 1, delegated: 0, background: 0 },
        },
        'agent.get': { agent },
        'metrics.getAgentStats': { additions: 8, deletions: 3, filesChanged: 1 },
      };
      wireReply = (frame) => replies[frame.method];
      const old = normalizeAgent({
        ...agent,
        name: 'Old agent',
        messages: [
          {
            id: 'retained',
            role: 'user',
            content: 'Retained conversation',
            timestamp: '2026-01-01T00:00:00Z',
          },
        ],
      });
      store.dispatch(setAgents(workspaceId, [old]));
      store.dispatch(bulkUpsertSessions([old]));
      store.dispatch(
        updateAgentStats(agentId, {
          additions: 1,
          deletions: 1,
          timestamp: '2026-01-01T00:00:00Z',
        }),
      );
      await vi.waitFor(() =>
        expect(rendererEventRecovery.hasOwner(agentMetadataRecoveryKey(workspaceId))).toBe(true),
      );
      await globalLoss();
      expect(frames.filter((frame) => frame.method === 'metrics.getAgentStats')).toHaveLength(0);
      const fences = frames.filter((frame) => frame.method === 'events.fence').length;
      if (heldControl)
        cancel.push(acquireAgentMetadataDemand(workspaceId, { agentId, lineStats: true }));
      store.dispatch(requestAgentLineStats(agentId, true));
      await vi.waitFor(() =>
        expect(store.state.changes.agentStats[agentId]).toMatchObject({
          additions: 8,
          deletions: 3,
        }),
      );
      expect(store.state.agentSessions.byAgentId[agentId].name).toBe('Recovered agent');
      expect(store.state.agentSessions.byAgentId[agentId].messages).toEqual(old.messages);
      expect(frames.filter((frame) => frame.method === 'metrics.getAgentStats')).toHaveLength(1);
      expect(frames.filter((frame) => frame.method === 'agent.list')).toHaveLength(1);
      expect(frames.filter((frame) => frame.method === 'events.fence')).toHaveLength(fences + 2);
      expect(frames.filter((frame) => frame.method === 'client.hello')).toHaveLength(1);
      expect(frames.some((frame) => /Conversation|^chat\./.test(frame.method))).toBe(false);
    },
  );
});
