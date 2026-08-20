import type { KnownRepo } from '$shared/types/known-repo';
import { createAction } from '@augmentcode/themis/utils/store/create-action';
import { createReducer } from '@augmentcode/themis/utils/store/create-reducer';
import {
  createCollection,
  removeItem,
  type Collection,
} from '@augmentcode/themis/utils/collections/collection-utils';

export type KnownReposState = {
  repos: Collection<KnownRepo, 'path'>;
  loaded: boolean;
};

export const initialState: KnownReposState = {
  repos: createCollection<KnownRepo, 'path'>('path'),
  loaded: false,
};

export const loadKnownRepos = createAction('knownRepos/loadKnownRepos');

export const setRepos = createAction<[repos: KnownRepo[]]>('knownRepos/setRepos');

export const removeRepo = createAction<[repoPath: string]>('knownRepos/removeRepo');

export const knownReposReducer = createReducer<KnownReposState>(initialState);
knownReposReducer.with(setRepos, (state, { payload: [repos] }) => ({
  ...state,
  repos: createCollection<KnownRepo, 'path'>('path', repos),
  loaded: true,
}));
knownReposReducer.with(removeRepo, (state, { payload: [repoPath] }) => {
  const repos = removeItem(state.repos, repoPath);
  if (repos === state.repos) {
    return state;
  }

  return {
    ...state,
    repos,
  };
});
