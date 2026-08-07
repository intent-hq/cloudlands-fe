/**
 * github-repo-search service — restores the global GitHub repo search side
 * effect that the removed `github-repo-search/sagas/github-repo-search-saga`
 * performed. With no saga listening, `searchGithubRepos` dispatched from the
 * onboarding GitHubRepoTab (and any other call site) has NO EFFECT — the
 * search slice never leaves its initial state.
 *
 * This middleware reconnects the path WITHOUT re-adding a saga and WITHOUT
 * changing any call site:
 *   1. `searchGithubRepos(query)` is dispatched on every keystroke.
 *   2. The query is trimmed; anything shorter than `MIN_QUERY_LENGTH`
 *      (including the empty string) cancels the pending timer and dispatches
 *      `clearGithubRepoSearch`.
 *   3. Otherwise a 300ms debounce coalesces rapid keystrokes into a single
 *      round-trip — each new action resets the timer, so the latest query wins.
 *   4. The fetch flips the slice into `loading` for that query, calls
 *      `githubAuthClient.searchRepos`, and stores the mapped results or error.
 *   5. Responses for a query that is no longer the current one are dropped so
 *      a slow in-flight search can never clobber newer results.
 *
 * Dependency-light per src/store/renderer AGENTS.md: imports only the
 * github-auth IPC client, slice actions, and the configured store — no
 * selectors (importing them would evaluate `store.createSelector` while the
 * store module is still mid-init through the middleware chain).
 */
import type { StoreMiddleware } from "$lib/store-shim/types";
import { githubAuthClient } from "$features/github-auth/renderer/github-auth.client";
import type { GithubRepo } from "$features/github-auth/types";
import { store as appStore } from "$store/renderer/store";
import {
  clearGithubRepoSearch,
  searchGithubRepos,
  setGithubRepoSearchError,
  setGithubRepoSearchLoading,
  setGithubRepoSearchResults,
} from "../slices/github-repo-search/github-repo-search-slice";
import type { GithubRepoItem } from "../slices/github-repos/github-repos-slice";

/** Debounce window for the global search. Matches standard "search-as-you-type" UX. */
export const SEARCH_DEBOUNCE_MS = 300;

/** Minimum query length before we hit the API. One-letter searches are noise. */
export const MIN_QUERY_LENGTH = 2;

/** Pending debounce timer; a newer dispatch always replaces the older one. */
let debounceTimer: ReturnType<typeof setTimeout> | null = null;

/**
 * The most recent query the middleware committed to searching. Responses whose
 * query no longer matches this are stale and must not reach the slice.
 */
let currentQuery: string | null = null;

function cancelPending(): void {
  if (debounceTimer !== null) {
    clearTimeout(debounceTimer);
    debounceTimer = null;
  }
}

/** Normalize a github-auth `GithubRepo` into the Collection-friendly shape. */
function normalizeRepo(repo: GithubRepo): GithubRepoItem {
  return {
    id: `${repo.owner}/${repo.name}`,
    owner: repo.owner,
    name: repo.name,
    defaultBranch: repo.default_branch,
  };
}

/** Run the search for `query`, dropping the response if a newer query superseded it. */
async function runSearch(query: string): Promise<void> {
  appStore.dispatch(setGithubRepoSearchLoading(query));
  try {
    const repos = await githubAuthClient.searchRepos(query);
    if (currentQuery !== query) return;
    appStore.dispatch(setGithubRepoSearchResults(query, repos.map(normalizeRepo)));
  } catch (error) {
    if (currentQuery !== query) return;
    appStore.dispatch(
      setGithubRepoSearchError(query, error instanceof Error ? error.message : String(error)),
    );
  }
}

/** First array-payload element coerced to a query string. */
function queryOf(action: { payload?: unknown }): string {
  return Array.isArray(action.payload) && typeof action.payload[0] === "string"
    ? action.payload[0]
    : "";
}

function handleSearch(query: string): void {
  const trimmed = query.trim();
  cancelPending();

  if (trimmed.length < MIN_QUERY_LENGTH) {
    currentQuery = null;
    // Only clear when there is something to clear, so an empty input does not
    // churn the slice on every keystroke.
    const search = appStore.state.githubRepoSearch;
    if (search.lastQuery !== "" || search.loading || search.error !== null) {
      appStore.dispatch(clearGithubRepoSearch());
    }
    return;
  }

  currentQuery = trimmed;
  debounceTimer = setTimeout(() => {
    debounceTimer = null;
    void runSearch(trimmed);
  }, SEARCH_DEBOUNCE_MS);
}

/**
 * Middleware giving the (post-saga) `searchGithubRepos` trigger a real handler
 * again: after the action passes through the reducer, it debounces and kicks off
 * the search. Fire-and-forget — dispatch stays synchronous.
 */
export function createGithubRepoSearchMiddleware(): StoreMiddleware {
  return () => (next) => (action) => {
    const result = next(action);
    if (action?.type === searchGithubRepos.type) {
      handleSearch(queryOf(action));
    }
    return result;
  };
}
