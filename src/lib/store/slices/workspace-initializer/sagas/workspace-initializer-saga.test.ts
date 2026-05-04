import { describe, expect, it, vi } from "vitest";
import * as sagaEffects from "redux-saga/effects";
import { safeLocalStorage } from "$lib/utils/safe-storage";
import { resetOnboarding } from "$lib/store/slices/onboarding/onboarding-slice";
import {
  cancelWorkspaceInitializerOnboardingFormStateDebounce,
  debounceWorkspaceInitializerOnboardingFormState,
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
import {
  BRANCH_BY_REPO_KEY,
  COMPACT_FORM_STATE_KEY,
  DEFAULT_PARENT_PATH_KEY,
  LAST_SELECTED_REPO_KEY,
  LAST_SUBMITTED_AGENT_KEY,
  ONBOARDING_FORM_STATE_DEBOUNCE_MS,
  ONBOARDING_PROMPT_SESSION_KEY,
  ONBOARDING_FORM_STATE_KEY,
  RECENT_REPOS_KEY,
  REMOTE_SETUPS_KEY,
  applyDebouncedOnboardingFormStateSaga,
  hydrateWorkspaceInitializerSaga,
  persistBranchByRepoSaga,
  persistCompactFormStateSaga,
  persistDefaultParentPathSaga,
  persistLastSelectedRepoSaga,
  persistLastSubmittedAgentSaga,
  persistOnboardingFormStateSaga,
  persistRecentReposSaga,
  persistRemoteSetupsSaga,
  removeOnboardingPromptSessionStorage,
  resetOnboardingPersistenceSaga,
  watchWorkspaceInitializerPersistenceSaga,
  workspaceInitializerSaga,
} from "./workspace-initializer-saga";

function expectSelect(iterator: Generator, selector: (state: any, ...args: any[]) => unknown) {
  expect(iterator.next().value).toEqual(sagaEffects.select(selector));
}

function expectSetJSON(iterator: Generator, value: unknown, key: string, persistedValue: unknown) {
  expect(iterator.next(value).value).toEqual(
    sagaEffects.call([safeLocalStorage, safeLocalStorage.setJSON], key, persistedValue),
  );
  expect(iterator.next()).toEqual({ value: undefined, done: true });
}

function expectRemoveItem(iterator: Generator, key: string) {
  iterator.next();
  expect(iterator.next(null).value).toEqual(
    sagaEffects.call([safeLocalStorage, safeLocalStorage.removeItem], key),
  );
  expect(iterator.next()).toEqual({ value: undefined, done: true });
}

describe("workspaceInitializerSaga", () => {
  it("forks hydration and persistence watchers", () => {
    const iterator = workspaceInitializerSaga();

    expect(iterator.next().value).toEqual(sagaEffects.fork(hydrateWorkspaceInitializerSaga));
    expect(iterator.next().value).toEqual(sagaEffects.fork(watchWorkspaceInitializerPersistenceSaga));
    expect(iterator.next()).toEqual({ value: undefined, done: true });
  });

  it("hydrates all persisted initializer keys", () => {
    const compact = { repoPath: "/repo" };
    const onboarding = { projectSelection: null, step: "project" as const };
    const repo = { path: "/repo", type: "local" as const };
    const remote = { id: "remote", name: "Remote", host: "h", port: 22, username: "u", workspacePath: "/repo" };
    const agent = { selectedModel: "auggie:default" };
    const iterator = hydrateWorkspaceInitializerSaga();

    expect(iterator.next().value).toEqual(
      sagaEffects.call([safeLocalStorage, safeLocalStorage.getJSON], COMPACT_FORM_STATE_KEY),
    );
    expect(iterator.next(compact).value).toEqual(
      sagaEffects.call([safeLocalStorage, safeLocalStorage.getJSON], ONBOARDING_FORM_STATE_KEY),
    );
    expect(iterator.next(onboarding).value).toEqual(
      sagaEffects.call([safeLocalStorage, safeLocalStorage.getJSON], LAST_SELECTED_REPO_KEY),
    );
    expect(iterator.next(repo).value).toEqual(
      sagaEffects.call([safeLocalStorage, safeLocalStorage.getJSON], BRANCH_BY_REPO_KEY),
    );
    expect(iterator.next({ "/repo": "dev", ignored: 42 }).value).toEqual(
      sagaEffects.call([safeLocalStorage, safeLocalStorage.getItem], DEFAULT_PARENT_PATH_KEY),
    );
    expect(iterator.next("~/Code").value).toEqual(
      sagaEffects.call([safeLocalStorage, safeLocalStorage.getJSON], RECENT_REPOS_KEY),
    );
    expect(iterator.next([{ path: "/repo", type: "local", name: "repo" }, "invalid"]).value).toEqual(
      sagaEffects.call([safeLocalStorage, safeLocalStorage.getJSON], REMOTE_SETUPS_KEY),
    );
    expect(iterator.next([remote, "invalid"]).value).toEqual(
      sagaEffects.call([safeLocalStorage, safeLocalStorage.getJSON], LAST_SUBMITTED_AGENT_KEY),
    );

    const putEffect = iterator.next(agent).value as any;
    expect(putEffect.type).toBe("PUT");
    expect(putEffect.payload.action.payload[0]).toMatchObject({
      compactFormState: compact,
      onboardingFormState: onboarding,
      lastSelectedRepo: repo,
      branchByRepo: { "/repo": "dev" },
      defaultParentPath: "~/Code",
      remoteSetups: [remote],
      lastSubmittedAgent: agent,
    });
    expect(iterator.next()).toEqual({ value: undefined, done: true });
  });

  it("falls back safely when persisted initializer storage reads fail", () => {
    const iterator = hydrateWorkspaceInitializerSaga();
    const readError = new Error("storage unavailable");

    expect(iterator.next().value).toEqual(
      sagaEffects.call([safeLocalStorage, safeLocalStorage.getJSON], COMPACT_FORM_STATE_KEY),
    );
    expect(iterator.throw(readError).value).toEqual(
      sagaEffects.call([safeLocalStorage, safeLocalStorage.getJSON], ONBOARDING_FORM_STATE_KEY),
    );
    expect(iterator.throw(readError).value).toEqual(
      sagaEffects.call([safeLocalStorage, safeLocalStorage.getJSON], LAST_SELECTED_REPO_KEY),
    );
    expect(iterator.throw(readError).value).toEqual(
      sagaEffects.call([safeLocalStorage, safeLocalStorage.getJSON], BRANCH_BY_REPO_KEY),
    );
    expect(iterator.throw(readError).value).toEqual(
      sagaEffects.call([safeLocalStorage, safeLocalStorage.getItem], DEFAULT_PARENT_PATH_KEY),
    );
    expect(iterator.throw(readError).value).toEqual(
      sagaEffects.call([safeLocalStorage, safeLocalStorage.getJSON], RECENT_REPOS_KEY),
    );
    expect(iterator.throw(readError).value).toEqual(
      sagaEffects.call([safeLocalStorage, safeLocalStorage.getJSON], REMOTE_SETUPS_KEY),
    );
    expect(iterator.throw(readError).value).toEqual(
      sagaEffects.call([safeLocalStorage, safeLocalStorage.getJSON], LAST_SUBMITTED_AGENT_KEY),
    );

    const putEffect = iterator.throw(readError).value as any;
    expect(putEffect.type).toBe("PUT");
    expect(putEffect.payload.action.payload[0]).toEqual({
      compactFormState: null,
      onboardingFormState: null,
      lastSelectedRepo: null,
      branchByRepo: undefined,
      defaultParentPath: undefined,
      recentRepos: undefined,
      remoteSetups: undefined,
      lastSubmittedAgent: null,
    });
    expect(iterator.next()).toEqual({ value: undefined, done: true });
  });

  it("persists compact form state through safe local storage", () => {
    const formState = { repoPath: "/repo" };
    const iterator = persistCompactFormStateSaga();

    expectSelect(iterator, selectCompactWorkspaceInitializerFormState.select);
    expectSetJSON(iterator, formState, COMPACT_FORM_STATE_KEY, formState);
  });

  it("removes compact form state when cleared", () => {
    expectRemoveItem(persistCompactFormStateSaga(), COMPACT_FORM_STATE_KEY);
  });

  it("persists onboarding form state and removes it when cleared", () => {
    const formState = { projectSelection: null, step: "project" };
    const iterator = persistOnboardingFormStateSaga();

    expectSelect(iterator, selectWorkspaceInitializerOnboardingFormState.select);
    expectSetJSON(iterator, formState, ONBOARDING_FORM_STATE_KEY, formState);
    expectRemoveItem(persistOnboardingFormStateSaga(), ONBOARDING_FORM_STATE_KEY);
  });

  it("debounces onboarding form state updates before applying them", () => {
    const formState = { projectSelection: null, step: "project" as const };
    const iterator = applyDebouncedOnboardingFormStateSaga(
      debounceWorkspaceInitializerOnboardingFormState(formState),
    );

    const raceEffect = iterator.next().value as any;
    expect(raceEffect.type).toBe("RACE");
    expect(Object.keys(raceEffect.payload)).toEqual(["debounced", "reset", "cancel"]);
    const debouncedEffect = raceEffect.payload.debounced.next().value as any;
    const resetEffect = raceEffect.payload.reset.next().value as any;
    const cancelEffect = raceEffect.payload.cancel.next().value as any;
    expect(debouncedEffect.type).toBe("CALL");
    expect(debouncedEffect.payload.args).toEqual([ONBOARDING_FORM_STATE_DEBOUNCE_MS]);
    expect(resetEffect.type).toBe("TAKE");
    expect(resetEffect.payload.pattern).toBe(resetOnboarding);
    expect(cancelEffect.type).toBe("TAKE");
    expect(cancelEffect.payload.pattern).toBe(cancelWorkspaceInitializerOnboardingFormStateDebounce);
    expect(iterator.next({ debounced: true }).value).toEqual(
      sagaEffects.put(setWorkspaceInitializerOnboardingFormState(formState)),
    );
    expect(iterator.next()).toEqual({ value: undefined, done: true });
  });

  it("drops pending debounced onboarding form state on reset or unmount cancellation", () => {
    const formState = { projectSelection: null, step: "project" as const };
    const resetIterator = applyDebouncedOnboardingFormStateSaga(
      debounceWorkspaceInitializerOnboardingFormState(formState),
    );
    const cancelIterator = applyDebouncedOnboardingFormStateSaga(
      debounceWorkspaceInitializerOnboardingFormState(formState),
    );

    resetIterator.next();
    expect(resetIterator.next({ reset: resetOnboarding() })).toEqual({ value: undefined, done: true });

    cancelIterator.next();
    const cancelResult = cancelIterator.next({
      cancel: cancelWorkspaceInitializerOnboardingFormStateDebounce(),
    });
    expect(cancelResult).toEqual({ value: undefined, done: true });
  });

  it("persists last selected repo and removes it when cleared", () => {
    const repo = { path: "/repo", type: "local" };
    const iterator = persistLastSelectedRepoSaga();

    expectSelect(iterator, selectWorkspaceInitializerLastSelectedRepo.select);
    expectSetJSON(iterator, repo, LAST_SELECTED_REPO_KEY, repo);
    expectRemoveItem(persistLastSelectedRepoSaga(), LAST_SELECTED_REPO_KEY);
  });

  it("persists branch map after branch updates", () => {
    const iterator = persistBranchByRepoSaga();

    expectSelect(iterator, selectWorkspaceInitializerBranchByRepo.select);
    expectSetJSON(iterator, { "/repo": "main" }, BRANCH_BY_REPO_KEY, { "/repo": "main" });
  });

  it("persists default parent path", () => {
    const iterator = persistDefaultParentPathSaga();

    expectSelect(iterator, selectWorkspaceInitializerDefaultParentPath.select);
    expect(iterator.next("~/Code").value).toEqual(
      sagaEffects.call([safeLocalStorage, safeLocalStorage.setItem], DEFAULT_PARENT_PATH_KEY, "~/Code"),
    );
    expect(iterator.next()).toEqual({ value: undefined, done: true });
  });

  it("persists recent repos", () => {
    const recentRepos = [{ path: "/repo", type: "local", name: "repo" }];
    const iterator = persistRecentReposSaga();

    expectSelect(iterator, selectWorkspaceInitializerRecentRepos.select);
    expectSetJSON(iterator, recentRepos, RECENT_REPOS_KEY, recentRepos);
  });

  it("persists remote setups", () => {
    const remoteSetups = [{ id: "remote", name: "Remote", host: "h", port: 22, username: "u", workspacePath: "/repo" }];
    const iterator = persistRemoteSetupsSaga();

    expectSelect(iterator, selectWorkspaceInitializerRemoteSetups.select);
    expectSetJSON(iterator, remoteSetups, REMOTE_SETUPS_KEY, remoteSetups);
  });

  it("persists last submitted agent settings and removes them when cleared", () => {
    const settings = { selectedSpecialist: null, selectedModel: "auggie:default" };
    const iterator = persistLastSubmittedAgentSaga();

    expectSelect(iterator, selectWorkspaceInitializerLastSubmittedAgent.select);
    expectSetJSON(iterator, settings, LAST_SUBMITTED_AGENT_KEY, settings);
    expectRemoveItem(persistLastSubmittedAgentSaga(), LAST_SUBMITTED_AGENT_KEY);
  });

  it("clears onboarding persistence when onboarding is reset", () => {
    const iterator = resetOnboardingPersistenceSaga();

    expect(iterator.next().value).toEqual(
      sagaEffects.put(setWorkspaceInitializerOnboardingFormState(null)),
    );
    expect(iterator.next().value).toEqual(sagaEffects.call(removeOnboardingPromptSessionStorage));
    expect(iterator.next()).toEqual({ value: undefined, done: true });
  });

  it("removes the onboarding prompt session handoff", () => {
    const removeItem = vi.fn();
    vi.stubGlobal("sessionStorage", { removeItem });

    removeOnboardingPromptSessionStorage();

    expect(removeItem).toHaveBeenCalledWith(ONBOARDING_PROMPT_SESSION_KEY);
    vi.unstubAllGlobals();
  });

  it("registers persistence watchers", () => {
    const iterator = watchWorkspaceInitializerPersistenceSaga();
    const expectedWatchers = [
      [setCompactWorkspaceInitializerFormState, persistCompactFormStateSaga],
      [debounceWorkspaceInitializerOnboardingFormState, applyDebouncedOnboardingFormStateSaga],
      [setWorkspaceInitializerOnboardingFormState, persistOnboardingFormStateSaga],
      [setWorkspaceInitializerLastSelectedRepo, persistLastSelectedRepoSaga],
      [setWorkspaceInitializerBranchForRepo, persistBranchByRepoSaga],
      [setWorkspaceInitializerDefaultParentPath, persistDefaultParentPathSaga],
      [setWorkspaceInitializerRecentRepos, persistRecentReposSaga],
      [setWorkspaceInitializerRemoteSetups, persistRemoteSetupsSaga],
      [upsertWorkspaceInitializerRemoteSetup, persistRemoteSetupsSaga],
      [removeWorkspaceInitializerRemoteSetup, persistRemoteSetupsSaga],
      [setWorkspaceInitializerLastSubmittedAgent, persistLastSubmittedAgentSaga],
      [resetOnboarding, resetOnboardingPersistenceSaga],
    ];

    for (const expectedWatcher of expectedWatchers) {
      const effect = iterator.next().value as any;
      expect(effect.type).toBe("FORK");
      expect(effect.payload.args).toEqual(expectedWatcher);
    }

    expect(iterator.next()).toEqual({ value: undefined, done: true });
  });
});