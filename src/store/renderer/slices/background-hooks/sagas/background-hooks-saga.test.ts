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
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
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
  let backgroundHooks = initialState;
  const channel = stdChannel();
  const dispatch = vi.fn((action: { type: string; payload?: unknown }) => {
    backgroundHooks = backgroundHooksReducer(backgroundHooks, action);
    channel.put(action);
    return action;
  });
  const task = runSaga(
    { channel, dispatch, getState: () => ({ backgroundHooks }) },
    backgroundHooksSaga,
  );
  return { dispatch, task, getState: () => backgroundHooks };
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
    expect(getState().byWorkspaceId['ws-1']).toBeUndefined();
    expect(mocks.notificationHandlers).toHaveLength(0);
    expect(mocks.reconnectHandlers).toHaveLength(0);
    await stop(task);
  });

  it('folds matching hook events, ignores foreign subscriptions, and refetches unseen hooks', async () => {
    const unseen = makeHook({ hookId: 'hook-9', name: 'new-hook' });
    mocks.request
      .mockResolvedValueOnce({ hooks: [makeHook()] })
      .mockResolvedValueOnce({ hooks: [unseen] });
    const { dispatch, task, getState } = createHarness();
    dispatch(backgroundHooksSubscribeRequested('ws-1'));
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
    expect(mocks.request).toHaveBeenNthCalledWith(2, 'hook.list', { workspaceId: 'ws-1' });

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
    expect(getState().byWorkspaceId['ws-1']).toBeUndefined();
  });

  it('drops a pending hook.list completion after root cancellation', async () => {
    const pending = deferred<{ hooks: BackgroundHook[] }>();
    mocks.request.mockReturnValueOnce(pending.promise);
    const { dispatch, task, getState } = createHarness();
    dispatch(backgroundHooksSubscribeRequested('ws-1'));
    await vi.waitFor(() => expect(mocks.request).toHaveBeenCalledOnce());

    await stop(task);
    expect(mocks.unsubscribe).toHaveBeenCalledWith('sub-1');
    expect(mocks.notificationHandlers).toHaveLength(0);
    expect(mocks.reconnectHandlers).toHaveLength(0);
    expect(getState().byWorkspaceId['ws-1']).toBeUndefined();

    pending.resolve({ hooks: [makeHook()] });
    await Promise.resolve();
    await Promise.resolve();
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
});
