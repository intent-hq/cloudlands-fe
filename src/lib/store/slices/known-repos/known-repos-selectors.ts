import type { KnownRepo } from "$shared/types/known-repo";
import { createSelector } from "../../utils/create-selector";
import { getItems, type Collection } from "../../utils/collection-utils";

export const selectKnownReposCollection = createSelector(
  (state): Collection<KnownRepo, "path"> => {
    return state.knownRepos.repos;
  }
);

export const selectKnownRepos = createSelector((state) => {
  return getItems(selectKnownReposCollection.select(state));
});

export const selectKnownReposLoaded = createSelector((state) => {
  return state.knownRepos.loaded;
});