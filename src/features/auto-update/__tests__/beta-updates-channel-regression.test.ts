/** Regression coverage for intent-hq/monorepo#1672 at the saga/IPC boundary. */
import { runSaga, stdChannel, type Task } from 'redux-saga';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('$store/renderer/slices/user-preferences/user-preferences-selectors', async () => {
  const { select } = await import('typed-redux-saga');
  return {
    selectBetaUpdatesEnabled: {
      effect: function* () {
        return yield* select(
          (state: { userPreferences: { betaUpdatesEnabled: boolean } }) =>
            state.userPreferences.betaUpdatesEnabled,
        );
      },
    },
  };
});

import { AUTO_UPDATE_CHANNELS, type UpdateState } from '$features/auto-update/types';
import { registerMockIpcHandler, resetMockIpcRouter } from '$shared/ipc-mock-router';
import {
  loadBetaUpdatesSettings,
  setBetaUpdatesEnabled,
  toggleBetaUpdates,
} from '$store/renderer/slices/user-preferences/user-preferences-slice';
import { betaUpdatesSaga } from '$store/renderer/slices/user-preferences/sagas/beta-updates-saga';

const flush = async () => {
  for (let i = 0; i < 5; i++) {
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
};

const baseUpdateState: UpdateState = {
  status: 'idle',
  currentVersion: '2.19.0',
  updateInfo: null,
  progress: null,
  error: null,
  channel: 'stable',
};

const runningTasks: Task[] = [];

function installAutoUpdateIpc(channel: 'beta' | 'stable') {
  const getState = vi.fn(async () => ({
    success: true,
    data: { ...baseUpdateState, channel },
  }));
  const setChannel = vi.fn(async () => ({ success: true }));
  registerMockIpcHandler(AUTO_UPDATE_CHANNELS.GET_STATE, getState);
  registerMockIpcHandler(AUTO_UPDATE_CHANNELS.SET_CHANNEL, setChannel);
  return { getState, setChannel };
}

function startBetaUpdatesSaga(initialEnabled: boolean) {
  const channel = stdChannel();
  const state = { userPreferences: { betaUpdatesEnabled: initialEnabled } };
  const dispatch = vi.fn((action: { type: string; payload?: unknown[] }) => {
    if (action.type === loadBetaUpdatesSettings.type) {
      state.userPreferences.betaUpdatesEnabled = action.payload?.[0] === true;
    }
  });
  const task = runSaga({ channel, dispatch, getState: () => state }, betaUpdatesSaga);
  runningTasks.push(task);
  return { channel, dispatch, state };
}

beforeEach(() => resetMockIpcRouter());

afterEach(() => {
  for (const task of runningTasks) task.cancel();
  runningTasks.length = 0;
  resetMockIpcRouter();
});

describe('beta-updates channel regression (intent-hq/monorepo#1672)', () => {
  it.each([
    ['beta', false, true],
    ['stable', true, false],
  ] as const)(
    'hydrates the Redux preference from the main-process %s channel without an echo',
    async (mainChannel, initialEnabled, expectedEnabled) => {
      const { getState, setChannel } = installAutoUpdateIpc(mainChannel);
      const { channel, dispatch, state } = startBetaUpdatesSaga(initialEnabled);

      await vi.waitFor(() => {
        expect(dispatch).toHaveBeenCalledWith(loadBetaUpdatesSettings(expectedEnabled));
      });
      const hydrationAction = dispatch.mock.calls[0]?.[0];
      expect(hydrationAction).toEqual(loadBetaUpdatesSettings(expectedEnabled));
      expect(state.userPreferences.betaUpdatesEnabled).toBe(expectedEnabled);

      channel.put(hydrationAction);
      await flush();
      expect(getState).toHaveBeenCalledTimes(1);
      expect(setChannel).not.toHaveBeenCalled();
    },
  );

  it('persists each user change exactly once after echo-free hydration', async () => {
    const { setChannel } = installAutoUpdateIpc('beta');
    const { channel, dispatch, state } = startBetaUpdatesSaga(false);

    await vi.waitFor(() => {
      expect(dispatch).toHaveBeenCalledWith(loadBetaUpdatesSettings(true));
    });
    channel.put(dispatch.mock.calls[0][0]);
    await flush();
    expect(setChannel).not.toHaveBeenCalled();

    state.userPreferences.betaUpdatesEnabled = false;
    channel.put(setBetaUpdatesEnabled(false));
    await vi.waitFor(() => expect(setChannel).toHaveBeenCalledTimes(1));
    expect(setChannel).toHaveBeenCalledWith({ channel: 'stable' });
    await flush();
    expect(setChannel).toHaveBeenCalledTimes(1);

    setChannel.mockClear();
    state.userPreferences.betaUpdatesEnabled = true;
    channel.put(toggleBetaUpdates());
    await vi.waitFor(() => expect(setChannel).toHaveBeenCalledTimes(1));
    expect(setChannel).toHaveBeenCalledWith({ channel: 'beta' });
    await flush();
    expect(setChannel).toHaveBeenCalledTimes(1);
  });
});
