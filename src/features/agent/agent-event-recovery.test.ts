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
