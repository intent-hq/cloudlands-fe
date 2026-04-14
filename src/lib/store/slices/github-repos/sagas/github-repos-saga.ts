/**
 * github-repos saga — loads the authenticated user's GitHub repositories via
 * the github-auth IPC channel and reacts to auth state changes so the cache
 * stays in sync automatically.
 *
 * Flow:
 *   1. Component (or any code) dispatches `loadGithubRepos`.
 *   2. Saga flips the slice into loading, calls the IPC channel, and either
 *      stores the normalized list or surfaces an error.
 *   3. Any GitHub auth transition (sign-in or sign-out) re-triggers a load
 *      or clears the cache via a selector channel on
 *      `selectGitHubAuthIsAuthenticated`.
 */
import { invoke } from "$lib/electron-bridge";
import { GITHUB_AUTH_CHANNELS } from "$features/github-auth/constants";
import type { GithubRepo } from "$shared/augment-api/augment-api.client";
import { call, put, select, takeLatest, type SagaGenerator } from "typed-redux-saga";
import { takeLatestFromSelector } from "../../../utils/selector-channel-effects";
import { selectGitHubAuthIsAuthenticated } from "../../github-auth/github-auth-selectors";
import {
  clearGithubRepos,
  loadGithubRepos,
  setGithubRepos,
  setGithubReposError,
  setGithubReposLoading,
  type GithubRepoItem,
} from "../github-repos-slice";

type ListReposResponse = {
  success: boolean;
  data?: GithubRepo[];
  error?: string;
};

/** Normalize an augment-api `GithubRepo` into the Collection-friendly shape. */
function normalizeRepo(repo: GithubRepo): GithubRepoItem {
  return {
    id: `${repo.owner}/${repo.name}`,
    owner: repo.owner,
    name: repo.name,
    defaultBranch: repo.default_branch,
  };
}

export function* loadGithubReposSaga(): SagaGenerator<void> {
  const isAuthenticated = yield* select(selectGitHubAuthIsAuthenticated.select);
  if (!isAuthenticated) {
    yield* put(clearGithubRepos());
    return;
  }

  yield* put(setGithubReposLoading());
  try {
    const result = yield* call(
      invoke<ListReposResponse>,
      GITHUB_AUTH_CHANNELS.LIST_REPOS,
      { page: undefined },
    );

    if (result?.success && Array.isArray(result.data)) {
      const isStillAuthenticated = yield* select(selectGitHubAuthIsAuthenticated.select);
      if (!isStillAuthenticated) {
        yield* put(clearGithubRepos());
        return;
      }

      yield* put(setGithubRepos(result.data.map(normalizeRepo)));
      return;
    }

    const message = result?.error ?? "Failed to load repositories";
    yield* put(setGithubReposError(message));
  } catch (error) {
    const message =
      (error as Error)?.message ?? "Failed to load repositories";
    yield* put(setGithubReposError(message));
  }
}

/**
 * React to GitHub auth changes: auto-load on sign-in, clear on sign-out.
 * `takeLatestFromSelector` fires once on subscription with the current value,
 * so the very first authenticated state the saga sees will also trigger a
 * load — no need for an explicit bootstrap dispatch from components.
 */
function* handleAuthChange({
  payload,
}: {
  payload: boolean;
}): SagaGenerator<void> {
  if (payload) {
    yield* put(loadGithubRepos());
  } else {
    yield* put(clearGithubRepos());
  }
}

export function* githubReposSaga(): SagaGenerator<void> {
  yield* takeLatest(loadGithubRepos, loadGithubReposSaga);
  yield* takeLatestFromSelector(
    selectGitHubAuthIsAuthenticated,
    handleAuthChange,
  );
}
