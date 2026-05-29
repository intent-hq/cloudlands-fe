/**
 * github-repo-search slice — caches the results of a debounced, global
 * GitHub repository search (`/search/repositories`).
 *
 * The `searchGithubRepos` trigger action is dispatched on every keystroke
 * by components; the saga debounces and calls the IPC search endpoint,
 * then dispatches `setGithubRepoSearchResults`. Components read a single
 * list of results plus loading/error flags and render them as "discover"
 * suggestions alongside the user's own repositories.
 *
 * `lastQuery` records the query that produced the current results so the
 * UI can show stale/mismatched data defensively (e.g. clear results the
 * moment the input diverges from `lastQuery`).
 */
import { createAction } from "svelte-redux-toolkit/utils/store/create-action";
import { createReducer } from "svelte-redux-toolkit/utils/store/create-reducer";
import {
  createCollection,
  type Collection,
} from "svelte-redux-toolkit/utils/collections/collection-utils";
import type { GithubRepoItem } from "../github-repos/github-repos-slice";

export type GithubRepoSearchState = {
  results: Collection<GithubRepoItem, "id">;
  loading: boolean;
  error: string | null;
  /** Trimmed query that produced `results`. Empty string when idle. */
  lastQuery: string;
};

export const initialState: GithubRepoSearchState = {
  results: createCollection<GithubRepoItem, "id">("id"),
  loading: false,
  error: null,
  lastQuery: "",
};

/**
 * Trigger: kick off a global repo search for the given query. Handled by
 * the saga via a debounce effect so rapid keystrokes coalesce into a
 * single network round-trip.
 */
export const searchGithubRepos = createAction<[query: string]>(
  "githubRepoSearch/search",
);

/** Saga → reducer: flip loading and record the query being searched. */
export const setGithubRepoSearchLoading = createAction<[query: string]>(
  "githubRepoSearch/setLoading",
);

/** Saga → reducer: store results for the given query. */
export const setGithubRepoSearchResults = createAction<
  [query: string, results: GithubRepoItem[]]
>("githubRepoSearch/setResults");

/** Saga → reducer: record an error for the given query. */
export const setGithubRepoSearchError = createAction<
  [query: string, error: string]
>("githubRepoSearch/setError");

/** Reset to the initial empty state (empty query, clear on sign-out, etc.). */
export const clearGithubRepoSearch = createAction(
  "githubRepoSearch/clear",
);

export const githubRepoSearchReducer = createReducer<GithubRepoSearchState>(
  initialState,
)
  .with(setGithubRepoSearchLoading, (state, { payload: [query] }) => ({
    ...state,
    loading: true,
    error: null,
    lastQuery: query,
  }))
  .with(
    setGithubRepoSearchResults,
    (state, { payload: [query, results] }) => ({
      ...state,
      results: createCollection<GithubRepoItem, "id">("id", results),
      loading: false,
      error: null,
      lastQuery: query,
    }),
  )
  .with(setGithubRepoSearchError, (state, { payload: [query, error] }) => ({
    ...state,
    results: createCollection<GithubRepoItem, "id">("id"),
    loading: false,
    error,
    lastQuery: query,
  }))
  .with(clearGithubRepoSearch, () => initialState);
