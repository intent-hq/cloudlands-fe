import { waitFor } from '@themislib/themis/saga';
import { modelSettingsChanges } from '../model-settings-changes';
import { buffers, channel, type Channel } from 'redux-saga';
import { all, call, put, race, take, takeEvery } from 'typed-redux-saga';

import type { AppSettingChange } from '$lib/client/settings-types';
import { createLogger } from '$lib/utils/client-logger';
import { splitLegacyCompoundId } from '$shared/utils/legacy-model-id';
import { setAtomicDefaultModel } from '../../provider-settings/provider-settings-slice';
import { selectModel, setDefaultReasoningEffort } from '../model-slice';
import {
  settingsFieldsRefreshRequested,
  settingsChangesReceived,
} from '../../settings-events/settings-events-slice';

const logger = createLogger('ModelSelectionSaga');

import type { SelectorChannelSelector } from '@themislib/themis/saga';
import type { SettingsClient, SettingsSnapshot } from '$lib/client/settings-types';
import type { ModelState } from '../model-types';
import type { BackgroundAgentSettingsState } from '../../background-agent-settings/background-agent-settings-slice';
import type { ProviderCatalogEntry } from '$shared/provider-catalog';

export function createModelSelectionSaga<State>({
  settings,
  readSettingsSnapshot,
  backgroundSettingsWriteLock,
  selectBgSettings,
  selectActiveProviderId,
  selectProviderCatalogEntry,
  selectProviderCatalogLoaded,
  selectModelSelectionState,
  selectCanAdministerHost,
}: {
  selectCanAdministerHost: SelectorChannelSelector<boolean, [], State>;
  settings: SettingsClient;
  readSettingsSnapshot: () => Promise<SettingsSnapshot>;
  backgroundSettingsWriteLock: Channel<boolean>;
  selectBgSettings: SelectorChannelSelector<BackgroundAgentSettingsState, [], State>;
  selectActiveProviderId: SelectorChannelSelector<string, [], State>;
  selectProviderCatalogEntry: SelectorChannelSelector<
    ProviderCatalogEntry | undefined,
    [string],
    State
  >;
  selectProviderCatalogLoaded: SelectorChannelSelector<boolean, [], State>;
  selectModelSelectionState: SelectorChannelSelector<ModelState, [], State>;
}) {
  function* handleSelectModel(action: ReturnType<typeof selectModel>) {
    if (!(yield* selectCanAdministerHost.effect())) return;
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
  function* persistSelectedModelsWorker(
    picks: Record<string, string>,
    atomicProviderId?: string,
    connection?: string | null,
    waitForBackground = false,
  ) {
    const admittedConnection =
      connection === undefined
        ? (yield* selectModelSelectionState.effect()).selectionConnection
        : connection;
    if (!admittedConnection || !(yield* selectCanAdministerHost.effect())) return false;
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
      if (!(yield* selectCanAdministerHost.effect())) return false;
      const snapshot = yield* call(readSettingsSnapshot);
      if (admittedConnection !== (yield* selectModelSelectionState.effect()).selectionConnection)
        return false;
      if (!snapshot.settings.length) throw new Error('Settings snapshot was empty');
      if (!(yield* selectCanAdministerHost.effect())) return false;
      changes = modelSettingsChanges(snapshot.settings, picks, atomicProviderId);
      const result = settings.updateSnapshot
        ? yield* call([settings, settings.updateSnapshot], changes)
        : { applied: yield* call([settings, settings.update], changes), revision: 0 };
      if (
        (yield* selectCanAdministerHost.effect()) &&
        admittedConnection === (yield* selectModelSelectionState.effect()).selectionConnection
      )
        yield* put(settingsChangesReceived(result.applied, result.revision));
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
  function* persistDefaultReasoningEffortWorker(effort: string, connection?: string | null) {
    const admittedConnection =
      connection === undefined
        ? (yield* selectModelSelectionState.effect()).selectionConnection
        : connection;
    if (!admittedConnection || !(yield* selectCanAdministerHost.effect())) return;
    if (admittedConnection !== (yield* selectModelSelectionState.effect()).selectionConnection)
      return;
    try {
      const changes = [{ path: 'model.defaultReasoningEffort', value: effort }];
      const result = settings.updateSnapshot
        ? yield* call([settings, settings.updateSnapshot], changes)
        : { applied: yield* call([settings, settings.update], changes), revision: 0 };
      if (
        (yield* selectCanAdministerHost.effect()) &&
        admittedConnection === (yield* selectModelSelectionState.effect()).selectionConnection
      )
        yield* put(settingsChangesReceived(result.applied, result.revision));
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

  function* modelSelectionSaga() {
    yield* takeEvery(selectModel, handleSelectModel);
    // Atomic defaults share providerSettingsSaga's ordered default-provider queue.
    yield* call(watchDefaultReasoningEffortPersistence);
  }

  return {
    handleSelectModel,
    persistSelectedModelsWorker,
    persistDefaultReasoningEffortWorker,
    modelSelectionSaga,
  };
}
