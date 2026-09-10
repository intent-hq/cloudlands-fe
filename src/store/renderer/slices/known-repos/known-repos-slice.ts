import type { KnownRepo } from '$shared/types/known-repo';
import type { LocalRepoOption } from '$features/onboarding/utils/local-repo-options';
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
  discovery: {
    backendId: string | null;
    status: 'idle' | 'loading' | 'complete' | 'error';
    repos: Collection<LocalRepoOption, 'path'>;
  };
};

export const initialState: KnownReposState = {
  repos: createCollection<KnownRepo, 'path'>('path'),
  loaded: false,
  discovery: {
    backendId: null,
    status: 'idle',
    repos: createCollection<LocalRepoOption, 'path'>('path'),
  },
};

export const loadKnownRepos = createAction('knownRepos/loadKnownRepos');

export const setRepos = createAction<[repos: KnownRepo[]]>('knownRepos/setRepos');

export const removeRepo = createAction<[repoPath: string]>('knownRepos/removeRepo');

export const onboardingPickerOpened = createAction<[local: boolean]>(
  'knownRepos/onboardingPickerOpened',
);
export const onboardingPickerClosed = createAction('knownRepos/onboardingPickerClosed');
export const discoverLocalReposRequested = createAction('knownRepos/discoverLocalReposRequested');
export const resetLocalRepoDiscovery = createAction('knownRepos/resetLocalRepoDiscovery');
export const localRepoDiscoveryStarted = createAction<[backendId: string]>(
  'knownRepos/localRepoDiscoveryStarted',
);
export const localRepoDiscoverySucceeded = createAction<
  [backendId: string, repos: LocalRepoOption[]]
>('knownRepos/localRepoDiscoverySucceeded');
export const localRepoDiscoveryFailed = createAction<[backendId: string]>(
  'knownRepos/localRepoDiscoveryFailed',
);

export const knownReposReducer = createReducer<KnownReposState>(initialState);
knownReposReducer.with(resetLocalRepoDiscovery, (state) => ({
  ...state,
  discovery: initialState.discovery,
}));
knownReposReducer.with(localRepoDiscoveryStarted, (state, { payload: [backendId] }) => ({
  ...state,
  discovery: { ...initialState.discovery, backendId, status: 'loading' },
}));
knownReposReducer.with(localRepoDiscoverySucceeded, (state, { payload: [backendId, repos] }) => {
  if (state.discovery.backendId !== backendId || state.discovery.status !== 'loading') return state;
  return {
    ...state,
    discovery: {
      backendId,
      status: 'complete',
      repos: createCollection<LocalRepoOption, 'path'>('path', repos),
    },
  };
});
knownReposReducer.with(localRepoDiscoveryFailed, (state, { payload: [backendId] }) => {
  if (state.discovery.backendId !== backendId || state.discovery.status !== 'loading') return state;
  return { ...state, discovery: { ...state.discovery, status: 'error' } };
});
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
