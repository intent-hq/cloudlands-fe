import { buffers } from 'redux-saga';
import { actionChannel, all, call, put, take, takeEvery } from 'typed-redux-saga';

import { appClient } from '$lib/client';
import { createLogger } from '$lib/utils/client-logger';
import { safeLocalStorage } from '$lib/utils/safe-storage';
import { setLocalStorageItem } from '../../../utils/safe-local-storage-saga';
import {
  selectBgDefaultModel,
  selectBgTypeOverrides,
} from '../background-agent-settings-selectors';
import {
  clearTypeOverride,
  resetSettings,
  setDefaultModel,
  setTypeOverride,
  hydrateSettings,
  backgroundSettingsHydrationRequested,
  backgroundSettingsMigrationRequested,
  BG_MODEL_MIGRATION_MARKER_KEY,
  backgroundSettingsWriteRejected,
} from '../background-agent-settings-slice';

const logger = createLogger('BackgroundAgentSettingsSaga');

function* persistBackgroundAgentSettingsWorker() {
  const defaultModel = yield* selectBgDefaultModel.effect();
  const typeOverrides = yield* selectBgTypeOverrides.effect();
  try {
    yield* call(
      [appClient.settings, appClient.settings.update],
      [
        { path: 'quickActions.defaultModel', value: defaultModel },
        { path: 'quickActions.typeOverrides', value: { ...typeOverrides } },
      ],
    );
  } catch (error) {
    yield* put(backgroundSettingsWriteRejected({ defaultModel, typeOverrides }));
    logger.error('Failed to persist background agent settings:', error);
  }
}

function* hydrateBackgroundSettings(
  action: ReturnType<typeof backgroundSettingsHydrationRequested>,
) {
  const [settings] = action.payload;
  const marker = yield* call(
    [safeLocalStorage, safeLocalStorage.getItemWithStatus],
    BG_MODEL_MIGRATION_MARKER_KEY,
  );
  const needsMigration = !marker.hadError && marker.value !== '1';
  if (!needsMigration) {
    yield* put(hydrateSettings(settings));
    return;
  }
  const strip = (value: string) => (value === 'haiku4.5' ? '' : value);
  const migrated = {
    defaultModel: strip(settings.defaultModel),
    typeOverrides: {
      commit: strip(settings.typeOverrides.commit),
      pr: strip(settings.typeOverrides.pr),
      review: strip(settings.typeOverrides.review),
      fast: strip(settings.typeOverrides.fast),
    },
  };
  yield* put(hydrateSettings(migrated));
  const changed =
    migrated.defaultModel !== settings.defaultModel ||
    Object.entries(migrated.typeOverrides).some(
      ([type, value]) =>
        value !== settings.typeOverrides[type as keyof typeof settings.typeOverrides],
    );
  // The existing ordered owner reads the live snapshot, not this potentially
  // obsolete migration payload, once earlier writes finish.
  if (changed) yield* put(backgroundSettingsMigrationRequested());
  yield* call(setLocalStorageItem, BG_MODEL_MIGRATION_MARKER_KEY, '1');
}

function* persistLoop() {
  const channel = yield* actionChannel(
    [
      setDefaultModel,
      setTypeOverride,
      clearTypeOverride,
      resetSettings,
      backgroundSettingsMigrationRequested,
    ],
    buffers.sliding(1),
  );
  try {
    while (true) {
      yield* take(channel);
      yield* call(persistBackgroundAgentSettingsWorker);
    }
  } finally {
    channel.close();
  }
}

export function* backgroundAgentSettingsSaga() {
  yield* all([
    call(persistLoop),
    takeEvery(backgroundSettingsHydrationRequested, hydrateBackgroundSettings),
  ]);
}
