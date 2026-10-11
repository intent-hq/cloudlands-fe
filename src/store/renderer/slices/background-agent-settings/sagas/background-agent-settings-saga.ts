import { buffers } from 'redux-saga';
import { actionChannel, call, put, take } from 'typed-redux-saga';
import { takeLatestFromSelector } from '@themislib/themis/saga';
import { m } from '$shared/paraglide/messages.js';
import { appClient } from '$lib/client';
import { createLogger } from '$lib/utils/client-logger';
import { safeLocalStorage } from '$lib/utils/safe-storage';
import { setLocalStorageItem } from '../../../utils/safe-local-storage-saga';
import {
  selectHostAdministrationContext,
  selectCanAdministerHost,
} from '../../principal/principal-selectors';
import { selectModelSelectionState } from '../../model/model-selectors';
import { readSettingsSnapshot } from '../../settings-events/sagas/read-settings-snapshot';
import { backgroundSettingsWriteLock } from './background-settings-write-lock';
import { selectBgSettings } from '../background-agent-settings-selectors';
import {
  backgroundProviderSwitchBlocked,
  backgroundSettingsHydrationRequested,
  backgroundSettingsMigrationRequested,
  backgroundSettingsSaveSettled,
  BG_MODEL_MIGRATION_MARKER_KEY,
} from '../background-agent-settings-slice';
import { createBackgroundAgentSettingsSaga } from './background-agent-settings-saga-factory';
const logger = createLogger('BackgroundAgentSettingsSaga');
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

function* migrateBackgroundSettings(
  action: ReturnType<typeof backgroundSettingsHydrationRequested>,
) {
  const [settings] = action.payload;
  // Only the daemon snapshot is authoritative; the migration is local intent
  // until the ordered persistence owner accepts it.
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

// Svelte compatibility composition retains its existing migration and notification owners.
const bound = createBackgroundAgentSettingsSaga({
  settingsClient: appClient.settings,
  selectCanAdministerHost,
  selectModelSelectionState,
  readSettingsSnapshot,
  backgroundSettingsWriteLock,
  selectBgSettings,
  showProviderSwitchBlocked,
  migrateBackgroundSettings,
});
export function* backgroundAgentSettingsSaga() {
  yield* takeLatestFromSelector(selectHostAdministrationContext, function* ({ payload }) {
    if (payload) yield* call(bound);
  });
}
