import { runSaga, stdChannel } from 'redux-saga';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { backendReconnected } from '../workspace-lifecycle-slice';
import { workspaceReconnectSaga } from './workspace-reconnect-saga';

const mocks = vi.hoisted(() => {
  const listeners = new Set<() => void>();
  return {
    listeners,
    unregister: vi.fn(),
    emitReconnect: () => {
      for (const listener of [...listeners]) listener();
    },
  };
});
vi.mock('$lib/client/live/backend-transport', () => ({
  onBackendReconnected: (listener: () => void) => {
    mocks.listeners.add(listener);
    return () => {
      mocks.listeners.delete(listener);
      mocks.unregister();
    };
  },
}));

const settle = async () => {
  for (let index = 0; index < 4; index += 1) await Promise.resolve();
};

function createHarness() {
  const channel = stdChannel();
  const actions: Array<{ type: string }> = [];
  const dispatch = (action: { type: string }) => {
    actions.push(action);
    channel.put(action);
    return action;
  };
  const task = runSaga({ channel, dispatch, getState: () => ({}) }, workspaceReconnectSaga);
  return { actions, task };
}

describe('workspaceReconnectSaga', () => {
  beforeEach(() => {
    mocks.listeners.clear();
    mocks.unregister.mockReset();
  });

  it('dispatches backendReconnected on every transport reconnect', async () => {
    const run = createHarness();
    await settle();
    expect(run.actions).toEqual([]);

    mocks.emitReconnect();
    await settle();
    mocks.emitReconnect();
    await settle();

    expect(run.actions).toEqual([backendReconnected(), backendReconnected()]);
    run.task.cancel();
    await run.task.toPromise();
  });

  it('unregisters the transport listener when cancelled', async () => {
    const run = createHarness();
    await settle();
    expect(mocks.listeners.size).toBe(1);

    run.task.cancel();
    await run.task.toPromise();

    expect(mocks.listeners.size).toBe(0);
    expect(mocks.unregister).toHaveBeenCalledOnce();
  });
});
