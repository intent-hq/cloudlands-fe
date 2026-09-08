import { all, call, delay, put, takeLatest } from 'typed-redux-saga';

import { readSetting, updateSettings } from '$lib/client/live/live-settings-client';
import { createLogger } from '$lib/utils/client-logger';
import {
  selectNotificationEnabled,
  selectNotificationVolume,
  selectSoundEnabled,
  selectSoundOnlyWhenUnfocused,
} from '../user-preferences-selectors';
import {
  resetNotificationSettings,
  setNotificationEnabled,
  setSoundEnabled,
  setSoundOnlyWhenUnfocused,
  setVolume,
} from '../user-preferences-slice';

const logger = createLogger('NotificationSettingsSaga');
const NOTIFICATION_PATHS = {
  enabled: 'notifications.enabled',
  soundEnabled: 'notifications.soundEnabled',
  soundOnlyWhenUnfocused: 'notifications.soundOnlyWhenUnfocused',
  volume: 'notifications.volume',
} as const;

type SettingResponse = { value?: unknown };

export function* hydrateNotificationSettingsWorker(suppressedActions?: WeakSet<object>) {
  try {
    const [enabled, soundEnabled, soundOnlyWhenUnfocused, volume] = yield* all([
      call(readSetting, NOTIFICATION_PATHS.enabled),
      call(readSetting, NOTIFICATION_PATHS.soundEnabled),
      call(readSetting, NOTIFICATION_PATHS.soundOnlyWhenUnfocused),
      call(readSetting, NOTIFICATION_PATHS.volume),
    ]);
    if (typeof (enabled as SettingResponse).value === 'boolean') {
      const action = setNotificationEnabled((enabled as { value: boolean }).value);
      suppressedActions?.add(action);
      yield* put(action);
    }
    if (typeof (soundEnabled as SettingResponse).value === 'boolean') {
      const action = setSoundEnabled((soundEnabled as { value: boolean }).value);
      suppressedActions?.add(action);
      yield* put(action);
    }
    if (typeof (soundOnlyWhenUnfocused as SettingResponse).value === 'boolean') {
      const action = setSoundOnlyWhenUnfocused(
        (soundOnlyWhenUnfocused as { value: boolean }).value,
      );
      suppressedActions?.add(action);
      yield* put(action);
    }
    if (typeof (volume as SettingResponse).value === 'number') {
      const action = setVolume((volume as { value: number }).value);
      suppressedActions?.add(action);
      yield* put(action);
    }
  } catch (error) {
    logger.warn('Failed to hydrate notification settings from daemon', { error });
  }
}

type NotificationAction =
  | ReturnType<typeof setNotificationEnabled>
  | ReturnType<typeof setSoundEnabled>
  | ReturnType<typeof setSoundOnlyWhenUnfocused>
  | ReturnType<typeof setVolume>
  | ReturnType<typeof resetNotificationSettings>;

function* persistNotificationAction(
  suppressedActions: WeakSet<object>,
  action: NotificationAction,
) {
  if (suppressedActions.delete(action)) return;
  yield* call(persistNotificationSettingsWorker);
}

export function* persistNotificationSettingsWorker() {
  yield* delay(100);
  const enabled = yield* selectNotificationEnabled.effect();
  const soundEnabled = yield* selectSoundEnabled.effect();
  const soundOnlyWhenUnfocused = yield* selectSoundOnlyWhenUnfocused.effect();
  const volume = yield* selectNotificationVolume.effect();
  try {
    yield* call(updateSettings, [
      { path: NOTIFICATION_PATHS.enabled, value: enabled ?? true },
      { path: NOTIFICATION_PATHS.soundEnabled, value: soundEnabled ?? true },
      {
        path: NOTIFICATION_PATHS.soundOnlyWhenUnfocused,
        value: soundOnlyWhenUnfocused ?? false,
      },
      { path: NOTIFICATION_PATHS.volume, value: volume ?? 0.5 },
    ]);
  } catch (error) {
    logger.warn('Failed to persist notification settings to daemon', { error });
  }
}

/** Unregistered until the S20 middleware cutover. */
export function* notificationSettingsSaga() {
  const suppressedActions = new WeakSet<object>();
  yield* takeLatest(
    [
      setNotificationEnabled,
      setSoundEnabled,
      setSoundOnlyWhenUnfocused,
      setVolume,
      resetNotificationSettings,
    ],
    persistNotificationAction,
    suppressedActions,
  );
  yield* call(hydrateNotificationSettingsWorker, suppressedActions);
}
