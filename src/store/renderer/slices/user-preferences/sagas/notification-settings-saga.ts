import { captureSettingsWork } from '$features/settings/settings-recovery-lifetime';
import { all, call, delay, put, takeLatest } from 'typed-redux-saga';

import { readSetting, updateSettingsRevision } from '$lib/client/live/live-settings-client';
import { createLogger } from '$lib/utils/client-logger';
import {
  selectNotificationEnabled,
  selectNotificationFieldEdits,
  selectNotificationVolume,
  selectNotificationVolumeWrite,
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
  const work = captureSettingsWork();
  if (!work.isCurrent()) return;
  const initial = yield* selectNotificationFieldEdits.effect();
  try {
    // Volume is hydrated by the revision-ordered settings snapshot/event saga.
    // A separate settings.get here could complete after a newer live update.
    const [enabled, soundEnabled, soundOnlyWhenUnfocused] = yield* all([
      call(readSetting, NOTIFICATION_PATHS.enabled),
      call(readSetting, NOTIFICATION_PATHS.soundEnabled),
      call(readSetting, NOTIFICATION_PATHS.soundOnlyWhenUnfocused),
    ]);
    if (!work.isSameScope()) return;
    if (
      work.isSameScope() &&
      (yield* selectNotificationFieldEdits.effect())?.enabled === initial?.enabled &&
      typeof (enabled as SettingResponse).value === 'boolean'
    ) {
      const action = setNotificationEnabled((enabled as { value: boolean }).value);
      suppressedActions?.add(action);
      yield* put(action);
    }
    if (
      work.isSameScope() &&
      (yield* selectNotificationFieldEdits.effect())?.soundEnabled === initial?.soundEnabled &&
      typeof (soundEnabled as SettingResponse).value === 'boolean'
    ) {
      const action = setSoundEnabled((soundEnabled as { value: boolean }).value);
      suppressedActions?.add(action);
      yield* put(action);
    }
    if (
      work.isSameScope() &&
      (yield* selectNotificationFieldEdits.effect())?.soundOnlyWhenUnfocused ===
        initial?.soundOnlyWhenUnfocused &&
      typeof (soundOnlyWhenUnfocused as SettingResponse).value === 'boolean'
    ) {
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
  const work = captureSettingsWork();
  if (!work.isCurrent()) return;
  const queued = yield* selectNotificationVolumeWrite.effect();
  yield* delay(100);
  if (!work.isSameScope()) return;
  const { editId, hydrationEpoch } = yield* selectNotificationVolumeWrite.effect();
  if (queued.editId !== editId || queued.hydrationEpoch !== hydrationEpoch) return;
  const enabled = yield* selectNotificationEnabled.effect();
  const soundEnabled = yield* selectSoundEnabled.effect();
  const soundOnlyWhenUnfocused = yield* selectSoundOnlyWhenUnfocused.effect();
  const volume = yield* selectNotificationVolume.effect();
  let revision: number | undefined;
  try {
    revision = yield* call(updateSettingsRevision, [
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
  if (!work.isSameScope()) return;
  const current = yield* selectNotificationVolumeWrite.effect();
  if (editId != null && current.editId === editId && current.hydrationEpoch === hydrationEpoch)
    yield* put(notificationVolumeWriteSettled(editId, hydrationEpoch, revision));
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
  type NotificationAction = ReturnType<(typeof triggers)[number]>;
  // Exclude startup hydration before takeLatest can cancel a pending user save.
  const isUserEdit = (action: { type: string }): action is NotificationAction =>
    triggers.some((trigger) => trigger.type === action.type) && !suppressedActions.delete(action);
  yield* takeLatest(isUserEdit, persistNotificationSettingsWorker);
  yield* call(hydrateNotificationSettingsWorker, suppressedActions);
}
