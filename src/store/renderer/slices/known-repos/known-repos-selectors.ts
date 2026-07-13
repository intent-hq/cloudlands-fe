import { store } from "../../store";
import type { KnownRepo } from "$shared/types/known-repo";
import {
  getItems,
  type Collection,
} from "@augmentcode/ag-redux-toolkit/utils/collections/collection-utils";

export const selectKnownReposCollection = store.createSelector(
  (state): Collection<KnownRepo, "path"> => {
    return state.knownRepos.repos;
  }
);

export const selectKnownRepos = store.createSelector((state) => {
  return getItems(selectKnownReposCollection.select(state));
});

export const selectKnownReposLoaded = store.createSelector((state) => {
  return state.knownRepos.loaded;
});