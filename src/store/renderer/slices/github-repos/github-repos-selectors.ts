import { store } from "../../store";
import {
  getItems,
  type Collection,
} from "@augmentcode/ag-redux-toolkit/utils/collections/collection-utils";
import type { GithubRepoItem } from "./github-repos-slice";

const selectGithubReposCollection = store.createSelector(
  (state): Collection<GithubRepoItem, "id"> => state.githubRepos.repos,
);

/** Ordered list view of the repo collection. */
export const selectGithubRepos = store.createSelector((state): GithubRepoItem[] => {
  return getItems(selectGithubReposCollection.select(state));
});

export const selectGithubReposLoading = store.createSelector(
  (state): boolean => state.githubRepos.loading,
);

export const selectGithubReposError = store.createSelector(
  (state): string | null => state.githubRepos.error,
);

export const selectGithubReposLoaded = store.createSelector(
  (state): boolean => state.githubRepos.loaded,
);
