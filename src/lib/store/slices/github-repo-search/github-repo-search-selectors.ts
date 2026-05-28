import { createSelector } from "../../utils/create-selector";
import {
  getItems,
  type Collection,
} from "../../utils/collection-utils";
import type { GithubRepoItem } from "../github-repos/github-repos-slice";

export const selectGithubRepoSearchCollection = createSelector(
  (state): Collection<GithubRepoItem, "id"> => state.githubRepoSearch.results,
);

/** Ordered list view of the search result collection. */
export const selectGithubRepoSearchResults = createSelector(
  (state): GithubRepoItem[] =>
    getItems(selectGithubRepoSearchCollection.select(state)),
);

export const selectGithubRepoSearchLoading = createSelector(
  (state): boolean => state.githubRepoSearch.loading,
);

export const selectGithubRepoSearchError = createSelector(
  (state): string | null => state.githubRepoSearch.error,
);

export const selectGithubRepoSearchLastQuery = createSelector(
  (state): string => state.githubRepoSearch.lastQuery,
);

/**
 * True when the slice is showing results for a non-empty, completed search.
 * UI can use this to decide whether to render the "Discover on GitHub"
 * section at all (skip it on an idle, never-searched state).
 */
export const selectGithubRepoSearchHasQuery = createSelector(
  (state): boolean => state.githubRepoSearch.lastQuery.trim().length > 0,
);
