import { backgroundSettingsWriteLock } from '../../background-agent-settings/sagas/background-settings-write-lock';
import { selectBgSettings } from '../../background-agent-settings/background-agent-settings-selectors';
import { waitFor } from '@themislib/themis/saga';
import { readSettingsSnapshot } from '../../settings-events/sagas/read-settings-snapshot';
import { modelSettingsChanges } from '../model-settings-changes';
import { buffers, channel, type Channel } from 'redux-saga';
import { all, call, put, race, take, takeEvery } from 'typed-redux-saga';

import { appClient } from '$lib/client';
import type { AppSettingChange } from '$lib/client/app-client';
import { createLogger } from '$lib/utils/client-logger';
import { splitLegacyCompoundId } from '$shared/utils/legacy-model-id';
import {
  selectProviderCatalogEntry,
  selectProviderCatalogLoaded,
} from '../../provider-catalog/provider-catalog-selectors';
import { selectActiveProviderId } from '../../provider-settings/provider-settings-selectors';
import { setAtomicDefaultModel } from '../../provider-settings/provider-settings-slice';
import { selectModelSelectionState } from '../model-selectors';
import { selectModel, setDefaultReasoningEffort } from '../model-slice';
import { settingsFieldsRefreshRequested } from '../../settings-events/settings-events-slice';

const logger = createLogger('ModelSelectionSaga');

export function* handleSelectModel(action: ReturnType<typeof selectModel>) {
  const [rawModel, explicitProviderId] = action.payload;
  if (!rawModel) return;

  const activeProviderId = yield* selectActiveProviderId.effect();
  // Explicit providerId from the pick wins; a legacy compound prefix in the
  // model string is honored as a fallback for old callers/persisted echoes.
  const { providerId: legacyPrefix, modelId: model } = splitLegacyCompoundId(rawModel);
  const providerId = explicitProviderId || legacyPrefix || activeProviderId;

  if (providerId && providerId !== activeProviderId) {
    const provider = yield* selectProviderCatalogEntry.effect(providerId);
    const catalogLoaded = yield* selectProviderCatalogLoaded.effect();
    // Before the catalog hydrates, let the daemon validate the pick.
    if (!provider && catalogLoaded) {
      logger.warn('Ignoring model selection for unknown provider', { model, providerId });
      return;
    }
  }

  // The provider owner validates the quick-action bundle and queues the atomic write.
  yield* put(setAtomicDefaultModel({ providerId, model }));
}

/** Send each queued intent; only daemon receipts change displayed settings. */
export function* persistSelectedModelsWorker(
  picks: Record<string, string>,
  atomicProviderId?: string,
  connection?: string | null,
  waitForBackground = false,
) {
  const admittedConnection =
    connection === undefined
      ? (yield* selectModelSelectionState.effect()).selectionConnection
      : connection;
  if (waitForBackground) {
    // Do not hold the lock while its existing owner drains admitted edits.
    // Success or failure releases this wait; a backend change cancels it.
    yield* race({
      drained: waitFor(selectBgSettings, [], (settings) => !settings.persistencePending),
      changed: waitFor(
        selectModelSelectionState,
        [],
        (selection) => selection.selectionConnection !== admittedConnection,
      ),
    });
  }
  if (admittedConnection !== (yield* selectModelSelectionState.effect()).selectionConnection)
    return false;
  yield* take(backgroundSettingsWriteLock);
  let changes: AppSettingChange[] = [];
  try {
    if (admittedConnection !== (yield* selectModelSelectionState.effect()).selectionConnection)
      return false;
    const snapshot = yield* call(readSettingsSnapshot);
    if (admittedConnection !== (yield* selectModelSelectionState.effect()).selectionConnection)
      return false;
    if (!snapshot.settings.length) throw new Error('Settings snapshot was empty');
    changes = modelSettingsChanges(snapshot.settings, picks, atomicProviderId);
    yield* call([appClient.settings, appClient.settings.update], changes);
    return admittedConnection === (yield* selectModelSelectionState.effect()).selectionConnection;
  } catch (error) {
    logger.error('Failed to persist default model settings', { error });
    if (changes.length)
      yield* put(
        settingsFieldsRefreshRequested(
          changes.map(({ path }) => path),
          admittedConnection,
        ),
      );
    return false;
  } finally {
    yield* put(backgroundSettingsWriteLock, true);
  }
}

/**
 * Persist a default reasoning-effort pick to the daemon settings catalog
 * (PROTOCOL §5.12). Fire-and-forget like `model.providerDefaults`; the daemon
 * echoes the write back via `settings:changed`, which hydration applies
 * through `loadDefaultReasoningEffortFromStorage` — deliberately NOT observed
 * here, so there is no write loop. The taken action's payload is persisted
 * (not a store snapshot read at worker time), so an interleaved hydration
 * echo of an older value can never displace a newer queued pick.
 */
export function* persistDefaultReasoningEffortWorker(effort: string, connection?: string | null) {
  const admittedConnection =
    connection === undefined
      ? (yield* selectModelSelectionState.effect()).selectionConnection
      : connection;
  if (admittedConnection !== (yield* selectModelSelectionState.effect()).selectionConnection)
    return;
  try {
    yield* call(
      [appClient.settings, appClient.settings.update],
      [{ path: 'model.defaultReasoningEffort', value: effort }],
    );
  } catch (error) {
    logger.error('Failed to persist model.defaultReasoningEffort', { error });
    yield* put(
      settingsFieldsRefreshRequested(['model.defaultReasoningEffort'], admittedConnection),
    );
  }
}

type EffortUpdate = { effort: string; connection: string | null };

function* queueEffort(
  updates: Channel<EffortUpdate>,
  action: ReturnType<typeof setDefaultReasoningEffort>,
) {
  yield* put(updates, {
    effort: action.payload[0],
    connection: (yield* selectModelSelectionState.effect()).selectionConnection,
  });
}

function* persistEffortQueue(updates: Channel<EffortUpdate>) {
  while (true) {
    const { effort, connection } = yield* take(updates);
    yield* call(persistDefaultReasoningEffortWorker, effort, connection);
  }
}

function* watchDefaultReasoningEffortPersistence() {
  const updates = channel<EffortUpdate>(buffers.expanding());
  try {
    yield* all([
      call(persistEffortQueue, updates),
      takeEvery(setDefaultReasoningEffort, queueEffort, updates),
    ]);
  } finally {
    updates.close();
  }
}

export function* modelSelectionSaga() {
  yield* takeEvery(selectModel, handleSelectModel);
  // Atomic defaults share providerSettingsSaga's ordered default-provider queue.
  yield* call(watchDefaultReasoningEffortPersistence);
}
