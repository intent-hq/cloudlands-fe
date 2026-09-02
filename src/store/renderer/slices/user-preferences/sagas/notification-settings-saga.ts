import { call, cancelled, delay, put, takeEvery, takeLatest } from 'typed-redux-saga';

import { backendRequest } from '$lib/client/live/backend-transport';
import { createLogger } from '$lib/utils/client-logger';
import {
  selectNotificationEnabled,
  selectNotificationVolume,
  selectSoundEnabled,
  selectSoundPath,
  selectSoundOnlyWhenUnfocused,
} from '../user-preferences-selectors';
import {
  pickNotificationSoundRequested,
  resetNotificationSettings,
  setNotificationEnabled,
  setSoundEnabled,
  setSoundPath,
  hydrateNotificationSettings,
  setSoundOnlyWhenUnfocused,
  setVolume,
} from '../user-preferences-slice';

import { pickLocalNotificationSound } from '$lib/utils/local-notification-audio';
import { setNotificationSoundPath } from '$lib/utils/notification-sound';

const logger = createLogger('NotificationSettingsSaga');
const NOTIFICATION_PATHS = {
  enabled: 'notifications.enabled',
  soundEnabled: 'notifications.soundEnabled',
  soundOnlyWhenUnfocused: 'notifications.soundOnlyWhenUnfocused',
  volume: 'notifications.volume',
  soundPath: 'notifications.soundPath',
} as const;

export function* persistNotificationSettingsWorker() {
  yield* delay(100);
  const enabled = yield* selectNotificationEnabled.effect();
  const soundEnabled = yield* selectSoundEnabled.effect();
  const soundOnlyWhenUnfocused = yield* selectSoundOnlyWhenUnfocused.effect();
  const volume = yield* selectNotificationVolume.effect();
  const soundPath = yield* selectSoundPath.effect();
  try {
    yield* call(backendRequest, 'settings.update', {
      changes: [
        { path: NOTIFICATION_PATHS.enabled, value: enabled ?? true },
        { path: NOTIFICATION_PATHS.soundEnabled, value: soundEnabled ?? true },
        {
          path: NOTIFICATION_PATHS.soundOnlyWhenUnfocused,
          value: soundOnlyWhenUnfocused ?? false,
        },
        { path: NOTIFICATION_PATHS.volume, value: volume ?? 0.5 },
        { path: NOTIFICATION_PATHS.soundPath, value: soundPath },
      ],
    });
  } catch (error) {
    logger.warn('Failed to persist notification settings to daemon', { error });
  }
}

export function* pickNotificationSoundWorker(
  action: ReturnType<typeof pickNotificationSoundRequested>,
) {
  try {
    const path = yield* call(pickLocalNotificationSound);
    if (path !== null) yield* put(setSoundPath(path));
    yield* put(action.success(undefined));
  } catch (error) {
    yield* put(action.failure(error instanceof Error ? error : new Error(String(error))));
  } finally {
    if (yield* cancelled()) yield* put(action.failure(new Error('Sound picker cancelled')));
  }
}

function* syncSoundPath() {
  const path = yield* selectSoundPath.effect();
  yield* call(setNotificationSoundPath, path);
}

/** Root-owned persistence and local playback invalidation. */
export function* notificationSettingsSaga() {
  yield* takeEvery(pickNotificationSoundRequested, pickNotificationSoundWorker);
  yield* takeEvery(
    [setSoundPath, hydrateNotificationSettings, resetNotificationSettings],
    syncSoundPath,
  );
  yield* takeLatest(
    [
      setNotificationEnabled,
      setSoundEnabled,
      setSoundPath,
      setSoundOnlyWhenUnfocused,
      setVolume,
      resetNotificationSettings,
    ],
    persistNotificationSettingsWorker,
  );
  // The root settingsHydrationSaga owns ordered boot snapshots and external deltas.
  // Do not race it with a separate settings.get snapshot here.
}
