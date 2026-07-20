import { store } from "../../store";
import {
  getItems,
  type Collection,
} from "$lib/store-shim/utils/collections/collection-utils";
import type { GithubRepoItem } from "../github-repos/github-repos-slice";

const selectGithubRepoSearchCollection = store.createSelector(
  (state): Collection<GithubRepoItem, "id"> => state.githubRepoSearch.results,
);

/** Ordered list view of the search result collection. */
export const selectGithubRepoSearchResults = store.createSelector(
  (state): GithubRepoItem[] =>
    getItems(selectGithubRepoSearchCollection.select(state)),
);

export const selectGithubRepoSearchLoading = store.createSelector(
  (state): boolean => state.githubRepoSearch.loading,
);

export const selectGithubRepoSearchLastQuery = store.createSelector(
  (state): string => state.githubRepoSearch.lastQuery,
);
