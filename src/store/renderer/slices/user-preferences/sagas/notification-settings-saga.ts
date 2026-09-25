import { all, call, delay, put, takeLatest } from 'typed-redux-saga';

import { readSetting, updateSettings } from '$lib/client/live/live-settings-client';
import { createLogger } from '$lib/utils/client-logger';
import {
  selectNotificationEnabled,
  selectNotificationVolume,
  selectPendingNotificationVolumeEditId,
  selectSoundEnabled,
  selectSoundOnlyWhenUnfocused,
} from '../user-preferences-selectors';
import {
  notificationVolumeWriteSettled,
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
    // Volume is hydrated by the revision-ordered settings snapshot/event saga.
    // A separate settings.get here could complete after a newer live update.
    const [enabled, soundEnabled, soundOnlyWhenUnfocused] = yield* all([
      call(readSetting, NOTIFICATION_PATHS.enabled),
      call(readSetting, NOTIFICATION_PATHS.soundEnabled),
      call(readSetting, NOTIFICATION_PATHS.soundOnlyWhenUnfocused),
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
  } catch (error) {
    logger.warn('Failed to hydrate notification settings from daemon', { error });
  }
}

export function* persistNotificationSettingsWorker() {
  yield* delay(100);
  const enabled = yield* selectNotificationEnabled.effect();
  const soundEnabled = yield* selectSoundEnabled.effect();
  const soundOnlyWhenUnfocused = yield* selectSoundOnlyWhenUnfocused.effect();
  const volume = yield* selectNotificationVolume.effect();
  const editId = yield* selectPendingNotificationVolumeEditId.effect();
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
  // A cancelled older save must not release a newer edit's hydration guard.
  // Success and failure both settle the matching write; cancellation skips this put.
  if (editId != null) yield* put(notificationVolumeWriteSettled(editId));
}

/** Unregistered until the S20 middleware cutover. */
export function* notificationSettingsSaga() {
  const suppressedActions = new WeakSet<object>();
  const triggers = [
    setNotificationEnabled,
    setSoundEnabled,
    setSoundOnlyWhenUnfocused,
    setVolume,
    resetNotificationSettings,
  ];
  yield* takeLatest(
    // Exclude startup hydration before takeLatest can cancel a pending user save.
    (action: { type: string }) =>
      triggers.some((trigger) => trigger.type === action.type) && !suppressedActions.delete(action),
    persistNotificationSettingsWorker,
  );
  yield* call(hydrateNotificationSettingsWorker, suppressedActions);
}
