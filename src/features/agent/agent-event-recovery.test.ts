import {
  fileTrackingReducer,
  updateAgentStats,
  agentLineStatsRequestStarted,
} from '$store/renderer/slices/changes/changes-slice';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { getItems } from '@themislib/themis/utils/collections/collection-utils';
import { RendererEventRecovery } from '$features/events/renderer-event-recovery';
import type { EventRecoverySession, RecoveryNotification } from '$shared/event-recovery/session';
import {
  agentQueueReducer,
  replaceAgentQueue,
} from '$store/renderer/slices/agent-queue/agent-queue-slice';
import { registerAgentQueueRecovery } from './agent-event-recovery';

function harness() {
  let receive!: (n: RecoveryNotification) => void | Promise<void>;
  let retire!: () => void;
  let current = true;
  let serial = 0;
  const request = vi.fn(async (method: string, _params?: unknown): Promise<unknown> =>
    method === 'events.subscribe'
      ? { subscriptionId: `lease-${++serial}`, lossRecovery: 1 }
      : { success: true, queue: [] },
  );
  const fence = vi.fn(async (_ids: readonly string[], observe: () => void) => {
    await Promise.resolve();
    observe();
  });
  const session: EventRecoverySession = {
    supported: true,
    isCurrent: () => current,
    onNotification: (fn) => {
      receive = fn;
      return () => {};
    },
    onRetired: (fn) => {
      retire = fn;
      return () => {};
    },
    request: request as EventRecoverySession['request'],
    fence,
    dispose: () => {},
  };
  const registry = new RendererEventRecovery();
  const scope = registry.attach(session);
  let state = agentQueueReducer(
    undefined,
    replaceAgentQueue(
      'a',
      [{ id: 'old', content: 'queued', queuedAt: '2026-01-01T00:00:00Z', position: 0 }],
      'ws',
    ),
  );
  const owner = registerAgentQueueRecovery(scope, 'ws', 'a', {
    isCurrent: () => true,
    dispatch: (action) => {
      state = agentQueueReducer(state, action);
    },
  });
  return {
    scope,
    registry,
    owner,
    request,
    fence,
    get state() {
      return state;
    },
    emit: (n: RecoveryNotification) => receive(n),
    retire: () => {
      current = false;
      retire();
    },
  };
}
const loss = {
  method: 'events.lost',
  params: { subscriptionId: 'lease-1', generation: '1', scope: { workspaceId: 'ws' } },
};
async function settle() {
  for (let i = 0; i < 80; i++) await Promise.resolve();
}
afterEach(() => vi.useRealTimers());

describe('agent queue loss recovery', () => {
  it('removes a final drained queue after duplicate loss with one read and two fences', async () => {
    const h = harness();
    await h.scope.subscribe({ workspaceId: 'ws', eventTypes: ['agent:*'] }, { recover: true });
    h.emit(loss);
    h.emit(loss);
    await settle();
    expect(getItems(h.state.byAgentId.a.messages)).toEqual([]);
    expect(h.request.mock.calls).toEqual([
      ['events.subscribe', { workspaceId: 'ws', eventTypes: ['agent:*'], lossRecovery: 1 }],
      ['agent.getQueue', { workspaceId: 'ws', agentId: 'a' }],
    ]);
    expect(h.fence).toHaveBeenCalledTimes(2);
    h.registry.dispose();
  });
  it('retires a protected queue and drops a held reply after principal replacement', async () => {
    const h = harness();
    await h.scope.subscribe({ workspaceId: 'ws', eventTypes: ['agent:*'] }, { recover: true });
    let resolve!: (value: unknown) => void;
    h.request.mockImplementationOnce(
      () =>
        new Promise((done) => {
          resolve = done;
        }),
    );
    h.emit(loss);
    await settle();
    h.retire();
    expect(h.state.byAgentId.a).toBeUndefined();
    resolve({
      queue: [{ id: 'stale', content: 'secret', position: 0, queuedAt: '2026-01-01T00:00:00Z' }],
    });
    await settle();
    expect(h.state.byAgentId.a).toBeUndefined();
    expect(h.fence).toHaveBeenCalledTimes(1);
    expect(h.request).toHaveBeenCalledTimes(2);
    h.registry.dispose();
  });
  it('clears a canonical missing queue without retrying', async () => {
    const h = harness();
    await h.scope.subscribe({ workspaceId: 'ws', eventTypes: ['agent:*'] }, { recover: true });
    h.request.mockRejectedValueOnce(
      Object.assign(new Error('gone'), { rpcCode: -32602, data: { code: 'not-found' } }),
    );
    h.emit(loss);
    await settle();
    expect(h.state.byAgentId.a).toBeUndefined();
    expect(h.request).toHaveBeenCalledTimes(2);
    expect(h.fence).toHaveBeenCalledTimes(1);
    h.registry.dispose();
  });
});

type UnknownAction = { type: string; payload?: unknown };
import { createCollection } from '@themislib/themis/utils/collections/collection-utils';
import { withLegacyPrincipal } from '../../test/fixtures/principal-state';
import {
  principalReducer,
  principalContextChanged,
} from '$store/renderer/slices/principal/principal-slice';
import {
  permissionReducer,
  permissionRequestReceived,
} from '$store/renderer/slices/permission/permission-slice';
import {
  agentSessionReducer,
  bulkUpsertSessions,
} from '$store/renderer/slices/agent-session/agent-session-slice';
import {
  workspaceAgentsReducer,
  setAgents,
} from '$store/renderer/slices/workspace-agents/workspace-agents-slice';
import { agentSubscriptionUIReducer } from '$store/renderer/slices/agent-subscription-ui/agent-subscription-ui-slice';
import { installAgentEventRecovery } from './agent-event-recovery';
import { activeStreamsTracker } from './services/active-streams-tracker';
import { clearAgentFailureRegistry, getAgentFailureEntry } from './agent-failure-registry';
import { normalizeAgent } from '$lib/client/live/live-agents-client';
import { trackAgentMetadataRead } from './agent-metadata-read-lane';
import { acquireAgentMetadataDemand } from './agent-metadata-recovery';

function integration() {
  const h = harness();
  h.owner.dispose();
  const agent = normalizeAgent({ id: 'a', workspaceId: 'ws', status: 'active', name: 'Old' });
  let state = withLegacyPrincipal({
    workspace: {
      hasLoaded: true,
      loadedBackendId: 'local',
      workspaces: createCollection('id', [{ id: 'ws', myRole: 'owner', canManage: true }]),
    },
    workspaceLifecycle: { sessionPhaseByWorkspaceId: {}, loadByWorkspaceId: {} },
    workspaceAgents: workspaceAgentsReducer(undefined, setAgents('ws', [agent])),
    agentSessions: agentSessionReducer(undefined, bulkUpsertSessions([agent])),
    agentQueue: h.state,
    changes: fileTrackingReducer(undefined, { type: '@@init' }),
    agentSubscriptionUI: agentSubscriptionUIReducer(undefined, { type: '@@init' }),
    permission: permissionReducer(
      undefined,
      permissionRequestReceived({
        requestId: 'old',
        sessionId: 'a',
        workspaceId: 'ws',
        title: 'Old permission',
        options: [],
        timestamp: 1,
      }),
    ),
  });
  const listeners = new Set<() => void>();
  const store = {
    getState: () => state,
    subscribe: (f: () => void) => {
      listeners.add(f);
      return () => {
        listeners.delete(f);
      };
    },
    dispatch: (action: UnknownAction) => {
      state = {
        ...state,
        principal: principalReducer(state.principal, action),
        changes: fileTrackingReducer(state.changes, action),
        permission: permissionReducer(state.permission, action),
        agentSessions: agentSessionReducer(state.agentSessions, action),
        workspaceAgents: workspaceAgentsReducer(state.workspaceAgents, action),
        agentQueue: agentQueueReducer(state.agentQueue, action),
        agentSubscriptionUI: agentSubscriptionUIReducer(state.agentSubscriptionUI, action),
      };
      for (const listener of listeners) listener();
      return action;
    },
  };
  h.request.mockImplementation(async (method) => {
    switch (method) {
      case 'events.subscribe':
        return { subscriptionId: 'lease-1', lossRecovery: 1 };
      case 'agent.getQueue':
        return { success: true, queue: [] };
      case 'agent.pendingPermissions':
        return { requests: [] };
      case 'agent.listActive':
        return { streams: [] };
      case 'workspace.list':
        return {
          workspaces: [
            { id: 'ws', agentSummary: { agents: [{ id: 'failed-new', status: 'error' }] } },
          ],
        };
      case 'workspace.get':
        return { workspace: { id: 'ws', agentSummary: { agents: [] } } };
      case 'agent.get':
        return {
          agent: {
            id: 'failed-new',
            workspaceId: 'ws',
            status: 'error',
            stopReason: 'Lost terminal error',
            stopReasonTimestamp: '2026-01-01T00:00:00Z',
          },
        };
      case 'agent.list':
        return {
          agents: [{ id: 'a', workspaceId: 'ws', status: 'idle', name: 'Recovered' }],
          retiredCount: 0,
          scopeCounts: { topLevel: 1, delegated: 0, background: 0 },
        };
      default:
        throw new Error(method);
    }
  });
  const stop = installAgentEventRecovery(h.scope, store);
  return {
    ...h,
    store,
    stop,
    get state() {
      return state;
    },
  };
}

describe('agent state snapshots', () => {
  afterEach(() => {
    activeStreamsTracker.replaceSnapshot([]);
    clearAgentFailureRegistry();
  });
  it('recovers a lost permission resolution, stream end and previously unseen failure without replay or transcripts', async () => {
    const h = integration();
    activeStreamsTracker.replaceSnapshot([
      { agentId: 'a', workspaceId: 'ws', sessionId: 'a', startTime: 0 },
    ]);
    await h.scope.subscribe({ eventTypes: ['agent:*'] }, { recover: true });
    h.emit({ ...loss, params: { ...loss.params, scope: { workspaceId: null } } });
    await settle();
    expect(getItems(h.state.permission.requests)).toEqual([]);
    expect(getItems(h.state.agentQueue.byAgentId.a.messages)).toEqual([]);
    expect(activeStreamsTracker.isAgentStreaming('a')).toBe(false);
    expect(getAgentFailureEntry('failed-new')).toMatchObject({
      error: 'Lost terminal error',
      workspaceId: 'ws',
    });
    expect(h.request.mock.calls.map(([method]) => method).sort()).toEqual(
      [
        'events.subscribe',
        'agent.pendingPermissions',
        'agent.getQueue',
        'agent.listActive',
        'workspace.list',
        'agent.get',
      ].sort(),
    );
    expect(h.fence).toHaveBeenCalledTimes(8);
    h.retire();
    expect(h.state.agentQueue.byAgentId.a).toBeUndefined();
    expect(getItems(h.state.permission.requests)).toEqual([]);
    expect(getAgentFailureEntry('failed-new')).toBeUndefined();
    h.stop();
    h.registry.dispose();
  });
  it('defers inactive metadata recovery until HUD demand and preserves the stored transcript', async () => {
    const h = integration();
    const old = h.state.agentSessions.byAgentId.a;
    h.store.dispatch(
      bulkUpsertSessions([
        {
          ...old,
          messages: [
            {
              id: 'message',
              role: 'user',
              content: 'Retained conversation',
              timestamp: '2026-01-01T00:00:00Z',
            },
          ],
        },
      ]),
    );
    const messages = h.state.agentSessions.byAgentId.a.messages;
    await h.scope.subscribe({ eventTypes: ['agent:*'] }, { recover: true });
    h.emit({ ...loss, params: { ...loss.params, scope: { workspaceId: null } } });
    await settle();
    expect(h.request.mock.calls.some(([method]) => method === 'agent.list')).toBe(false);
    const release = acquireAgentMetadataDemand('ws', { hud: true });
    await settle();
    expect(h.state.agentSessions.byAgentId.a.name).toBe('Recovered');
    expect(h.state.agentSessions.byAgentId.a.messages).toEqual(messages);
    expect(h.request.mock.calls.filter(([method]) => method === 'agent.list')).toEqual([
      ['agent.list', { workspaceId: 'ws', scope: 'topLevel' }],
    ]);
    expect(h.request.mock.calls.some(([method]) => /Conversation|chat\./.test(method))).toBe(false);
    release();
    h.stop();
    h.registry.dispose();
  });
});

describe('agent recovery request bounds', () => {
  it('coalesces two covering loss leases into one queue snapshot', async () => {
    const h = harness();
    await h.scope.subscribe({ workspaceId: 'ws', eventTypes: ['agent:*'] }, { recover: true });
    await h.scope.subscribe({ eventTypes: ['agent:*'] }, { recover: true });
    h.emit(loss);
    h.emit({
      ...loss,
      params: { subscriptionId: 'lease-2', generation: '1', scope: { workspaceId: null } },
    });
    await settle();
    expect(getItems(h.state.byAgentId.a.messages)).toEqual([]);
    expect(h.request.mock.calls.filter(([method]) => method === 'agent.getQueue')).toHaveLength(1);
    expect(h.fence.mock.calls.map(([ids]) => ids)).toEqual([
      ['lease-1', 'lease-2'],
      ['lease-1', 'lease-2'],
    ]);
    h.registry.dispose();
  });
  it('rejects a held recovery snapshot when a newer queue event arrives and runs one trailing read', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    const h = harness();
    await h.scope.subscribe({ workspaceId: 'ws', eventTypes: ['agent:*'] }, { recover: true });
    let resolve!: (value: unknown) => void;
    h.request.mockImplementationOnce(
      () =>
        new Promise((done) => {
          resolve = done;
        }),
    );
    h.emit(loss);
    await settle();
    h.emit({
      method: 'events.event',
      params: {
        subscriptionId: 'lease-1',
        event: {
          type: 'agent:queue:updated',
          workspaceId: 'ws',
          data: { agentId: 'a', queue: [] },
        },
      },
    });
    resolve({
      queue: [{ id: 'held', content: 'old', position: 0, queuedAt: '2026-01-01T00:00:00Z' }],
    });
    await settle();
    expect(getItems(h.state.byAgentId.a.messages).map((m) => m.id)).toEqual(['old']);
    await vi.advanceTimersByTimeAsync(250);
    await settle();
    expect(getItems(h.state.byAgentId.a.messages)).toEqual([]);
    expect(h.request.mock.calls.filter(([method]) => method === 'agent.getQueue')).toHaveLength(2);
    expect(h.fence).toHaveBeenCalledTimes(4);
    h.registry.dispose();
  });
  it('retires permissions and metadata immediately on principal change, then rejects held replies', async () => {
    const h = integration();
    const release = acquireAgentMetadataDemand('ws', { bin: 'topLevel' });
    await h.scope.subscribe({ eventTypes: ['agent:*'] }, { recover: true });
    const pending: Array<() => void> = [];
    const base = h.request.getMockImplementation()!;
    h.request.mockImplementation((method, params) =>
      method === 'agent.list' || method === 'agent.pendingPermissions'
        ? new Promise((resolve) => {
            pending.push(() =>
              resolve(
                method === 'agent.list'
                  ? { agents: [{ id: 'a', workspaceId: 'ws', name: 'Secret', status: 'active' }] }
                  : {
                      requests: [
                        {
                          requestId: 'secret',
                          sessionId: 'a',
                          title: 'Secret',
                          options: [],
                          timestamp: 1,
                        },
                      ],
                    },
              ),
            );
          })
        : base(method, params),
    );
    h.emit({ ...loss, params: { ...loss.params, scope: { workspaceId: null } } });
    await settle();
    expect(pending).toHaveLength(2);
    h.store.dispatch(principalContextChanged('different-principal'));
    expect(h.state.agentSessions.byAgentId.a).toBeUndefined();
    expect(getItems(h.state.permission.requests)).toEqual([]);
    for (const finish of pending) finish();
    await settle();
    expect(h.state.agentSessions.byAgentId.a).toBeUndefined();
    expect(getItems(h.state.permission.requests)).toEqual([]);
    release();
    h.stop();
    h.registry.dispose();
  });
});

it('restores loaded lazy and retired bins while retaining detail-only fields from slim rows', async () => {
  const h = integration();
  const { setLazyBinLoaded, setRetiredAgentsLoaded } =
    await import('$store/renderer/slices/workspace-agents/workspace-agents-slice');
  h.store.dispatch(setLazyBinLoaded('ws', 'delegated', true));
  h.store.dispatch(setLazyBinLoaded('ws', 'background', true));
  h.store.dispatch(setRetiredAgentsLoaded('ws', true));
  h.store.dispatch(
    bulkUpsertSessions([
      {
        ...h.state.agentSessions.byAgentId.a,
        contextReferences: [{ type: 'note', id: 'keep', name: 'Keep detail' }],
      },
    ]),
  );
  const release = acquireAgentMetadataDemand('ws');
  const base = h.request.getMockImplementation()!;
  h.request.mockImplementation(async (method, params) => {
    if (method !== 'agent.list') return base(method, params);
    const p = params as { scope?: string; retiredOnly?: boolean };
    const id = p.retiredOnly ? 'retired' : p.scope === 'topLevel' ? 'a' : p.scope!;
    return {
      agents: [
        {
          id,
          workspaceId: 'ws',
          name: id,
          status: 'idle',
          ...(p.scope === 'delegated' ? { parentAgentId: 'a' } : {}),
          ...(p.scope === 'background' ? { isBackground: true } : {}),
          ...(p.retiredOnly ? { retiredAt: '2026-01-01T00:00:00Z' } : {}),
        },
      ],
      retiredCount: 1,
      scopeCounts: { topLevel: 1, delegated: 1, background: 1 },
    };
  });
  await h.scope.subscribe({ eventTypes: ['agent:*'] }, { recover: true });
  h.emit({ ...loss, params: { ...loss.params, scope: { workspaceId: null } } });
  await settle();
  expect(h.state.workspaceAgents.byWorkspaceId.ws.agentIds.sort()).toEqual([
    'a',
    'background',
    'delegated',
    'retired',
  ]);
  expect(h.state.agentSessions.byAgentId.a.contextReferences).toEqual([
    { type: 'note', id: 'keep', name: 'Keep detail' },
  ]);
  expect(h.state.agentSessions.byAgentId.retired.retiredAt).toBe('2026-01-01T00:00:00Z');
  expect(
    h.request.mock.calls.filter(([method]) => method === 'agent.list').map(([, params]) => params),
  ).toEqual([
    { workspaceId: 'ws', scope: 'topLevel' },
    { workspaceId: 'ws', scope: 'delegated' },
    { workspaceId: 'ws', scope: 'background' },
    { workspaceId: 'ws', retiredOnly: true },
  ]);
  expect(h.fence).toHaveBeenCalledTimes(10);
  release();
  h.stop();
  h.registry.dispose();
});

it('retires workspace metadata and queues before a held HUD snapshot can publish', async () => {
  const h = integration();
  const release = acquireAgentMetadataDemand('ws', { hud: true });
  await h.scope.subscribe({ workspaceId: 'ws', eventTypes: ['agent:*'] }, { recover: true });
  const base = h.request.getMockImplementation()!;
  let finish!: (value: unknown) => void;
  h.request.mockImplementation((method, params) =>
    method === 'agent.list'
      ? new Promise((resolve) => {
          finish = resolve;
        })
      : base(method, params),
  );
  h.emit(loss);
  await settle();
  h.registry.retireWorkspace('ws');
  expect(h.state.workspaceAgents.byWorkspaceId.ws).toBeUndefined();
  expect(h.state.agentSessions.byAgentId.a).toBeUndefined();
  finish({ agents: [{ id: 'a', workspaceId: 'ws', name: 'Unauthorized' }] });
  await settle();
  expect(h.state.agentSessions.byAgentId.a).toBeUndefined();
  expect(h.request.mock.calls.filter(([method]) => method === 'agent.list')).toHaveLength(1);
  expect(h.request.mock.calls.filter(([method]) => method === 'workspace.get')).toHaveLength(0);
  release();
  h.stop();
  h.registry.dispose();
});

it('clears pending deletion snapshots when workspace authority retires', async () => {
  const { setPendingAgentDeletion, getPendingAgentDeletion, clearPendingAgentDeletions } =
    await import('./utils/pending-agent-deletions');
  const h = integration();
  setPendingAgentDeletion({
    wsId: 'ws',
    agentId: 'hidden',
    snapshot: h.state.agentSessions.byAgentId.a,
  });
  try {
    h.registry.retireWorkspace('ws');
    expect(getPendingAgentDeletion('hidden')).toBeUndefined();
  } finally {
    clearPendingAgentDeletions();
    h.stop();
    h.registry.dispose();
  }
});

it('waits for an ordinary metadata read before recovery and performs one final snapshot', async () => {
  const h = integration();
  const release = acquireAgentMetadataDemand('ws', {});
  let finish!: () => void;
  const ordinary = trackAgentMetadataRead(
    'ws',
    () =>
      new Promise<void>((done) => {
        finish = done;
      }),
  );
  try {
    await h.scope.subscribe({ eventTypes: ['agent:*'] }, { recover: true });
    h.emit({ ...loss, params: { ...loss.params, scope: { workspaceId: null } } });
    await settle();
    expect(h.request.mock.calls.filter(([method]) => method === 'agent.list')).toHaveLength(0);
    finish();
    await ordinary;
    await settle();
    expect(h.request.mock.calls.filter(([method]) => method === 'agent.list')).toHaveLength(1);
    expect(h.state.agentSessions.byAgentId.a.name).toBe('Recovered');
    expect(h.fence).toHaveBeenCalledTimes(10);
  } finally {
    release();
    h.stop();
    h.registry.dispose();
  }
});

it('removes only a missing agent detail while retaining its workspace and sibling snapshot', async () => {
  const h = integration();
  h.store.dispatch(
    bulkUpsertSessions([
      normalizeAgent({ id: 'gone', workspaceId: 'ws', name: 'Deleted', status: 'idle' }),
    ]),
  );
  const release = acquireAgentMetadataDemand('ws', { agentId: 'gone' });
  const original = h.request.getMockImplementation()!;
  h.request.mockImplementation(async (method, params) => {
    if (method === 'agent.get' && (params as { agentId: string }).agentId === 'gone')
      throw Object.assign(new Error('gone'), { rpcCode: -32602, data: { code: 'not-found' } });
    return original(method, params);
  });
  try {
    await h.scope.subscribe({ eventTypes: ['agent:*'] }, { recover: true });
    h.emit({ ...loss, params: { ...loss.params, scope: { workspaceId: null } } });
    await settle();
    expect(h.state.agentSessions.byAgentId.gone).toBeUndefined();
    expect(h.state.agentSessions.byAgentId.a.name).toBe('Recovered');
    expect(h.state.workspaceAgents.byWorkspaceId.ws).toBeDefined();
    expect(
      h.request.mock.calls.filter(
        ([method, params]) =>
          method === 'agent.get' && (params as { agentId: string }).agentId === 'gone',
      ),
    ).toHaveLength(1);
  } finally {
    release();
    h.stop();
    h.registry.dispose();
  }
});

describe('agent line statistics recovery', () => {
  it('recovers the lost final metrics update without extra metadata reads or transcripts', async () => {
    const h = integration();
    h.store.dispatch(updateAgentStats('a', { additions: 1, deletions: 2, timestamp: 'old' }));
    h.store.dispatch(agentLineStatsRequestStarted('a', 'old'));
    const release = acquireAgentMetadataDemand('ws', { agentId: 'a' });
    const fallback = h.request.getMockImplementation()!;
    h.request.mockImplementation(async (method, params) =>
      method === 'metrics.getAgentStats'
        ? { additions: 9, deletions: 4, filesChanged: 1 }
        : fallback(method, params),
    );
    await h.scope.subscribe({ workspaceId: 'ws', eventTypes: ['changes:*'] }, { recover: true });
    h.emit(loss);
    h.emit(loss);
    await settle();
    expect(h.state.changes.agentStats.a).toMatchObject({ additions: 9, deletions: 4 });
    expect(h.state.changes.agentLineStatsRequests.a.isLoading).toBe(false);
    expect(h.request.mock.calls.filter(([m]) => m === 'metrics.getAgentStats')).toEqual([
      ['metrics.getAgentStats', { workspaceId: 'ws', agentId: 'a' }],
    ]);
    expect(h.request.mock.calls.filter(([m]) => m === 'agent.list')).toHaveLength(1);
    expect(h.fence).toHaveBeenCalledTimes(2);
    expect(h.request.mock.calls.some(([m]) => /conversation|history/i.test(m))).toBe(false);
    release();
    h.stop();
    h.registry.dispose();
  });
});

it.each(['null', 'not-found'])(
  'clears stale line statistics for %s without retiring sibling agents',
  async (kind) => {
    const h = integration();
    h.store.dispatch(updateAgentStats('a', { additions: 99, deletions: 99, timestamp: 'old' }));
    h.store.dispatch(
      updateAgentStats('other-workspace', { additions: 3, deletions: 2, timestamp: 'other' }),
    );
    const release = acquireAgentMetadataDemand('ws', { agentId: 'a', lineStats: true });
    try {
      const base = h.request.getMockImplementation()!;
      h.request.mockImplementation(async (method, params) => {
        if (method !== 'metrics.getAgentStats') return base(method, params);
        if (kind === 'not-found')
          throw Object.assign(new Error('gone'), { rpcCode: -32602, data: { code: 'not-found' } });
        return null;
      });
      await h.scope.subscribe({ workspaceId: 'ws', eventTypes: ['changes:*'] }, { recover: true });
      h.emit(loss);
      await settle();
      expect(h.state.changes.agentStats.a).toBeUndefined();
      expect(h.state.changes.agentStats['other-workspace'].additions).toBe(3);
      expect(h.state.agentSessions.byAgentId.a).toBeDefined();
      expect(h.state.changes.agentLineStatsRequests.a.isLoading).toBe(false);
      expect(h.request.mock.calls.filter(([m]) => m === 'metrics.getAgentStats')).toHaveLength(1);
      expect(h.fence).toHaveBeenCalledTimes(2);
    } finally {
      release();
      h.stop();
      h.registry.dispose();
    }
  },
);

it.each(['principal', 'workspace'])(
  'retires line statistics before a held reply on %s replacement',
  async (kind) => {
    const h = integration();
    h.store.dispatch(updateAgentStats('a', { additions: 1, deletions: 2, timestamp: 'old' }));
    h.store.dispatch(agentLineStatsRequestStarted('a', 'old'));
    const release = acquireAgentMetadataDemand('ws', { agentId: 'a', lineStats: true });
    try {
      const base = h.request.getMockImplementation()!;
      let finish!: (value: unknown) => void;
      h.request.mockImplementation((method, params) =>
        method === 'metrics.getAgentStats'
          ? new Promise((resolve) => {
              finish = resolve;
            })
          : base(method, params),
      );
      await h.scope.subscribe({ workspaceId: 'ws', eventTypes: ['changes:*'] }, { recover: true });
      h.emit(loss);
      await settle();
      expect(finish).toBeDefined();
      if (kind === 'workspace') h.registry.retireWorkspace('ws');
      else h.store.dispatch(principalContextChanged('replacement-principal'));
      expect(h.state.changes.agentStats.a).toBeUndefined();
      expect(h.state.changes.agentLineStatsRequests.a).toBeUndefined();
      finish({ additions: 99, deletions: 99, filesChanged: 1 });
      await settle();
      expect(h.state.changes.agentStats.a).toBeUndefined();
      expect(h.state.changes.agentLineStatsRequests.a).toBeUndefined();
      expect(h.request.mock.calls.filter(([m]) => m === 'metrics.getAgentStats')).toHaveLength(1);
      expect(h.fence).toHaveBeenCalledTimes(1);
    } finally {
      release();
      h.stop();
      h.registry.dispose();
    }
  },
);

it('defers line statistics recovery until demand and shares the ordinary read barrier', async () => {
  const h = integration();
  h.store.dispatch(updateAgentStats('a', { additions: 1, deletions: 2, timestamp: 'old' }));
  let release = () => {};
  try {
    const base = h.request.getMockImplementation()!;
    h.request.mockImplementation(async (method, params) =>
      method === 'metrics.getAgentStats'
        ? { additions: 9, deletions: 4, filesChanged: 1 }
        : base(method, params),
    );
    await h.scope.subscribe({ workspaceId: 'ws', eventTypes: ['changes:*'] }, { recover: true });
    const receipt = h.registry.capture('agents:["ws"]');
    let finish!: () => void;
    const ordinary = trackAgentMetadataRead('ws', async () => {
      await new Promise<void>((resolve) => {
        finish = resolve;
      });
      receipt.commit(() => {
        h.store.dispatch(
          updateAgentStats('a', { additions: 77, deletions: 77, timestamp: 'stale' }),
        );
        return undefined;
      });
    });
    h.emit(loss);
    await settle();
    expect(h.request.mock.calls.filter(([m]) => m === 'metrics.getAgentStats')).toHaveLength(0);
    release = acquireAgentMetadataDemand('ws', { agentId: 'a', lineStats: true });
    await settle();
    expect(h.request.mock.calls.filter(([m]) => m === 'agent.list')).toHaveLength(0);
    finish();
    await ordinary;
    await settle();
    expect(h.state.changes.agentStats.a).toMatchObject({ additions: 9, deletions: 4 });
    expect(h.request.mock.calls.filter(([m]) => m === 'metrics.getAgentStats')).toHaveLength(1);
    expect(h.fence).toHaveBeenCalledTimes(2);
  } finally {
    release();
    h.stop();
    h.registry.dispose();
  }
});

it('only reads line statistics with cached or explicit demand', async () => {
  const h = integration();
  let release = acquireAgentMetadataDemand('ws', { agentId: 'a' });
  try {
    const base = h.request.getMockImplementation()!;
    h.request.mockImplementation(async (method, params) =>
      method === 'metrics.getAgentStats'
        ? { additions: 9, deletions: 4, filesChanged: 1 }
        : base(method, params),
    );
    await h.scope.subscribe({ workspaceId: 'ws', eventTypes: ['changes:*'] }, { recover: true });
    h.emit(loss);
    await settle();
    expect(h.request.mock.calls.filter(([m]) => m === 'metrics.getAgentStats')).toHaveLength(0);
    release();
    release = acquireAgentMetadataDemand('ws', { agentId: 'a', lineStats: true });
    h.emit({ ...loss, params: { ...loss.params, generation: '2' } });
    await new Promise((resolve) => setTimeout(resolve, 300));
    await settle();
    expect(h.state.changes.agentStats.a).toMatchObject({ additions: 9, deletions: 4 });
    expect(h.request.mock.calls.filter(([m]) => m === 'metrics.getAgentStats')).toHaveLength(1);
  } finally {
    release();
    h.stop();
    h.registry.dispose();
  }
});

it('failure snapshot retry must drain a held sibling read before retrying', async () => {
  vi.useFakeTimers();
  const h = integration();
  let resolveHeld!: (v: unknown) => void;
  const held = new Promise((done) => {
    resolveHeld = done;
  });
  const normal = h.request.getMockImplementation()!;
  let heldCalls = 0;
  h.request.mockImplementation(async (method, params: any) => {
    if (method === 'workspace.list')
      return {
        workspaces: [
          {
            id: 'ws',
            agentSummary: {
              agents: [
                { id: 'early', status: 'error' },
                { id: 'held', status: 'error' },
              ],
            },
          },
        ],
      };
    if (method === 'agent.get' && params.agentId === 'early')
      throw new Error('ordinary read failure');
    if (method === 'agent.get' && params.agentId === 'held') {
      heldCalls++;
      return held;
    }
    return normal(method, params);
  });
  try {
    await h.scope.subscribe({ eventTypes: ['agent:*'] }, { recover: true });
    h.emit({ ...loss, params: { ...loss.params, scope: { workspaceId: null } } });
    await settle();
    expect(heldCalls).toBe(1);
    await vi.advanceTimersByTimeAsync(1000);
    expect(heldCalls).toBe(1);
  } finally {
    resolveHeld({ agent: { id: 'held', workspaceId: 'ws', status: 'idle' } });
    await settle();
    h.stop();
    h.registry.dispose();
    clearAgentFailureRegistry();
    vi.useRealTimers();
  }
});

it('workspace retirement clears global failure and active-stream mirrors for that workspace', async () => {
  const { recordAgentFailure } = await import('./agent-failure-registry');
  const h = integration();
  try {
    recordAgentFailure({ agentId: 'a', workspaceId: 'ws', error: 'private failure' });
    recordAgentFailure({ agentId: 'other', workspaceId: 'other-ws', error: 'retained failure' });
    activeStreamsTracker.replaceSnapshot([
      { agentId: 'a', workspaceId: 'ws', sessionId: 'a', startTime: 0 },
      { agentId: 'other', workspaceId: 'other-ws', sessionId: 'other', startTime: 0 },
    ]);
    h.registry.retireWorkspace('ws');
    expect(h.state.agentSessions.byAgentId.a).toBeUndefined();
    expect(getAgentFailureEntry('other')).toBeDefined();
    expect(activeStreamsTracker.isAgentStreaming('other')).toBe(true);
    expect.soft(getAgentFailureEntry('a')).toBeUndefined();
    expect.soft(activeStreamsTracker.isAgentStreaming('a')).toBe(false);
    expect.soft(getItems(h.state.permission.requests)).toEqual([]);
  } finally {
    h.stop();
    h.registry.dispose();
    clearAgentFailureRegistry();
    activeStreamsTracker.replaceSnapshot([]);
  }
});

it('held global snapshots cannot restore a workspace after its authority retires', async () => {
  const h = integration();
  const normal = h.request.getMockImplementation()!;
  let finishFailure!: (v: unknown) => void, finishActive!: (v: unknown) => void;
  h.request.mockImplementation((method, params: any) => {
    if (method === 'agent.get')
      return new Promise((done) => {
        finishFailure = done;
      });
    if (method === 'agent.listActive')
      return new Promise((done) => {
        finishActive = done;
      });
    return normal(method, params);
  });
  try {
    await h.scope.subscribe({ eventTypes: ['agent:*'] }, { recover: true });
    h.emit({ ...loss, params: { ...loss.params, scope: { workspaceId: null } } });
    await settle();
    expect(finishFailure).toBeTypeOf('function');
    expect(finishActive).toBeTypeOf('function');
    h.registry.retireWorkspace('ws');
    expect(h.state.agentSessions.byAgentId.a).toBeUndefined();
    finishFailure({
      agent: {
        id: 'failed-new',
        workspaceId: 'ws',
        status: 'error',
        stopReason: 'late private failure',
      },
    });
    finishActive({ streams: [{ agentId: 'a', workspaceId: 'ws', sessionId: 'a', startTime: 0 }] });
    await settle();
    expect.soft(getAgentFailureEntry('failed-new')).toBeUndefined();
    expect.soft(activeStreamsTracker.isAgentStreaming('a')).toBe(false);
  } finally {
    h.stop();
    h.registry.dispose();
    clearAgentFailureRegistry();
    activeStreamsTracker.replaceSnapshot([]);
  }
});

it.each(['not-found', 'denied'])(
  'clears current %s failure authority before a held sibling finishes',
  async (kind) => {
    const { recordAgentFailure } = await import('./agent-failure-registry');
    const h = integration();
    const original = recordAgentFailure({ agentId: 'early', workspaceId: 'ws', error: 'private' });
    let finish!: (v: unknown) => void;
    const held = new Promise((resolve) => {
      finish = resolve;
    });
    const normal = h.request.getMockImplementation()!;
    h.request.mockImplementation(async (method, params: any) => {
      if (method === 'workspace.list')
        return {
          workspaces: [
            {
              id: 'ws',
              agentSummary: {
                agents: [
                  { id: 'early', status: 'error' },
                  { id: 'held', status: 'error' },
                ],
              },
            },
          ],
        };
      if (method === 'agent.get' && params.agentId === 'early')
        throw Object.assign(
          new Error('gone'),
          kind === 'denied'
            ? { rpcCode: -32003 }
            : { rpcCode: -32602, data: { code: 'not-found' } },
        );
      if (method === 'agent.get' && params.agentId === 'held') return held;
      return normal(method, params);
    });
    try {
      await h.scope.subscribe({ eventTypes: ['agent:*'] }, { recover: true });
      h.emit({ ...loss, params: { ...loss.params, scope: { workspaceId: null } } });
      await settle();
      expect(getAgentFailureEntry('early')).toBeUndefined();
      expect(original.error).toBe('private');
      expect(
        h.request.mock.calls.filter(([m, p]) => m === 'agent.get' && (p as any).agentId === 'held'),
      ).toHaveLength(1);
    } finally {
      finish({ agent: { id: 'held', workspaceId: 'ws', status: 'idle' } });
      await settle();
      h.stop();
      h.registry.dispose();
      clearAgentFailureRegistry();
    }
  },
);

it('does not let a held canonical denial clear a replacement failure', async () => {
  const { recordAgentFailure } = await import('./agent-failure-registry');
  const h = integration();
  recordAgentFailure({ agentId: 'early', workspaceId: 'ws', error: 'old' });
  let reject!: (error: unknown) => void;
  const held = new Promise((_, fail) => {
    reject = fail;
  });
  const normal = h.request.getMockImplementation()!;
  h.request.mockImplementation(async (method, params: any) => {
    if (method === 'workspace.list') return { workspaces: [] };
    if (method === 'agent.get' && params.agentId === 'early') return held;
    return normal(method, params);
  });
  try {
    await h.scope.subscribe({ eventTypes: ['agent:*'] }, { recover: true });
    h.emit({ ...loss, params: { ...loss.params, scope: { workspaceId: null } } });
    await settle();
    const replacement = recordAgentFailure({
      agentId: 'early',
      workspaceId: 'ws',
      error: 'replacement',
    });
    reject(Object.assign(new Error('old denial'), { rpcCode: -32003 }));
    await settle();
    expect(getAgentFailureEntry('early')).toBe(replacement);
    expect(h.state.agentSessions.byAgentId.a).toBeDefined();
  } finally {
    h.stop();
    h.registry.dispose();
    clearAgentFailureRegistry();
  }
});

it.each([
  ['agent-permissions', 'agent.pendingPermissions'],
  ['agent-active-streams', 'agent.listActive'],
  ['agent-subscriptions:["ws","a"]', 'agent.getSubscriptions'],
])('shares ordinary and recovery physical reads for %s', async (key, method) => {
  const { trackAgentRecoveryRead } = await import('./agent-recovery-read-lane');
  const { setSubscriptionSnapshot } =
    await import('$store/renderer/slices/agent-subscription-ui/agent-subscription-ui-slice');
  const h = integration();
  h.store.dispatch(
    setSubscriptionSnapshot('ws', 'a', {
      subscriptions: [],
      delegationGroups: [],
      waitingState: 'waiting',
    }),
  );
  activeStreamsTracker.replaceSnapshot([
    { agentId: 'a', workspaceId: 'ws', sessionId: 'a', startTime: 0 },
  ]);
  const normal = h.request.getMockImplementation()!;
  h.request.mockImplementation(async (m, params) =>
    m === 'agent.getSubscriptions'
      ? { subscriptions: [], delegationGroups: [] }
      : normal(m, params),
  );
  let finish!: () => void;
  try {
    await h.scope.subscribe({ eventTypes: ['agent:*'] }, { recover: true });
    const receipt = h.registry.capture(key);
    const ordinary = trackAgentRecoveryRead(
      key,
      () =>
        new Promise<void>((resolve) => {
          finish = resolve;
        }),
      receipt,
    );
    h.emit({ ...loss, params: { ...loss.params, scope: { workspaceId: null } } });
    await settle();
    expect(h.request.mock.calls.filter(([m]) => m === method)).toHaveLength(0);
    finish();
    await ordinary;
    await settle();
    expect(h.request.mock.calls.filter(([m]) => m === method)).toHaveLength(1);
    if (method === 'agent.pendingPermissions')
      expect(getItems(h.state.permission.requests)).toEqual([]);
    if (method === 'agent.listActive')
      expect(activeStreamsTracker.isAgentStreaming('a')).toBe(false);
    if (method === 'agent.getSubscriptions')
      expect(
        h.state.agentSubscriptionUI.entries['ws:a']?.waitingState ??
          Object.values(h.state.agentSubscriptionUI.entries)[0]?.waitingState,
      ).toBe('idle');
  } finally {
    finish?.();
    h.stop();
    h.registry.dispose();
    clearAgentFailureRegistry();
    activeStreamsTracker.replaceSnapshot([]);
  }
});

it('admits subscription child updates across workspaces only for watching parents and retires the home scope', async () => {
  const { setSubscriptionSnapshot } =
    await import('$store/renderer/slices/agent-subscription-ui/agent-subscription-ui-slice');
  const { agentSubscriptionsRecoveryKey } = await import('./agent-recovery-keys');
  const h = integration();
  h.store.dispatch(
    setSubscriptionSnapshot('ws', 'a', {
      subscriptions: [
        {
          id: 'watch',
          agentId: 'a',
          actorIds: ['child'],
          eventTypes: ['agent:idle'],
          createdAt: '',
        },
      ],
      delegationGroups: [],
      agentStatuses: {},
      waitingState: 'waiting',
    }),
  );
  await h.scope.subscribe({ eventTypes: ['agent:*'] }, { recover: true });
  const key = agentSubscriptionsRecoveryKey('ws', 'a');
  const before = h.registry.capture(key);
  expect(h.state.agentSubscriptionUI.entries['ws:a']).toBeDefined();
  h.emit({
    method: 'events.event',
    params: {
      subscriptionId: 'lease-1',
      event: { type: 'agent:idle', workspaceId: 'other', data: { agentId: 'unrelated' } },
    },
  });
  await settle();
  expect(before.commit(() => undefined)).toBe(true);
  h.emit({
    method: 'events.event',
    params: {
      subscriptionId: 'lease-1',
      event: { type: 'agent:idle', workspaceId: 'other', data: { agentId: 'child' } },
    },
  });
  await settle();
  expect(before.commit(() => undefined)).toBe(false);
  h.registry.retireWorkspace('ws');
  expect(h.state.agentSubscriptionUI.entries['ws:a']).toBeUndefined();
  h.stop();
  h.registry.dispose();
});

it.each([false, true])(
  'current workspace denials clear independently while replacement=%s and a sibling is held',
  async (replaceSecond) => {
    const { recordAgentFailure } = await import('$features/agent/agent-failure-registry');
    const h = integration();
    recordAgentFailure({
      agentId: 'denied-first',
      workspaceId: 'ws',
      error: 'first private failure',
    });
    recordAgentFailure({
      agentId: 'denied-second',
      workspaceId: 'ws-second',
      error: 'second private failure',
    });
    recordAgentFailure({
      agentId: 'held-third',
      workspaceId: 'ws-third',
      error: 'still authorized',
    });
    const normal = h.request.getMockImplementation()!;
    let finish!: (v: unknown) => void;
    h.request.mockImplementation(async (method, params: any) => {
      if (method === 'workspace.list') return { workspaces: [] };
      if (method === 'agent.get' && params.agentId.startsWith('denied-')) {
        if (replaceSecond && params.agentId === 'denied-second')
          recordAgentFailure({
            agentId: 'denied-second',
            workspaceId: 'ws-second',
            error: 'replacement failure',
          });
        throw Object.assign(new Error('current workspace denied'), { rpcCode: -32003 });
      }
      if (method === 'agent.get' && params.agentId === 'held-third')
        return new Promise((resolve) => {
          finish = resolve;
        });
      return normal(method, params);
    });
    try {
      await h.scope.subscribe({ eventTypes: ['agent:*'] }, { recover: true });
      h.emit({ ...loss, params: { ...loss.params, scope: { workspaceId: null } } });
      await settle();
      expect(finish).toBeTypeOf('function');
      expect.soft(getAgentFailureEntry('denied-first')).toBeUndefined();
      if (replaceSecond)
        expect(getAgentFailureEntry('denied-second')?.error).toBe('replacement failure');
      else expect(getAgentFailureEntry('denied-second')).toBeUndefined();
      expect(getAgentFailureEntry('held-third')?.error).toBe('still authorized');
      expect(
        h.request.mock.calls.filter(
          ([m, p]) => m === 'agent.get' && (p as any).agentId === 'held-third',
        ),
      ).toHaveLength(1);
    } finally {
      finish?.({ agent: { id: 'held-third', workspaceId: 'ws-third', status: 'idle' } });
      await settle();
      h.stop();
      h.registry.dispose();
      clearAgentFailureRegistry();
    }
  },
);

it.each(['current', 'replacement', 'retired'] as const)(
  'consumes ordinary failure-read completion under original authority: %s',
  async (transition) => {
    const { BackendError } = await import('$lib/client/live/backend-transport-types');
    const { recordAgentFailure } = await import('./agent-failure-registry');
    const h = integration();
    recordAgentFailure({ agentId: 'late-denied', workspaceId: 'ws', error: 'private failure' });
    recordAgentFailure({
      agentId: 'held-sibling',
      workspaceId: 'other',
      error: 'authorized sibling',
    });
    const completion = Promise.withResolvers<{ errors: unknown[]; retired: boolean }>();
    const held = Promise.withResolvers<unknown>();
    const normal = h.request.getMockImplementation()!;
    h.request.mockImplementation(async (method, params: any) => {
      if (method === 'workspace.list') return { workspaces: [] };
      if (method === 'agent.get' && params.agentId === 'late-denied')
        throw new BackendError(
          { code: 'TIMEOUT', message: 'ordinary deadline' },
          completion.promise,
        );
      if (method === 'agent.get' && params.agentId === 'held-sibling') return held.promise;
      return normal(method, params);
    });
    try {
      await h.scope.subscribe({ eventTypes: ['agent:*'] }, { recover: true });
      h.emit({ ...loss, params: { ...loss.params, scope: { workspaceId: null } } });
      await settle();
      if (transition === 'replacement')
        recordAgentFailure({ agentId: 'late-denied', workspaceId: 'ws', error: 'replacement' });
      completion.resolve({
        errors: [Object.assign(new Error('denied'), { rpcCode: -32003 })],
        retired: transition === 'retired',
      });
      await settle();
      if (transition === 'current') expect(getAgentFailureEntry('late-denied')).toBeUndefined();
      else
        expect(getAgentFailureEntry('late-denied')?.error).toBe(
          transition === 'replacement' ? 'replacement' : 'private failure',
        );
      expect(getAgentFailureEntry('held-sibling')?.error).toBe('authorized sibling');
      expect(
        h.request.mock.calls.filter(
          ([m, p]) => m === 'agent.get' && (p as any).agentId === 'held-sibling',
        ),
      ).toHaveLength(1);
    } finally {
      completion.resolve({ errors: [], retired: true });
      held.resolve({ agent: { id: 'held-sibling', workspaceId: 'other', status: 'idle' } });
      await settle();
      h.stop();
      h.registry.dispose();
      clearAgentFailureRegistry();
    }
  },
);

it.each(['queued', 'running'] as const)(
  'retains released metadata demand until %s recovery applies',
  async (phase) => {
    const { agentMetadataDemands } = await import('./agent-metadata-demand');
    const h = integration();
    const held = Promise.withResolvers<{ additions: number; deletions: number }>();
    h.store.dispatch(updateAgentStats('a', { additions: 1, deletions: 1, timestamp: 'old' }));
    const normal = h.request.getMockImplementation()!;
    h.request.mockImplementation(async (method, params) =>
      method === 'metrics.getAgentStats' ? held.promise : normal(method, params),
    );
    let release = () => {};
    try {
      await h.scope.subscribe({ workspaceId: 'ws', eventTypes: ['changes:*'] }, { recover: true });
      h.emit(loss);
      await settle();
      expect(h.request.mock.calls.filter(([m]) => m === 'agent.list')).toHaveLength(0);
      release = acquireAgentMetadataDemand('ws', { agentId: 'a', lineStats: true });
      if (phase === 'running') await settle();
      expect(h.registry.capture('agents:["ws"]').commit(() => undefined)).toBe(false);
      release();
      release();
      expect(agentMetadataDemands.has('ws')).toBe(true);
      await settle();
      expect(h.request.mock.calls.filter(([m]) => m === 'metrics.getAgentStats')).toHaveLength(1);
      held.resolve({ additions: 8, deletions: 3 });
      await settle();
      expect(h.state.changes.agentStats.a).toMatchObject({ additions: 8, deletions: 3 });
      expect(agentMetadataDemands.has('ws')).toBe(false);
      expect(h.request.mock.calls.filter(([m]) => m === 'agent.list')).toHaveLength(1);
      expect(h.fence).toHaveBeenCalledTimes(2);
      h.emit({ ...loss, params: { ...loss.params, generation: '2' } });
      await settle();
      expect(h.request.mock.calls.filter(([m]) => m === 'agent.list')).toHaveLength(1);
    } finally {
      held.resolve({ additions: 8, deletions: 3 });
      release();
      h.stop();
      h.registry.dispose();
      await settle();
    }
  },
);

it('releases clean metadata demand synchronously without starting a snapshot', async () => {
  const { agentMetadataDemands } = await import('./agent-metadata-demand');
  const h = integration();
  try {
    const release = acquireAgentMetadataDemand('ws', { agentId: 'a', lineStats: true });
    expect(agentMetadataDemands.has('ws')).toBe(true);
    release();
    expect(agentMetadataDemands.has('ws')).toBe(false);
    await settle();
    expect(h.request).not.toHaveBeenCalled();
  } finally {
    h.stop();
    h.registry.dispose();
  }
});

it.each(['dispose', 'exhaust'] as const)(
  'releases retained metadata demand on %s',
  async (terminal) => {
    vi.useFakeTimers();
    const { agentMetadataDemands } = await import('./agent-metadata-demand');
    const h = integration();
    const held = Promise.withResolvers<unknown>();
    h.store.dispatch(updateAgentStats('a', { additions: 1, deletions: 1, timestamp: 'old' }));
    const normal = h.request.getMockImplementation()!;
    h.request.mockImplementation(async (method, params) => {
      if (method === 'metrics.getAgentStats') {
        if (terminal === 'exhaust') throw new Error('temporary');
        return held.promise;
      }
      return normal(method, params);
    });
    let release = () => {};
    try {
      await h.scope.subscribe({ workspaceId: 'ws', eventTypes: ['changes:*'] }, { recover: true });
      h.emit(loss);
      await settle();
      release = acquireAgentMetadataDemand('ws', { agentId: 'a', lineStats: true });
      release();
      await settle();
      if (terminal === 'dispose') h.stop();
      else await vi.advanceTimersByTimeAsync(6000);
      await settle();
      expect(agentMetadataDemands.has('ws')).toBe(false);
      expect(h.request.mock.calls.filter(([m]) => m === 'metrics.getAgentStats')).toHaveLength(
        terminal === 'dispose' ? 1 : 3,
      );
      held.resolve({ additions: 88, deletions: 33 });
      await settle();
      expect(h.state.changes.agentStats.a).toMatchObject({ additions: 1, deletions: 1 });
    } finally {
      held.resolve(null);
      release();
      h.stop();
      h.registry.dispose();
      await settle();
    }
  },
);
