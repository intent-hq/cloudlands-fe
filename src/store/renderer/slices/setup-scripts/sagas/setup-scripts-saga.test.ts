import { runSaga, stdChannel } from 'redux-saga';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ get: vi.fn() }));
vi.mock('$lib/client', () => ({
  appClient: { setupScripts: { get: mocks.get } },
}));

import {
  loadSetupScriptPresenceRequested,
  setupScriptPresenceLoadFailed,
  setupScriptPresenceLoaded,
} from '../setup-scripts-slice';
import { setupScriptsSaga } from './setup-scripts-saga';

const settle = async () => {
  for (let i = 0; i < 4; i++) await Promise.resolve();
};

describe('setupScriptsSaga', () => {
  beforeEach(() => vi.clearAllMocks());

  it('publishes an explicit failure when the presence read rejects', async () => {
    mocks.get.mockRejectedValue(new Error('offline'));
    const channel = stdChannel();
    const dispatch = vi.fn();
    const task = runSaga({ channel, dispatch, getState: () => ({}) }, setupScriptsSaga);

    channel.put(loadSetupScriptPresenceRequested('ws-test'));
    await settle();
    task.cancel();
    await task.toPromise();

    expect(mocks.get).toHaveBeenCalledExactlyOnceWith('ws-test');
    expect(dispatch).toHaveBeenCalledWith(setupScriptPresenceLoadFailed('ws-test'));
    expect(dispatch).not.toHaveBeenCalledWith(setupScriptPresenceLoaded('ws-test', false));
  });
});
