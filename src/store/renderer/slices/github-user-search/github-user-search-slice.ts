/**
 * github-user-search slice — caches the results of a debounced GitHub user
 * search (`github.users.search`, §5.27) for the Share dialog's pin typeahead.
 *
 * `searchGithubUsers` is dispatched on every keystroke; the saga debounces
 * and calls the IPC endpoint, then dispatches `setGithubUserSearchResults`.
 * Mirrors github-repo-search: `lastQuery` records the query that produced the
 * current results so the UI can drop stale rows the moment the input diverges.
 */
import { createAction } from '@augmentcode/themis/utils/store/create-action';
import { createReducer } from '@augmentcode/themis/utils/store/create-reducer';
import {
  createCollection,
  type Collection,
} from '@augmentcode/themis/utils/collections/collection-utils';

export type GithubUserSearchItem = {
  login: string;
  githubUserId: number;
  avatarUrl: string | null;
  htmlUrl: string | null;
};

export type GithubUserSearchState = {
  results: Collection<GithubUserSearchItem, 'login'>;
  loading: boolean;
  error: string | null;
  /** Trimmed query that produced `results`. Empty string when idle. */
  lastQuery: string;
};

export const initialState: GithubUserSearchState = {
  results: createCollection<GithubUserSearchItem, 'login'>('login'),
  loading: false,
  error: null,
  lastQuery: '',
};

/** Trigger: debounced by the saga so rapid keystrokes coalesce into one call. */
export const searchGithubUsers = createAction<[query: string]>('githubUserSearch/search');

/** Saga → reducer: flip loading and record the query being searched. */
export const setGithubUserSearchLoading = createAction<[query: string]>(
  'githubUserSearch/setLoading',
);

/** Saga → reducer: store results for the given query. */
export const setGithubUserSearchResults = createAction<
  [query: string, results: GithubUserSearchItem[]]
>('githubUserSearch/setResults');

/** Saga → reducer: record an error for the given query. */
export const setGithubUserSearchError = createAction<[query: string, error: string]>(
  'githubUserSearch/setError',
);

/** Reset to the initial empty state (short query, dialog close, link minted). */
export const clearGithubUserSearch = createAction('githubUserSearch/clear');

export const githubUserSearchReducer = createReducer<GithubUserSearchState>(initialState);

githubUserSearchReducer.with(setGithubUserSearchLoading, (state, { payload: [query] }) => ({
  ...state,
  loading: true,
  error: null,
  lastQuery: query,
}));
githubUserSearchReducer.with(
  setGithubUserSearchResults,
  (state, { payload: [query, results] }) => ({
    ...state,
    results: createCollection<GithubUserSearchItem, 'login'>('login', results),
    loading: false,
    error: null,
    lastQuery: query,
  }),
);
githubUserSearchReducer.with(setGithubUserSearchError, (state, { payload: [query, error] }) => ({
  ...state,
  results: createCollection<GithubUserSearchItem, 'login'>('login'),
  loading: false,
  error,
  lastQuery: query,
}));
githubUserSearchReducer.with(clearGithubUserSearch, () => initialState);
