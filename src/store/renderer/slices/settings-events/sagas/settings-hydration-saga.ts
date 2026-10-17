import { rendererEventRecovery } from '$features/events/renderer-event-recovery';
import { GLOBAL_SETTINGS_RECOVERY_KEY } from '$features/settings/settings-recovery-lifetime';
import {
  captureSettingsWork,
  isSettingsAuthorityError,
} from '$features/settings/settings-recovery-lifetime';
import {
  installSettingsRecovery,
  retireSettingsAuthority,
  recordSettingsSnapshotRevision,
  getSettingsSnapshotRevision,
} from './settings-recovery';
import { settingsWorkScope } from './settings-work-scope';
import { buffers } from 'redux-saga';
import { actionChannel, all, call, delay, flush, put, take } from 'typed-redux-saga';
import { takeLatestFromSelector, type SelectorChannelPayload } from '@themislib/themis/saga';
import { settingsFormSaga } from './settings-form-saga';
import { settingsMigrationsSaga } from './settings-migrations-saga';
import { websocketApiSaga } from '../../websocket-api/sagas/websocket-api-saga';
import { rtkSettingsSaga } from '../../rtk-settings/sagas/rtk-settings-saga';

import { readSettingsSnapshot } from './read-settings-snapshot';
import type { AppliedSettingChange } from '$lib/client/app-client';
import { isDaemonErrorResponse } from '$lib/client/live/backend-transport-types';
import { applySettingsChanges } from '$features/settings/settings-hydration-service';
import { createLogger } from '$lib/utils/client-logger';
import { settingsChangesReceived, settingsFieldsRefreshRequested } from '../settings-events-slice';
import {
  selectCanAdministerHost,
  selectPrincipalActionContext,
} from '../../principal/principal-selectors';
import { notificationVolumeHydrationStarted } from '../../user-preferences/user-preferences-slice';
import { selectModelSelectionState } from '../../model/model-selectors';

import {
  fastModeHydrationStarted,
  fastModeSupportReceived,
} from '../../provider-settings/provider-settings-slice';

const logger = createLogger('SettingsHydrationSaga');

/**
 * Retry backoff for a boot `settings.list` that failed to land. On a fresh
 * app start the daemon's UDS listener may not be up yet (connect ENOENT
 * bursts for ~1s while the sidecar boots), and dropping the boot snapshot
 * would leave every settings-backed slice at its empty default (e.g.
 * `enabledProviders: {}` — everything disabled) until a settings:changed
 * event happens to arrive (monorepo#1986).
 *
 * `LiveSettingsClient.list()` folds transient transport failures into an EMPTY
 * result, so in the live renderer the failure signal is an empty snapshot,
 * not a throw — the daemon always reports its setting catalog, making empty
 * unambiguous (the same convention the settings panels use). Both signals are
 * retried; a structured daemon error response (including the `-32003
 * Forbidden` capability refusal) is a rejection, not a transient failure, and
 * is not. Boot reads stop after three delayed retries while this connection
 * has confirmed owner authority. Unresolved, revoked, member and guest callers never request the
 * catalog. Losing authority cancels the pending read and its retry timer.
 */
export const SETTINGS_HYDRATION_RETRY_DELAYS_MS = [1_000, 5_000, 15_000] as const;

function* readSettingsSnapshotSaga() {
  let attempt = 0;
  while (
    attempt <= SETTINGS_HYDRATION_RETRY_DELAYS_MS.length &&
    (yield* selectCanAdministerHost.effect())
  ) {
    const receipt = captureSettingsWork();
    if (!receipt.isCurrent()) return;
    try {
      const snapshot = yield* call(readSettingsSnapshot);
      if (!receipt.isCurrent()) {
        rendererEventRecovery.invalidate(GLOBAL_SETTINGS_RECOVERY_KEY);
        return;
      }
      const settings = snapshot.settings;
      if (Array.isArray(settings) && settings.length > 0) {
        const changes: AppliedSettingChange[] = settings.map(({ path, value, origin }) => ({
          path,
          value,
          ...(origin ? { origin } : {}),
        }));
        // The shared apply seam emits hydration actions only. It never calls
        // settings.update, so the boot snapshot cannot echo back into persistence.
        return {
          changes,
          revision: snapshot.revision,
          fastModeSupported: settings.some(
            (s) => s.path === 'providers.fastMode' && s.type === 'object',
          ),
        };
      }
      logger.error('settings hydration returned an empty snapshot, retrying');
    } catch (error) {
      if (!receipt.isCurrent()) return;
      if (isSettingsAuthorityError(error)) {
        logger.error('settings hydration authority retired', error);
        retireSettingsAuthority();
        return;
      }
      if (isDaemonErrorResponse(error)) {
        logger.error('settings hydration rejected by daemon', error);
        return;
      }
      logger.error('settings hydration failed, retrying', error);
    }
    if (attempt >= SETTINGS_HYDRATION_RETRY_DELAYS_MS.length) return;
    yield* delay(
      SETTINGS_HYDRATION_RETRY_DELAYS_MS[
        Math.min(attempt, SETTINGS_HYDRATION_RETRY_DELAYS_MS.length - 1)
      ],
    );
    attempt += 1;
  }
}

export function* hydrateSettingsOnceSaga() {
  yield* put(notificationVolumeHydrationStarted());
  yield* put(fastModeHydrationStarted());
  const snapshot = yield* call(readSettingsSnapshotSaga);
  if (snapshot) {
    recordSettingsSnapshotRevision(snapshot.revision);
    yield* call(applySettingsChanges, snapshot.changes, snapshot.revision);
    yield* put(fastModeSupportReceived(snapshot.fastModeSupported));
  }
}

function* settingsSnapshotLoop() {
  const channel = yield* actionChannel(settingsChangesReceived, buffers.expanding());
  try {
    yield* put(notificationVolumeHydrationStarted());
    yield* put(fastModeHydrationStarted());
    const snapshot = yield* call(readSettingsSnapshotSaga);
    const revisions = new Map<string, number>();
    if (snapshot) {
      recordSettingsSnapshotRevision(snapshot.revision);
      yield* call(applySettingsChanges, snapshot.changes, snapshot.revision);
      for (const { path } of snapshot.changes) revisions.set(path, snapshot.revision);
      yield* put(fastModeSupportReceived(snapshot.fastModeSupported));
    }
    while (true) {
      const first = yield* take(channel);
      const buffered = yield* flush(channel);
      for (const action of [first, ...(Array.isArray(buffered) ? buffered : [])]) {
        const [changes, revision] = action.payload;
        // A field-only recovery must not suppress unrelated event deltas.
        const current = changes.filter(
          ({ path }) =>
            revision === undefined ||
            revision >=
              Math.max(
                revisions.get(path) ?? snapshot?.revision ?? -1,
                getSettingsSnapshotRevision(),
              ),
        );
        if (!current.length) continue;
        yield* call(applySettingsChanges, current, revision);
        if (revision !== undefined) for (const { path } of current) revisions.set(path, revision);
      }
    }
  } finally {
    channel.close();
  }
}

function* refreshFailedFieldsLoop() {
  const channel = yield* actionChannel(settingsFieldsRefreshRequested, buffers.expanding());
  try {
    while (true) {
      const first = yield* take(channel);
      const buffered = yield* flush(channel);
      const connection = (yield* selectModelSelectionState.effect()).selectionConnection;
      const paths = new Set(
        [first, ...(Array.isArray(buffered) ? buffered : [])]
          .filter(({ payload }) => payload[1] === connection)
          .flatMap(({ payload }) => payload[0]),
      );
      if (!paths.size) continue;
      try {
        const work = captureSettingsWork();
        if (!work.isCurrent()) continue;
        const snapshot = yield* call(readSettingsSnapshot);
        if (!work.isCurrent()) continue;
        if (connection !== (yield* selectModelSelectionState.effect()).selectionConnection)
          continue;
        yield* put(
          settingsChangesReceived(
            snapshot.settings.filter(({ path }) => paths.has(path)),
            snapshot.revision,
          ),
        );
      } catch (error) {
        logger.error('Failed to refresh rejected settings', error);
      }
    }
  } finally {
    channel.close();
  }
}

export function* settingsHydrationSaga() {
  yield* takeLatestFromSelector(
    selectPrincipalActionContext,
    function* ({ payload: context }: SelectorChannelPayload<string | null>) {
      if (!context || !(yield* selectCanAdministerHost.effect())) return;
      const stop = installSettingsRecovery();
      try {
        yield* all([
          call(settingsWorkScope, settingsMigrationsSaga),
          call(settingsWorkScope, settingsSnapshotLoop),
          call(settingsWorkScope, refreshFailedFieldsLoop),
          call(settingsWorkScope, settingsFormSaga),
          call(settingsWorkScope, websocketApiSaga),
          call(settingsWorkScope, rtkSettingsSaga),
        ]);
      } finally {
        stop();
      }
    },
  );
}
