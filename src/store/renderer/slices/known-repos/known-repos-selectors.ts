import { store } from '../../store';
import { selectPrincipalConnectionContext } from '../principal/principal-selectors';
import type { KnownRepo } from '$shared/types/known-repo';
import { getItems, type Collection } from '@themislib/themis/utils/collections/collection-utils';

export const selectKnownReposCollection = store.createSelector(
  (state): Collection<KnownRepo, 'path'> => {
    return state.knownRepos.repos;
  },
);

export const selectKnownRepos = store.createSelector((state) => {
  return getItems(selectKnownReposCollection.select(state));
});

export const selectKnownReposLoaded = store.createSelector((state) => {
  return state.knownRepos.loaded;
});

export const selectLocalRepoDiscoveryStatus = store.createSelector(
  (state) => state.knownRepos.discovery.status,
);
export const selectDiscoveredLocalRepos = store.createSelector((state) =>
  getItems(state.knownRepos.discovery.repos),
);

/** Wait for the host owner's reset before starting reads for a new connection. */
export const selectLocalRepoDiscoveryConnection = store.createSelector((state) => {
  const connection = selectPrincipalConnectionContext.select(state);
  return state.hostExecution.connection === connection ? connection : null;
});
