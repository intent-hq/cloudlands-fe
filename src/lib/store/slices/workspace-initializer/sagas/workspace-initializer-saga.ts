import {
  call,
  delay,
  fork,
  put,
  race,
  take,
  takeEvery,
  takeLatest,
  type SagaGenerator,
} from "typed-redux-saga";
import { resetOnboarding } from "$lib/store/slices/onboarding/onboarding-slice";
import {
  getLocalStorageItem,
  getLocalStorageJSON,
  removeLocalStorageItem,
  setLocalStorageItem,
  setLocalStorageJSON,
} from "$lib/store/utils/safe-local-storage-saga";
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
} from "../workspace-initializer-slice";
import {
  selectCompactWorkspaceInitializerFormState,
  selectWorkspaceInitializerBranchByRepo,
  selectWorkspaceInitializerDefaultParentPath,
  selectWorkspaceInitializerLastSelectedRepo,
  selectWorkspaceInitializerLastSubmittedAgent,
  selectWorkspaceInitializerOnboardingFormState,
  selectWorkspaceInitializerRecentRepos,
  selectWorkspaceInitializerRemoteSetups,
} from "../workspace-initializer-selectors";
import type {
  CompactWorkspaceInitializerFormState,
  WorkspaceInitializerAgentSettings,
  WorkspaceInitializerOnboardingFormState,
  WorkspaceInitializerRecentRepo,
  WorkspaceInitializerRemoteSetup,
  WorkspaceInitializerRepoSelection,
} from "../workspace-initializer-types";

export const COMPACT_FORM_STATE_KEY = "compact-workspace-initializer-state";
export const ONBOARDING_FORM_STATE_KEY = "onboarding-form-state";
export const LAST_SELECTED_REPO_KEY = "workspace-initializer-last-repo";
export const BRANCH_BY_REPO_KEY = "workspace-initializer-branch-by-repo";
export const DEFAULT_PARENT_PATH_KEY = "workspace-initializer-default-parent";
export const RECENT_REPOS_KEY = "workspace-initializer-recent-repos";
export const REMOTE_SETUPS_KEY = "remote-setups";
export const LAST_SUBMITTED_AGENT_KEY = "workspace-initializer-last-agent";
export const ONBOARDING_PROMPT_SESSION_KEY = "onboarding-prompt";
export const ONBOARDING_FORM_STATE_DEBOUNCE_MS = 300;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stringRecord(value: unknown): Record<string, string> | undefined {
  if (!isRecord(value)) return undefined;
  return Object.fromEntries(
    Object.entries(value).filter((entry): entry is [string, string] => typeof entry[1] === "string"),
  );
}

function objectArray<T>(value: unknown): T[] | undefined {
  return Array.isArray(value) ? (value.filter(isRecord) as T[]) : undefined;
}

export function* hydrateWorkspaceInitializerSaga(): SagaGenerator<void> {
  const compactFormState = yield* getLocalStorageJSON<CompactWorkspaceInitializerFormState>(
    COMPACT_FORM_STATE_KEY,
  );
  const onboardingFormState = yield* getLocalStorageJSON<WorkspaceInitializerOnboardingFormState>(
    ONBOARDING_FORM_STATE_KEY,
  );
  const lastSelectedRepo = yield* getLocalStorageJSON<WorkspaceInitializerRepoSelection>(
    LAST_SELECTED_REPO_KEY,
  );
  const branchByRepo = stringRecord(yield* getLocalStorageJSON<unknown>(BRANCH_BY_REPO_KEY));
  const defaultParentPath = yield* getLocalStorageItem(DEFAULT_PARENT_PATH_KEY);
  const recentRepos = objectArray<WorkspaceInitializerRecentRepo>(
    yield* getLocalStorageJSON<unknown>(RECENT_REPOS_KEY),
  );
  const remoteSetups = objectArray<WorkspaceInitializerRemoteSetup>(
    yield* getLocalStorageJSON<unknown>(REMOTE_SETUPS_KEY),
  );
  const lastSubmittedAgent = yield* getLocalStorageJSON<WorkspaceInitializerAgentSettings>(
    LAST_SUBMITTED_AGENT_KEY,
  );

  yield* put(hydrateWorkspaceInitializer({
    compactFormState: compactFormState ?? null,
    onboardingFormState: onboardingFormState ?? null,
    lastSelectedRepo: lastSelectedRepo ?? null,
    branchByRepo,
    defaultParentPath: defaultParentPath ?? undefined,
    recentRepos,
    remoteSetups,
    lastSubmittedAgent: lastSubmittedAgent ?? null,
  }));
}

export function* persistCompactFormStateSaga(): SagaGenerator<void> {
  const formState = yield* selectCompactWorkspaceInitializerFormState.effect();
  if (formState) {
    yield* setLocalStorageJSON(COMPACT_FORM_STATE_KEY, formState);
  } else {
    yield* removeLocalStorageItem(COMPACT_FORM_STATE_KEY);
  }
}

export function* persistOnboardingFormStateSaga(): SagaGenerator<void> {
  const formState = yield* selectWorkspaceInitializerOnboardingFormState.effect();
  if (formState) {
    yield* setLocalStorageJSON(ONBOARDING_FORM_STATE_KEY, formState);
  } else {
    yield* removeLocalStorageItem(ONBOARDING_FORM_STATE_KEY);
  }
}

export function* applyDebouncedOnboardingFormStateSaga(
  action: ReturnType<typeof debounceWorkspaceInitializerOnboardingFormState>,
): SagaGenerator<void> {
  const result = yield* race({
    debounced: delay(ONBOARDING_FORM_STATE_DEBOUNCE_MS),
    reset: take(resetOnboarding),
    cancel: take(cancelWorkspaceInitializerOnboardingFormStateDebounce),
  });

  if (result.reset || result.cancel) return;

  yield* put(setWorkspaceInitializerOnboardingFormState(action.payload[0]));
}

export function* persistLastSelectedRepoSaga(): SagaGenerator<void> {
  const repo = yield* selectWorkspaceInitializerLastSelectedRepo.effect();
  if (repo) {
    yield* setLocalStorageJSON(LAST_SELECTED_REPO_KEY, repo);
  } else {
    yield* removeLocalStorageItem(LAST_SELECTED_REPO_KEY);
  }
}

export function* persistBranchByRepoSaga(): SagaGenerator<void> {
  const branchByRepo = yield* selectWorkspaceInitializerBranchByRepo.effect();
  yield* setLocalStorageJSON(BRANCH_BY_REPO_KEY, branchByRepo);
}

export function* persistDefaultParentPathSaga(): SagaGenerator<void> {
  const defaultParentPath = yield* selectWorkspaceInitializerDefaultParentPath.effect();
  yield* setLocalStorageItem(DEFAULT_PARENT_PATH_KEY, defaultParentPath);
}

export function* persistRecentReposSaga(): SagaGenerator<void> {
  const recentRepos = yield* selectWorkspaceInitializerRecentRepos.effect();
  yield* setLocalStorageJSON(RECENT_REPOS_KEY, recentRepos);
}

export function* persistRemoteSetupsSaga(): SagaGenerator<void> {
  const remoteSetups = yield* selectWorkspaceInitializerRemoteSetups.effect();
  yield* setLocalStorageJSON(REMOTE_SETUPS_KEY, remoteSetups);
}

export function* persistLastSubmittedAgentSaga(): SagaGenerator<void> {
  const settings = yield* selectWorkspaceInitializerLastSubmittedAgent.effect();
  if (settings) {
    yield* setLocalStorageJSON(LAST_SUBMITTED_AGENT_KEY, settings);
  } else {
    yield* removeLocalStorageItem(LAST_SUBMITTED_AGENT_KEY);
  }
}

export function removeOnboardingPromptSessionStorage(): void {
  try {
    if (typeof sessionStorage !== "undefined") {
      sessionStorage.removeItem(ONBOARDING_PROMPT_SESSION_KEY);
    }
  } catch {
    // Ignore session storage failures; reset should still clear Redux-backed state.
  }
}

export function* resetOnboardingPersistenceSaga(): SagaGenerator<void> {
  yield* put(setWorkspaceInitializerOnboardingFormState(null));
  yield* call(removeOnboardingPromptSessionStorage);
}

export function* watchWorkspaceInitializerPersistenceSaga(): SagaGenerator<void> {
  yield* takeEvery(setCompactWorkspaceInitializerFormState, persistCompactFormStateSaga);
  yield* takeLatest(
    debounceWorkspaceInitializerOnboardingFormState,
    applyDebouncedOnboardingFormStateSaga,
  );
  yield* takeEvery(setWorkspaceInitializerOnboardingFormState, persistOnboardingFormStateSaga);
  yield* takeEvery(setWorkspaceInitializerLastSelectedRepo, persistLastSelectedRepoSaga);
  yield* takeEvery(setWorkspaceInitializerBranchForRepo, persistBranchByRepoSaga);
  yield* takeEvery(setWorkspaceInitializerDefaultParentPath, persistDefaultParentPathSaga);
  yield* takeEvery(setWorkspaceInitializerRecentRepos, persistRecentReposSaga);
  yield* takeEvery(setWorkspaceInitializerRemoteSetups, persistRemoteSetupsSaga);
  yield* takeEvery(upsertWorkspaceInitializerRemoteSetup, persistRemoteSetupsSaga);
  yield* takeEvery(removeWorkspaceInitializerRemoteSetup, persistRemoteSetupsSaga);
  yield* takeEvery(setWorkspaceInitializerLastSubmittedAgent, persistLastSubmittedAgentSaga);
  yield* takeEvery(resetOnboarding, resetOnboardingPersistenceSaga);
}

export function* workspaceInitializerSaga(): SagaGenerator<void> {
  yield* fork(hydrateWorkspaceInitializerSaga);
  yield* fork(watchWorkspaceInitializerPersistenceSaga);
}