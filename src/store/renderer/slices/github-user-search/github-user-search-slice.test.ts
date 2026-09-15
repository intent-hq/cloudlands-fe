import { describe, expect, it } from 'vitest';
import { createCollection, getItems } from '@augmentcode/themis/utils/collections/collection-utils';
import {
  clearGithubUserSearch,
  githubUserSearchReducer,
  initialState,
  setGithubUserSearchError,
  setGithubUserSearchLoading,
  setGithubUserSearchResults,
  type GithubUserSearchItem,
} from './github-user-search-slice';

const mockUser = (login: string, id: number): GithubUserSearchItem => ({
  login,
  githubUserId: id,
  avatarUrl: `https://avatars.githubusercontent.com/u/${id}`,
  htmlUrl: `https://github.com/${login}`,
});

describe('githubUserSearchReducer', () => {
  it('returns the initial state', () => {
    expect(githubUserSearchReducer(undefined, { type: '@@INIT' })).toEqual(initialState);
  });

  it('records the active query and flips loading while searching', () => {
    const previous = { ...initialState, error: 'stale error' };

    const next = githubUserSearchReducer(previous, setGithubUserSearchLoading('octo'));

    expect(next).toEqual({ ...previous, loading: true, error: null, lastQuery: 'octo' });
  });

  // Regression (fe#2482 review F1): results for the previous query must not
  // survive into the next query's loading window, or the dialog renders them
  // as current, selectable rows until the second RPC settles.
  it('drops the previous results when a new query starts loading', () => {
    const settled = githubUserSearchReducer(
      initialState,
      setGithubUserSearchResults('octo', [mockUser('octocat', 1)]),
    );

    const next = githubUserSearchReducer(settled, setGithubUserSearchLoading('hub'));

    expect(next.loading).toBe(true);
    expect(next.lastQuery).toBe('hub');
    expect(getItems(next.results)).toEqual([]);
  });

  it('stores results as a Collection keyed by login', () => {
    const loading = { ...initialState, loading: true, lastQuery: 'octo' };
    const users = [mockUser('octocat', 1), mockUser('octokit', 2)];

    const next = githubUserSearchReducer(loading, setGithubUserSearchResults('octo', users));

    expect(next.loading).toBe(false);
    expect(next.error).toBeNull();
    expect(next.lastQuery).toBe('octo');
    expect(getItems(next.results)).toEqual(users);
  });

  it('records an error, clears loading, and drops previous results', () => {
    const populated = {
      ...initialState,
      results: createCollection<GithubUserSearchItem, 'login'>('login', [mockUser('octocat', 1)]),
      loading: true,
      lastQuery: 'octo',
    };

    const next = githubUserSearchReducer(populated, setGithubUserSearchError('octo', 'failed'));

    expect(next.loading).toBe(false);
    expect(next.error).toBe('failed');
    expect(next.lastQuery).toBe('octo');
    expect(getItems(next.results)).toEqual([]);
  });

  it('resets to initial state on clear', () => {
    const populated = {
      results: createCollection<GithubUserSearchItem, 'login'>('login', [mockUser('octocat', 1)]),
      loading: false,
      error: null,
      lastQuery: 'octo',
    };

    expect(githubUserSearchReducer(populated, clearGithubUserSearch())).toEqual(initialState);
  });
});
