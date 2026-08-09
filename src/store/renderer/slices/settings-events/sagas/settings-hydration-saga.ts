import { buffers } from 'redux-saga';
import { actionChannel, call, take } from 'typed-redux-saga';

import { appClient } from '$lib/client';
import type { AppliedSettingChange } from '$lib/client/app-client';
import { applySettingsChanges } from '$features/settings/settings-hydration-service';
import { createLogger } from '$lib/utils/client-logger';
import { settingsChangesReceived } from '../settings-events-slice';

const logger = createLogger('SettingsHydrationSaga');

export function* hydrateSettingsOnceSaga() {
  try {
    const settings = yield* call([appClient.settings, appClient.settings.list]);
    if (!Array.isArray(settings) || settings.length === 0) return;
    const changes: AppliedSettingChange[] = settings.map(({ path, value }) => ({ path, value }));
    // The shared apply seam emits hydration actions only. It never calls
    // settings.update, so the boot snapshot cannot echo back into persistence.
    yield* call(applySettingsChanges, changes);
  } catch (error) {
    logger.error('settings hydration failed', error);
  }
}

export function* settingsHydrationSaga() {
  const channel = yield* actionChannel(settingsChangesReceived, buffers.expanding());
  try {
    // Install the ordered event channel before the boot read so changes racing
    // settings.list are retained and applied after its older snapshot.
    yield* call(hydrateSettingsOnceSaga);
    while (true) {
      const action: ReturnType<typeof settingsChangesReceived> = yield* take(channel);
      yield* call(applySettingsChanges, action.payload[0]);
    }
  } finally {
    channel.close();
  }
}