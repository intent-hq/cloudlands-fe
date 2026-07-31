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

import { setBetaUpdatesEnabled, toggleBetaUpdates } from '../user-preferences-slice';
import {
  betaUpdatesSaga,
  hydrateBetaUpdatesWorker,
  persistBetaUpdatesWorker,
} from './beta-updates-saga';

const settle = async () => {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
};

describe('betaUpdatesSaga', () => {
  beforeEach(() => vi.clearAllMocks());

  it('hydrates the exact beta and stable actions', async () => {
    const dispatch = vi.fn();
    mocks.getState.mockResolvedValueOnce({ channel: 'beta', status: 'idle' });
    await runSaga({ dispatch, getState: () => ({}) }, hydrateBetaUpdatesWorker).toPromise();
    mocks.getState.mockResolvedValueOnce({ channel: 'stable', status: 'idle' });
    await runSaga({ dispatch, getState: () => ({}) }, hydrateBetaUpdatesWorker).toPromise();

    expect(dispatch.mock.calls).toEqual([
      [setBetaUpdatesEnabled(true)],
      [setBetaUpdatesEnabled(false)],
    ]);
  });

  it('swallows hydration failures without dispatching', async () => {
    const dispatch = vi.fn();
    mocks.getState.mockRejectedValue(new Error('offline'));
    await runSaga({ dispatch, getState: () => ({}) }, hydrateBetaUpdatesWorker).toPromise();

    expect(dispatch.mock.calls).toEqual([]);
    expect(mocks.warn.mock.calls).toHaveLength(1);
  });

  it('persists the post-reducer channel and swallows failures', async () => {
    mocks.setChannel.mockResolvedValueOnce(undefined).mockRejectedValueOnce(new Error('denied'));
    await runSaga(
      { dispatch: vi.fn(), getState: () => ({ userPreferences: { betaUpdatesEnabled: true } }) },
      persistBetaUpdatesWorker,
    ).toPromise();
    await runSaga(
      { dispatch: vi.fn(), getState: () => ({ userPreferences: { betaUpdatesEnabled: false } }) },
      persistBetaUpdatesWorker,
    ).toPromise();

    expect(mocks.setChannel.mock.calls).toEqual([['beta'], ['stable']]);
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
      { channel, dispatch, getState: () => ({ userPreferences: { betaUpdatesEnabled: true } }) },
      betaUpdatesSaga,
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
    let resolveStable!: () => void;
    mocks.setChannel.mockImplementation(
      (nextChannel: 'beta' | 'stable') =>
        new Promise<void>((resolve) => {
          const complete = () => {
            completions.push(nextChannel);
            resolve();
          };
          if (nextChannel === 'beta') resolveBeta = complete;
          else resolveStable = complete;
        }),
    );
    const state = { userPreferences: { betaUpdatesEnabled: true } };
    const channel = stdChannel();
    const task = runSaga({ channel, dispatch: vi.fn(), getState: () => state }, betaUpdatesSaga);
    await settle();
    channel.put(setBetaUpdatesEnabled(true));
    await settle();
    state.userPreferences.betaUpdatesEnabled = false;
    channel.put(toggleBetaUpdates());
    await settle();

    expect(mocks.setChannel.mock.calls).toEqual([['beta']]);
    resolveBeta();
    await settle();
    expect(mocks.setChannel.mock.calls).toEqual([['beta'], ['stable']]);
    resolveStable();
    await settle();
    expect(completions).toEqual(['beta', 'stable']);
    task.cancel();
    await task.toPromise();
  });
});
