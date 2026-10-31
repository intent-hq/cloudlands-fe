import { runSaga, stdChannel, type Task } from 'redux-saga';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { WINDOW_CHANNELS } from '$shared/ipc/channels';

const mocks = vi.hoisted(() => ({
  invoke: vi.fn(),
  isElectron: vi.fn(() => true),
}));

vi.mock('$lib/electron-bridge', () => ({ invoke: mocks.invoke, isElectron: mocks.isElectron }));

import {
  initialState,
  setShellTransparencyEnabled,
  toggleShellTransparency,
  userPreferencesHydrated,
  userPreferencesReducer,
} from '../user-preferences-slice';
import { windowTranslucencySaga } from './window-translucency-saga';

const settle = async () => {
  for (let i = 0; i < 5; i += 1) await Promise.resolve();
};

describe('windowTranslucencySaga', () => {
  let tasks: Task[];

  function start() {
    const channel = stdChannel();
    let userPreferences = initialState;
    const getState = () => ({ userPreferences });
    const dispatch = (action: unknown) => {
      userPreferences = userPreferencesReducer(userPreferences, action as never);
      channel.put(action as never);
      return action;
    };
    const task = runSaga(
      {
        channel,
        dispatch,
        getState,
        context: { reduxStore: { getState, subscribe: () => () => {} } },
      },
      windowTranslucencySaga,
    );
    tasks.push(task);
    return { dispatch };
  }

  beforeEach(() => {
    tasks = [];
    mocks.invoke.mockReset();
    mocks.invoke.mockResolvedValue({ success: true });
    mocks.isElectron.mockReturnValue(true);
  });

  afterEach(() => {
    for (const task of tasks) task.cancel();
  });

  it('turns the native blur off and back on when the setting changes', async () => {
    const { dispatch } = start();

    dispatch(setShellTransparencyEnabled(false));
    await settle();
    expect(mocks.invoke).toHaveBeenLastCalledWith(WINDOW_CHANNELS.SET_TRANSLUCENCY, {
      enabled: false,
    });

    dispatch(toggleShellTransparency());
    await settle();
    expect(mocks.invoke).toHaveBeenLastCalledWith(WINDOW_CHANNELS.SET_TRANSLUCENCY, {
      enabled: true,
    });
  });

  it('reports the hydrated value so a fresh window matches the saved setting', async () => {
    const { dispatch } = start();

    dispatch(userPreferencesHydrated());
    await settle();

    expect(mocks.invoke).toHaveBeenCalledOnce();
    expect(mocks.invoke).toHaveBeenCalledWith(WINDOW_CHANNELS.SET_TRANSLUCENCY, {
      enabled: true,
    });
  });

  it('keeps a failed native sync non-fatal', async () => {
    mocks.invoke.mockRejectedValueOnce(new Error('no handler'));
    const { dispatch } = start();

    dispatch(setShellTransparencyEnabled(false));
    await settle();
    dispatch(setShellTransparencyEnabled(true));
    await settle();

    expect(mocks.invoke).toHaveBeenCalledTimes(2);
    expect(tasks[0].isRunning()).toBe(true);
  });

  it('does nothing outside Electron', async () => {
    mocks.isElectron.mockReturnValue(false);
    const { dispatch } = start();

    dispatch(setShellTransparencyEnabled(false));
    await settle();

    expect(mocks.invoke).not.toHaveBeenCalled();
  });
});
