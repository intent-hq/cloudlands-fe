/**
 * github-repo-search saga — debounces rapid `searchGithubRepos` dispatches,
 * hits the github-auth IPC search channel, and populates the search slice.
 *
 * Flow:
 *   1. Component dispatches `searchGithubRepos(query)` on every keystroke.
 *   2. `debounce(300, ...)` coalesces activity: only the final quiet-period
 *      action drives a network call. Any new action resets the timer.
 *   3. The handler trims the query, short-circuits empty or very short
 *      queries to a `clearGithubRepoSearch`, and otherwise flips the slice
 *      into `loading` before invoking the IPC channel.
 *   4. On success/failure, the normalized results or error are stored.
 */
import { invoke } from "$lib/electron-bridge";
import { GITHUB_AUTH_CHANNELS } from "$features/github-auth/constants";
import type { GithubRepo } from "$shared/augment-api/augment-api.client";
import {
  call,
  debounce,
  put,
  type SagaGenerator,
} from "typed-redux-saga";
import type { StoreAction } from "../../../types";
import type { GithubRepoItem } from "../../github-repos/github-repos-slice";
import {
  clearGithubRepoSearch,
  searchGithubRepos,
  setGithubRepoSearchError,
  setGithubRepoSearchLoading,
  setGithubRepoSearchResults,
} from "../github-repo-search-slice";

/** Debounce window for the global search. Matches standard "search-as-you-type" UX. */
export const SEARCH_DEBOUNCE_MS = 300;

/** Minimum query length before we hit the API. One-letter searches are noise. */
export const MIN_QUERY_LENGTH = 2;

type SearchReposResponse = {
  success: boolean;
  data?: GithubRepo[];
  error?: string;
};

function normalizeRepo(repo: GithubRepo): GithubRepoItem {
  return {
    id: `${repo.owner}/${repo.name}`,
    owner: repo.owner,
    name: repo.name,
    defaultBranch: repo.default_branch,
  };
}

export function* handleSearchGithubRepos(
  action: StoreAction<[query: string]>,
): SagaGenerator<void> {
  const [query] = action.payload;
  const trimmed = query.trim();

  if (trimmed.length < MIN_QUERY_LENGTH) {
    yield* put(clearGithubRepoSearch());
    return;
  }

  yield* put(setGithubRepoSearchLoading(trimmed));

  try {
    const result = yield* call(
      invoke<SearchReposResponse>,
      GITHUB_AUTH_CHANNELS.SEARCH_REPOS,
      { query: trimmed },
    );

    if (result?.success && Array.isArray(result.data)) {
      yield* put(
        setGithubRepoSearchResults(trimmed, result.data.map(normalizeRepo)),
      );
      return;
    }

    const message = result?.error ?? "Search failed";
    yield* put(setGithubRepoSearchError(trimmed, message));
  } catch (error) {
    const message = (error as Error)?.message ?? "Search failed";
    yield* put(setGithubRepoSearchError(trimmed, message));
  }
}

export function* githubRepoSearchSaga(): SagaGenerator<void> {
  yield* debounce(
    SEARCH_DEBOUNCE_MS,
    searchGithubRepos.type,
    handleSearchGithubRepos,
  );
}
