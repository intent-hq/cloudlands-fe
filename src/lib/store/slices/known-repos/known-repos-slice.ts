import type { KnownRepo } from "$shared/types/known-repo";
import { createAction } from "../../utils/create-action";
import { createReducer } from "../../utils/create-reducer";
import {
  createCollection,
  removeItem,
  type Collection,
} from "../../utils/collection-utils";

export type KnownReposState = {
  repos: Collection<KnownRepo, "path">;
  loaded: boolean;
};

export const initialState: KnownReposState = {
  repos: createCollection<KnownRepo, "path">("path"),
  loaded: false,
};

export const loadKnownRepos = createAction("knownRepos/loadKnownRepos");

export const setRepos = createAction<[repos: KnownRepo[]]>(
  "knownRepos/setRepos"
);

export const removeKnownRepo = createAction<[repoPath: string]>(
  "knownRepos/removeKnownRepo"
);

export const removeRepo = createAction<[repoPath: string]>(
  "knownRepos/removeRepo"
);

export const knownReposReducer = createReducer<KnownReposState>(initialState)
  .with(setRepos, (state, { payload: [repos] }) => ({
    ...state,
    repos: createCollection<KnownRepo, "path">("path", repos),
    loaded: true,
  }))
  .with(removeRepo, (state, { payload: [repoPath] }) => {
    const repos = removeItem(state.repos, repoPath);
    if (repos === state.repos) {
      return state;
    }

    return {
      ...state,
      repos,
    };
  });