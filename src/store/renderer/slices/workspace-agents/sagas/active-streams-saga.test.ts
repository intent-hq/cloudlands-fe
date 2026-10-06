import { beforeEach, describe, expect, it, vi } from 'vitest';
import { runSaga } from 'redux-saga';

const mocks = vi.hoisted(() => ({
  startPolling: vi.fn(),
  stopPolling: vi.fn(),
}));

vi.mock('$features/agent/services/active-streams-tracker', () => ({
  activeStreamsTracker: {
    startPolling: mocks.startPolling,
    stopPolling: mocks.stopPolling,
  },
}));

import { activeStreamsSaga } from './active-streams-saga';

describe('activeStreamsSaga', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('starts the single tracker polling owner', async () => {
    const task = runSaga({ dispatch: vi.fn() }, activeStreamsSaga);

    expect(mocks.startPolling).toHaveBeenCalledTimes(1);

    task.cancel();
    await task.toPromise();
  });

  it('stops polling on cancellation', async () => {
    const dispatch = vi.fn();
    const task = runSaga({ dispatch }, activeStreamsSaga);
    task.cancel();
    await task.toPromise();

    expect(mocks.stopPolling).toHaveBeenCalledTimes(1);
    await Promise.resolve();
    expect(dispatch).not.toHaveBeenCalled();
  });
});
