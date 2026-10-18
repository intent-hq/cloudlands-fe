import { settleBackgroundSettings } from './settle-background-settings';
import { settingsChangesReceived } from '../../settings-events/settings-events-slice';
import { readSettingsSnapshot } from '../../settings-events/sagas/read-settings-snapshot';
import { backgroundSettingsWriteLock } from './background-settings-write-lock';
import { buffers } from 'redux-saga';
import { actionChannel, all, call, put, take, takeEvery } from 'typed-redux-saga';

import { m } from '$shared/paraglide/messages.js';
import { appClient } from '$lib/client';
import { createLogger } from '$lib/utils/client-logger';
import { selectBgSettings } from '../background-agent-settings-selectors';
import {
  backgroundSettingsChanges,
  rebaseBackgroundSettings,
} from '../background-agent-settings-persistence';
import { safeLocalStorage } from '$lib/utils/safe-storage';
import { setLocalStorageItem } from '../../../utils/safe-local-storage-saga';
import {
  clearTypeOverride,
  setDefaultReasoningEffort,
  setTypeReasoningEffortOverride,
  setTypeReasoningEffortOverrides,
  backgroundProviderSwitchBlocked,
  resetTypeOverride,
  resetSettings,
  setDefaultModel,
  setTypeOverride,
  hydrateSettings,
  backgroundSettingsHydrationRequested,
  backgroundSettingsMigrationRequested,
  backgroundSettingsSaveSettled,
  BG_MODEL_MIGRATION_MARKER_KEY,
} from '../background-agent-settings-slice';

const logger = createLogger('BackgroundAgentSettingsSaga');

function* persistBackgroundAgentSettingsWorker() {
  yield* take(backgroundSettingsWriteLock);
  const settings = yield* selectBgSettings.effect();
  try {
    const snapshot = yield* call(readSettingsSnapshot);
    const rebased = rebaseBackgroundSettings(snapshot.settings, settings);
    const changes = backgroundSettingsChanges(rebased);
    if (rebased.providerId)
      changes.unshift({ path: 'model.defaultProvider', value: rebased.providerId });
    const result = appClient.settings.updateSnapshot
      ? yield* call([appClient.settings, appClient.settings.updateSnapshot], changes)
      : {
          applied: yield* call([appClient.settings, appClient.settings.update], changes),
          revision: 0,
        };
    yield* call(
      settleBackgroundSettings,
      {
        revision: result.revision,
        generation: settings.persistenceGeneration ?? 0,
        providerId: settings.providerId,
      },
      rebased,
      result.applied,
    );
    if (appClient.settings.updateSnapshot)
      yield* put(
        settingsChangesReceived(
          [
            ...changes.filter((change) => !result.applied.some(({ path }) => path === change.path)),
            ...result.applied,
          ].filter(({ path }) => !path.startsWith('model.')),
          result.revision,
        ),
      );
  } catch (error) {
    logger.error('Failed to persist background agent settings:', error);
    yield* call(settleBackgroundSettings, {
      generation: settings.persistenceGeneration ?? 0,
      providerId: settings.providerId,
    });
  } finally {
    yield* put(backgroundSettingsWriteLock, true);
  }
}

async function showProviderSwitchBlocked(
  action: ReturnType<typeof backgroundProviderSwitchBlocked>,
) {
  try {
    const { notify } = await import('$lib/components/patterns/notify');
    notify.error(m.settings_backgroundAgent_legacySwitch_error({ provider: action.payload[0] }));
  } catch (error) {
    logger.error('Failed to show blocked provider switch:', error);
  }
}

function* hydrateBackgroundSettings(
  action: ReturnType<typeof backgroundSettingsHydrationRequested>,
) {
  const [settings] = action.payload;
  // Only the daemon snapshot is authoritative; the migration is local intent
  // until the ordered persistence owner accepts it.
  yield* put(hydrateSettings(settings));
  const marker = yield* call(
    [safeLocalStorage, safeLocalStorage.getItemWithStatus],
    BG_MODEL_MIGRATION_MARKER_KEY,
  );
  const needsMigration = !marker.hadError && marker.value !== '1';
  if (!needsMigration) return;
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
  const changed =
    migrated.defaultModel !== settings.defaultModel ||
    Object.entries(migrated.typeOverrides).some(
      ([type, value]) =>
        value !== settings.typeOverrides[type as keyof typeof settings.typeOverrides],
    );
  if (!changed) {
    // Partial deltas can inherit optimistic migrated models while a write is
    // pending. They must not bypass that write's acknowledgement.
    if (!(yield* selectBgSettings.effect()).persistencePending)
      yield* call(setLocalStorageItem, BG_MODEL_MIGRATION_MARKER_KEY, '1');
    return;
  }
  // The existing ordered owner reads the live snapshot, not this potentially
  // obsolete migration payload, once earlier writes finish. Buffer settlement
  // before dispatch so even a synchronous acknowledgement cannot be missed.
  const acknowledgements = yield* actionChannel(backgroundSettingsSaveSettled, buffers.expanding());
  try {
    yield* put(backgroundSettingsMigrationRequested(migrated));
    const { persistenceGeneration = 0 } = yield* selectBgSettings.effect();
    while (true) {
      const {
        payload: [ack],
      } = yield* take(acknowledgements);
      // A newer queued edit may replace the migration trigger in the sliding
      // buffer, but its full snapshot still covers this migration generation.
      if (ack.generation < persistenceGeneration) continue;
      if (ack.savedValues) yield* call(setLocalStorageItem, BG_MODEL_MIGRATION_MARKER_KEY, '1');
      return;
    }
  } finally {
    acknowledgements.close();
  }
}

function* persistLoop() {
  const channel = yield* actionChannel(
    [
      setDefaultModel,
      setTypeOverride,
      clearTypeOverride,
      resetSettings,
      setDefaultReasoningEffort,
      setTypeReasoningEffortOverride,
      setTypeReasoningEffortOverrides,
      resetTypeOverride,
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
    takeEvery(backgroundProviderSwitchBlocked, showProviderSwitchBlocked),
    takeEvery(backgroundSettingsHydrationRequested, hydrateBackgroundSettings),
  ]);
}
