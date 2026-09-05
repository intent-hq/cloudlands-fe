import { buffers } from 'redux-saga';
import {
  actionChannel,
  call,
  delay,
  fork,
  join,
  put,
  race,
  take,
  takeLatest,
} from 'typed-redux-saga';

import { appClient } from '$lib/client';
import { createLogger } from '$lib/utils/client-logger';
import {
  getLocalStorageItem,
  getLocalStorageJSON,
} from '$store/renderer/utils/safe-local-storage-saga';
import {
  selectCompactWorkspaceInitializerFormState,
  selectWorkspaceInitializerBranchByRepo,
  selectWorkspaceInitializerDefaultParentPath,
  selectWorkspaceInitializerLastSelectedRepo,
  selectWorkspaceInitializerLastSubmittedAgent,
  selectWorkspaceInitializerOnboardingFormState,
  selectWorkspaceInitializerRecentRepos,
  selectWorkspaceInitializerRemoteSetups,
} from '../workspace-initializer-selectors';
import {
  cancelWorkspaceInitializerOnboardingFormStateDebounce,
  debounceWorkspaceInitializerOnboardingFormState,
  hydrateWorkspaceInitializer,
  removeWorkspaceInitializerRemoteSetup,
  setCompactWorkspaceInitializerFormState,
  setWorkspaceInitializerBranchForRepo,
  setWorkspaceInitializerDefaultParentPath,
  setWorkspaceInitializerLastSelectedRepo,
  setWorkspaceInitializerLastSubmittedAgent,
  setWorkspaceInitializerOnboardingFormState,
  setWorkspaceInitializerRecentRepos,
  setWorkspaceInitializerRemoteSetups,
  upsertWorkspaceInitializerRemoteSetup,
} from '../workspace-initializer-slice';
import type {
  CompactWorkspaceInitializerFormState,
  WorkspaceInitializerAgentSettings,
  WorkspaceInitializerHydrationState,
  WorkspaceInitializerOnboardingFormState,
  WorkspaceInitializerRecentRepo,
  WorkspaceInitializerRemoteSetup,
  WorkspaceInitializerRepoSelection,
} from '../workspace-initializer-types';

const logger = createLogger('WorkspaceInitializerSaga');
const SETTINGS_PATH = 'workspaceInitializer.state';
const COMPACT_FORM_STATE_KEY = 'compact-workspace-initializer-state';
const ONBOARDING_FORM_STATE_KEY = 'onboarding-form-state';
const LAST_SELECTED_REPO_KEY = 'workspace-initializer-last-repo';
const BRANCH_BY_REPO_KEY = 'workspace-initializer-branch-by-repo';
const DEFAULT_PARENT_PATH_KEY = 'workspace-initializer-default-parent';
const RECENT_REPOS_KEY = 'workspace-initializer-recent-repos';
const REMOTE_SETUPS_KEY = 'remote-setups';
const LAST_SUBMITTED_AGENT_KEY = 'workspace-initializer-last-agent';
const ONBOARDING_FORM_STATE_DEBOUNCE_MS = 300;

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

function nonEmptyRecord<T>(value: unknown): T | null {
  return isRecord(value) && Object.keys(value).length > 0 ? (value as T) : null;
}

/**
 * Strip legacy setup-script fields from a persisted form-state record. The
 * setup script is session-local now (last-used per repo lives in
 * localStorage, `$features/setup-scripts/last-used`), so previously persisted
 * script fields must not rehydrate into Redux.
 */
function stripLegacyScriptFields<T>(record: T | null): T | null {
  if (!isRecord(record)) return record;
  const {
    setupScript: _setupScript,
    setupScriptName: _setupScriptName,
    isCustomSetupScript: _isCustomSetupScript,
    showSetupScript: _showSetupScript,
    ...rest
  } = record;
  return rest as T;
}

let warnedNonCloneableBag = false;

function cloneableBag(
  bag: WorkspaceInitializerHydrationState,
): WorkspaceInitializerHydrationState | null {
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
      return JSON.parse(JSON.stringify(bag)) as WorkspaceInitializerHydrationState;
    } catch (error) {
      logger.error(`Cannot sanitize ${SETTINGS_PATH} bag; skipping persist`, { error });
      return null;
    }
  }
}

function* buildWorkspaceInitializerBag() {
  const compactFormState = yield* selectCompactWorkspaceInitializerFormState.effect();
  const onboardingFormState = yield* selectWorkspaceInitializerOnboardingFormState.effect();
  const lastSelectedRepo = yield* selectWorkspaceInitializerLastSelectedRepo.effect();
  const branchByRepo = yield* selectWorkspaceInitializerBranchByRepo.effect();
  const defaultParentPath = yield* selectWorkspaceInitializerDefaultParentPath.effect();
  const recentRepos = yield* selectWorkspaceInitializerRecentRepos.effect();
  const remoteSetups = yield* selectWorkspaceInitializerRemoteSetups.effect();
  const lastSubmittedAgent = yield* selectWorkspaceInitializerLastSubmittedAgent.effect();
  return {
    compactFormState,
    onboardingFormState,
    lastSelectedRepo,
    branchByRepo,
    defaultParentPath,
    recentRepos,
    remoteSetups,
    lastSubmittedAgent,
  } satisfies WorkspaceInitializerHydrationState;
}

export function* persistWorkspaceInitializerWorker() {
  const bag = cloneableBag(yield* call(buildWorkspaceInitializerBag));
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

function* readLegacyBag() {
  const compactFormState = stripLegacyScriptFields(
    nonEmptyRecord<CompactWorkspaceInitializerFormState>(
      yield* getLocalStorageJSON<unknown>(COMPACT_FORM_STATE_KEY),
    ),
  );
  const onboardingFormState = stripLegacyScriptFields(
    nonEmptyRecord<WorkspaceInitializerOnboardingFormState>(
      yield* getLocalStorageJSON<unknown>(ONBOARDING_FORM_STATE_KEY),
    ),
  );
  const lastSelectedRepo = nonEmptyRecord<WorkspaceInitializerRepoSelection>(
    yield* getLocalStorageJSON<unknown>(LAST_SELECTED_REPO_KEY),
  );
  const branchByRepo = stringRecord(yield* getLocalStorageJSON<unknown>(BRANCH_BY_REPO_KEY));
  const defaultParentPath = yield* getLocalStorageItem(DEFAULT_PARENT_PATH_KEY);
  const recentRepos = objectArray<WorkspaceInitializerRecentRepo>(
    yield* getLocalStorageJSON<unknown>(RECENT_REPOS_KEY),
  );
  const remoteSetups = objectArray<WorkspaceInitializerRemoteSetup>(
    yield* getLocalStorageJSON<unknown>(REMOTE_SETUPS_KEY),
  );
  const lastSubmittedAgent = nonEmptyRecord<WorkspaceInitializerAgentSettings>(
    yield* getLocalStorageJSON<unknown>(LAST_SUBMITTED_AGENT_KEY),
  );
  return {
    compactFormState,
    onboardingFormState,
    lastSelectedRepo,
    branchByRepo,
    defaultParentPath: defaultParentPath ?? undefined,
    recentRepos,
    remoteSetups,
    lastSubmittedAgent,
  } satisfies WorkspaceInitializerHydrationState;
}

export function* hydrateWorkspaceInitializerWorker() {
  try {
    const setting = yield* call([appClient.settings, appClient.settings.get], SETTINGS_PATH);
    if (setting === null) throw new Error(`settings.get(${SETTINGS_PATH}) returned null`);
    const daemonBag = isRecord(setting.value) ? setting.value : {};
    if (Object.keys(daemonBag).length === 0) {
      const migratedBag = yield* call(readLegacyBag);
      yield* put(hydrateWorkspaceInitializer(migratedBag));
      try {
        yield* call(
          [appClient.settings, appClient.settings.update],
          [{ path: SETTINGS_PATH, value: migratedBag }],
        );
      } catch (error) {
        logger.error('Failed to write migrated bag to daemon', { error });
      }
      return true;
    }

    const hydrationState: WorkspaceInitializerHydrationState = {
      compactFormState: isRecord(daemonBag.compactFormState)
        ? stripLegacyScriptFields(
            daemonBag.compactFormState as CompactWorkspaceInitializerFormState,
          )
        : null,
      onboardingFormState: isRecord(daemonBag.onboardingFormState)
        ? stripLegacyScriptFields(
            daemonBag.onboardingFormState as unknown as WorkspaceInitializerOnboardingFormState,
          )
        : null,
      lastSelectedRepo: isRecord(daemonBag.lastSelectedRepo)
        ? (daemonBag.lastSelectedRepo as unknown as WorkspaceInitializerRepoSelection)
        : null,
      branchByRepo: stringRecord(daemonBag.branchByRepo),
      defaultParentPath:
        typeof daemonBag.defaultParentPath === 'string' ? daemonBag.defaultParentPath : undefined,
      recentRepos: objectArray<WorkspaceInitializerRecentRepo>(daemonBag.recentRepos),
      remoteSetups: objectArray<WorkspaceInitializerRemoteSetup>(daemonBag.remoteSetups),
      lastSubmittedAgent: isRecord(daemonBag.lastSubmittedAgent)
        ? (daemonBag.lastSubmittedAgent as WorkspaceInitializerAgentSettings)
        : null,
    };
    yield* put(hydrateWorkspaceInitializer(hydrationState));
    return true;
  } catch (error) {
    logger.error('Hydration failed; dispatching defaults so UI is not blocked', { error });
    yield* put(
      hydrateWorkspaceInitializer({
        compactFormState: null,
        onboardingFormState: null,
        lastSelectedRepo: null,
      }),
    );
    return false;
  }
}

function* applyDebouncedOnboardingFormWorker(
  action: ReturnType<typeof debounceWorkspaceInitializerOnboardingFormState>,
) {
  const result = yield* race({
    elapsed: delay(ONBOARDING_FORM_STATE_DEBOUNCE_MS),
    cancelled: take(cancelWorkspaceInitializerOnboardingFormStateDebounce),
  });
  if (result.cancelled) return;
  yield* put(setWorkspaceInitializerOnboardingFormState(action.payload[0]));
}

function* watchDebouncedOnboardingForm() {
  yield* takeLatest(
    debounceWorkspaceInitializerOnboardingFormState,
    applyDebouncedOnboardingFormWorker,
  );
}

function* watchWorkspaceInitializerPersistence(gate: HydrationGate) {
  const channel = yield* actionChannel(
    [
      setCompactWorkspaceInitializerFormState,
      setWorkspaceInitializerOnboardingFormState,
      setWorkspaceInitializerLastSelectedRepo,
      setWorkspaceInitializerBranchForRepo,
      setWorkspaceInitializerDefaultParentPath,
      setWorkspaceInitializerRecentRepos,
      setWorkspaceInitializerRemoteSetups,
      upsertWorkspaceInitializerRemoteSetup,
      removeWorkspaceInitializerRemoteSetup,
      setWorkspaceInitializerLastSubmittedAgent,
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
      yield* call(persistWorkspaceInitializerWorker);
    }
  } finally {
    channel.close();
  }
}

/** Unregistered until the S20 middleware cutover. */
export function* workspaceInitializerSaga() {
  const gate: HydrationGate = { settled: false, queued: false };
  const persistenceTask = yield* fork(watchWorkspaceInitializerPersistence, gate);
  yield* fork(watchDebouncedOnboardingForm);

  const hydrated = yield* call(hydrateWorkspaceInitializerWorker);
  gate.settled = true;
  if (gate.queued && hydrated) yield* call(persistWorkspaceInitializerWorker);
  gate.queued = false;

  yield* join(persistenceTask);
}
