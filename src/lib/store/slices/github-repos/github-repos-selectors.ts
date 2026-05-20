import { createSelector } from "../../utils/create-selector";
import {
  getItems,
  type Collection,
} from "svelte-redux-toolkit/utils/collections/collection-utils";
import type { GithubRepoItem } from "./github-repos-slice";

export const selectGithubReposCollection = createSelector(
  (state): Collection<GithubRepoItem, "id"> => state.githubRepos.repos,
);

/** Ordered list view of the repo collection. */
export const selectGithubRepos = createSelector((state): GithubRepoItem[] => {
  return getItems(selectGithubReposCollection.select(state));
});

export const selectGithubReposLoading = createSelector(
  (state): boolean => state.githubRepos.loading,
);

export const selectGithubReposError = createSelector(
  (state): string | null => state.githubRepos.error,
);

export const selectGithubReposLoaded = createSelector(
  (state): boolean => state.githubRepos.loaded,
);

/**
 * Case-insensitive client-side filter over the cached repo list. Matches the
 * full `owner/name` string so typing an org prefix or a repo substring both
 * work. An empty query returns the full list unchanged so the selector is
 * safe to use as a single source of truth for the displayed rows.
 */
export const selectFilteredGithubRepos = createSelector(
  (state, query: string): GithubRepoItem[] => {
    const all = selectGithubRepos.select(state);
    const q = query.trim().toLowerCase();
    if (!q) return all;
    return all.filter((r) => `${r.owner}/${r.name}`.toLowerCase().includes(q));
  },
);
