import { buffers } from 'redux-saga';
import { actionChannel, call, delay, take } from 'typed-redux-saga';

import { appClient } from '$lib/client';
import type { AppliedSettingChange } from '$lib/client/app-client';
import { isDaemonErrorResponse } from '$lib/client/live/backend-transport-types';
import { applySettingsChanges } from '$features/settings/settings-hydration-service';
import { createLogger } from '$lib/utils/client-logger';
import { settingsChangesReceived } from '../settings-events-slice';

const logger = createLogger('SettingsHydrationSaga');

/**
 * Retry backoff for a boot `settings.list` that failed to land. On a fresh
 * app start the daemon's UDS listener may not be up yet (connect ENOENT
 * bursts for ~1s while the sidecar boots), and dropping the boot snapshot
 * would leave every settings-backed slice at its empty default (e.g.
 * `enabledProviders: {}` — everything disabled) until a settings:changed
 * event happens to arrive (monorepo#1986).
 *
 * `LiveSettingsClient.list()` folds every transport failure into an EMPTY
 * result, so in the live renderer the failure signal is an empty snapshot,
 * not a throw — the daemon always reports its setting catalog, making empty
 * unambiguous (the same convention the settings panels use). Both signals are
 * retried; a structured daemon error response is a rejection, not a transient
 * failure, and is not. The last delay repeats until the read lands.
 */
export const SETTINGS_HYDRATION_RETRY_DELAYS_MS = [1_000, 5_000, 15_000] as const;

export function* hydrateSettingsOnceSaga() {
  let attempt = 0;
  while (true) {
    try {
      const settings = yield* call([appClient.settings, appClient.settings.list]);
      if (Array.isArray(settings) && settings.length > 0) {
        const changes: AppliedSettingChange[] = settings.map(({ path, value }) => ({
          path,
          value,
        }));
        // The shared apply seam emits hydration actions only. It never calls
        // settings.update, so the boot snapshot cannot echo back into persistence.
        yield* call(applySettingsChanges, changes);
        return;
      }
      logger.error('settings hydration returned an empty snapshot, retrying');
    } catch (error) {
      if (isDaemonErrorResponse(error)) {
        logger.error('settings hydration rejected by daemon', error);
        return;
      }
      logger.error('settings hydration failed, retrying', error);
    }
    yield* delay(
      SETTINGS_HYDRATION_RETRY_DELAYS_MS[
        Math.min(attempt, SETTINGS_HYDRATION_RETRY_DELAYS_MS.length - 1)
      ],
    );
    attempt += 1;
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