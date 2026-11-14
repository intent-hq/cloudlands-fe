import { hostExecutionConnectionChanged } from '../host-execution/host-execution-slice';
import type { KnownRepo } from '$shared/types/known-repo';
import { createAction } from '@themislib/themis/utils/store/create-action';
import { createReducer } from '@themislib/themis/utils/store/create-reducer';
import {
  createCollection,
  removeItem,
  type Collection,
} from '@themislib/themis/utils/collections/collection-utils';

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

/**
 * Removes a folder from the daemon's recent list; the row leaves at once. `hiddenKey`
 * names the Home sidebar entry hidden with it, restored if the daemon refuses.
 */
export const removeRecentRepository = createAction<[repoPath: string, hiddenKey?: string]>(
  'knownRepos/removeRecentRepository',
);

export const recentRepositoryRemovalFailed = createAction<[repoPath: string, hiddenKey?: string]>(
  'knownRepos/recentRepositoryRemovalFailed',
);

export const knownReposReducer = createReducer<KnownReposState>(initialState);
knownReposReducer.with(setRepos, (state, { payload: [repos] }) => ({
  ...state,
  repos: createCollection<KnownRepo, 'path'>('path', repos),
  loaded: true,
}));
const removeKnownRepo = (state: KnownReposState, repoPath: string): KnownReposState => {
  const repos = removeItem(state.repos, repoPath);
  if (repos === state.repos) {
    return state;
  }

  return {
    ...state,
    repos,
  };
};
knownReposReducer.with(removeRepo, (state, { payload: [repoPath] }) =>
  removeKnownRepo(state, repoPath),
);
knownReposReducer.with(removeRecentRepository, (state, { payload: [repoPath] }) =>
  removeKnownRepo(state, repoPath),
);

knownReposReducer.with(hostExecutionConnectionChanged, () => initialState);
