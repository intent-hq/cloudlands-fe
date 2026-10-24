import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { runSaga, stdChannel } from 'redux-saga';
import type { StoreAction } from '@themislib/themis/types';
const wire = vi.hoisted(() => ({
  request: vi.fn(),
  subscribe: vi.fn(),
  unsubscribe: vi.fn(),
  reconnect: new Set<() => void>(),
}));
vi.mock('$lib/client/live/backend-transport', () => ({
  backendRequest: wire.request,
  backendSubscribe: wire.subscribe,
  backendUnsubscribe: wire.unsubscribe,
  onBackendNotification: () => () => {},
  onBackendReconnected: (handler: () => void) => {
    wire.reconnect.add(handler);
    return () => wire.reconnect.delete(handler);
  },
}));
import { gitRootsSaga } from './git-roots-saga';
import {
  gitRootsReducer,
  initialState,
  gitRootsConsumerMounted,
  gitRootsConsumerUnmounted,
} from '../git-roots-slice';

const root = {
  id: 'secondary',
  workspaceId: 'ws',
  path: '/workspace/secondary',
  source: 'agent',
  createdAt: '2026-10-16T00:00:00Z',
  updatedAt: '2026-10-16T00:00:00Z',
};
function start() {
  let state = { gitRoots: initialState };
  const channel = stdChannel();
  const listeners = new Set<() => void>();
  const dispatch = (action: StoreAction<unknown>) => {
    state = { gitRoots: gitRootsReducer(state.gitRoots, action) };
    channel.put(action);
    for (const listener of listeners) listener();
  };
  const reduxStore = {
    getState: () => state,
    subscribe: (listener: () => void) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
  const task = runSaga(
    { channel, dispatch, getState: reduxStore.getState, context: { reduxStore } },
    gitRootsSaga,
  );
  return { dispatch, task, roots: () => state.gitRoots.byWorkspaceId.ws?.gitRoots };
}
const settle = () => vi.advanceTimersByTimeAsync(100);
beforeEach(() => {
  vi.useFakeTimers();
  vi.resetAllMocks();
  wire.reconnect.clear();
  wire.subscribe.mockResolvedValue({ subscriptionId: 'git-sub' });
  wire.unsubscribe.mockResolvedValue(undefined);
  wire.request.mockResolvedValue({ gitRoots: [root] });
});
afterEach(() => vi.useRealTimers());

it('Home → Git view → Home sends only demand-scoped wire requests, including reconnect', async () => {
  const run = start();
  try {
    await settle();
    expect(wire.request).not.toHaveBeenCalled();
    expect(wire.subscribe).not.toHaveBeenCalled();
    run.dispatch(gitRootsConsumerMounted('ws', 'sidebar'));
    run.dispatch(gitRootsConsumerMounted('ws', 'panel'));
    await settle();
    expect(wire.subscribe.mock.calls).toEqual([[{ eventTypes: ['gitRoot:*'], workspaceId: 'ws' }]]);
    expect(wire.request.mock.calls).toEqual([['gitRoot.list', { workspaceId: 'ws' }]]);
    expect(run.roots()?.map.secondary).toEqual(root);
    for (const handler of wire.reconnect) handler();
    await settle();
    expect(wire.request).toHaveBeenCalledTimes(2);
    run.dispatch(gitRootsConsumerUnmounted('ws', 'sidebar'));
    await settle();
    expect(wire.unsubscribe).not.toHaveBeenCalled();
    run.dispatch(gitRootsConsumerUnmounted('ws', 'panel'));
    await settle();
    expect(wire.unsubscribe.mock.calls).toEqual([['git-sub', 'ws']]);
    expect(wire.reconnect.size).toBe(0);
    wire.request.mockClear();
    run.dispatch(gitRootsConsumerMounted('ws', 'sidebar'));
    await settle();
    expect(wire.request.mock.calls).toEqual([['gitRoot.list', { workspaceId: 'ws' }]]);
  } finally {
    run.task.cancel();
    await run.task.toPromise();
  }
});

it('a list resolving after the view is released cannot replace a reacquired snapshot', async () => {
  let resolve!: (value: unknown) => void;
  wire.request.mockReturnValueOnce(new Promise((done) => (resolve = done)));
  const run = start();
  try {
    run.dispatch(gitRootsConsumerMounted('ws', 'sidebar'));
    await settle();
    run.dispatch(gitRootsConsumerUnmounted('ws', 'sidebar'));
    await settle();
    run.dispatch(gitRootsConsumerMounted('ws', 'sidebar'));
    await settle();
    expect(run.roots()?.map.secondary).toEqual(root);
    resolve({ gitRoots: [{ ...root, path: '/obsolete' }] });
    await settle();
    expect(run.roots()?.map.secondary).toEqual(root);
    expect(wire.request.mock.calls).toEqual([
      ['gitRoot.list', { workspaceId: 'ws' }],
      ['gitRoot.list', { workspaceId: 'ws' }],
    ]);
  } finally {
    run.task.cancel();
    await run.task.toPromise();
  }
});
