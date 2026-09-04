import { beforeEach, describe, expect, it, vi } from 'vitest';
import { runSaga } from 'redux-saga';

const mocks = vi.hoisted(() => ({
  subscribe: vi.fn(),
  unsubscribe: vi.fn(),
  startPolling: vi.fn(),
  stopPolling: vi.fn(),
  listener: undefined as (() => void) | undefined,
}));

vi.mock('$features/agent/services/active-streams-tracker', () => ({
  activeStreamsTracker: {
    subscribe: (listener: () => void) => {
      mocks.listener = listener;
      mocks.subscribe(listener);
      return mocks.unsubscribe;
    },
    startPolling: mocks.startPolling,
    stopPolling: mocks.stopPolling,
  },
}));

import { bumpActiveStreamsVersion } from '$store/renderer/slices/sidebar-nav/sidebar-nav-slice';
import { activeStreamsSaga } from './active-streams-saga';

describe('activeStreamsSaga', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.listener = undefined;
  });

  it('subscribes before starting the single tracker polling owner and forwards changes', async () => {
    const dispatch = vi.fn();
    const task = runSaga({ dispatch }, activeStreamsSaga);

    expect(mocks.subscribe).toHaveBeenCalledTimes(1);
    expect(mocks.startPolling).toHaveBeenCalledTimes(1);
    expect(mocks.subscribe.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.startPolling.mock.invocationCallOrder[0],
    );
    mocks.listener!();
    await Promise.resolve();
    expect(dispatch).toHaveBeenCalledWith(bumpActiveStreamsVersion());

    task.cancel();
    await task.toPromise();
  });

  it('unsubscribes and stops polling on cancellation without forwarding later changes', async () => {
    const dispatch = vi.fn();
    const task = runSaga({ dispatch }, activeStreamsSaga);
    const listener = mocks.listener!;
    task.cancel();
    await task.toPromise();

    expect(mocks.unsubscribe).toHaveBeenCalledTimes(1);
    expect(mocks.stopPolling).toHaveBeenCalledTimes(1);
    listener();
    await Promise.resolve();
    expect(dispatch).not.toHaveBeenCalled();
  });
});
