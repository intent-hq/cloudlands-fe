import { store } from '../../store';
import { getItems, type Collection } from '@augmentcode/themis/utils/collections/collection-utils';
import type { GithubUserSearchItem } from './github-user-search-slice';

const selectGithubUserSearchCollection = store.createSelector(
  (state): Collection<GithubUserSearchItem, 'login'> => state.githubUserSearch.results,
);

/** Ordered list view of the search result collection. */
export const selectGithubUserSearchResults = store.createSelector((state): GithubUserSearchItem[] =>
  getItems(selectGithubUserSearchCollection.select(state)),
);

export const selectGithubUserSearchLoading = store.createSelector(
  (state): boolean => state.githubUserSearch.loading,
);

export const selectGithubUserSearchError = store.createSelector(
  (state): string | null => state.githubUserSearch.error,
);

export const selectGithubUserSearchLastQuery = store.createSelector(
  (state): string => state.githubUserSearch.lastQuery,
);
