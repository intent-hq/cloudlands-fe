import { runSaga, stdChannel } from 'redux-saga';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  getState: vi.fn(),
  setChannel: vi.fn(),
  warn: vi.fn(),
}));

vi.mock('$features/auto-update/auto-update.client', () => ({
  autoUpdateClient: { getState: mocks.getState, setChannel: mocks.setChannel },
}));
vi.mock('$lib/utils/client-logger', () => ({
  createLogger: () => ({ warn: mocks.warn }),
}));

import { setUpdateChannel } from '../user-preferences-slice';
import {
  updateChannelSaga,
  hydrateUpdateChannelWorker,
  persistUpdateChannelWorker,
} from './update-channel-saga';

const settle = async () => {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
};

describe('updateChannelSaga', () => {
  beforeEach(() => vi.clearAllMocks());

  it('hydrates the exact channel actions for every channel', async () => {
    const dispatch = vi.fn();
    mocks.getState.mockResolvedValueOnce({ channel: 'beta', status: 'idle' });
    await runSaga({ dispatch, getState: () => ({}) }, hydrateUpdateChannelWorker).toPromise();
    mocks.getState.mockResolvedValueOnce({ channel: 'stable', status: 'idle' });
    await runSaga({ dispatch, getState: () => ({}) }, hydrateUpdateChannelWorker).toPromise();
    mocks.getState.mockResolvedValueOnce({ channel: 'alpha', status: 'idle' });
    await runSaga({ dispatch, getState: () => ({}) }, hydrateUpdateChannelWorker).toPromise();

    expect(dispatch.mock.calls).toEqual([
      [setUpdateChannel('beta')],
      [setUpdateChannel('stable')],
      [setUpdateChannel('alpha')],
    ]);
  });

  it('swallows hydration failures without dispatching', async () => {
    const dispatch = vi.fn();
    mocks.getState.mockRejectedValue(new Error('offline'));
    await runSaga({ dispatch, getState: () => ({}) }, hydrateUpdateChannelWorker).toPromise();

    expect(dispatch.mock.calls).toEqual([]);
    expect(mocks.warn.mock.calls).toHaveLength(1);
  });

  it('persists the post-reducer channel and swallows failures', async () => {
    mocks.setChannel.mockResolvedValueOnce(undefined).mockRejectedValueOnce(new Error('denied'));
    await runSaga(
      { dispatch: vi.fn(), getState: () => ({ userPreferences: { updateChannel: 'alpha' } }) },
      persistUpdateChannelWorker,
    ).toPromise();
    await runSaga(
      { dispatch: vi.fn(), getState: () => ({ userPreferences: { updateChannel: 'stable' } }) },
      persistUpdateChannelWorker,
    ).toPromise();

    expect(mocks.setChannel.mock.calls).toEqual([['alpha'], ['stable']]);
    expect(mocks.warn.mock.calls).toHaveLength(1);
  });

  it('ignores unrelated actions and cancels a pending boot read', async () => {
    let resolve!: (value: { channel: 'beta'; status: 'idle' }) => void;
    mocks.getState.mockReturnValue(
      new Promise((done) => {
        resolve = done;
      }),
    );
    const channel = stdChannel();
    const dispatch = vi.fn();
    const task = runSaga(
      { channel, dispatch, getState: () => ({ userPreferences: { updateChannel: 'beta' } }) },
      updateChannelSaga,
    );
    channel.put({ type: 'unrelated/action' });
    task.cancel();
    resolve({ channel: 'beta', status: 'idle' });
    await task.toPromise();
    await settle();

    expect(dispatch.mock.calls).toEqual([]);
    expect(mocks.setChannel.mock.calls).toEqual([]);
  });

  it('serializes an active write before applying the latest queued channel', async () => {
    mocks.getState.mockResolvedValue({ channel: 'stable', status: 'idle' });
    const completions: string[] = [];
    let resolveBeta!: () => void;
    let resolveAlpha!: () => void;
    mocks.setChannel.mockImplementation(
      (nextChannel: 'beta' | 'alpha') =>
        new Promise<void>((resolve) => {
          const complete = () => {
            completions.push(nextChannel);
            resolve();
          };
          if (nextChannel === 'beta') resolveBeta = complete;
          else resolveAlpha = complete;
        }),
    );
    const state = { userPreferences: { updateChannel: 'beta' } };
    const channel = stdChannel();
    const task = runSaga({ channel, dispatch: vi.fn(), getState: () => state }, updateChannelSaga);
    await settle();
    channel.put(setUpdateChannel('beta'));
    await settle();
    state.userPreferences.updateChannel = 'alpha';
    channel.put(setUpdateChannel('alpha'));
    await settle();

    expect(mocks.setChannel.mock.calls).toEqual([['beta']]);
    resolveBeta();
    await settle();
    expect(mocks.setChannel.mock.calls).toEqual([['beta'], ['alpha']]);
    resolveAlpha();
    await settle();
    expect(completions).toEqual(['beta', 'alpha']);
    task.cancel();
    await task.toPromise();
  });
});
