import { afterEach, describe, expect, it, vi } from 'vitest';
import { ReactStore } from '@themislib/themis/react-store';
import { createAction } from '@themislib/themis/utils/store/create-action';
import { createReducer } from '@themislib/themis/utils/store/create-reducer';
import type { BackendRuntime } from '$lib/client/live/backend-transport-runtime';
import { createBackendAgentClient } from '$lib/client/live/backend-agent-client';
import { createAgentReadService } from '../../../../../features/agent/agent-read-service-factory';
import { createAgentReadOwnership } from '../../../../../features/agent/agent-read-ownership-factory';
import { getWorkspaceAgentMetadataStatus } from '../../workspace-agents/workspace-agents-projections';
import {
  workspaceAgentsReducer,
  workspaceAgentMetadataRetryRequested,
} from '../../workspace-agents/workspace-agents-slice';
import {
  agentSessionReducer,
  agentMetadataAcquired,
  agentMetadataReleased,
} from '../agent-session-slice';
import { createAgentMetadataSaga } from './agent-metadata-saga-factory';

const changeContext = createAction<[string | null]>('metadataTest/context');
const contextReducer = createReducer({ value: 'context-a' as string | null });
contextReducer.with(changeContext, (_state, { payload: [value] }) => ({ value }));
const getContext = (state: { context: { value: string | null } }) => state.context.value;

function fixture() {
  const store = new ReactStore({
    context: contextReducer,
    workspaceAgents: workspaceAgentsReducer,
    agentSessions: agentSessionReducer,
  });
  const dispose = store.init();
  const notifications = new Set<Parameters<BackendRuntime['onBackendNotification']>[0]>();
  const reconnects = new Set<() => void>();
  const requests: {
    resolve: (value: { subscriptionId?: string }) => void;
    reject: (error: Error) => void;
  }[] = [];
  const request = vi.fn((method: string, _params?: unknown): Promise<unknown> => {
    if (method === 'agent.subscribe')
      return new Promise((resolve, reject) => requests.push({ resolve, reject }));
    return Promise.resolve({ success: true });
  });
  const backend = {
    backendRequest: <T>(...args: Parameters<BackendRuntime['backendRequest']>) =>
      request(...args) as Promise<T>,
    onBackendNotification: (listener: Parameters<BackendRuntime['onBackendNotification']>[0]) => {
      notifications.add(listener);
      return () => {
        notifications.delete(listener);
      };
    },
    onBackendReconnected: (listener: () => void) => {
      reconnects.add(listener);
      return () => {
        reconnects.delete(listener);
      };
    },
  };
  const ownership = createAgentReadOwnership({
    onBackendReconnected: backend.onBackendReconnected,
    getSessionWorkspace: (id) => store.state.agentSessions.byAgentId[id]?.workspaceId,
  });
  const reads = createAgentReadService({
    appStore: store,
    getAgent: async () => null,
    ownership,
    onBackendReconnected: backend.onBackendReconnected,
  });
  const stop = store.runSaga(
    createAgentMetadataSaga({
      contextSelector: store.createSelector(getContext),
      client: createBackendAgentClient(backend),
      reads,
      ownership,
    }),
  );
  const push = (
    subscriptionId: string,
    kind: 'snapshot' | 'delta',
    seq: number,
    rows: unknown[] = [],
  ) => {
    for (const listener of notifications)
      listener({
        method: 'subscription.push',
        params: {
          subscriptionId,
          kind,
          seq,
          ...(kind === 'snapshot'
            ? { snapshot: rows }
            : { delta: { added: rows, updated: [], removedIds: [] } }),
        },
      });
  };
  return {
    store,
    requests,
    request,
    push,
    status: (ws = 'ws-a') =>
      getWorkspaceAgentMetadataStatus(store.state, ws, store.state.context.value),
    acquire: (consumer = 'switcher', ws = 'ws-a') =>
      store.dispatch(agentMetadataAcquired(consumer, ws)),
    release: (consumer = 'switcher') => store.dispatch(agentMetadataReleased(consumer)),
    retry: (consumer = 'switcher', ws = 'ws-a', context = 'context-a') =>
      store.dispatch(workspaceAgentMetadataRetryRequested(consumer, ws, context)),
    reconnect: () => {
      for (const listener of reconnects) listener();
    },
    stop,
    dispose: () => {
      stop();
      dispose();
    },
  };
}

const settle = () => vi.advanceTimersByTimeAsync(0);
const row = { id: 'agent-a', workspaceId: 'ws-a', name: 'Conversation', status: 'idle' };

describe('canonical agent metadata completeness', () => {
  afterEach(() => vi.useRealTimers());

  it('requires a snapshot, includes empty workspaces, and retains confirmed siblings during recovery', async () => {
    vi.useFakeTimers();
    const h = fixture();
    try {
      h.acquire();
      h.acquire('other', 'ws-b');
      expect(h.request.mock.calls).toEqual([
        ['agent.subscribe', { workspaceId: 'ws-a' }],
        ['agent.subscribe', { workspaceId: 'ws-b' }],
      ]);
      h.requests[0].resolve({ subscriptionId: 'a' });
      h.requests[1].resolve({ subscriptionId: 'b' });
      await settle();
      expect(h.status()?.status).toBe('loading');
      h.push('a', 'snapshot', 0, [row]);
      h.push('b', 'snapshot', 0);
      expect(h.status()?.status).toBe('ready');
      expect(h.status('ws-b')?.status).toBe('ready');
      expect(h.store.state.workspaceAgents.byWorkspaceId['ws-b'].agentIds).toEqual([]);
      const session = h.store.state.agentSessions.byAgentId['agent-a'];
      h.push('a', 'delta', 3);
      expect(h.status()?.status).toBe('loading');
      expect(h.status('ws-b')?.status).toBe('ready');
      expect(h.store.state.agentSessions.byAgentId['agent-a']).toBe(session);
      expect(h.store.state.workspaceAgents.byWorkspaceId['ws-a'].agentIds).toEqual(['agent-a']);
      expect(h.request.mock.calls.slice(-2)).toEqual([
        ['events.unsubscribe', { subscriptionId: 'a', workspaceId: 'ws-a' }],
        ['agent.subscribe', { workspaceId: 'ws-a' }],
      ]);
      h.requests[2].resolve({ subscriptionId: 'a-new' });
      await settle();
      h.push('a', 'snapshot', 0);
      expect(h.status()?.status).toBe('loading');
      h.push('a-new', 'snapshot', 0, [row]);
      expect(h.status()?.status).toBe('ready');
      h.reconnect();
      expect(h.status()?.status).toBe('loading');
      expect(h.status('ws-b')?.status).toBe('loading');
      expect(h.store.state.agentSessions.byAgentId['agent-a']).toBeDefined();
    } finally {
      h.dispose();
    }
  });

  it('exposes failures, accepts only a current consumer retry, and keeps automatic retries', async () => {
    vi.useFakeTimers();
    const h = fixture();
    try {
      h.acquire();
      h.requests[0].reject(new Error('offline'));
      await settle();
      expect(h.status()).toEqual({ context: 'context-a', status: 'error', error: 'offline' });
      h.retry('absent');
      h.retry('switcher', 'ws-b');
      h.retry('switcher', 'ws-a', 'old-context');
      expect(h.requests).toHaveLength(1);
      h.retry();
      h.retry();
      expect(h.requests).toHaveLength(2);
      expect(h.status()?.status).toBe('loading');
      h.requests[1].resolve({});
      await settle();
      expect(h.status()?.status).toBe('error');
      await vi.advanceTimersByTimeAsync(1999);
      expect(h.requests).toHaveLength(2);
      await vi.advanceTimersByTimeAsync(1);
      expect(h.requests).toHaveLength(3);
      h.requests[2].resolve({ subscriptionId: 'retry' });
      await settle();
      h.push('retry', 'snapshot', 0);
      expect(h.status()?.status).toBe('ready');
      h.retry();
      expect(h.requests).toHaveLength(3);
    } finally {
      h.dispose();
    }
  });

  it('retires readiness with the last lease and ignores old replies after reacquire or context changes', async () => {
    vi.useFakeTimers();
    const h = fixture();
    try {
      h.acquire();
      h.acquire('second');
      expect(h.requests).toHaveLength(1);
      h.requests[0].resolve({ subscriptionId: 'first' });
      await settle();
      h.push('first', 'snapshot', 0, [row]);
      h.release();
      expect(h.status()?.status).toBe('ready');
      h.retry();
      h.release('second');
      expect(h.status()).toBeNull();
      expect(h.store.state.agentSessions.byAgentId['agent-a']).toBeDefined();
      h.acquire();
      expect(h.status()?.status).toBe('loading');
      h.push('first', 'snapshot', 0);
      expect(h.status()?.status).toBe('loading');
      h.store.dispatch(changeContext('context-b'));
      await settle();
      expect(h.status()).toEqual({ context: 'context-b', status: 'loading' });
      h.requests[1].reject(new Error('late old context'));
      await settle();
      expect(h.status()?.status).toBe('loading');
      h.requests[2].resolve({ subscriptionId: 'current' });
      await settle();
      h.push('current', 'snapshot', 0, [row]);
      expect(h.status()?.status).toBe('ready');
      expect(getWorkspaceAgentMetadataStatus(h.store.state, 'ws-a', 'context-a')).toBeNull();
      h.store.dispatch(changeContext(null));
      expect(h.status()).toBeNull();
      await settle();
      expect(h.store.state.workspaceAgents.byWorkspaceId['ws-a'].metadataSubscription).toBeNull();
      h.push('current', 'snapshot', 1);
      expect(h.store.state.agentSessions.byAgentId['agent-a']).toBeDefined();
    } finally {
      h.dispose();
    }
  });

  it('invalidates readiness on owner cancellation and cancels pending automatic retry', async () => {
    vi.useFakeTimers();
    const h = fixture();
    h.acquire();
    h.requests[0].reject(new Error('offline'));
    await settle();
    try {
      h.stop();
      expect(h.status()).toBeNull();
      await vi.advanceTimersByTimeAsync(30_000);
      expect(h.requests).toHaveLength(1);
    } finally {
      h.dispose();
    }
  });
});
