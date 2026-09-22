import { createCollection, getItems } from '@augmentcode/themis/utils/collections/collection-utils';
import { describe, expect, it } from 'vitest';

import type { StoreState } from '../../types';
import { selectGitHubIssueSuggestions } from './issue-suggestions-selectors';
import {
  emptyIssueSuggestionsState,
  contextSourcePreferenceHydrated,
  issueSuggestionsFailed,
  issueSuggestionsLoaded,
  issueSuggestionsReducer,
  loadIssueSuggestionsRequested,
  issueSuggestionRequestKey,
  setContextSourcePreference,
} from './issue-suggestions-slice';
import type { GitHubIssueSuggestion, IssueSuggestionsState } from './issue-suggestions-types';

const ISSUE: GitHubIssueSuggestion = {
  id: 'issue-1',
  number: 17,
  title: 'Fix selector flow',
  url: 'https://github.test/acme/app/issues/17',
  state: 'open',
  owner: 'acme',
  repo: 'app',
};
const ISSUE_KEY = issueSuggestionRequestKey('github-issues', {
  owner: 'acme',
  repo: 'app',
});

function pageState(items = [ISSUE]): IssueSuggestionsState {
  return {
    byRequestKey: {
      [ISSUE_KEY]: {
        items: createCollection<GitHubIssueSuggestion, 'id'>('id', items),
        nextToken: 'next-page',
        isFetching: false,
        isLoadingMore: false,
        error: null,
        version: 2,
      },
    },
    lastUsedContextSource: null,
  };
}

describe('issueSuggestionsReducer', () => {
  it('starts first-page and append requests independently', () => {
    const first = issueSuggestionsReducer(
      emptyIssueSuggestionsState,
      loadIssueSuggestionsRequested('github-issues', { owner: 'acme', repo: 'app' }),
    );
    const append = issueSuggestionsReducer(
      pageState(),
      loadIssueSuggestionsRequested(
        'github-issues',
        { owner: 'acme', repo: 'app', nextToken: 'next-page' },
        true,
      ),
    );

    expect(first.byRequestKey[ISSUE_KEY]).toMatchObject({
      isFetching: true,
      isLoadingMore: false,
      version: 0,
    });
    expect(append.byRequestKey[ISSUE_KEY]).toMatchObject({
      isFetching: false,
      isLoadingMore: true,
      error: null,
    });
  });

  it('replaces a first page and appends a later page', () => {
    const replacement = { ...ISSUE, id: 'issue-2', number: 18 };
    const replaced = issueSuggestionsReducer(
      pageState(),
      issueSuggestionsLoaded(ISSUE_KEY, [replacement], null, false),
    );
    const appended = issueSuggestionsReducer(
      pageState(),
      issueSuggestionsLoaded(ISSUE_KEY, [replacement], null, true),
    );

    expect(getItems(replaced.byRequestKey[ISSUE_KEY].items)).toEqual([replacement]);
    expect(replaced.byRequestKey[ISSUE_KEY].version).toBe(3);
    expect(getItems(appended.byRequestKey[ISSUE_KEY].items)).toEqual([ISSUE, replacement]);
  });

  it('settles failures while preserving the last rendered items', () => {
    const failed = issueSuggestionsReducer(
      pageState(),
      issueSuggestionsFailed(ISSUE_KEY, 'rate limited'),
    );

    expect(getItems(failed.byRequestKey[ISSUE_KEY].items)).toEqual([ISSUE]);
    expect(failed.byRequestKey[ISSUE_KEY]).toMatchObject({
      nextToken: null,
      isFetching: false,
      isLoadingMore: false,
      error: 'rate limited',
      version: 3,
    });
  });

  it('stores hydrated and selected context-source preferences as canonical state', () => {
    const hydrated = issueSuggestionsReducer(
      emptyIssueSuggestionsState,
      contextSourcePreferenceHydrated('github-prs'),
    );
    const selected = issueSuggestionsReducer(hydrated, setContextSourcePreference('linear'));

    expect(hydrated.lastUsedContextSource).toBe('github-prs');
    expect(selected.lastUsedContextSource).toBe('linear');
    expect(issueSuggestionsReducer(selected, setContextSourcePreference('linear'))).toBe(selected);
  });
});

describe('issue suggestion selectors', () => {
  it('returns plain items and the request lifecycle state', () => {
    const state = { issueSuggestions: pageState() } as unknown as StoreState;

    expect(selectGitHubIssueSuggestions.select(state, 'acme', 'app', [], '')).toEqual({
      items: [ISSUE],
      nextToken: 'next-page',
      isFetching: false,
      isLoadingMore: false,
      error: null,
      version: 2,
    });
  });

  it('returns an idle empty view before the first request', () => {
    const state = {
      issueSuggestions: emptyIssueSuggestionsState,
    } as unknown as StoreState;

    expect(selectGitHubIssueSuggestions.select(state, 'acme', 'other', [], '')).toEqual({
      items: [],
      nextToken: null,
      isFetching: false,
      isLoadingMore: false,
      error: null,
      version: 0,
    });
  });

  it('reverse-resolves the page for each repository without exposing the other repository', () => {
    const other = { ...ISSUE, id: 'issue-2', repo: 'other', title: 'Other repository' };
    const otherKey = issueSuggestionRequestKey('github-issues', {
      owner: 'acme',
      repo: 'other',
    });
    const state = {
      issueSuggestions: {
        ...pageState(),
        byRequestKey: {
          ...pageState().byRequestKey,
          [otherKey]: {
            ...pageState().byRequestKey[ISSUE_KEY],
            items: createCollection<GitHubIssueSuggestion, 'id'>('id', [other]),
          },
        },
      },
    } as unknown as StoreState;

    expect(selectGitHubIssueSuggestions.select(state, 'acme', 'other', [], '').items).toEqual([
      other,
    ]);
    expect(selectGitHubIssueSuggestions.select(state, 'acme', 'app', [], '').items).toEqual([
      ISSUE,
    ]);
  });
});
