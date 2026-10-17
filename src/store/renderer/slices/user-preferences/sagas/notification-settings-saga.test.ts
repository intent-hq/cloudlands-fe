import { runSaga, stdChannel } from 'redux-saga';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { retireSettingsWork } from '$features/settings/settings-recovery-lifetime';

const mocks = vi.hoisted(() => ({ backendRequest: vi.fn(), warn: vi.fn() }));
vi.mock('$lib/client/live/backend-transport', () => ({
  backendRequest: mocks.backendRequest,
  onBackendNotification: vi.fn(() => () => {}),
  onBackendReconnected: vi.fn(() => () => {}),
}));
vi.mock('$lib/utils/client-logger', () => ({ createLogger: () => ({ warn: mocks.warn }) }));

import {
  initialState,
  notificationVolumeWriteSettled,
  resetNotificationSettings,
  setNotificationEnabled,
  setSoundEnabled,
  setSoundOnlyWhenUnfocused,
  setVolume,
} from '../user-preferences-slice';
import {
  hydrateNotificationSettingsWorker,
  notificationSettingsSaga,
  persistNotificationSettingsWorker,
} from './notification-settings-saga';
import { __resetSettingsReadCacheForTests } from '$lib/client/live/live-settings-client';

const paths = [
  'notifications.enabled',
  'notifications.soundEnabled',
  'notifications.soundOnlyWhenUnfocused',
];

const settle = async () => {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
};

describe('notificationSettingsSaga', () => {
  beforeEach(() => {
    retireSettingsWork(true);
    vi.useFakeTimers();
    vi.clearAllMocks();
    __resetSettingsReadCacheForTests();
  });
  afterEach(() => vi.useRealTimers());

  it('hydrates the boolean setting paths; ordered settings hydration owns volume', async () => {
    const values: Record<string, unknown> = {
      'notifications.enabled': false,
      'notifications.soundEnabled': true,
      'notifications.soundOnlyWhenUnfocused': false,
    };
    mocks.backendRequest.mockImplementation((_method: string, params: { path: string }) =>
      Promise.resolve({
        value: values[params.path],
        definition: {
          path: params.path,
          label: params.path,
          description: '',
          category: 'notifications',
          type: 'boolean',
        },
      }),
    );
    const dispatch = vi.fn();
    await runSaga(
      { dispatch, getState: () => ({ userPreferences: initialState }) },
      hydrateNotificationSettingsWorker,
    ).toPromise();

    expect(mocks.backendRequest.mock.calls).toEqual(
      paths.map((path) => ['settings.get', { path }]),
    );
    expect(dispatch.mock.calls).toEqual([
      [setNotificationEnabled(false)],
      [setSoundEnabled(true)],
      [setSoundOnlyWhenUnfocused(false)],
    ]);
  });

  it('ignores invalid hydration values and swallows read failures', async () => {
    const dispatch = vi.fn();
    mocks.backendRequest.mockImplementation((_method: string, params: { path: string }) =>
      Promise.resolve({
        value: params.path === paths[0] ? 'yes' : null,
        definition: {
          path: params.path,
          label: params.path,
          description: '',
          category: 'notifications',
          type: 'boolean',
        },
      }),
    );
    await runSaga(
      { dispatch, getState: () => ({ userPreferences: initialState }) },
      hydrateNotificationSettingsWorker,
    ).toPromise();
    mocks.backendRequest.mockReset().mockRejectedValue(new Error('offline'));
    __resetSettingsReadCacheForTests();
    await runSaga(
      { dispatch, getState: () => ({ userPreferences: initialState }) },
      hydrateNotificationSettingsWorker,
    ).toPromise();

    expect(dispatch.mock.calls).toEqual([]);
    expect(mocks.warn.mock.calls).toHaveLength(1);
  });

  it('writes the exact post-reducer snapshot after 100ms', async () => {
    mocks.backendRequest.mockResolvedValue({ applied: [], revision: 11 });
    const state = {
      userPreferences: {
        enabled: false,
        soundEnabled: true,
        soundOnlyWhenUnfocused: false,
        volume: 0.8,
        pendingNotificationVolumeEditId: 3,
        notificationVolumeHydrationEpoch: 2,
      },
    };
    const dispatch = vi.fn();
    const task = runSaga({ dispatch, getState: () => state }, persistNotificationSettingsWorker);
    await vi.advanceTimersByTimeAsync(100);
    await task.toPromise();

    expect(mocks.backendRequest.mock.calls).toEqual([
      [
        'settings.update',
        {
          changes: [
            { path: 'notifications.enabled', value: false },
            { path: 'notifications.soundEnabled', value: true },
            { path: 'notifications.soundOnlyWhenUnfocused', value: false },
            { path: 'notifications.volume', value: 0.8 },
          ],
        },
      ],
    ]);
    expect(dispatch.mock.calls).toEqual([[notificationVolumeWriteSettled(3, 2, 11)]]);
  });

  it('swallows persistence failures', async () => {
    mocks.backendRequest.mockRejectedValue(new Error('denied'));
    const dispatch = vi.fn();
    const task = runSaga(
      {
        dispatch,
        getState: () => ({
          userPreferences: {
            enabled: true,
            soundEnabled: true,
            soundOnlyWhenUnfocused: false,
            volume: 0.5,
            pendingNotificationVolumeEditId: 4,
            notificationVolumeHydrationEpoch: 2,
          },
        }),
      },
      persistNotificationSettingsWorker,
    );
    await vi.advanceTimersByTimeAsync(100);
    await task.toPromise();

    expect(mocks.warn.mock.calls).toHaveLength(1);
    expect(dispatch.mock.calls).toEqual([[notificationVolumeWriteSettled(4, 2, undefined)]]);
  });

  it('debounces every notification trigger to the latest snapshot', async () => {
    mocks.backendRequest.mockImplementation((method: string) =>
      Promise.resolve(method === 'settings.get' ? { value: true } : {}),
    );
    const state = {
      userPreferences: {
        enabled: true,
        soundEnabled: true,
        soundOnlyWhenUnfocused: false,
        volume: 0.5,
      },
    };
    const channel = stdChannel();
    const task = runSaga(
      { channel, dispatch: vi.fn(), getState: () => state },
      notificationSettingsSaga,
    );
    await settle();
    mocks.backendRequest.mockClear();
    channel.put(setNotificationEnabled(false));
    channel.put(setSoundEnabled(false));
    channel.put(setSoundOnlyWhenUnfocused(true));
    state.userPreferences.volume = 0.9;
    channel.put(setVolume(0.9));
    channel.put(resetNotificationSettings());
    await vi.advanceTimersByTimeAsync(100);

    expect(mocks.backendRequest.mock.calls).toEqual([
      [
        'settings.update',
        {
          changes: [
            { path: 'notifications.enabled', value: true },
            { path: 'notifications.soundEnabled', value: true },
            { path: 'notifications.soundOnlyWhenUnfocused', value: false },
            { path: 'notifications.volume', value: 0.9 },
          ],
        },
      ],
    ]);
    task.cancel();
    await task.toPromise();
  });

  it('cancels pending hydration and debounce work without echo writes', async () => {
    let resolve!: (value: { value: boolean }) => void;
    mocks.backendRequest.mockReturnValue(new Promise((done) => (resolve = done)));
    const channel = stdChannel();
    const dispatch = vi.fn();
    const task = runSaga(
      {
        channel,
        dispatch,
        getState: () => ({
          userPreferences: {
            enabled: true,
            soundEnabled: true,
            soundOnlyWhenUnfocused: false,
            volume: 0.5,
          },
        }),
      },
      notificationSettingsSaga,
    );
    channel.put(setVolume(0.2));
    task.cancel();
    resolve({ value: true });
    await task.toPromise();
    await vi.runAllTimersAsync();

    expect(dispatch.mock.calls).toEqual([]);
    expect(mocks.backendRequest.mock.calls).toEqual(
      paths.map((path) => ['settings.get', { path }]),
    );
  });
});

it('drops a notification edit queued before recovery', async () => {
  vi.useFakeTimers();
  retireSettingsWork(true);
  mocks.backendRequest.mockClear();
  const dispatch = vi.fn();
  const task = runSaga(
    { dispatch, getState: () => ({ userPreferences: { volume: 0.9 } }) },
    persistNotificationSettingsWorker,
  );
  retireSettingsWork(true);
  await vi.advanceTimersByTimeAsync(100);
  await task.toPromise();
  expect(mocks.backendRequest).not.toHaveBeenCalled();
  expect(dispatch).not.toHaveBeenCalled();
  vi.useRealTimers();
});

it('does not settle a notification write after its authority retires', async () => {
  vi.useFakeTimers();
  retireSettingsWork(true);
  let resolve!: (value: { revision: number }) => void;
  mocks.backendRequest.mockReturnValue(
    new Promise((done) => {
      resolve = done;
    }),
  );
  const dispatch = vi.fn();
  const task = runSaga(
    {
      dispatch,
      getState: () => ({
        userPreferences: {
          volume: 0.9,
          pendingNotificationVolumeEditId: 1,
          notificationVolumeHydrationEpoch: 0,
        },
      }),
    },
    persistNotificationSettingsWorker,
  );
  await vi.advanceTimersByTimeAsync(100);
  retireSettingsWork(false);
  resolve({ revision: 20 });
  await task.toPromise();
  expect(dispatch).not.toHaveBeenCalled();
  retireSettingsWork(true);
  vi.useRealTimers();
});
