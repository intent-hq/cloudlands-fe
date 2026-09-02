import { runSaga, stdChannel } from 'redux-saga';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ backendRequest: vi.fn(), warn: vi.fn(), setPath: vi.fn() }));
vi.mock('$lib/client/live/backend-transport', () => ({ backendRequest: mocks.backendRequest }));
vi.mock('$lib/utils/client-logger', () => ({ createLogger: () => ({ warn: mocks.warn }) }));
vi.mock('$lib/utils/notification-sound', () => ({ setNotificationSoundPath: mocks.setPath }));

import {
  initialState,
  userPreferencesReducer,
  hydrateNotificationSettings,
  resetNotificationSettings,
  setNotificationEnabled,
  setSoundEnabled,
  setSoundOnlyWhenUnfocused,
  setSoundPath,
  setVolume,
} from '../user-preferences-slice';
import { notificationSettingsSaga } from './notification-settings-saga';

function start() {
  const channel = stdChannel();
  let state = { userPreferences: initialState };
  const dispatch = (action: Parameters<typeof userPreferencesReducer>[1]) => {
    state = { userPreferences: userPreferencesReducer(state.userPreferences, action) };
    channel.put(action);
  };
  const task = runSaga({ channel, dispatch, getState: () => state }, notificationSettingsSaga);
  return { task, dispatch, state: () => state.userPreferences };
}

const expectedChanges = (soundPath: string, soundEnabled = false) => [
  { path: 'notifications.enabled', value: true },
  { path: 'notifications.soundEnabled', value: soundEnabled },
  { path: 'notifications.soundOnlyWhenUnfocused', value: true },
  { path: 'notifications.volume', value: 0.5 },
  { path: 'notifications.soundPath', value: soundPath },
];

beforeEach(() => {
  vi.useFakeTimers();
  vi.clearAllMocks();
  mocks.backendRequest.mockResolvedValue({ applied: [] });
});
afterEach(() => vi.useRealTimers());

describe('notificationSettingsSaga', () => {
  it('persists selection and clear without enabling sound; hydration and reset stay coherent', async () => {
    const run = start();
    try {
      run.dispatch(hydrateNotificationSettings({ soundEnabled: false, soundPath: '/old.mp3' }));
      await vi.advanceTimersByTimeAsync(200);
      expect(mocks.backendRequest).not.toHaveBeenCalled();
      run.dispatch(setSoundPath('/Users/me/notify.mp3'));
      expect(mocks.setPath).toHaveBeenLastCalledWith('/Users/me/notify.mp3');
      await vi.advanceTimersByTimeAsync(100);
      expect(mocks.backendRequest).toHaveBeenLastCalledWith('settings.update', {
        changes: expectedChanges('/Users/me/notify.mp3'),
      });
      run.dispatch(setSoundPath(''));
      await vi.advanceTimersByTimeAsync(100);
      expect(mocks.backendRequest).toHaveBeenLastCalledWith('settings.update', {
        changes: expectedChanges(''),
      });
      run.dispatch(resetNotificationSettings());
      await vi.advanceTimersByTimeAsync(100);
      expect(mocks.backendRequest).toHaveBeenLastCalledWith('settings.update', {
        changes: expectedChanges('', true),
      });
      expect(run.state().soundPath).toBe('');
    } finally {
      run.task.cancel();
      await run.task.toPromise();
    }
  });

  it('debounces all notification edits and cancels pending writes on disposal', async () => {
    const run = start();
    run.dispatch(setNotificationEnabled(false));
    run.dispatch(setSoundEnabled(false));
    run.dispatch(setSoundOnlyWhenUnfocused(false));
    run.dispatch(setVolume(0.8));
    run.dispatch(setSoundPath('/new.mp3'));
    await vi.advanceTimersByTimeAsync(99);
    expect(mocks.backendRequest).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(mocks.backendRequest.mock.calls).toEqual([
      [
        'settings.update',
        {
          changes: [
            { path: 'notifications.enabled', value: false },
            { path: 'notifications.soundEnabled', value: false },
            { path: 'notifications.soundOnlyWhenUnfocused', value: false },
            { path: 'notifications.volume', value: 0.8 },
            { path: 'notifications.soundPath', value: '/new.mp3' },
          ],
        },
      ],
    ]);
    run.dispatch(setSoundPath('/cancelled.mp3'));
    run.task.cancel();
    await run.task.toPromise();
    await vi.advanceTimersByTimeAsync(100);
    expect(mocks.backendRequest).toHaveBeenCalledTimes(1);
  });

  it('does not persist external changes/reset and invalidates the playback source', async () => {
    const run = start();
    try {
      run.dispatch(hydrateNotificationSettings({ soundPath: '/external.mp3' }));
      expect(mocks.setPath).toHaveBeenLastCalledWith('/external.mp3');
      run.dispatch(hydrateNotificationSettings({ soundPath: '' }));
      expect(mocks.setPath).toHaveBeenLastCalledWith('');
      await vi.advanceTimersByTimeAsync(200);
      expect(mocks.backendRequest).not.toHaveBeenCalled();
    } finally {
      run.task.cancel();
      await run.task.toPromise();
    }
  });

  it('contains failed writes without clearing the selected path', async () => {
    mocks.backendRequest.mockRejectedValue(new Error('offline'));
    const run = start();
    try {
      run.dispatch(setSoundPath('/retry.mp3'));
      await vi.advanceTimersByTimeAsync(100);
      expect(mocks.warn).toHaveBeenCalledOnce();
      expect(run.state().soundPath).toBe('/retry.mp3');
    } finally {
      run.task.cancel();
      await run.task.toPromise();
    }
  });
});
