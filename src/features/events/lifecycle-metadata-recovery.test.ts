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
import { contextReducer, hydrateContextItems } from '$store/renderer/slices/context/context-slice';
import {
  tokenUsageReducer,
  tokenUsageReceived,
} from '$store/renderer/slices/token-usage/token-usage-slice';
import {
  taskAgentAssociationsReducer,
  hydrateTaskAgentAssociations,
} from '$store/renderer/slices/task-agent-associations/task-agent-associations-slice';
import { RendererEventRecovery } from './renderer-event-recovery';
import {
  acquireLifecycleMetadataDemand,
  contextRecoveryKey,
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
async function harness(mounted = true) {
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
    installLifecycleMetadataRecovery(scope, {
      getState: () => state,
      dispatch,
      subscribe: (fn) => {
        listeners.add(fn);
        return () => {
          listeners.delete(fn);
        };
      },
    }),
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
});
