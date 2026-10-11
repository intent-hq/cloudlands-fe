import { settingsChangesReceived } from '../../settings-events/settings-events-slice';
import { buffers } from 'redux-saga';
import { actionChannel, all, call, put, take, takeEvery } from 'typed-redux-saga';

import { createLogger } from '$lib/utils/client-logger';
import {
  backgroundSettingsChanges,
  rebaseBackgroundSettings,
} from '../background-agent-settings-persistence';
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
} from '../background-agent-settings-slice';

const logger = createLogger('BackgroundAgentSettingsSaga');

import type { Channel } from 'redux-saga';
import type { SelectorChannelSelector } from '@themislib/themis/saga';
import type { SagaGenerator } from 'typed-redux-saga';
import type { SettingsClient, SettingsSnapshot } from '$lib/client/settings-types';
import type { BackgroundAgentSettingsState } from '../background-agent-settings-slice';
import { createBackgroundSettingsSettlement } from './settle-background-settings-factory';

export function createBackgroundAgentSettingsSaga<State>({
  settingsClient,
  readSettingsSnapshot,
  backgroundSettingsWriteLock,
  selectBgSettings,
  showProviderSwitchBlocked,
  migrateBackgroundSettings,
  selectCanAdministerHost,
  selectModelSelectionState,
}: {
  selectCanAdministerHost: SelectorChannelSelector<boolean, [], State>;
  selectModelSelectionState: SelectorChannelSelector<
    { selectionConnection: string | null },
    [],
    State
  >;
  settingsClient: SettingsClient;
  readSettingsSnapshot: () => Promise<SettingsSnapshot>;
  backgroundSettingsWriteLock: Channel<boolean>;
  selectBgSettings: SelectorChannelSelector<BackgroundAgentSettingsState, [], State>;
  showProviderSwitchBlocked: (
    action: ReturnType<typeof backgroundProviderSwitchBlocked>,
  ) => void | Promise<void>;
  migrateBackgroundSettings?: (
    action: ReturnType<typeof backgroundSettingsHydrationRequested>,
  ) => SagaGenerator<void>;
}) {
  const settleBackgroundSettings = createBackgroundSettingsSettlement(selectBgSettings);
  function* persistBackgroundAgentSettingsWorker() {
    if (!(yield* selectCanAdministerHost.effect())) return;
    const connection = (yield* selectModelSelectionState.effect()).selectionConnection;
    yield* take(backgroundSettingsWriteLock);
    const settings = yield* selectBgSettings.effect();
    try {
      if (
        !(yield* selectCanAdministerHost.effect()) ||
        connection !== (yield* selectModelSelectionState.effect()).selectionConnection
      )
        return;
      const snapshot = yield* call(readSettingsSnapshot);
      if (
        !(yield* selectCanAdministerHost.effect()) ||
        connection !== (yield* selectModelSelectionState.effect()).selectionConnection
      )
        return;
      const rebased = rebaseBackgroundSettings(snapshot.settings, settings);
      const changes = backgroundSettingsChanges(rebased);
      if (rebased.providerId)
        changes.unshift({ path: 'model.defaultProvider', value: rebased.providerId });
      const result = settingsClient.updateSnapshot
        ? yield* call([settingsClient, settingsClient.updateSnapshot], changes)
        : {
            applied: yield* call([settingsClient, settingsClient.update], changes),
            revision: 0,
          };
      if (
        !(yield* selectCanAdministerHost.effect()) ||
        connection !== (yield* selectModelSelectionState.effect()).selectionConnection
      )
        return;
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
      if (settingsClient.updateSnapshot)
        yield* put(
          settingsChangesReceived(
            [
              ...changes.filter(
                (change) => !result.applied.some(({ path }) => path === change.path),
              ),
              ...result.applied,
            ].filter(({ path }) => !path.startsWith('model.')),
            result.revision,
          ),
        );
    } catch (error) {
      logger.error('Failed to persist background agent settings:', error);
      if (
        !(yield* selectCanAdministerHost.effect()) ||
        connection !== (yield* selectModelSelectionState.effect()).selectionConnection
      )
        return;
      yield* call(settleBackgroundSettings, {
        generation: settings.persistenceGeneration ?? 0,
        providerId: settings.providerId,
      });
    } finally {
      yield* put(backgroundSettingsWriteLock, true);
    }
  }

  function* hydrateBackgroundSettings(
    action: ReturnType<typeof backgroundSettingsHydrationRequested>,
  ) {
    yield* put(hydrateSettings(action.payload[0]));
    if (migrateBackgroundSettings) yield* call(migrateBackgroundSettings, action);
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

  function* backgroundAgentSettingsSaga() {
    yield* all([
      call(persistLoop),
      takeEvery(backgroundProviderSwitchBlocked, showProviderSwitchBlocked),
      takeEvery(backgroundSettingsHydrationRequested, hydrateBackgroundSettings),
    ]);
  }

  return backgroundAgentSettingsSaga;
}
