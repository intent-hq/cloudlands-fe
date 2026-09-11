import { beforeEach, describe, expect, it, vi } from 'vitest';
import { runSaga, stdChannel, type Task } from 'redux-saga';

const mocks = vi.hoisted(() => ({
  request: vi.fn(),
  subscribe: vi.fn(),
  unsubscribe: vi.fn(),
  notificationHandlers: new Set<(notification: { method: string; params?: unknown }) => void>(),
  reconnectHandlers: new Set<() => void>(),
}));

vi.mock('$lib/client/live/backend-transport', () => ({
  backendRequest: mocks.request,
  backendSubscribe: mocks.subscribe,
  backendUnsubscribe: mocks.unsubscribe,
  onBackendNotification: (
    handler: (notification: { method: string; params?: unknown }) => void,
  ) => {
    mocks.notificationHandlers.add(handler);
    return () => mocks.notificationHandlers.delete(handler);
  },
  onBackendReconnected: (handler: () => void) => {
    mocks.reconnectHandlers.add(handler);
    return () => mocks.reconnectHandlers.delete(handler);
  },
}));

import type { BackgroundHook } from '$features/hooks/background-hooks-service';
import {
  backgroundHooksReducer,
  backgroundHooksRefetchRequested,
  backgroundHooksSubscribeRequested,
  backgroundHooksUnsubscribeRequested,
  cancelBackgroundHookRequested,
  initialState,
  runBackgroundHookRequested,
} from '../background-hooks-slice';
import { backgroundHooksSaga } from './background-hooks-saga';
import { openWorkspaceTab, tabStateReducer } from '../../tab-state/tab-state-slice';

function makeHook(overrides: Partial<BackgroundHook> = {}): BackgroundHook {
  return {
    hookId: 'hook-1',
    workspaceId: 'ws-1',
    agentId: 'agent-1',
    name: 'ci-watch',
    code: 'const status = await ws.ci.status();',
    delayMs: 60_000,
    state: 'scheduled',
    createdAt: '2026-07-31T10:00:00Z',
    nextRunAt: '2026-07-31T10:06:00Z',
    runCount: 6,
    lastLogs: 'checking CI\nall green',
    ...overrides,
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((done, fail) => {
    resolve = done;
    reject = fail;
  });
  return { promise, resolve, reject };
}

function emitNotification(params: unknown): void {
  for (const handler of [...mocks.notificationHandlers]) {
    handler({ method: 'events.event', params });
  }
}

function emitReconnect(): void {
  for (const handler of [...mocks.reconnectHandlers]) handler();
}

function createHarness() {
  const initialTabState = tabStateReducer(undefined, { type: '@@INIT' });
  let state = { backgroundHooks: initialState, tabState: initialTabState };
  const channel = stdChannel();
  const listeners = new Set<() => void>();
  const dispatch = vi.fn((action: { type: string; payload?: unknown }) => {
    state = {
      backgroundHooks: backgroundHooksReducer(state.backgroundHooks, action),
      tabState: tabStateReducer(state.tabState, action as Parameters<typeof tabStateReducer>[1]),
    };
    channel.put(action);
    for (const listener of listeners) listener();
    return action;
  });
  const reduxStore = {
    getState: () => state,
    subscribe: (listener: () => void) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
  const task = runSaga(
    { channel, dispatch, getState: reduxStore.getState, context: { reduxStore } },
    backgroundHooksSaga,
  );
  return { dispatch, task, getState: () => state.backgroundHooks };
}

async function stop(task: Task): Promise<void> {
  task.cancel();
  await task.toPromise();
}

describe('backgroundHooksSaga', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.notificationHandlers.clear();
    mocks.reconnectHandlers.clear();
    mocks.subscribe.mockResolvedValue({ subscriptionId: 'sub-1' });
    mocks.unsubscribe.mockResolvedValue(undefined);
    mocks.request.mockImplementation((method: string) =>
      Promise.resolve(method === 'hook.list' ? { hooks: [makeHook()] } : { ok: true }),
    );
  });

  it('refcounts one workspace subscription and converges the hook.list response', async () => {
    const { dispatch, task, getState } = createHarness();
    dispatch(backgroundHooksSubscribeRequested('ws-1'));
    dispatch(backgroundHooksSubscribeRequested('ws-1'));

    await vi.waitFor(() => expect(getState().byWorkspaceId['ws-1']).toBeDefined());
    expect(mocks.subscribe).toHaveBeenCalledOnce();
    expect(mocks.subscribe).toHaveBeenCalledWith({
      eventTypes: ['hook:*'],
      workspaceId: 'ws-1',
    });
    expect(mocks.request).toHaveBeenCalledWith('hook.list', { workspaceId: 'ws-1' });
    expect(getState().byWorkspaceId['ws-1'].hooks.map['hook-1']).toEqual(makeHook());

    dispatch(backgroundHooksUnsubscribeRequested('ws-1'));
    expect(mocks.unsubscribe).not.toHaveBeenCalled();
    expect(getState().byWorkspaceId['ws-1']).toBeDefined();

    dispatch(backgroundHooksUnsubscribeRequested('ws-1'));
    await vi.waitFor(() => expect(mocks.unsubscribe).toHaveBeenCalledWith('sub-1'));
    // The entry is RETAINED (stale-marked, not cleared) so a warm re-subscribe
    // keeps the delivered latch set.
    expect(getState().byWorkspaceId['ws-1'].stale).toBe(true);
    expect(getState().byWorkspaceId['ws-1'].hooks.map['hook-1']).toEqual(makeHook());
    expect(mocks.notificationHandlers).toHaveLength(0);
    expect(mocks.reconnectHandlers).toHaveLength(0);
    await stop(task);
  });

  it('folds matching hook events, ignores foreign subscriptions, and refetches unseen hooks', async () => {
    const unseen = makeHook({ hookId: 'hook-9', name: 'new-hook' });
    const seed = deferred<{ hooks: BackgroundHook[] }>();
    mocks.request
      .mockReturnValueOnce(seed.promise)
      .mockResolvedValueOnce({ hooks: [makeHook()] })
      .mockResolvedValueOnce({ hooks: [unseen] });
    const { dispatch, task, getState } = createHarness();
    dispatch(backgroundHooksSubscribeRequested('ws-1'));
    // Settle the seed after the subscribe ack, then let the unconditional
    // post-ack re-list (coalesced as the seed's trailing run) settle before
    // emitting events.
    await vi.waitFor(() => expect(mocks.subscribe).toHaveBeenCalledOnce());
    seed.resolve({ hooks: [makeHook()] });
    await vi.waitFor(() => expect(mocks.request).toHaveBeenCalledTimes(2));
    await vi.waitFor(() => expect(getState().byWorkspaceId['ws-1']).toBeDefined());

    emitNotification({
      subscriptionId: 'foreign-sub',
      event: { type: 'hook:cancelled', workspaceId: 'ws-1', data: { hookId: 'hook-1' } },
    });
    emitNotification({
      subscriptionId: 'sub-1',
      event: { type: 'hook:run-started', workspaceId: 'ws-1', data: { hookId: 'hook-1' } },
    });
    await vi.waitFor(() =>
      expect(getState().byWorkspaceId['ws-1'].hooks.map['hook-1'].state).toBe('running'),
    );

    emitNotification({
      subscriptionId: 'sub-1',
      event: { type: 'hook:scheduled', workspaceId: 'ws-1', data: { hookId: 'hook-9' } },
    });
    await vi.waitFor(() =>
      expect(getState().byWorkspaceId['ws-1'].hooks.map['hook-9']).toEqual(unseen),
    );
    expect(mocks.request).toHaveBeenNthCalledWith(3, 'hook.list', { workspaceId: 'ws-1' });

    emitNotification({
      subscriptionId: 'sub-1',
      event: { type: 'hook:cancelled', workspaceId: 'ws-1', data: { hookId: 'hook-9' } },
    });
    await vi.waitFor(() =>
      expect(getState().byWorkspaceId['ws-1'].hooks.map['hook-9']).toBeUndefined(),
    );
    await stop(task);
  });

  it('coalesces refetch bursts into one trailing hook.list request', async () => {
    const first = deferred<{ hooks: BackgroundHook[] }>();
    const fresh = makeHook({ runCount: 7, lastLogs: 'fresh logs' });
    mocks.request.mockReturnValueOnce(first.promise).mockResolvedValueOnce({ hooks: [fresh] });
    const { dispatch, task, getState } = createHarness();
    dispatch(backgroundHooksSubscribeRequested('ws-1'));
    await vi.waitFor(() => expect(mocks.request).toHaveBeenCalledTimes(1));

    dispatch(backgroundHooksRefetchRequested('ws-1'));
    dispatch(backgroundHooksRefetchRequested('ws-1'));
    dispatch(backgroundHooksRefetchRequested('ws-1'));
    await Promise.resolve();
    expect(mocks.request).toHaveBeenCalledTimes(1);

    first.resolve({ hooks: [makeHook()] });
    await vi.waitFor(() => expect(mocks.request).toHaveBeenCalledTimes(2));
    await vi.waitFor(() =>
      expect(getState().byWorkspaceId['ws-1'].hooks.map['hook-1']).toEqual(fresh),
    );
    await Promise.resolve();
    expect(mocks.request).toHaveBeenCalledTimes(2);
    await stop(task);
  });

  it('coalesces overlapping bursts independently for two workspaces', async () => {
    const firstWs1 = deferred<{ hooks: BackgroundHook[] }>();
    const firstWs2 = deferred<{ hooks: BackgroundHook[] }>();
    const listCalls = new Map<string, number>();
    mocks.subscribe.mockImplementation(({ workspaceId }: { workspaceId: string }) =>
      Promise.resolve({ subscriptionId: `sub-${workspaceId}` }),
    );
    mocks.request.mockImplementation((method: string, params: { workspaceId?: string }) => {
      if (method !== 'hook.list' || !params.workspaceId) return Promise.resolve({ ok: true });
      const workspaceId = params.workspaceId;
      const call = listCalls.get(workspaceId) ?? 0;
      listCalls.set(workspaceId, call + 1);
      if (call === 0) return workspaceId === 'ws-1' ? firstWs1.promise : firstWs2.promise;
      return Promise.resolve({
        hooks: [
          makeHook({
            hookId: `hook-${workspaceId}`,
            workspaceId,
            runCount: 2,
            lastLogs: `fresh-${workspaceId}`,
          }),
        ],
      });
    });
    const { dispatch, task, getState } = createHarness();
    dispatch(backgroundHooksSubscribeRequested('ws-1'));
    dispatch(backgroundHooksSubscribeRequested('ws-2'));
    await vi.waitFor(() => expect(mocks.request).toHaveBeenCalledTimes(2));

    dispatch(backgroundHooksRefetchRequested('ws-1'));
    dispatch(backgroundHooksRefetchRequested('ws-2'));
    dispatch(backgroundHooksRefetchRequested('ws-1'));
    dispatch(backgroundHooksRefetchRequested('ws-2'));
    expect(mocks.request).toHaveBeenCalledTimes(2);

    firstWs2.resolve({ hooks: [makeHook({ hookId: 'stale-ws-2', workspaceId: 'ws-2' })] });
    await vi.waitFor(() => expect(listCalls.get('ws-2')).toBe(2));
    expect(listCalls.get('ws-1')).toBe(1);
    await vi.waitFor(() =>
      expect(getState().byWorkspaceId['ws-2'].hooks.map['hook-ws-2']?.lastLogs).toBe('fresh-ws-2'),
    );

    firstWs1.resolve({ hooks: [makeHook({ hookId: 'stale-ws-1' })] });
    await vi.waitFor(() => expect(listCalls.get('ws-1')).toBe(2));
    await vi.waitFor(() =>
      expect(getState().byWorkspaceId['ws-1'].hooks.map['hook-ws-1']?.lastLogs).toBe('fresh-ws-1'),
    );
    expect(mocks.request).toHaveBeenCalledWith('hook.list', { workspaceId: 'ws-1' });
    expect(mocks.request).toHaveBeenCalledWith('hook.list', { workspaceId: 'ws-2' });
    await stop(task);
  });

  it('runs the trailing refetch after the in-flight hook.list fails', async () => {
    const first = deferred<{ hooks: BackgroundHook[] }>();
    const fresh = makeHook({ runCount: 8, lastLogs: 'recovered' });
    mocks.request.mockReturnValueOnce(first.promise).mockResolvedValueOnce({ hooks: [fresh] });
    const { dispatch, task, getState } = createHarness();
    dispatch(backgroundHooksSubscribeRequested('ws-1'));
    await vi.waitFor(() => expect(mocks.request).toHaveBeenCalledOnce());

    dispatch(backgroundHooksRefetchRequested('ws-1'));
    dispatch(backgroundHooksRefetchRequested('ws-1'));
    first.reject(new Error('list failed'));

    await vi.waitFor(() => expect(mocks.request).toHaveBeenCalledTimes(2));
    await vi.waitFor(() =>
      expect(getState().byWorkspaceId['ws-1'].hooks.map['hook-1']).toEqual(fresh),
    );
    await stop(task);
  });

  it('surfaces failure when the initial hook.list seed fails', async () => {
    mocks.request.mockRejectedValue(new Error('list failed'));
    const { dispatch, task, getState } = createHarness();
    dispatch(backgroundHooksSubscribeRequested('ws-1'));

    await vi.waitFor(() => expect(getState().byWorkspaceId['ws-1']).toBeDefined());
    expect(Object.keys(getState().byWorkspaceId['ws-1'].hooks.map)).toHaveLength(0);
    expect(getState().byWorkspaceId['ws-1'].snapshotStatus).toBe('failed');
    await stop(task);
  });

  it('retires in-flight and trailing refetches when the last subscriber leaves', async () => {
    const pending = deferred<{ hooks: BackgroundHook[] }>();
    mocks.request.mockReturnValueOnce(pending.promise);
    const { dispatch, task, getState } = createHarness();
    dispatch(backgroundHooksSubscribeRequested('ws-1'));
    await vi.waitFor(() => expect(mocks.request).toHaveBeenCalledOnce());

    dispatch(backgroundHooksRefetchRequested('ws-1'));
    dispatch(backgroundHooksRefetchRequested('ws-1'));
    dispatch(backgroundHooksUnsubscribeRequested('ws-1'));
    await vi.waitFor(() => expect(mocks.unsubscribe).toHaveBeenCalledWith('sub-1'));
    expect(getState().byWorkspaceId['ws-1']).toBeUndefined();

    pending.resolve({ hooks: [makeHook({ lastLogs: 'late' })] });
    await Promise.resolve();
    await Promise.resolve();
    expect(mocks.request).toHaveBeenCalledTimes(1);
    expect(getState().byWorkspaceId['ws-1']).toBeUndefined();
    await stop(task);
  });

  it('coalesces reconnect refetches and rejects the prior generation late result', async () => {
    const stale = deferred<{ hooks: BackgroundHook[] }>();
    const fresh = deferred<{ hooks: BackgroundHook[] }>();
    mocks.subscribe
      .mockResolvedValueOnce({ subscriptionId: 'sub-old' })
      .mockResolvedValueOnce({ subscriptionId: 'sub-new' });
    mocks.request.mockReturnValueOnce(stale.promise).mockReturnValueOnce(fresh.promise);
    const { dispatch, task, getState } = createHarness();
    dispatch(backgroundHooksSubscribeRequested('ws-1'));
    await vi.waitFor(() => expect(mocks.request).toHaveBeenCalledOnce());

    emitReconnect();
    await vi.waitFor(() => expect(mocks.subscribe).toHaveBeenCalledTimes(2));
    stale.resolve({ hooks: [makeHook({ lastLogs: 'stale' })] });
    await vi.waitFor(() => expect(mocks.request).toHaveBeenCalledTimes(2));
    expect(getState().byWorkspaceId['ws-1']).toBeUndefined();

    const next = makeHook({ runCount: 9, lastLogs: 'fresh-after-reconnect' });
    fresh.resolve({ hooks: [next] });
    await vi.waitFor(() =>
      expect(getState().byWorkspaceId['ws-1'].hooks.map['hook-1']).toEqual(next),
    );
    await stop(task);
    expect(mocks.unsubscribe).toHaveBeenCalledWith('sub-new');
  });

  it('releases a stale subscribe acknowledgement and resubscribes after reconnect', async () => {
    const first = deferred<{ subscriptionId: string }>();
    mocks.subscribe
      .mockReturnValueOnce(first.promise)
      .mockResolvedValueOnce({ subscriptionId: 'sub-new' });
    const { dispatch, task, getState } = createHarness();
    dispatch(backgroundHooksSubscribeRequested('ws-1'));
    expect(mocks.notificationHandlers).toHaveLength(1);
    expect(mocks.reconnectHandlers).toHaveLength(1);

    emitReconnect();
    first.resolve({ subscriptionId: 'sub-stale' });
    await vi.waitFor(() => expect(mocks.unsubscribe).toHaveBeenCalledWith('sub-stale'));
    await vi.waitFor(() => expect(mocks.subscribe).toHaveBeenCalledTimes(2));
    await vi.waitFor(() => expect(getState().byWorkspaceId['ws-1']).toBeDefined());
    expect(mocks.subscribe).toHaveBeenNthCalledWith(2, {
      eventTypes: ['hook:*'],
      workspaceId: 'ws-1',
    });

    await stop(task);
    expect(mocks.unsubscribe).toHaveBeenCalledWith('sub-new');
    expect(mocks.notificationHandlers).toHaveLength(0);
    expect(mocks.reconnectHandlers).toHaveLength(0);
    expect(getState().byWorkspaceId['ws-1'].stale).toBe(true);
  });

  it('drops a pending hook.list completion after root cancellation', async () => {
    const pending = deferred<{ hooks: BackgroundHook[] }>();
    mocks.request.mockReturnValueOnce(pending.promise);
    const { dispatch, task, getState } = createHarness();
    dispatch(backgroundHooksSubscribeRequested('ws-1'));
    await vi.waitFor(() => expect(mocks.request).toHaveBeenCalledOnce());
    dispatch(backgroundHooksRefetchRequested('ws-1'));
    dispatch(backgroundHooksRefetchRequested('ws-1'));

    await stop(task);
    expect(mocks.unsubscribe).toHaveBeenCalledWith('sub-1');
    expect(mocks.notificationHandlers).toHaveLength(0);
    expect(mocks.reconnectHandlers).toHaveLength(0);
    expect(getState().byWorkspaceId['ws-1']).toBeUndefined();

    pending.resolve({ hooks: [makeHook()] });
    await Promise.resolve();
    await Promise.resolve();
    expect(mocks.request).toHaveBeenCalledTimes(1);
    expect(getState().byWorkspaceId['ws-1']).toBeUndefined();
  });

  it('sends exact hook.runNow and hook.cancel requests', async () => {
    const { dispatch, task } = createHarness();
    dispatch(runBackgroundHookRequested('ws-1', 'hook-1'));
    dispatch(cancelBackgroundHookRequested('ws-1', 'hook-1'));

    await vi.waitFor(() => expect(mocks.request).toHaveBeenCalledTimes(2));
    expect(mocks.request).toHaveBeenCalledWith('hook.runNow', {
      workspaceId: 'ws-1',
      hookId: 'hook-1',
    });
    expect(mocks.request).toHaveBeenCalledWith('hook.cancel', {
      workspaceId: 'ws-1',
      hookId: 'hook-1',
    });
    await stop(task);
  });

  describe('parallel seed and event-gap closing', () => {
    it('issues the hook.list seed concurrently with events.subscribe', async () => {
      const seed = deferred<{ hooks: BackgroundHook[] }>();
      const ack = deferred<{ subscriptionId: string }>();
      mocks.request.mockReturnValueOnce(seed.promise);
      mocks.subscribe.mockReturnValueOnce(ack.promise);
      const { dispatch, task, getState } = createHarness();
      dispatch(backgroundHooksSubscribeRequested('ws-1'));

      // Both RPCs are in flight before either settles (~1 RTT, not 2 serial).
      expect(mocks.request).toHaveBeenCalledWith('hook.list', { workspaceId: 'ws-1' });
      expect(mocks.subscribe).toHaveBeenCalledWith({
        eventTypes: ['hook:*'],
        workspaceId: 'ws-1',
      });

      ack.resolve({ subscriptionId: 'sub-1' });
      seed.resolve({ hooks: [makeHook()] });
      await vi.waitFor(() =>
        expect(getState().byWorkspaceId['ws-1'].hooks.map['hook-1']).toEqual(makeHook()),
      );
      await stop(task);
    });

    it('re-lists once when the seed settles before the subscribe ack', async () => {
      const ack = deferred<{ subscriptionId: string }>();
      const stale = makeHook({ runCount: 1, lastLogs: 'stale' });
      const fresh = makeHook({ runCount: 2, lastLogs: 'fresh' });
      mocks.subscribe.mockReturnValueOnce(ack.promise);
      mocks.request
        .mockResolvedValueOnce({ hooks: [stale] })
        .mockResolvedValueOnce({ hooks: [fresh] });
      const { dispatch, task, getState } = createHarness();
      dispatch(backgroundHooksSubscribeRequested('ws-1'));

      // The seed settled while the handshake was still in flight: its
      // snapshot may predate the subscription window.
      await vi.waitFor(() =>
        expect(getState().byWorkspaceId['ws-1'].hooks.map['hook-1']?.lastLogs).toBe('stale'),
      );
      expect(mocks.request).toHaveBeenCalledTimes(1);

      // The ack triggers exactly one gap-closing re-list.
      ack.resolve({ subscriptionId: 'sub-1' });
      await vi.waitFor(() => expect(mocks.request).toHaveBeenCalledTimes(2));
      expect(mocks.request).toHaveBeenNthCalledWith(2, 'hook.list', { workspaceId: 'ws-1' });
      await vi.waitFor(() =>
        expect(getState().byWorkspaceId['ws-1'].hooks.map['hook-1']?.lastLogs).toBe('fresh'),
      );
      await Promise.resolve();
      expect(mocks.request).toHaveBeenCalledTimes(2);
      await stop(task);
    });

    it('re-lists once (coalesced) even when the ack lands before the seed settles', async () => {
      const seed = deferred<{ hooks: BackgroundHook[] }>();
      const fresh = makeHook({ runCount: 3, lastLogs: 'fresh' });
      mocks.request.mockReturnValueOnce(seed.promise).mockResolvedValueOnce({ hooks: [fresh] });
      const { dispatch, task, getState } = createHarness();
      dispatch(backgroundHooksSubscribeRequested('ws-1'));
      await vi.waitFor(() => expect(mocks.subscribe).toHaveBeenCalledOnce());

      // Response ordering proves nothing about snapshot ordering: the seed
      // may have snapshotted before the subscription window even though it
      // responds after the ack — the post-ack re-list is unconditional,
      // coalesced into the in-flight seed's single trailing run.
      seed.resolve({ hooks: [makeHook()] });
      await vi.waitFor(() => expect(mocks.request).toHaveBeenCalledTimes(2));
      expect(mocks.request).toHaveBeenNthCalledWith(2, 'hook.list', { workspaceId: 'ws-1' });
      await vi.waitFor(() =>
        expect(getState().byWorkspaceId['ws-1'].hooks.map['hook-1']).toEqual(fresh),
      );
      await Promise.resolve();
      expect(mocks.request).toHaveBeenCalledTimes(2);
      await stop(task);
    });

    it('re-lists after the ack when a hook event folded during the handshake', async () => {
      const ack = deferred<{ subscriptionId: string }>();
      const seed = deferred<{ hooks: BackgroundHook[] }>();
      mocks.subscribe.mockReturnValueOnce(ack.promise);
      mocks.request.mockReturnValueOnce(seed.promise).mockResolvedValueOnce({ hooks: [] });
      const { dispatch, task, getState } = createHarness();
      dispatch(backgroundHooksSubscribeRequested('ws-1'));

      // A pre-ack fold (terminal event for a hook the empty list has not
      // seen — a no-op that does not itself request a refetch) can be
      // clobbered by the in-flight seed's older snapshot.
      emitNotification({
        subscriptionId: 'sub-1',
        event: { type: 'hook:cancelled', workspaceId: 'ws-1', data: { hookId: 'hook-1' } },
      });
      ack.resolve({ subscriptionId: 'sub-1' });
      // The stale seed still carries the cancelled hook; the gap-closing
      // re-list (coalesced as the trailing run) converges to the fresh list.
      seed.resolve({ hooks: [makeHook()] });
      await vi.waitFor(() => expect(mocks.request).toHaveBeenCalledTimes(2));
      expect(mocks.request).toHaveBeenNthCalledWith(2, 'hook.list', { workspaceId: 'ws-1' });
      await vi.waitFor(() =>
        expect(getState().byWorkspaceId['ws-1'].hooks.map['hook-1']).toBeUndefined(),
      );
      await Promise.resolve();
      expect(mocks.request).toHaveBeenCalledTimes(2);
      await stop(task);
    });
  });

  describe('active-workspace lease (view-time seed)', () => {
    it('seeds the active workspace subscription immediately at tab activation, before any card mounts', async () => {
      const { dispatch, task, getState } = createHarness();
      dispatch(openWorkspaceTab('ws-1'));

      // The lease opens on the leading edge — no reconciliation delay: the
      // subscribe is issued synchronously with the tab activation and the
      // hook.list seed lands (delivered latch flips) without any component
      // subscriber.
      expect(mocks.subscribe).toHaveBeenCalledWith({
        eventTypes: ['hook:*'],
        workspaceId: 'ws-1',
      });
      await vi.waitFor(() => expect(getState().byWorkspaceId['ws-1']).toBeDefined());
      await stop(task);
    });

    it('debounces a rapid tab flap into one trailing swap', async () => {
      vi.useFakeTimers();
      try {
        mocks.subscribe.mockImplementation(({ workspaceId }: { workspaceId: string }) =>
          Promise.resolve({ subscriptionId: `sub-${workspaceId}` }),
        );
        const { dispatch, task, getState } = createHarness();
        dispatch(openWorkspaceTab('ws-1'));
        expect(mocks.subscribe).toHaveBeenCalledTimes(1);
        await vi.advanceTimersByTimeAsync(10);

        // Flap within the window: ws-2 is debounced, ws-3 restarts the delay.
        dispatch(openWorkspaceTab('ws-2'));
        await vi.advanceTimersByTimeAsync(50);
        dispatch(openWorkspaceTab('ws-3'));
        await vi.advanceTimersByTimeAsync(99);
        expect(mocks.subscribe).toHaveBeenCalledTimes(1);

        await vi.advanceTimersByTimeAsync(1);
        expect(mocks.subscribe).toHaveBeenCalledTimes(2);
        expect(mocks.subscribe).toHaveBeenLastCalledWith({
          eventTypes: ['hook:*'],
          workspaceId: 'ws-3',
        });
        await vi.waitFor(() => expect(getState().byWorkspaceId['ws-3']).toBeDefined());
        expect(mocks.unsubscribe).toHaveBeenCalledWith('sub-ws-1');
        expect(getState().byWorkspaceId['ws-1']?.stale).toBe(true);
        await stop(task);
      } finally {
        vi.useRealTimers();
      }
    });

    it('keeps the workspace entry alive across a card remount (unsubscribe/subscribe churn)', async () => {
      const { dispatch, task, getState } = createHarness();
      dispatch(openWorkspaceTab('ws-1'));
      await vi.waitFor(() => expect(getState().byWorkspaceId['ws-1']).toBeDefined());

      // Card mounts (count 2), then remounts on agent switch: the paired
      // unsubscribe never drops the count to zero while the lease holds, so
      // the delivered entry survives and no reveal re-defers.
      dispatch(backgroundHooksSubscribeRequested('ws-1'));
      dispatch(backgroundHooksUnsubscribeRequested('ws-1'));
      expect(getState().byWorkspaceId['ws-1']).toBeDefined();
      expect(mocks.unsubscribe).not.toHaveBeenCalled();
      await stop(task);
    });

    it('swaps the lease when the active workspace tab changes', async () => {
      mocks.subscribe.mockImplementation(({ workspaceId }: { workspaceId: string }) =>
        Promise.resolve({ subscriptionId: `sub-${workspaceId}` }),
      );
      const { dispatch, task, getState } = createHarness();
      dispatch(openWorkspaceTab('ws-1'));
      await vi.waitFor(() => expect(getState().byWorkspaceId['ws-1']).toBeDefined());

      dispatch(openWorkspaceTab('ws-2'));
      await vi.waitFor(() => expect(getState().byWorkspaceId['ws-2']).toBeDefined());
      await vi.waitFor(() => expect(mocks.unsubscribe).toHaveBeenCalledWith('sub-ws-1'));
      // Retained stale-marked: the delivered latch survives the swap.
      expect(getState().byWorkspaceId['ws-1'].stale).toBe(true);
      await stop(task);
    });

    it('retains the outgoing entry stale-marked and re-seeds on warm switch-back', async () => {
      const seed = deferred<{ hooks: BackgroundHook[] }>();
      const reseed = deferred<{ hooks: BackgroundHook[] }>();
      const listCalls = new Map<string, number>();
      mocks.subscribe.mockImplementation(({ workspaceId }: { workspaceId: string }) =>
        Promise.resolve({ subscriptionId: `sub-${workspaceId}` }),
      );
      mocks.request.mockImplementation((method: string, params: { workspaceId?: string }) => {
        if (method !== 'hook.list' || !params.workspaceId) return Promise.resolve({ ok: true });
        const call = listCalls.get(params.workspaceId) ?? 0;
        listCalls.set(params.workspaceId, call + 1);
        if (params.workspaceId === 'ws-2') return Promise.resolve({ hooks: [] });
        return call === 0 ? seed.promise : reseed.promise;
      });
      const { dispatch, task, getState } = createHarness();

      // Seed ws-1; settle the seed after the subscribe ack. The
      // unconditional post-ack re-list runs as the seed's trailing run
      // (call 1) and parks on the reseed promise until the switch-away
      // cancels it.
      dispatch(openWorkspaceTab('ws-1'));
      await vi.waitFor(() => expect(mocks.subscribe).toHaveBeenCalledTimes(1));
      seed.resolve({ hooks: [makeHook()] });
      await vi.waitFor(() => expect(getState().byWorkspaceId['ws-1']).toBeDefined());
      expect(getState().byWorkspaceId['ws-1'].stale).toBe(false);

      // Switch away: the entry is retained stale-marked, rows intact.
      dispatch(openWorkspaceTab('ws-2'));
      await vi.waitFor(() => expect(mocks.unsubscribe).toHaveBeenCalledWith('sub-ws-1'));
      expect(getState().byWorkspaceId['ws-1'].stale).toBe(true);
      expect(getState().byWorkspaceId['ws-1'].hooks.map['hook-1']).toEqual(makeHook());

      // Warm switch-back: the retained rows stay visible immediately while
      // the background re-seed is still in flight.
      dispatch(openWorkspaceTab('ws-1'));
      await vi.waitFor(() => expect(listCalls.get('ws-1')).toBe(3));
      expect(getState().byWorkspaceId['ws-1'].stale).toBe(true);
      expect(getState().byWorkspaceId['ws-1'].hooks.map['hook-1']).toEqual(makeHook());

      // A pre-seed event folds against the retained rows, not from empty —
      // and the PROVISIONAL fold preserves the stale flag until a full
      // hook.list lands.
      emitNotification({
        subscriptionId: 'sub-ws-1',
        event: { type: 'hook:run-started', workspaceId: 'ws-1', data: { hookId: 'hook-1' } },
      });
      await vi.waitFor(() =>
        expect(getState().byWorkspaceId['ws-1'].hooks.map['hook-1'].state).toBe('running'),
      );
      expect(getState().byWorkspaceId['ws-1'].stale).toBe(true);

      // The re-seed lands: rows refresh and the entry is fresh again (the
      // post-ack trailing re-list re-applies the same resolved response).
      const fresh = makeHook({ runCount: 7, lastLogs: 'fresh' });
      reseed.resolve({ hooks: [fresh] });
      await vi.waitFor(() =>
        expect(getState().byWorkspaceId['ws-1'].hooks.map['hook-1']).toEqual(fresh),
      );
      expect(getState().byWorkspaceId['ws-1'].stale).toBe(false);
      await vi.waitFor(() => expect(listCalls.get('ws-1')).toBe(4));
      await stop(task);
    });
  });
});
