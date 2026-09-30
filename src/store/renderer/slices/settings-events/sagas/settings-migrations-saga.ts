import { buffers } from 'redux-saga';
import { actionChannel, call, put, take } from 'typed-redux-saga';
import { appClient } from '$lib/client';
import { LOCAL_CONNECTION_ID } from '$shared/types/connections';
import { splitLegacyCompoundId } from '$shared/utils/legacy-model-id';
import { createLogger } from '$lib/utils/client-logger';
import { selectSettingsMigrationContext } from '../settings-events-selectors';
import { connectionsListReceived } from '../../connections/connections-slice';
import { providerEnablementSeedRequested } from '../../provider-settings/provider-settings-slice';
import { settingsChanged } from '../settings-events-slice';

const logger = createLogger('SettingsMigrationsSaga');

function candidate(
  state: ReturnType<typeof selectSettingsMigrationContext.select>,
  knownIds?: string[],
) {
  const models = state.model?.providerModels ?? {};
  const ids = Object.keys(models);
  const providerId = state.model?.defaultProviderId || (ids.length === 1 ? ids[0] : '');
  const model = models[providerId];
  const prefix = model?.includes(':') ? splitLegacyCompoundId(model).providerId : undefined;
  return prefix && (!knownIds || knownIds.includes(prefix)) ? prefix : providerId;
}

function* seedDefaultProvider() {
  const state = yield* selectSettingsMigrationContext.effect();
  if (!state.connectionsReady) return;
  if (state.backendId !== LOCAL_CONNECTION_ID) return;
  const initial = candidate(state);
  if (!initial || state.providerSettings.enabledProviders[initial] !== undefined) return;
  try {
    const catalog = yield* call([appClient.providers, appClient.providers.catalog]);
    const live = yield* selectSettingsMigrationContext.effect();
    if (live.backendId !== LOCAL_CONNECTION_ID) return;
    const providerId = candidate(
      live,
      catalog.providers.map(({ id }) => id),
    );
    const row = catalog.providers.find(({ id }) => id === providerId);
    if (
      !row ||
      row.canBeDisabled === false ||
      live.providerSettings.enabledProviders[providerId] !== undefined
    )
      return;
    yield* put(providerEnablementSeedRequested({ [providerId]: true }));
  } catch (error) {
    logger.error('Failed to resolve default-provider migration', error);
  }
}

/** Single-flight lookup with one trailing trigger; writes belong to providerSettingsSaga. */
export function* settingsMigrationsSaga() {
  type Event = ReturnType<typeof settingsChanged> | ReturnType<typeof connectionsListReceived>;
  const events = yield* actionChannel<Event>(
    [settingsChanged, connectionsListReceived],
    buffers.sliding(1),
  );
  let enabledSnapshotSeen = false;
  try {
    while (true) {
      const action = yield* take(events);
      if (action.type === settingsChanged.type) {
        const [changes] = (action as ReturnType<typeof settingsChanged>).payload;
        if (!changes.some(({ path }) => path === 'providers.enabled')) continue;
        enabledSnapshotSeen = true;
      }
      if (enabledSnapshotSeen) yield* call(seedDefaultProvider);
    }
  } finally {
    events.close();
  }
}
