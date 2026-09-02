import { buffers } from 'redux-saga';
import { actionChannel, call, delay, race, take } from 'typed-redux-saga';

import { appClient } from '$lib/client';
import type { AppliedSettingChange } from '$lib/client/app-client';
import { isDaemonErrorResponse } from '$lib/client/live/backend-transport-types';
import { applySettingsChanges } from '$features/settings/settings-hydration-service';
import { createLogger } from '$lib/utils/client-logger';
import { settingsChangesReceived } from '../settings-events-slice';
import { connectionsListReceived } from '../../connections/connections-slice';
import { backendReconnected } from '../../workspace-lifecycle/workspace-lifecycle-slice';

const logger = createLogger('SettingsHydrationSaga');

type LifecycleAction =
  ReturnType<typeof connectionsListReceived> | ReturnType<typeof backendReconnected>;

function isConnectionsListReceived(
  action: LifecycleAction,
): action is ReturnType<typeof connectionsListReceived> {
  return action.type === connectionsListReceived.type;
}

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

function* readSettingsSnapshotSaga() {
  let attempt = 0;
  while (true) {
    try {
      const snapshot = appClient.settings.listSnapshot
        ? yield* call([appClient.settings, appClient.settings.listSnapshot])
        : {
            settings: yield* call([appClient.settings, appClient.settings.list]),
            revision: 0,
          };
      const settings = snapshot.settings;
      if (Array.isArray(settings) && settings.length > 0) {
        const changes: AppliedSettingChange[] = settings.map(({ path, value, origin }) => ({
          path,
          value,
          ...(origin ? { origin } : {}),
        }));
        // The shared apply seam emits hydration actions only. It never calls
        // settings.update, so the boot snapshot cannot echo back into persistence.
        return { changes, revision: snapshot.revision };
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

export function* hydrateSettingsOnceSaga() {
  const snapshot = yield* call(readSettingsSnapshotSaga);
  if (snapshot) yield* call(applySettingsChanges, snapshot.changes);
}

export function* settingsHydrationSaga() {
  const channel = yield* actionChannel(settingsChangesReceived, buffers.expanding());
  const lifecycleChannel = yield* actionChannel<LifecycleAction>(
    [connectionsListReceived, backendReconnected],
    buffers.expanding(),
  );
  try {
    // Install the ordered event channel before the boot read so changes racing
    // settings.list are retained and applied after its older snapshot.
    let backendId: string | undefined;
    let revision = -1;
    let needsSnapshot = true;
    while (true) {
      if (needsSnapshot) {
        const { snapshot, lifecycle } = yield* race({
          snapshot: call(readSettingsSnapshotSaga),
          lifecycle: take(lifecycleChannel),
        });
        if (lifecycle) {
          if (isConnectionsListReceived(lifecycle)) {
            backendId = lifecycle.payload[0].windowBackendId;
          }
          revision = -1;
          continue;
        }
        if (snapshot) {
          yield* call(applySettingsChanges, snapshot.changes);
          revision = snapshot.revision;
        }
        needsSnapshot = false;
        continue;
      }

      const { settings, lifecycle } = yield* race({
        settings: take(channel),
        lifecycle: take(lifecycleChannel),
      });
      if (lifecycle?.type === backendReconnected.type) {
        revision = -1;
        needsSnapshot = true;
        continue;
      }
      if (lifecycle && isConnectionsListReceived(lifecycle)) {
        const nextBackendId = lifecycle.payload[0].windowBackendId;
        if (nextBackendId === backendId) continue;
        backendId = nextBackendId;
        revision = -1;
        needsSnapshot = true;
        continue;
      }
      if (!settings) continue;
      const incomingRevision = settings.payload[1];
      // Older daemons omit revisions. Accept those only until this backend has
      // demonstrated revision support, preserving additive compatibility.
      if (incomingRevision === undefined ? revision > 0 : incomingRevision < revision) continue;
      yield* call(applySettingsChanges, settings.payload[0]);
      if (incomingRevision !== undefined) revision = incomingRevision;
    }
  } finally {
    channel.close();
    lifecycleChannel.close();
  }
}
