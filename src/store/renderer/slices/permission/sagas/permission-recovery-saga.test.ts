import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { runSaga, stdChannel } from 'redux-saga';
import { withLegacyPrincipal } from '../../../../../test/fixtures/principal-state';
import { createCollection } from '@themislib/themis/utils/collections/collection-utils';
import {
  initialState,
  permissionRequestReceived,
  removePermissionRequest,
  setPendingRequests,
} from '../permission-slice';
const request = vi.hoisted(() => vi.fn());
vi.mock('$lib/client/live/backend-transport', () => ({ backendRequest: request }));
import { selectPrincipalActionContext } from '../../principal/principal-selectors';
import { permissionRecoverySaga } from './permission-recovery-saga';
const prompt = {
  requestId: 'p1',
  sessionId: 'a1',
  title: 'Allow tool',
  options: [{ id: 'allow', label: 'Allow' }],
  timestamp: 1,
};
const running: ReturnType<typeof runSaga>[] = [];
beforeEach(() => request.mockReset());
afterEach(() => running.splice(0).forEach((task) => task.cancel()));

function recoveryFixture(count = 1) {
  let state = withLegacyPrincipal({
    permission: initialState,
    workspace: {
      hasLoaded: true,
      loadedBackendId: 'local',
      workspaces: createCollection('id', [{ id: 'ws', myRole: 'owner', canManage: true }]),
    },
    agentSessions: { byAgentId: {} },
  });
  state.agentSessions.byAgentId = Object.fromEntries(
    Array.from({ length: count }, (_, i) => [`a${i + 1}`, { id: `a${i + 1}`, workspaceId: 'ws' }]),
  ) as typeof state.agentSessions.byAgentId;
  const listeners = new Set<() => void>();
  const channel = stdChannel();
  const dispatch = vi.fn();
  const reduxStore = {
    getState: () => state,
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
  return {
    dispatch,
    channel,
    get state() {
      return state;
    },
    update(next: typeof state) {
      state = next;
      listeners.forEach((listener) => listener());
    },
    start() {
      const task = runSaga(
        { channel, dispatch, getState: () => state, context: { reduxStore } },
        permissionRecoverySaga,
      );
      running.push(task);
      return task;
    },
  };
}

async function settle() {
  // Drain the finite promise/saga continuation chain, without wall-clock timing.
  for (let i = 0; i < 500; i++) await Promise.resolve();
}

describe('bounded subscription recovery', () => {
  it('uses one authorized aggregate snapshot for 100 known agents', async () => {
    request.mockResolvedValue({ requests: [prompt] });
    const f = recoveryFixture(100);
    f.start();
    await settle();
    expect(request.mock.calls).toEqual([['agent.pendingPermissions', {}]]);
    expect(f.dispatch).toHaveBeenCalledWith(setPendingRequests([{ ...prompt, workspaceId: 'ws' }]));
  });

  it('does not restart scans for discovery or unrelated scope updates', async () => {
    request.mockResolvedValue({ requests: [] });
    const f = recoveryFixture(100);
    f.start();
    await settle();
    request.mockClear();
    f.update({
      ...f.state,
      agentSessions: {
        ...f.state.agentSessions,
        byAgentId: {
          ...f.state.agentSessions.byAgentId,
          a101: { ...f.state.agentSessions.byAgentId.a1!, id: 'a101' },
        },
      },
    });
    await settle();
    f.update({ ...f.state, permission: { ...f.state.permission } });
    await settle();
    expect(request).not.toHaveBeenCalled();
  });
});

function deferred() {
  let resolve!: (value: unknown) => void;
  const promise = new Promise((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

function discover(f: ReturnType<typeof recoveryFixture>, id: string, workspaceId = 'ws') {
  f.update({
    ...f.state,
    agentSessions: {
      ...f.state.agentSessions,
      byAgentId: {
        ...f.state.agentSessions.byAgentId,
        [id]: { ...f.state.agentSessions.byAgentId.a1!, id, workspaceId },
      },
    },
  });
}

function authorizeRole(
  f: ReturnType<typeof recoveryFixture>,
  role: 'owner' | 'member' | 'guest',
  canManage = true,
) {
  const state = f.state;
  const next = {
    ...state,
    principal: {
      ...state.principal,
      snapshot: {
        ...state.principal.snapshot!,
        principal: { ...state.principal.snapshot!.principal, hostRole: role },
        capabilities: { ...state.principal.snapshot!.capabilities, hostMembership: true },
      },
    },
  };
  next.workspace = {
    ...state.workspace,
    capabilityContext: selectPrincipalActionContext.select(next),
    workspaces: createCollection('id', [
      { id: 'ws', myRole: canManage ? 'owner' : 'collaborator', canManage },
    ]),
  } as typeof state.workspace;
  f.update(next);
}

describe('snapshot races and admission', () => {
  it('recovers snapshot prompts after late agent discovery without refetching', async () => {
    request.mockResolvedValue({ requests: [prompt] });
    const f = recoveryFixture(0);
    f.start();
    await settle();
    expect(f.dispatch).not.toHaveBeenCalled();
    discover(f, 'a1');
    await settle();
    expect(request.mock.calls).toEqual([['agent.pendingPermissions', {}]]);
    expect(f.dispatch).toHaveBeenCalledExactlyOnceWith(
      setPendingRequests([{ ...prompt, workspaceId: 'ws' }]),
    );
    discover(f, 'a2');
    await settle();
    expect(f.dispatch).toHaveBeenCalledTimes(1);
  });

  it('keeps unrelated snapshot prompts while live updates and resolutions win the race', async () => {
    const reply = deferred();
    request.mockReturnValue(reply.promise);
    const f = recoveryFixture();
    f.start();
    f.channel.put(permissionRequestReceived({ ...prompt, requestId: 'live', title: 'Newer' }));
    f.channel.put(removePermissionRequest('resolved'));
    reply.resolve({
      requests: [prompt, { ...prompt, requestId: 'live' }, { ...prompt, requestId: 'resolved' }],
    });
    await settle();
    expect(f.dispatch).toHaveBeenCalledExactlyOnceWith(
      setPendingRequests([{ ...prompt, workspaceId: 'ws' }]),
    );
  });

  it.each(['request', 'resolved'])(
    'does not revive a cached prompt after a late live %s event',
    async (event) => {
      request.mockResolvedValue({ requests: [prompt] });
      const f = recoveryFixture(0);
      f.start();
      await settle();
      f.channel.put(
        event === 'request'
          ? permissionRequestReceived({ ...prompt, title: 'Newer' })
          : removePermissionRequest('p1'),
      );
      discover(f, 'a1');
      await settle();
      expect(f.dispatch).not.toHaveBeenCalled();
      expect(request).toHaveBeenCalledTimes(1);
    },
  );

  it.each(['owner', 'member', 'guest'] as const)(
    'recovers an authorized %s with the same single snapshot',
    async (role) => {
      request.mockResolvedValue({ requests: [prompt] });
      const f = recoveryFixture();
      authorizeRole(f, role);
      f.start();
      await settle();
      expect(request.mock.calls).toEqual([['agent.pendingPermissions', {}]]);
      expect(f.dispatch).toHaveBeenCalledWith(
        setPendingRequests([{ ...prompt, workspaceId: 'ws' }]),
      );
      discover(f, 'a2');
      await settle();
      expect(request).toHaveBeenCalledTimes(1);
    },
  );

  it('does not admit recovered prompts for collaborators or unknown workspaces', async () => {
    // The server normally filters these out. Keep the renderer admission gate too.
    request.mockResolvedValue({
      requests: [prompt, { ...prompt, requestId: 'other', sessionId: 'a2' }],
    });
    const f = recoveryFixture();
    authorizeRole(f, 'guest', false);
    discover(f, 'a2', 'unknown');
    f.start();
    await settle();
    expect(f.dispatch).not.toHaveBeenCalled();
  });

  it('waits for current workspace capability hydration before binding prompts', async () => {
    request.mockResolvedValue({ requests: [prompt] });
    const f = recoveryFixture();
    authorizeRole(f, 'guest');
    f.update({ ...f.state, workspace: { ...f.state.workspace, capabilityContext: null } });
    f.start();
    await settle();
    expect(f.dispatch).not.toHaveBeenCalled();
    f.update({
      ...f.state,
      workspace: {
        ...f.state.workspace,
        capabilityContext: selectPrincipalActionContext.select(f.state),
      },
    });
    await settle();
    expect(f.dispatch).toHaveBeenCalledWith(setPendingRequests([{ ...prompt, workspaceId: 'ws' }]));
    expect(request).toHaveBeenCalledTimes(1);
  });

  it('waits for an admitted subscription and recovers again after reconnect', async () => {
    request.mockResolvedValue({ requests: [prompt] });
    const f = recoveryFixture();
    f.update({
      ...f.state,
      workspaceEvents: { ...f.state.workspaceEvents, subscriptionGeneration: 0 },
    });
    f.start();
    await settle();
    expect(request).not.toHaveBeenCalled();
    f.update(
      withLegacyPrincipal({
        ...f.state,
        workspaceEvents: { ...f.state.workspaceEvents, subscriptionGeneration: 1 },
      }),
    );
    await settle();
    expect(request).toHaveBeenCalledTimes(1);
    f.update({ ...f.state, daemonHealth: { ...f.state.daemonHealth, health: 'down' } });
    await settle();
    f.update(
      withLegacyPrincipal({
        ...f.state,
        workspaceEvents: { ...f.state.workspaceEvents, subscriptionGeneration: 2 },
      }),
    );
    await settle();
    expect(request.mock.calls).toEqual([
      ['agent.pendingPermissions', {}],
      ['agent.pendingPermissions', {}],
    ]);
  });

  it.each(['backend', 'principal', 'subscription'] as const)(
    'discards late replies after a %s change',
    async (change) => {
      const old = deferred();
      request.mockReturnValueOnce(old.promise).mockResolvedValue({ requests: [] });
      const f = recoveryFixture();
      f.start();
      const next = withLegacyPrincipal({
        ...f.state,
        connections: {
          ...f.state.connections,
          windowBackendId: change === 'backend' ? 'remote' : f.state.connections.windowBackendId,
        },
        workspaceEvents: {
          ...f.state.workspaceEvents,
          subscriptionGeneration: change === 'subscription' ? 2 : 1,
        },
      });
      if (change === 'principal') next.principal.snapshot!.principal.id = 'another';
      f.update(next);
      old.resolve({ requests: [prompt] });
      await settle();
      expect(request).toHaveBeenCalledTimes(2);
      expect(f.dispatch).not.toHaveBeenCalled();
    },
  );

  it('discards a reply after permission authority is revoked', async () => {
    const reply = deferred();
    request.mockReturnValue(reply.promise);
    const f = recoveryFixture();
    authorizeRole(f, 'guest');
    f.start();
    authorizeRole(f, 'guest', false);
    reply.resolve({ requests: [prompt] });
    await settle();
    expect(f.dispatch).not.toHaveBeenCalled();
  });

  it('discards a snapshot prompt denied by current workspace rights instead of caching it for a later grant', async () => {
    request.mockResolvedValue({ requests: [prompt] });
    const f = recoveryFixture();
    authorizeRole(f, 'guest', false);
    f.start();
    await settle();
    authorizeRole(f, 'guest', true);
    await settle();
    expect(f.dispatch).not.toHaveBeenCalled();
    expect(request).toHaveBeenCalledTimes(1);
  });

  it('does not retry failed reads on discovery, but retries after resubscription', async () => {
    request.mockRejectedValueOnce(new Error('offline')).mockResolvedValue({ requests: [prompt] });
    const f = recoveryFixture();
    f.start();
    await settle();
    discover(f, 'a2');
    await settle();
    expect(request).toHaveBeenCalledTimes(1);
    expect(f.dispatch).not.toHaveBeenCalled();
    f.update(
      withLegacyPrincipal({
        ...f.state,
        workspaceEvents: { ...f.state.workspaceEvents, subscriptionGeneration: 2 },
      }),
    );
    await settle();
    expect(request).toHaveBeenCalledTimes(2);
    expect(f.dispatch).toHaveBeenCalledWith(setPendingRequests([{ ...prompt, workspaceId: 'ws' }]));
  });

  it.each([
    { requests: null },
    { requests: [null] },
    { requests: [{ ...prompt, options: [null] }] },
  ])('ignores malformed snapshots without clearing live prompts', async (reply) => {
    request.mockResolvedValue(reply);
    const f = recoveryFixture();
    f.start();
    await settle();
    expect(f.dispatch).not.toHaveBeenCalled();
  });
});
