import { BackendError } from '$lib/client/live/backend-transport-types';
import { RecoveryRequestTimeoutError } from '$shared/event-recovery/session';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createCollection, getItems } from '@themislib/themis/utils/collections/collection-utils';
import {
  createEventRecoverySession,
  type RecoveryNotification,
} from '$shared/event-recovery/session';
import type { StoreState } from '$store/renderer/types';
import {
  getPrincipalActionContext,
  getPrincipalConnectionContext,
} from '$store/renderer/slices/principal/principal-context';
import {
  contextReducer,
  hydrateContextItems,
  addContextItem,
  removeContextItem,
  updateContextItem,
} from '$store/renderer/slices/context/context-slice';
import {
  tokenUsageReducer,
  tokenUsageReceived,
} from '$store/renderer/slices/token-usage/token-usage-slice';
import {
  taskAgentAssociationsReducer,
  hydrateTaskAgentAssociations,
  addTaskAgentAssociation,
  removeTaskAgentAssociation,
  pruneTaskAgentAssociationsForNote,
  applyTaskAgentLinked,
} from '$store/renderer/slices/task-agent-associations/task-agent-associations-slice';
import { RendererEventRecovery } from './renderer-event-recovery';
import {
  acquireLifecycleMetadataDemand,
  contextRecoveryKey,
  lifecycleMetadataMutationKey,
  beginLifecycleMetadataMutation,
  getLifecycleMetadataMutation,
  installLifecycleMetadataRecovery,
  runLifecycleMetadataRead,
} from './lifecycle-metadata-recovery';

const item = (id: string) => ({ id, type: 'file', path: id });
const usage = (inputTokens: number) => ({
  byAgentId: {},
  byModel: {},
  totals: { inputTokens, outputTokens: 0, cacheReadTokens: 0, cacheCreationTokens: 0 },
  lastScanAt: null,
});
const link = { noteId: 'note', taskKey: 'task', taskText: 'Work', agentId: 'agent', createdAt: 1 };
const settle = async () => {
  for (let i = 0; i < 100; i++) await Promise.resolve();
};
const cleanups: Array<() => void> = [];
afterEach(() => {
  for (const cleanup of cleanups.splice(0)) cleanup();
  vi.useRealTimers();
});
async function harness(mounted = true, afterDispatch?: () => void) {
  vi.useFakeTimers();
  vi.setSystemTime(0);
  let state = {
    context: contextReducer(undefined, hydrateContextItems('ws', [item('old')] as never)),
    tokenUsage: tokenUsageReducer(undefined, tokenUsageReceived('ws', usage(1))),
    taskAgentAssociations: taskAgentAssociationsReducer(
      undefined,
      hydrateTaskAgentAssociations('ws', {}),
    ),
    workspaceLifecycle: { sessionPhaseByWorkspaceId: mounted ? { ws: 'live' } : {} },
    connections: { hasReceivedList: true, windowBackendId: 'backend' },
    daemonHealth: { health: 'up', connectionGeneration: 1 },
    workspaceEvents: { subscriptionGeneration: 1 },
    principal: {
      status: 'ready',
      context: '',
      invalidation: 0,
      presentationVersion: 0,
      snapshot: { principal: { id: 'person', isAdministrator: true }, capabilities: {} },
    },
    workspace: { workspaces: createCollection('id', [{ id: 'ws' }]), capabilityContext: '' },
  } as unknown as StoreState;
  state.principal.context = getPrincipalConnectionContext(state);
  state.workspace.capabilityContext = getPrincipalActionContext(state);
  const listeners = new Set<() => void>();
  const notify = () => {
    for (const fn of listeners) fn();
  };
  const dispatch = (action: { type: string; payload?: unknown }) => {
    state = {
      ...state,
      context: contextReducer(state.context, action as never),
      tokenUsage: tokenUsageReducer(state.tokenUsage, action as never),
      taskAgentAssociations: taskAgentAssociationsReducer(
        state.taskAgentAssociations,
        action as never,
      ),
    };
    notify();
    afterDispatch?.();
    return action;
  };
  let receive!: (event: RecoveryNotification) => void;
  let sequence = 0;
  const request = vi.fn(async (method: string, params?: unknown): Promise<unknown> => {
    if (method === 'events.subscribe') return { subscriptionId: `s${++sequence}`, lossRecovery: 1 };
    if (method === 'events.fence') return params;
    if (method === 'workspace.getContext') return { items: [item('fresh')] };
    if (method === 'workspace.getTokenUsage') return { tokenUsage: usage(20) };
    if (method === 'task.listAgentLinks')
      return { linksByNoteId: { note: { task: { ...link, workspaceId: 'ws' } } } };
    throw new Error(`Unexpected request: ${method}`);
  });
  const session = createEventRecoverySession({
    supported: true,
    isCurrent: () => true,
    onRetired: () => () => {},
    onNotification: (fn) => {
      receive = fn;
      return () => {};
    },
    request: async (method, params, observe) => {
      const result = await request(method, params);
      observe?.(result);
      return result;
    },
    dispose: () => {},
  });
  const registry = new RendererEventRecovery();
  const off = registry.onSession((scope) =>
    installLifecycleMetadataRecovery(
      scope,
      {
        getState: () => state,
        dispatch,
        subscribe: (fn) => {
          listeners.add(fn);
          return () => {
            listeners.delete(fn);
          };
        },
      },
      registry,
    ),
  );
  const scope = registry.attach(session);
  await scope.subscribe({ workspaceId: 'ws', eventTypes: ['*'] }, { recover: true });
  cleanups.push(() => {
    off();
    registry.dispose();
  });
  return {
    registry,
    uninstall: off,
    scope,
    request,
    dispatch,
    get state() {
      return state;
    },
    update: (fn: (s: StoreState) => void) => {
      fn(state);
      notify();
    },
    loss: (generation = '1', id = 's1') =>
      receive({
        method: 'events.lost',
        params: { subscriptionId: id, generation, scope: { workspaceId: 'ws' } },
      }),
  };
}

describe('lifecycle metadata recovery', () => {
  it('restores the three real projections after final-event loss with bounded read-only requests', async () => {
    const h = await harness();
    expect(h.request.mock.calls.map((c) => c[0])).toEqual(['events.subscribe']);
    h.loss();
    await settle();
    expect(getItems(h.state.context.byWorkspaceId.ws.items).map((row) => row.id)).toEqual([
      'fresh',
    ]);
    expect(h.state.tokenUsage.byWorkspaceId.ws.totals.inputTokens).toBe(20);
    expect(h.state.taskAgentAssociations.byWorkspaceId.ws.byNoteId).toEqual({
      note: { task: link },
    });
    for (const method of ['workspace.getContext', 'workspace.getTokenUsage', 'task.listAgentLinks'])
      expect(h.request.mock.calls.filter((c) => c[0] === method)).toEqual([
        [method, { workspaceId: 'ws' }],
      ]);
    expect(h.request.mock.calls.filter((c) => c[0] === 'events.fence')).toHaveLength(6);
  });
  it('leaves inactive projections lazy until their workspace mounts', async () => {
    const h = await harness(false);
    h.loss();
    await settle();
    expect(h.request).toHaveBeenCalledTimes(1);
    expect(h.state.tokenUsage.byWorkspaceId.ws.isStale).toBe(true);
    h.update((s) => {
      s.workspaceLifecycle.sessionPhaseByWorkspaceId.ws = 'live';
    });
    await settle();
    expect(getItems(h.state.context.byWorkspaceId.ws.items).map((row) => row.id)).toEqual([
      'fresh',
    ]);
  });
  it('waits for a held ordinary read even when another lease changes its receipt', async () => {
    const h = await harness();
    let resolve!: (value: unknown) => void;
    const receipt = h.registry.capture(contextRecoveryKey('ws'));
    const ordinary = runLifecycleMetadataRead(
      contextRecoveryKey('ws'),
      receipt,
      () =>
        new Promise((r) => {
          resolve = r;
        }),
    );
    await h.scope.subscribe(
      { workspaceId: 'ws', eventTypes: ['workspace:context-changed'] },
      { recover: true },
    );
    h.loss();
    await settle();
    expect(h.request.mock.calls.filter((c) => c[0] === 'workspace.getContext')).toHaveLength(0);
    resolve([item('old-reply')]);
    await ordinary;
    await settle();
    expect(
      receipt.commit(() => {
        h.dispatch(hydrateContextItems('ws', [item('old-reply')] as never));
      }),
    ).toBe(false);
    expect(getItems(h.state.context.byWorkspaceId.ws.items).map((row) => row.id)).toEqual([
      'fresh',
    ]);
    expect(h.request.mock.calls.filter((c) => c[0] === 'workspace.getContext')).toHaveLength(1);
  });
  it('rejects held replies after a newer ordinary push without another read', async () => {
    const h = await harness();
    const key = contextRecoveryKey('ws');
    const receipt = h.registry.capture(key);
    expect(h.registry.push(key)).toBe(true);
    h.registry.capture(key).commit(() => {
      h.dispatch(hydrateContextItems('ws', [item('push')] as never));
    });
    expect(
      receipt.commit(() => {
        h.dispatch(hydrateContextItems('ws', [item('old')] as never));
      }),
    ).toBe(false);
    expect(getItems(h.state.context.byWorkspaceId.ws.items).map((row) => row.id)).toEqual(['push']);
    expect(h.request).toHaveBeenCalledTimes(1);
  });
  it('retires protected projections and stale tokens on principal ABA', async () => {
    const h = await harness();
    const receipt = h.registry.capture(contextRecoveryKey('ws'));
    h.update((s) => {
      s.principal.invalidation++;
    });
    h.update((s) => {
      s.principal.invalidation--;
    });
    expect(
      receipt.commit(() => {
        h.dispatch(hydrateContextItems('ws', [item('old')] as never));
      }),
    ).toBe(false);
    expect(getItems(h.state.context.byWorkspaceId.ws.items).map((row) => row.id)).toEqual([]);
    expect(h.state.tokenUsage.byWorkspaceId.ws).toBeUndefined();
    expect(h.state.taskAgentAssociations.byWorkspaceId.ws.byNoteId).toEqual({});
  });
  it('clears a disappeared workspace and cannot revive its old snapshot', async () => {
    const h = await harness();
    const receipt = h.registry.capture(contextRecoveryKey('ws'));
    h.update((s) => {
      s.workspace.workspaces = createCollection('id');
    });
    expect(receipt.commit(() => undefined)).toBe(false);
    expect(getItems(h.state.context.byWorkspaceId.ws.items).map((row) => row.id)).toEqual([]);
    expect(h.state.tokenUsage.byWorkspaceId.ws).toBeUndefined();
  });
  it('recovers only explicitly demanded metadata in a hidden workspace', async () => {
    const h = await harness(false);
    const release = acquireLifecycleMetadataDemand('ws', 'context');
    cleanups.push(release);
    h.loss();
    await settle();
    expect(getItems(h.state.context.byWorkspaceId.ws.items).map((row) => row.id)).toEqual([
      'fresh',
    ]);
    expect(
      h.request.mock.calls.filter((c) => !c[0].startsWith('events.')).map((c) => c[0]),
    ).toEqual(['workspace.getContext']);
    release();
    h.loss('2');
    await settle();
    expect(h.request.mock.calls.filter((c) => c[0] === 'workspace.getContext')).toHaveLength(1);
  });
  it('retires a canonical not-found resource after one read', async () => {
    const h = await harness();
    const original = h.request.getMockImplementation()!;
    h.request.mockImplementation(async (method, params) => {
      if (method === 'workspace.getContext')
        throw Object.assign(new Error('missing'), { rpcCode: -32602, data: { code: 'not-found' } });
      return original(method, params);
    });
    h.loss();
    await settle();
    await vi.advanceTimersByTimeAsync(10000);
    expect(getItems(h.state.context.byWorkspaceId.ws.items)).toEqual([]);
    expect(h.request.mock.calls.filter((c) => c[0] === 'workspace.getContext')).toHaveLength(1);
    expect(h.registry.capture(contextRecoveryKey('ws')).commit(() => undefined)).toBe(false);
  });
  it('does not accept a delayed unversioned push after recovery', async () => {
    const h = await harness();
    h.loss();
    await settle();
    expect(h.registry.push(contextRecoveryKey('ws'))).toBe(false);
    expect(getItems(h.state.context.byWorkspaceId.ws.items).map((row) => row.id)).toEqual([
      'fresh',
    ]);
    await vi.advanceTimersByTimeAsync(250);
    await settle();
    expect(h.request.mock.calls.filter((c) => c[0] === 'workspace.getContext')).toHaveLength(2);
  });
  it('coalesces ordinary readers and rejects queued requests before sending after retirement', async () => {
    const h = await harness();
    const key = contextRecoveryKey('ws');
    let resolve!: (value: string) => void;
    const read = vi.fn(
      () =>
        new Promise<string>((r) => {
          resolve = r;
        }),
    );
    const first = runLifecycleMetadataRead(key, h.registry.capture(key), read);
    const second = runLifecycleMetadataRead(key, h.registry.capture(key), read);
    expect(second).toBe(first);
    expect(read).toHaveBeenCalledTimes(1);
    h.registry.push(key);
    const queuedRead = vi.fn(async () => 'queued');
    const queued = runLifecycleMetadataRead(key, h.registry.capture(key), queuedRead);
    const rejection = expect(queued).rejects.toThrow('authority expired');
    h.update((s) => {
      s.daemonHealth.connectionGeneration++;
    });
    resolve('old');
    await first;
    await rejection;
    expect(queuedRead).not.toHaveBeenCalled();
  });
  it('coalesces overlapping loss signals into a finite trailing cycle', async () => {
    const h = await harness();
    h.loss();
    h.loss('2');
    h.loss('2');
    await settle();
    await vi.advanceTimersByTimeAsync(250);
    await settle();
    for (const method of ['workspace.getContext', 'workspace.getTokenUsage', 'task.listAgentLinks'])
      expect(h.request.mock.calls.filter((c) => c[0] === method).length).toBeLessThanOrEqual(2);
    expect(h.state.tokenUsage.byWorkspaceId.ws.totals.inputTokens).toBe(20);
  });

  it.each(['backend', 'subscription', 'unmount'])(
    'rejects a pre-%s receipt after returning to the same workspace',
    async (transition) => {
      const h = await harness();
      const old = h.registry.capture(contextRecoveryKey('ws'));
      if (transition === 'backend') {
        h.update((s) => {
          s.connections.windowBackendId = 'other';
        });
        h.update((s) => {
          s.connections.windowBackendId = 'backend';
        });
      } else if (transition === 'subscription') {
        h.update((s) => {
          s.workspaceEvents.subscriptionGeneration++;
        });
        h.update((s) => {
          s.workspaceEvents.subscriptionGeneration--;
        });
      } else {
        h.update((s) => {
          delete s.workspaceLifecycle.sessionPhaseByWorkspaceId.ws;
        });
        h.update((s) => {
          s.workspaceLifecycle.sessionPhaseByWorkspaceId.ws = 'live';
        });
      }
      expect(old.commit(() => undefined)).toBe(false);
    },
  );
  it('keeps ordinary legacy reads and their resulting state unchanged without an installed owner', async () => {
    const registry = new RendererEventRecovery();
    const receipt = registry.capture(contextRecoveryKey('legacy'));
    const request = vi.fn(async () => [item('legacy')]);
    const result = await runLifecycleMetadataRead(contextRecoveryKey('legacy'), receipt, request);
    let state = contextReducer(undefined, { type: '@@init' });
    expect(
      receipt.commit(() => {
        state = contextReducer(state, hydrateContextItems('legacy', result as never));
      }),
    ).toBe(true);
    expect(getItems(state.byWorkspaceId.legacy.items).map((row) => row.id)).toEqual(['legacy']);
    expect(request).toHaveBeenCalledTimes(1);
    registry.dispose();
  });
  it('clears protected projections immediately when its installer is removed', async () => {
    const h = await harness();
    h.uninstall();
    expect(getItems(h.state.context.byWorkspaceId.ws.items)).toEqual([]);
    expect(h.state.tokenUsage.byWorkspaceId.ws).toBeUndefined();
    expect(h.state.taskAgentAssociations.byWorkspaceId.ws.byNoteId).toEqual({});
  });
  it('registers fresh ownership after a workspace disappears and returns', async () => {
    const h = await harness();
    const old = h.registry.capture(contextRecoveryKey('ws'));
    const original = h.state.workspace.workspaces;
    h.update((s) => {
      s.workspace.workspaces = createCollection('id');
    });
    h.update((s) => {
      s.workspace.workspaces = original;
    });
    h.loss();
    await settle();
    expect(old.commit(() => undefined)).toBe(false);
    expect(getItems(h.state.context.byWorkspaceId.ws.items).map((row) => row.id)).toEqual([
      'fresh',
    ]);
  });
  it('does not let an expired caller join a newer authorized ordinary read', async () => {
    const h = await harness();
    const key = contextRecoveryKey('ws');
    const expired = h.registry.capture(key);
    h.registry.push(key);
    let resolve!: (value: string) => void;
    const valid = runLifecycleMetadataRead(
      key,
      h.registry.capture(key),
      () =>
        new Promise<string>((r) => {
          resolve = r;
        }),
    );
    const rejected = runLifecycleMetadataRead(key, expired, async () => 'unauthorized');
    resolve('current');
    await valid;
    await expect(rejected).rejects.toThrow('authority expired');
  });
  it('classifies only optimistic commands, excluding recovery and daemon projections', () => {
    for (const action of [
      addContextItem('ws', item('edit') as never),
      removeContextItem('ws', 'edit'),
      updateContextItem('ws', 'edit', {}),
    ])
      expect(lifecycleMetadataMutationKey(action)).toBe(contextRecoveryKey('ws'));
    for (const action of [
      addTaskAgentAssociation('ws', 'note', link),
      removeTaskAgentAssociation('ws', 'note', 'task'),
      pruneTaskAgentAssociationsForNote('ws', 'note', []),
    ])
      expect(lifecycleMetadataMutationKey(action)).toBe('task-agent-links:["ws"]');
    for (const action of [
      hydrateContextItems('ws', []),
      hydrateTaskAgentAssociations('ws', {}),
      applyTaskAgentLinked('ws', 'note', link),
      tokenUsageReceived('ws', usage(1)),
    ])
      expect(lifecycleMetadataMutationKey(action)).toBeUndefined();
  });
  it('waits for a cancelled saga physical mutation before recovery reads', async () => {
    const h = await harness();
    const action = addContextItem('ws', item('edit') as never);
    const lease = beginLifecycleMetadataMutation(action)!;
    expect(getLifecycleMetadataMutation(action)).toBe(lease);
    h.registry.push(contextRecoveryKey('ws'));
    h.dispatch(action);
    let resolve!: () => void;
    const mutate = vi.fn(
      () =>
        new Promise<void>((r) => {
          resolve = r;
        }),
    );
    const pending = lease.run(mutate);
    lease.finish(); // Saga cancellation cannot cancel an already-sent request.
    h.loss();
    await settle();
    expect(h.request.mock.calls.filter((c) => c[0] === 'workspace.getContext')).toHaveLength(0);
    resolve();
    await pending;
    await settle();
    await vi.advanceTimersByTimeAsync(250);
    await settle();
    expect(getItems(h.state.context.byWorkspaceId.ws.items).map((row) => row.id)).toEqual([
      'fresh',
    ]);
    expect(mutate).toHaveBeenCalledTimes(1);
  });
  it('holds buffered task mutations until every reservation and physical write finishes', async () => {
    const h = await harness();
    const action = removeTaskAgentAssociation('ws', 'note', 'task');
    const lease = beginLifecycleMetadataMutation(action)!;
    const releaseQueued = lease.retain();
    lease.finish();
    h.registry.push('task-agent-links:["ws"]');
    h.loss();
    await settle();
    expect(h.request.mock.calls.filter((c) => c[0] === 'task.listAgentLinks')).toHaveLength(0);
    const mutate = vi.fn(async () => undefined);
    await lease.run(mutate);
    releaseQueued();
    await settle();
    await vi.advanceTimersByTimeAsync(250);
    await settle();
    expect(h.state.taskAgentAssociations.byWorkspaceId.ws.byNoteId).toEqual({
      note: { task: link },
    });
    expect(mutate).toHaveBeenCalledTimes(1);
  });
  it('keeps clean local edits read-free after their mutations settle', async () => {
    const h = await harness();
    const action = addContextItem('ws', item('edit') as never);
    const lease = beginLifecycleMetadataMutation(action)!;
    h.registry.push(contextRecoveryKey('ws'));
    h.dispatch(action);
    await lease.run(async () => undefined);
    lease.finish();
    await settle();
    expect(getItems(h.state.context.byWorkspaceId.ws.items).map((row) => row.id)).toContain('edit');
    expect(h.request).toHaveBeenCalledTimes(1);
  });
  it('rejects queued user mutations after workspace authority retires', async () => {
    const h = await harness();
    const lease = beginLifecycleMetadataMutation(removeContextItem('ws', 'old'))!;
    const release = lease.retain();
    lease.finish();
    h.update((s) => {
      s.principal.invalidation++;
    });
    const mutate = vi.fn(async () => undefined);
    await expect(lease.run(mutate)).rejects.toThrow('authority expired');
    expect(mutate).not.toHaveBeenCalled();
    release();
  });
  it('does not return a mutation reply to a retired caller', async () => {
    const h = await harness();
    const lease = beginLifecycleMetadataMutation(removeContextItem('ws', 'old'))!;
    let resolve!: (value: string) => void;
    const result = lease.run(
      () =>
        new Promise<string>((r) => {
          resolve = r;
        }),
    );
    lease.finish();
    h.update((s) => {
      s.principal.invalidation++;
    });
    resolve('old protected result');
    await expect(result).rejects.toThrow('authority expired');
  });
});

it.each(['recovery', 'ordinary'] as const)(
  'retains the physical read lane after a %s timeout',
  async (kind) => {
    const registry = new RendererEventRecovery();
    const key = 'timeout-lifecycle-metadata';
    let release!: () => void;
    const completion = new Promise<{ errors: readonly unknown[]; retired: boolean }>((resolve) => {
      release = () => resolve({ errors: [], retired: false });
    });
    const error =
      kind === 'recovery'
        ? new RecoveryRequestTimeoutError(completion)
        : new BackendError({ code: 'TIMEOUT', message: 'Caller deadline' }, completion);
    await expect(
      runLifecycleMetadataRead(key, registry.capture(key), async () => {
        throw error;
      }),
    ).rejects.toBe(error);
    const send = vi.fn(async () => ['new']);
    const pending = runLifecycleMetadataRead(key, registry.capture(key), send);
    try {
      await settle();
      expect(send).not.toHaveBeenCalled();
    } finally {
      release();
      await pending;
      registry.dispose();
    }
    expect(send).toHaveBeenCalledTimes(1);
  },
);

it('keeps a timed-out ordinary mutation physical barrier until actual completion', async () => {
  const h = await harness();
  let release!: () => void;
  const completion = new Promise<{ errors: readonly unknown[]; retired: boolean }>((resolve) => {
    release = () => resolve({ errors: [], retired: false });
  });
  const error = new BackendError({ code: 'TIMEOUT', message: 'Caller deadline' }, completion);
  const lease = beginLifecycleMetadataMutation(addContextItem('ws', item('edit') as never))!;
  const mutate = vi.fn(async () => {
    throw error;
  });
  await expect(lease.run(mutate)).rejects.toBe(error);
  lease.finish();
  h.loss();
  try {
    await settle();
    expect(h.request.mock.calls.filter((c) => c[0] === 'workspace.getContext')).toHaveLength(0);
  } finally {
    release();
    await settle();
    await vi.advanceTimersByTimeAsync(250);
  }
  expect(h.request.mock.calls.filter((c) => c[0] === 'workspace.getContext')).toHaveLength(1);
  expect(getItems(h.state.context.byWorkspaceId.ws.items).map((row) => row.id)).toEqual(['fresh']);
  expect(mutate).toHaveBeenCalledTimes(1);
});

it.each([-32003, -32001, -32602])(
  'retires the original ordinary owner on late canonical denial %s',
  async (rpcCode) => {
    const h = await harness();
    const readKey = contextRecoveryKey('ws');
    const receipt = h.registry.capture(readKey);
    let release!: (value: { errors: readonly unknown[]; retired: boolean }) => void;
    const completion = new Promise<{ errors: readonly unknown[]; retired: boolean }>((resolve) => {
      release = resolve;
    });
    const timeout = new BackendError({ code: 'TIMEOUT', message: 'Caller deadline' }, completion);
    await expect(
      runLifecycleMetadataRead(readKey, receipt, async () => {
        throw timeout;
      }),
    ).rejects.toBe(timeout);
    h.registry.push(readKey);
    release({ errors: [{ rpcCode, data: { code: 'not-found' } }], retired: false });
    await settle();
    expect(getItems(h.state.context.byWorkspaceId.ws.items)).toEqual([]);
    expect(h.registry.capture(readKey).commit(() => undefined)).toBe(false);
    h.loss();
    await vi.advanceTimersByTimeAsync(5000);
    expect(h.request.mock.calls.filter((c) => !c[0].startsWith('events.')).length).toBe(2);
  },
);

it.each([true, false])(
  'does not clear replacement state from a late ordinary completion (retired=%s)',
  async (retired) => {
    const h = await harness();
    const readKey = contextRecoveryKey('ws');
    let release!: (value: { errors: readonly unknown[]; retired: boolean }) => void;
    const completion = new Promise<{ errors: readonly unknown[]; retired: boolean }>((resolve) => {
      release = resolve;
    });
    const timeout = new BackendError({ code: 'TIMEOUT', message: 'Caller deadline' }, completion);
    await expect(
      runLifecycleMetadataRead(readKey, h.registry.capture(readKey), async () => {
        throw timeout;
      }),
    ).rejects.toBe(timeout);
    if (!retired) {
      h.registry.refreshAuthority();
      h.dispatch(hydrateContextItems('ws', [item('replacement')] as never));
    }
    const newer = h.registry.capture(readKey);
    release({ errors: [{ rpcCode: -32003 }], retired });
    await settle();
    expect(newer.commit(() => undefined)).toBe(true);
    if (!retired)
      expect(getItems(h.state.context.byWorkspaceId.ws.items).map((row) => row.id)).toEqual([
        'replacement',
      ]);
    if (retired)
      expect(getItems(h.state.context.byWorkspaceId.ws.items).map((row) => row.id)).toEqual([
        'old',
      ]);
  },
);

it('clears immediate ordinary denial while another physical read is held', async () => {
  const h = await harness();
  const readKey = contextRecoveryKey('ws');
  let release!: () => void;
  const completion = new Promise<{ errors: readonly unknown[]; retired: boolean }>((resolve) => {
    release = () => resolve({ errors: [], retired: false });
  });
  const timeout = new BackendError({ code: 'TIMEOUT', message: 'Caller deadline' }, completion);
  await expect(
    runLifecycleMetadataRead(
      'independent-sibling-lifecycle-metadata',
      h.registry.capture('independent-sibling-lifecycle-metadata'),
      async () => {
        throw timeout;
      },
    ),
  ).rejects.toBe(timeout);
  try {
    await expect(
      runLifecycleMetadataRead(readKey, h.registry.capture(readKey), async () => {
        throw { rpcCode: -32003 };
      }),
    ).rejects.toEqual({ rpcCode: -32003 });
    expect(getItems(h.state.context.byWorkspaceId.ws.items)).toEqual([]);
  } finally {
    release();
    await settle();
  }
});

it.each(['authority', 'session'] as const)(
  'keeps physical occupancy only across the same session after %s replacement',
  async (change) => {
    const h = await harness();
    const readKey = contextRecoveryKey('ws');
    let release!: () => void;
    const completion = new Promise<{ errors: readonly unknown[]; retired: boolean }>((resolve) => {
      release = () => resolve({ errors: [], retired: true });
    });
    const timeout = new BackendError({ code: 'TIMEOUT', message: 'Caller deadline' }, completion);
    await expect(
      runLifecycleMetadataRead(readKey, h.registry.capture(readKey), async () => {
        throw timeout;
      }),
    ).rejects.toBe(timeout);
    const next = change === 'session' ? await harness() : h;
    if (change === 'authority') h.registry.refreshAuthority();
    const send = vi.fn(async () => 'replacement');
    const pending = runLifecycleMetadataRead(readKey, next.registry.capture(readKey), send);
    try {
      await settle();
      expect(send).toHaveBeenCalledTimes(change === 'session' ? 1 : 0);
    } finally {
      release();
      await pending;
    }
    expect(send).toHaveBeenCalledTimes(1);
  },
);

it('does not treat ordinary invalid parameters as a canonical disappearance', async () => {
  const h = await harness();
  const readKey = contextRecoveryKey('ws');
  await expect(
    runLifecycleMetadataRead(readKey, h.registry.capture(readKey), async () => {
      throw { rpcCode: -32602 };
    }),
  ).rejects.toEqual({ rpcCode: -32602 });
  expect(h.registry.capture(readKey).commit(() => undefined)).toBe(true);
});

it.each(['authority', 'session'] as const)(
  'keeps timed-out mutation occupancy across only the same physical session after %s replacement',
  async (change) => {
    const h = await harness();
    let release!: () => void;
    const completion = new Promise<{ errors: readonly unknown[]; retired: boolean }>((resolve) => {
      release = () => resolve({ errors: [{ rpcCode: -32003 }], retired: true });
    });
    const timeout = new BackendError({ code: 'TIMEOUT', message: 'Caller deadline' }, completion);
    const lease = beginLifecycleMetadataMutation(removeContextItem('ws', 'old'))!;
    await expect(
      lease.run(async () => {
        throw timeout;
      }),
    ).rejects.toBe(timeout);
    lease.finish();
    const next = change === 'session' ? await harness() : h;
    if (change === 'authority') h.registry.refreshAuthority();
    const key = contextRecoveryKey('ws');
    const send = vi.fn(async () => 'replacement');
    const pending = runLifecycleMetadataRead(key, next.registry.capture(key), send);
    try {
      await settle();
      expect(send).toHaveBeenCalledTimes(change === 'session' ? 1 : 0);
    } finally {
      release();
      await pending;
    }
    expect(send).toHaveBeenCalledTimes(1);
    expect(next.registry.capture(key).commit(() => undefined)).toBe(true);
  },
);

it('retires a timed-out mutation owner on eventual permission denial without replay', async () => {
  const h = await harness();
  let release!: () => void;
  const completion = new Promise<{ errors: readonly unknown[]; retired: boolean }>((resolve) => {
    release = () => resolve({ errors: [{ rpcCode: -32003 }], retired: false });
  });
  const timeout = new BackendError({ code: 'TIMEOUT', message: 'Caller deadline' }, completion);
  const lease = beginLifecycleMetadataMutation(removeContextItem('ws', 'old'))!;
  const mutate = vi.fn(async () => {
    throw timeout;
  });
  await expect(lease.run(mutate)).rejects.toBe(timeout);
  lease.finish();
  h.loss();
  await settle();
  expect(h.request.mock.calls.filter((c) => c[0] === 'workspace.getContext')).toHaveLength(0);
  release();
  await settle();
  expect(getItems(h.state.context.byWorkspaceId.ws.items)).toEqual([]);
  expect(h.registry.capture(contextRecoveryKey('ws')).commit(() => undefined)).toBe(false);
  await vi.advanceTimersByTimeAsync(5000);
  expect(h.request.mock.calls.filter((c) => c[0] === 'workspace.getContext')).toHaveLength(0);
  expect(mutate).toHaveBeenCalledTimes(1);
});

it('does not infer workspace retirement from a missing task-link mutation target', async () => {
  const h = await harness();
  const key = 'task-agent-links:["ws"]';
  h.dispatch(hydrateTaskAgentAssociations('ws', { note: { task: link } }));
  const lease = beginLifecycleMetadataMutation(removeTaskAgentAssociation('ws', 'note', 'task'))!;
  await expect(
    lease.run(async () => {
      throw { rpcCode: -32602, data: { code: 'not-found' } };
    }),
  ).rejects.toEqual({ rpcCode: -32602, data: { code: 'not-found' } });
  lease.finish();
  await settle();
  expect(h.registry.capture(key).commit(() => undefined)).toBe(true);
  expect(h.state.taskAgentAssociations.byWorkspaceId.ws.byNoteId).toEqual({ note: { task: link } });
});

it('does not carry a legacy mutation barrier into a newly installed physical session', async () => {
  let release!: () => void;
  const completion = new Promise<{ errors: readonly unknown[]; retired: boolean }>((resolve) => {
    release = () => resolve({ errors: [], retired: true });
  });
  const timeout = new BackendError({ code: 'TIMEOUT', message: 'Caller deadline' }, completion);
  const lease = beginLifecycleMetadataMutation(removeContextItem('ws', 'old'))!;
  await expect(
    lease.run(async () => {
      throw timeout;
    }),
  ).rejects.toBe(timeout);
  lease.finish();
  const h = await harness();
  const key = contextRecoveryKey('ws');
  const send = vi.fn(async () => 'fresh');
  const pending = runLifecycleMetadataRead(key, h.registry.capture(key), send);
  try {
    await settle();
    expect(send).toHaveBeenCalledTimes(1);
  } finally {
    release();
    await pending;
  }
});

it.each([false, true])(
  'a denied referenced agent cannot retire accessible task links (late=%s)',
  async (late) => {
    const h = await harness();
    const key = 'task-agent-links:["ws"]';
    h.dispatch(hydrateTaskAgentAssociations('ws', { note: { task: link } }));
    const lease = beginLifecycleMetadataMutation(
      addTaskAgentAssociation('ws', 'note', { ...link, agentId: 'foreign-private-agent' }),
    )!;
    const forbidden = new BackendError({
      rpcCode: -32003,
      code: 'forbidden',
      message: 'Referenced agent workspace denied',
    });
    let release!: () => void;
    const completion = new Promise<{ errors: readonly unknown[]; retired: boolean }>((resolve) => {
      release = () => resolve({ errors: [forbidden], retired: false });
    });
    const error = late
      ? new BackendError({ code: 'TIMEOUT', message: 'Caller deadline' }, completion)
      : forbidden;
    const mutate = vi.fn(async () => {
      throw error;
    });
    await expect(lease.run(mutate)).rejects.toBe(error);
    lease.finish();
    h.loss();
    if (late) {
      await settle();
      expect(h.request.mock.calls.filter((c) => c[0] === 'task.listAgentLinks')).toHaveLength(0);
      release();
    }
    await settle();
    expect(
      h.registry.capture(key).commit(() => undefined),
      'target workspace still permits task.listAgentLinks',
    ).toBe(true);
    expect(
      h.state.taskAgentAssociations.byWorkspaceId.ws?.byNoteId.note?.task?.agentId,
      'existing accessible association survives a different agent denial',
    ).toBe('agent');
    expect(
      h.request.mock.calls.filter((c) => c[0] === 'task.listAgentLinks'),
      'authoritative workspace-wide read decides its own access',
    ).toHaveLength(1);
    expect(mutate).toHaveBeenCalledTimes(1);
  },
);

it.each([false, true])(
  'retires task links only when the authoritative workspace read is denied (late mutation=%s)',
  async (late) => {
    const h = await harness();
    const key = 'task-agent-links:["ws"]';
    h.dispatch(hydrateTaskAgentAssociations('ws', { note: { task: link } }));
    const forbidden = new BackendError({
      rpcCode: -32003,
      code: 'forbidden',
      message: 'Access denied',
    });
    const original = h.request.getMockImplementation()!;
    h.request.mockImplementation(async (method, params) => {
      if (method === 'task.listAgentLinks') throw forbidden;
      return original(method, params);
    });
    let release!: () => void;
    const completion = new Promise<{ errors: readonly unknown[]; retired: boolean }>((resolve) => {
      release = () => resolve({ errors: [forbidden], retired: false });
    });
    const error = late
      ? new BackendError({ code: 'TIMEOUT', message: 'Caller deadline' }, completion)
      : forbidden;
    const lease = beginLifecycleMetadataMutation(addTaskAgentAssociation('ws', 'note', link))!;
    const mutate = vi.fn(async () => {
      throw error;
    });
    await expect(lease.run(mutate)).rejects.toBe(error);
    lease.finish();
    expect(h.registry.capture(key).commit(() => undefined)).toBe(true);
    expect(h.state.taskAgentAssociations.byWorkspaceId.ws.byNoteId).toEqual({
      note: { task: link },
    });
    h.loss();
    if (late) {
      await settle();
      expect(h.request.mock.calls.filter((c) => c[0] === 'task.listAgentLinks')).toHaveLength(0);
      release();
    }
    await settle();
    await vi.advanceTimersByTimeAsync(10000);
    expect(h.state.taskAgentAssociations.byWorkspaceId.ws.byNoteId).toEqual({});
    expect(h.registry.capture(key).commit(() => undefined)).toBe(false);
    expect(h.request.mock.calls.filter((c) => c[0] === 'task.listAgentLinks')).toHaveLength(1);
    expect(mutate).toHaveBeenCalledTimes(1);
  },
);

it('keeps replacement task links after an old mutation returns a late referenced-agent denial', async () => {
  const h = await harness();
  const key = 'task-agent-links:["ws"]';
  let release!: () => void;
  const completion = new Promise<{ errors: readonly unknown[]; retired: boolean }>((resolve) => {
    release = () => resolve({ errors: [{ rpcCode: -32003 }], retired: false });
  });
  const error = new BackendError({ code: 'TIMEOUT', message: 'Caller deadline' }, completion);
  const lease = beginLifecycleMetadataMutation(addTaskAgentAssociation('ws', 'note', link))!;
  const mutate = vi.fn(async () => {
    throw error;
  });
  await expect(lease.run(mutate)).rejects.toBe(error);
  lease.finish();
  h.registry.refreshAuthority();
  const replacement = { ...link, agentId: 'replacement-agent' };
  h.dispatch(hydrateTaskAgentAssociations('ws', { note: { task: replacement } }));
  const receipt = h.registry.capture(key);
  release();
  await settle();
  expect(receipt.commit(() => undefined)).toBe(true);
  expect(h.state.taskAgentAssociations.byWorkspaceId.ws.byNoteId).toEqual({
    note: { task: replacement },
  });
  expect(h.request.mock.calls.filter((c) => c[0] === 'task.listAgentLinks')).toHaveLength(0);
  expect(mutate).toHaveBeenCalledTimes(1);
});

it.each(['context', 'tokenUsage', 'taskAgentLinks'] as const)(
  'keeps inactive %s recovery demand after an ordinary stale caller releases it',
  async (domain) => {
    const h = await harness(false);
    h.loss();
    await settle();
    expect(h.request.mock.calls.filter((c) => !c[0].startsWith('events.'))).toHaveLength(0);
    const release = acquireLifecycleMetadataDemand('ws', domain);
    release();
    await settle();
    const method = {
      context: 'workspace.getContext',
      tokenUsage: 'workspace.getTokenUsage',
      taskAgentLinks: 'task.listAgentLinks',
    }[domain];
    expect(h.request.mock.calls.filter((c) => c[0] === method)).toHaveLength(1);
    if (domain === 'context')
      expect(getItems(h.state.context.byWorkspaceId.ws.items).map((row) => row.id)).toEqual([
        'fresh',
      ]);
    if (domain === 'tokenUsage')
      expect(h.state.tokenUsage.byWorkspaceId.ws.totals.inputTokens).toBe(20);
    if (domain === 'taskAgentLinks')
      expect(h.state.taskAgentAssociations.byWorkspaceId.ws.byNoteId).toEqual({
        note: { task: link },
      });
    h.loss('2');
    await vi.advanceTimersByTimeAsync(1000);
    expect(h.request.mock.calls.filter((c) => c[0] === method)).toHaveLength(1);
  },
);

it('releases clean inactive metadata demand without starting a recovery', async () => {
  const h = await harness(false);
  const key = contextRecoveryKey('ws');
  const release = acquireLifecycleMetadataDemand('ws', 'context');
  expect(h.registry.capture(key).commit(() => undefined)).toBe(true);
  release();
  release();
  await settle();
  expect(h.registry.capture(key).isCurrent()).toBe(false);
  expect(h.request.mock.calls.filter((c) => c[0] === 'workspace.getContext')).toHaveLength(0);
});

it('releases retained metadata demand after the bounded recovery retry budget', async () => {
  const h = await harness(false);
  const original = h.request.getMockImplementation()!;
  h.request.mockImplementation(async (method, params) => {
    if (method === 'workspace.getContext') throw new Error('temporarily unavailable');
    return original(method, params);
  });
  h.loss();
  const release = acquireLifecycleMetadataDemand('ws', 'context');
  release();
  await settle();
  await vi.advanceTimersByTimeAsync(10000);
  expect(h.request.mock.calls.filter((c) => c[0] === 'workspace.getContext')).toHaveLength(3);
  expect(h.registry.capture(contextRecoveryKey('ws')).isCurrent()).toBe(false);
  expect(getItems(h.state.context.byWorkspaceId.ws.items).map((row) => row.id)).toEqual(['old']);
});

it('retiring a held metadata recovery cannot transfer released demand to its replacement', async () => {
  const h = await harness(false);
  let finish!: () => void;
  const original = h.request.getMockImplementation()!;
  h.request.mockImplementation(async (method, params) => {
    if (method === 'workspace.getContext')
      await new Promise<void>((resolve) => {
        finish = resolve;
      });
    return original(method, params);
  });
  h.loss();
  const release = acquireLifecycleMetadataDemand('ws', 'context');
  await settle();
  release();
  h.registry.refreshAuthority();
  h.dispatch(hydrateContextItems('ws', [item('replacement')] as never));
  finish();
  await settle();
  expect(getItems(h.state.context.byWorkspaceId.ws.items).map((row) => row.id)).toEqual([
    'replacement',
  ]);
  expect(h.registry.capture(contextRecoveryKey('ws')).isCurrent()).toBe(false);
  expect(h.request.mock.calls.filter((c) => c[0] === 'workspace.getContext')).toHaveLength(1);
});

it('retains released metadata demand until the final recovery fence commits', async () => {
  const h = await harness(false);
  const original = h.request.getMockImplementation()!;
  let fences = 0;
  let finish!: () => void;
  h.request.mockImplementation(async (method, params) => {
    if (method === 'events.fence' && ++fences === 2)
      await new Promise<void>((resolve) => {
        finish = resolve;
      });
    return original(method, params);
  });
  h.loss();
  const release = acquireLifecycleMetadataDemand('ws', 'context');
  release();
  await settle();
  expect(fences).toBe(2);
  expect(getItems(h.state.context.byWorkspaceId.ws.items).map((row) => row.id)).toEqual(['old']);
  expect(h.request.mock.calls.filter((c) => c[0] === 'workspace.getContext')).toHaveLength(1);
  finish();
  await settle();
  expect(getItems(h.state.context.byWorkspaceId.ws.items).map((row) => row.id)).toEqual(['fresh']);
  expect(h.registry.capture(contextRecoveryKey('ws')).isCurrent()).toBe(false);
});

it('retains metadata demand released after apply until the running cycle settles', async () => {
  let afterApply = () => {};
  const h = await harness(false, () => afterApply());
  const original = h.request.getMockImplementation()!;
  let reads = 0;
  h.request.mockImplementation(async (method, params) => {
    if (method === 'workspace.getContext')
      return { items: [item(++reads === 1 ? 'fresh' : 'latest')] };
    return original(method, params);
  });
  h.loss();
  const release = acquireLifecycleMetadataDemand('ws', 'context');
  let freshBeforeRelease = false;
  let currentAfterRelease = false;
  afterApply = () => {
    afterApply = () => {};
    void Promise.resolve().then(() => {
      const receipt = h.registry.capture(contextRecoveryKey('ws'));
      freshBeforeRelease = receipt.commit(() => undefined);
      release();
      currentAfterRelease = receipt.isCurrent();
      h.loss('2');
    });
  };
  await settle();
  await vi.advanceTimersByTimeAsync(250);
  expect(getItems(h.state.context.byWorkspaceId.ws.items).map((row) => row.id)).toEqual(['latest']);
  expect(reads).toBe(2);
  expect(freshBeforeRelease).toBe(true);
  expect(currentAfterRelease).toBe(true);
  expect(h.registry.capture(contextRecoveryKey('ws')).isCurrent()).toBe(false);
  h.loss('3');
  await vi.advanceTimersByTimeAsync(250);
  expect(reads).toBe(2);
});
