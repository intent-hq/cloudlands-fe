import { buffers } from 'redux-saga';
import { actionChannel, call, fork, join, put, take } from 'typed-redux-saga';

import { appClient } from '$lib/client';
import { createLogger } from '$lib/utils/client-logger';
import {
  selectWorkspaceCreationBranchByRepo,
  selectWorkspaceCreationDefaultParentPath,
  selectWorkspaceCreationLastSelectedRepo,
  selectWorkspaceCreationRecentRepos,
  selectWorkspaceCreationRemoteSetups,
} from '../workspace-creation-settings-selectors';
import {
  hydrateWorkspaceCreationSettings,
  removeWorkspaceCreationRemoteSetup,
  setWorkspaceCreationBranchForRepo,
  setWorkspaceCreationDefaultParentPath,
  setWorkspaceCreationLastSelectedRepo,
  setWorkspaceCreationRecentRepos,
  setWorkspaceCreationRemoteSetups,
  upsertWorkspaceCreationRemoteSetup,
} from '../workspace-creation-settings-slice';
import type {
  WorkspaceCreationRecentRepo,
  WorkspaceCreationRemoteSetup,
  WorkspaceCreationRepoSelection,
  WorkspaceCreationSettingsHydrationState,
} from '../workspace-creation-settings-types';

const logger = createLogger('WorkspaceCreationSettingsSaga');
const SETTINGS_PATH = 'workspaceCreationSettings.state';
const LEGACY_SETTINGS_PATH = 'workspaceInitializer.state';

type HydrationGate = { settled: boolean; queued: boolean };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function stringRecord(value: unknown): Record<string, string> | undefined {
  if (!isRecord(value)) return undefined;
  return Object.fromEntries(
    Object.entries(value).filter(
      (entry): entry is [string, string] => typeof entry[1] === 'string',
    ),
  );
}

function objectArray<T>(value: unknown): T[] | undefined {
  return Array.isArray(value) ? (value.filter(isRecord) as T[]) : undefined;
}

function hydrationStateFromBag(
  daemonBag: Record<string, unknown>,
): WorkspaceCreationSettingsHydrationState {
  return {
    lastSelectedRepo: isRecord(daemonBag.lastSelectedRepo)
      ? (daemonBag.lastSelectedRepo as unknown as WorkspaceCreationRepoSelection)
      : null,
    branchByRepo: stringRecord(daemonBag.branchByRepo),
    defaultParentPath:
      typeof daemonBag.defaultParentPath === 'string' ? daemonBag.defaultParentPath : undefined,
    recentRepos: objectArray<WorkspaceCreationRecentRepo>(daemonBag.recentRepos),
    remoteSetups: objectArray<WorkspaceCreationRemoteSetup>(daemonBag.remoteSetups),
  };
}

let warnedNonCloneableBag = false;

function cloneableBag(
  bag: WorkspaceCreationSettingsHydrationState,
): WorkspaceCreationSettingsHydrationState | null {
  try {
    structuredClone(bag);
    return bag;
  } catch (cloneError) {
    if (!warnedNonCloneableBag) {
      warnedNonCloneableBag = true;
      logger.warn(
        `Sanitized non-structured-cloneable ${SETTINGS_PATH} bag before persisting; ` +
          'a non-serializable value (e.g. a $state proxy) reached the store',
        { error: cloneError },
      );
    }
    try {
      return JSON.parse(JSON.stringify(bag)) as WorkspaceCreationSettingsHydrationState;
    } catch (error) {
      logger.error(`Cannot sanitize ${SETTINGS_PATH} bag; skipping persist`, { error });
      return null;
    }
  }
}

function* buildWorkspaceCreationSettingsBag() {
  const lastSelectedRepo = yield* selectWorkspaceCreationLastSelectedRepo.effect();
  const branchByRepo = yield* selectWorkspaceCreationBranchByRepo.effect();
  const defaultParentPath = yield* selectWorkspaceCreationDefaultParentPath.effect();
  const recentRepos = yield* selectWorkspaceCreationRecentRepos.effect();
  const remoteSetups = yield* selectWorkspaceCreationRemoteSetups.effect();
  return {
    lastSelectedRepo,
    branchByRepo,
    defaultParentPath,
    recentRepos,
    remoteSetups,
  } satisfies WorkspaceCreationSettingsHydrationState;
}

export function* persistWorkspaceCreationSettingsWorker() {
  const bag = cloneableBag(yield* call(buildWorkspaceCreationSettingsBag));
  if (bag === null) return;
  try {
    yield* call(
      [appClient.settings, appClient.settings.update],
      [{ path: SETTINGS_PATH, value: bag }],
    );
  } catch (error) {
    logger.error(`Failed to persist ${SETTINGS_PATH}`, { error });
  }
}

export function* hydrateWorkspaceCreationSettingsWorker() {
  try {
    const setting = yield* call([appClient.settings, appClient.settings.get], SETTINGS_PATH);
    const daemonBag = isRecord(setting?.value) ? setting.value : {};
    if (Object.keys(daemonBag).length === 0) {
      const legacySetting = yield* call(
        [appClient.settings, appClient.settings.get],
        LEGACY_SETTINGS_PATH,
      );
      const legacyBag = isRecord(legacySetting?.value) ? legacySetting.value : null;
      if (legacyBag && Object.keys(legacyBag).length > 0) {
        const migratedBag = hydrationStateFromBag(legacyBag);
        yield* put(hydrateWorkspaceCreationSettings(migratedBag));
        logger.info(`Migrated ${LEGACY_SETTINGS_PATH} to ${SETTINGS_PATH}`);
        try {
          yield* call(
            [appClient.settings, appClient.settings.update],
            [{ path: SETTINGS_PATH, value: migratedBag }],
          );
        } catch (error) {
          logger.error(`Failed to persist migrated ${SETTINGS_PATH} bag`, { error });
        }
        return true;
      }
    }

    const hydrationState = hydrationStateFromBag(daemonBag);
    yield* put(hydrateWorkspaceCreationSettings(hydrationState));
    return true;
  } catch (error) {
    logger.error('Hydration failed; dispatching defaults so UI is not blocked', { error });
    yield* put(hydrateWorkspaceCreationSettings({ lastSelectedRepo: null }));
    return false;
  }
}

function* watchWorkspaceCreationSettingsPersistence(gate: HydrationGate) {
  const channel = yield* actionChannel(
    [
      setWorkspaceCreationLastSelectedRepo,
      setWorkspaceCreationBranchForRepo,
      setWorkspaceCreationDefaultParentPath,
      setWorkspaceCreationRecentRepos,
      setWorkspaceCreationRemoteSetups,
      upsertWorkspaceCreationRemoteSetup,
      removeWorkspaceCreationRemoteSetup,
    ],
    buffers.sliding(1),
  );
  try {
    while (true) {
      yield* take(channel);
      if (!gate.settled) {
        gate.queued = true;
        continue;
      }
      yield* call(persistWorkspaceCreationSettingsWorker);
    }
  } finally {
    channel.close();
  }
}

export function* workspaceCreationSettingsSaga() {
  const gate: HydrationGate = { settled: false, queued: false };
  const persistenceTask = yield* fork(watchWorkspaceCreationSettingsPersistence, gate);

  const hydrated = yield* call(hydrateWorkspaceCreationSettingsWorker);
  gate.settled = true;
  if (gate.queued && hydrated) yield* call(persistWorkspaceCreationSettingsWorker);
  gate.queued = false;

  yield* join(persistenceTask);
}
