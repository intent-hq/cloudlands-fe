import { afterEach, describe, expect, it, vi } from 'vitest';
vi.mock('$lib/client/live/backend-transport', () => ({
  backendRequest: vi.fn(),
  onBackendNotification: () => () => {},
  onBackendReconnected: () => () => {},
}));
vi.mock('$store/renderer/store', () => ({ store: { state: {}, dispatch: vi.fn() } }));
vi.mock('$store/renderer/slices/principal/principal-selectors', () => ({
  selectPrincipalActionContext: { select: (state: { authority: string }) => state.authority },
}));
import {
  createEventRecoverySession,
  type RecoveryNotification,
} from '$shared/event-recovery/session';
import { RendererEventRecovery } from './renderer-event-recovery';
import { installTaskListRecovery, runTaskListRead, tasksRecoveryKey } from './task-list-recovery';
import {
  workspaceTasksReducer,
  acquireWorkspaceTasksDemand,
  releaseWorkspaceTasksDemand,
  workspaceTasksReadStarted,
  loadWorkspaceTasksSucceeded,
} from '$store/renderer/slices/workspace-tasks/workspace-tasks-slice';
import type { StoreState } from '$store/renderer/types';
const settle = async () => {
  for (let i = 0; i < 100; i++) await Promise.resolve();
};
const cleanups: Array<() => void> = [];
afterEach(() => {
  for (const off of cleanups.splice(0)) off();
  vi.useRealTimers();
});
async function harness(active = true, authority: string | null = 'a') {
  vi.useFakeTimers();
  vi.setSystemTime(0);
  let receive!: (n: RecoveryNotification) => void;
  let state = {
    authority,
    workspaceTasks: workspaceTasksReducer(
      undefined,
      loadWorkspaceTasksSucceeded('ws', [{ id: 'gone', title: 'Old', status: 'not_started' }], {
        total: 8,
        completed: 0,
        inProgress: 0,
      }),
    ),
  };
  const listeners = new Set<() => void>();
  const dispatch = (action: { type: string }) => {
    state = { ...state, workspaceTasks: workspaceTasksReducer(state.workspaceTasks, action) };
    for (const fn of listeners) fn();
  };
  if (active) dispatch(acquireWorkspaceTasksDemand('ws', 'view'));
  const read = vi.fn(async (): Promise<unknown> => ({
    tasks: [{ id: 'current', title: 'Current', status: 'complete' }],
    stats: { total: 11, completed: 9, inProgress: 1 },
  }));
  const request = vi.fn(async (method: string, params?: unknown) => {
    if (method === 'events.subscribe') return { subscriptionId: 'tasks', lossRecovery: 1 };
    if (method === 'events.fence') return params;
    if (method === 'task.list') return read();
    throw new Error(method);
  });
  const registry = new RendererEventRecovery();
  const scope = registry.attach(
    createEventRecoverySession({
      supported: true,
      isCurrent: () => true,
      onRetired: () => () => {},
      onNotification: (fn) => {
        receive = fn;
        return () => {};
      },
      request: async (method, params, observe) => {
        const value = await request(method, params);
        observe?.(value);
        return value;
      },
      dispose: () => {},
    }),
  );
  const store = {
    getState: () => state as unknown as StoreState,
    dispatch,
    subscribe: (fn: () => void) => {
      listeners.add(fn);
      return () => {
        listeners.delete(fn);
      };
    },
  };
  const stop = installTaskListRecovery(scope, store);
  cleanups.push(() => {
    stop();
    registry.dispose();
  });
  await scope.subscribe(
    { workspaceId: 'ws', eventTypes: ['task:*', 'note:*', 'workspace:*'] },
    { recover: true },
  );
  return {
    registry,
    read,
    request,
    dispatch,
    stop,
    state: () => state.workspaceTasks.byWorkspaceId.ws,
    loss: (generation = '1', id = 'tasks') =>
      receive({
        method: 'events.lost',
        params: { subscriptionId: id, generation, scope: { workspaceId: 'ws' } },
      }),
    changeAuthority: () => {
      state = { ...state, authority: 'b' };
      for (const fn of listeners) fn();
    },
  };
}
describe('active task list recovery', () => {
  it('repairs the canonical list and daemon rollup after a lost final event', async () => {
    const h = await harness();
    const old = h.registry.capture(tasksRecoveryKey('ws'));
    h.loss('1', 'foreign');
    await settle();
    expect(h.read).not.toHaveBeenCalled();
    h.loss();
    await settle();
    expect(h.state().tasks.ids).toEqual(['current']);
    expect(h.state().stats).toEqual({ total: 11, completed: 9, inProgress: 1 });
    expect(h.read).toHaveBeenCalledTimes(1);
    expect(old.commit(() => {})).toBe(false);
    expect(h.request.mock.calls.filter(([m]) => m === 'events.fence')).toHaveLength(2);
  });
  it('keeps hidden caches stale without reading until visible demand returns', async () => {
    const h = await harness(false);
    h.loss();
    await settle();
    expect(h.read).not.toHaveBeenCalled();
    expect(h.state().stale).toBe(true);
    h.dispatch(acquireWorkspaceTasksDemand('ws', 'view'));
    await settle();
    expect(h.read).toHaveBeenCalledTimes(1);
    expect(h.state().tasks.ids).toEqual(['current']);
  });
  it('shares ordinary work and waits for it before the fresh recovery read', async () => {
    const h = await harness();
    let finish!: (value: unknown) => void;
    let active = 0,
      peak = 0;
    const token = h.registry.capture(tasksRecoveryKey('ws'));
    const ordinary = vi.fn(() => {
      peak = Math.max(peak, ++active);
      return new Promise((done) => {
        finish = (value) => {
          active--;
          done(value);
        };
      });
    });
    const pending = runTaskListRead('ws', token, ordinary);
    expect(runTaskListRead('ws', token, ordinary)).toBe(pending);
    h.read.mockImplementation(async () => {
      peak = Math.max(peak, ++active);
      active--;
      return { tasks: [], stats: { total: 0, completed: 0, inProgress: 0 } };
    });
    h.loss();
    await settle();
    expect(h.read).not.toHaveBeenCalled();
    finish({ tasks: [{ id: 'obsolete' }] });
    await pending;
    await settle();
    expect(peak).toBe(1);
    expect(h.read).toHaveBeenCalledTimes(1);
    expect(h.state().tasks.ids).toEqual([]);
    expect(token.commit(() => {})).toBe(false);
  });
  it('rejects held recovery and ordinary writes across hide and same-id remount', async () => {
    const h = await harness();
    let finish!: (value: unknown) => void;
    h.read.mockImplementationOnce(
      () =>
        new Promise((done) => {
          finish = done;
        }),
    );
    h.loss();
    await settle();
    const old = h.registry.capture(tasksRecoveryKey('ws'));
    h.dispatch(releaseWorkspaceTasksDemand('ws', 'view'));
    h.dispatch(acquireWorkspaceTasksDemand('ws', 'new-view'));
    finish({ tasks: [{ id: 'stale', status: 'complete' }], stats: { total: 99 } });
    await settle();
    expect(old.commit(() => {})).toBe(false);
    await vi.advanceTimersByTimeAsync(250);
    await settle();
    expect(h.state().tasks.ids).toEqual(['current']);
    expect(h.state().stats.total).toBe(11);
  });
  it('clears protected tasks on permission denial and retains view demand', async () => {
    const h = await harness();
    h.read.mockRejectedValue({ rpcCode: -32001, message: 'permission denied' });
    h.loss();
    await settle();
    expect(h.state().tasks.ids).toEqual([]);
    expect(h.state().stats.total).toBe(0);
    expect(h.state().demandIds).toEqual(['view']);
  });
  it('clears on teardown and prevents a held old result from populating replacement state', async () => {
    const h = await harness();
    let finish!: (value: unknown) => void;
    h.read.mockImplementationOnce(
      () =>
        new Promise((done) => {
          finish = done;
        }),
    );
    h.loss();
    await settle();
    h.stop();
    expect(h.state().tasks.ids).toEqual([]);
    h.dispatch(workspaceTasksReadStarted('ws'));
    h.dispatch(
      loadWorkspaceTasksSucceeded('ws', [{ id: 'replacement', title: 'New', status: 'complete' }], {
        total: 1,
        completed: 1,
        inProgress: 0,
      }),
    );
    finish({ tasks: [{ id: 'stale', status: 'complete' }], stats: { total: 99 } });
    await settle();
    expect(h.state().tasks.ids).toEqual(['replacement']);
  });
  it('coalesces loss during a held snapshot and rejects later unproven pushes', async () => {
    const h = await harness();
    let finish!: (value: unknown) => void;
    h.read.mockImplementationOnce(
      () =>
        new Promise((done) => {
          finish = done;
        }),
    );
    h.loss();
    await settle();
    for (let generation = 2; generation <= 20; generation++) h.loss(String(generation));
    await settle();
    expect(h.read).toHaveBeenCalledTimes(1);
    finish({ tasks: [{ id: 'obsolete', status: 'complete' }], stats: { total: 99 } });
    await settle();
    await vi.advanceTimersByTimeAsync(250);
    await settle();
    expect(h.read).toHaveBeenCalledTimes(2);
    expect(h.state().tasks.ids).toEqual(['current']);
    expect(h.registry.push(tasksRecoveryKey('ws'))).toBe(false);
    expect(h.state().tasks.ids).toEqual(['current']);
  });
  it('clears the old principal projection before a held reply can return', async () => {
    const h = await harness();
    let finish!: (value: unknown) => void;
    h.read.mockImplementationOnce(
      () =>
        new Promise((done) => {
          finish = done;
        }),
    );
    h.loss();
    await settle();
    h.changeAuthority();
    expect(h.state().tasks.ids).toEqual([]);
    finish({ tasks: [{ id: 'secret', status: 'complete' }], stats: { total: 99 } });
    await settle();
    expect(h.state().tasks.ids).toEqual([]);
  });
  it('does not read protected tasks without an admitted principal', async () => {
    const h = await harness(true, null);
    h.loss();
    await settle();
    expect(h.read).not.toHaveBeenCalled();
    expect(h.state().tasks.ids).toEqual([]);
  });
});
