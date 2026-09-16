import { createCollection, getItems } from '@augmentcode/themis/utils/collections/collection-utils';
import { createAction } from '@augmentcode/themis/utils/store/create-action';
import { createReducer } from '@augmentcode/themis/utils/store/create-reducer';
import type {
  IssueSuggestion,
  IssueSuggestionRequest,
  IssueSuggestionSource,
  IssueSuggestionsState,
  ContextSource,
} from './issue-suggestions-types';

export const emptyIssueSuggestionsState: IssueSuggestionsState = {
  byRequestKey: {},
  lastUsedContextSource: null,
};

export function issueSuggestionRequestKey(
  source: IssueSuggestionSource,
  request: IssueSuggestionRequest,
): string {
  const repos = request.repos?.map(({ owner, repo }) => `${owner}/${repo}`) ?? [];
  if (source === 'github-issues') {
    return JSON.stringify([
      source,
      request.owner ?? '',
      request.repo ?? '',
      repos,
      request.query ?? '',
    ]);
  }
  if (source === 'github-prs') {
    return JSON.stringify([
      source,
      request.owner ?? '',
      request.repo ?? '',
      repos,
      request.filter ?? 'all',
      request.query ?? '',
    ]);
  }
  if (source === 'github-related-repos') {
    return JSON.stringify([source, request.owner ?? '', request.repo ?? '']);
  }
  if (source === 'github-pr-detail') {
    return JSON.stringify([
      source,
      request.owner ?? '',
      request.repo ?? '',
      request.number ?? null,
    ]);
  }
  return source;
}

export const loadIssueSuggestionsRequested = createAction<
  [source: IssueSuggestionSource, request: IssueSuggestionRequest, append?: boolean]
>('issueSuggestions/loadRequested');
export const issueSuggestionsLoaded =
  createAction<
    [requestKey: string, items: IssueSuggestion[], nextToken: string | null, append: boolean]
  >('issueSuggestions/loaded');
export const issueSuggestionsFailed =
  createAction<[requestKey: string, error: string]>('issueSuggestions/failed');
export const contextSourcePreferenceHydrated = createAction<[source: ContextSource | null]>(
  'issueSuggestions/contextSourcePreferenceHydrated',
);
export const setContextSourcePreference = createAction<[source: ContextSource]>(
  'issueSuggestions/setContextSourcePreference',
);

const emptyPage = () => ({
  items: createCollection<IssueSuggestion, 'id'>('id'),
  nextToken: null,
  isFetching: false,
  isLoadingMore: false,
  error: null,
  version: 0,
});

export const issueSuggestionsReducer = createReducer<IssueSuggestionsState>(
  emptyIssueSuggestionsState,
);
issueSuggestionsReducer.with(
  loadIssueSuggestionsRequested,
  (state, { payload: [source, request, append = false] }) => {
    const requestKey = issueSuggestionRequestKey(source, request);
    const current = state.byRequestKey[requestKey] ?? emptyPage();
    return {
      ...state,
      byRequestKey: {
        ...state.byRequestKey,
        [requestKey]: {
          ...current,
          isFetching: !append,
          isLoadingMore: append,
          error: null,
        },
      },
    };
  },
);
issueSuggestionsReducer.with(contextSourcePreferenceHydrated, (state, { payload: [source] }) =>
  state.lastUsedContextSource === source ? state : { ...state, lastUsedContextSource: source },
);
issueSuggestionsReducer.with(setContextSourcePreference, (state, { payload: [source] }) =>
  state.lastUsedContextSource === source ? state : { ...state, lastUsedContextSource: source },
);
issueSuggestionsReducer.with(
  issueSuggestionsLoaded,
  (state, { payload: [requestKey, items, nextToken, append] }) => {
    const current = state.byRequestKey[requestKey] ?? emptyPage();
    const combined = append ? [...getItems(current.items), ...items] : items;
    return {
      ...state,
      byRequestKey: {
        ...state.byRequestKey,
        [requestKey]: {
          items: createCollection<IssueSuggestion, 'id'>('id', combined),
          nextToken,
          isFetching: false,
          isLoadingMore: false,
          error: null,
          version: current.version + 1,
        },
      },
    };
  },
);
issueSuggestionsReducer.with(issueSuggestionsFailed, (state, { payload: [requestKey, error] }) => {
  const current = state.byRequestKey[requestKey] ?? emptyPage();
  return {
    ...state,
    byRequestKey: {
      ...state.byRequestKey,
      [requestKey]: {
        ...current,
        nextToken: null,
        isFetching: false,
        isLoadingMore: false,
        error,
        version: current.version + 1,
      },
    },
  };
});
