import type { KnownRepo } from '$shared/types/known-repo';
import { describe, expect, it } from 'vitest';
import { createCollection } from '@augmentcode/themis/utils/collections/collection-utils';
import {
  initialState,
  knownReposReducer,
  removeRepo,
  setRepos,
  localRepoDiscoveryStarted,
  localRepoDiscoverySucceeded,
  localRepoDiscoveryFailed,
  resetLocalRepoDiscovery,
} from './known-repos-slice';
import { getItems } from '@augmentcode/themis/utils/collections/collection-utils';

const mockRepo = (path: string, name = 'intent'): KnownRepo => ({
  path,
  name,
  owner: 'augmentcode',
  addedAt: '2026-03-18T00:00:00.000Z',
  lastUsedAt: '2026-03-18T00:00:00.000Z',
});

describe('knownReposReducer', () => {
  it('returns the initial state', () => {
    expect(knownReposReducer(undefined, { type: '@@INIT' })).toEqual(initialState);
  });

  it('stores fetched repos and marks the slice as loaded', () => {
    const repos = [mockRepo('/repo/intent'), mockRepo('/repo/augment', 'augment')];

    expect(knownReposReducer(initialState, setRepos(repos))).toEqual({
      ...initialState,
      repos: createCollection<KnownRepo, 'path'>('path', repos),
      loaded: true,
    });
  });

  it('removes a repo by path without mutating other entries', () => {
    const previousState = {
      ...initialState,
      repos: createCollection<KnownRepo, 'path'>('path', [
        mockRepo('/repo/intent'),
        mockRepo('/repo/augment', 'augment'),
      ]),
      loaded: true,
    };

    expect(knownReposReducer(previousState, removeRepo('/repo/intent'))).toEqual({
      ...initialState,
      repos: createCollection<KnownRepo, 'path'>('path', [mockRepo('/repo/augment', 'augment')]),
      loaded: true,
    });
  });

  it('keeps discovery suggestions separate from persisted recents and deduplicates paths', () => {
    const started = knownReposReducer(initialState, localRepoDiscoveryStarted('local'));
    expect(started.discovery.status).toBe('loading');
    const repo = { path: '/home/dev/app', name: 'app' };
    const completed = knownReposReducer(
      started,
      localRepoDiscoverySucceeded('local', [repo, repo]),
    );
    expect(completed.discovery.status).toBe('complete');
    expect(getItems(completed.discovery.repos)).toEqual([repo]);
    expect(completed.repos).toBe(initialState.repos);
    expect(completed.loaded).toBe(false);
    expect(knownReposReducer(completed, resetLocalRepoDiscovery())).toEqual(initialState);
  });

  it('settles failures and rejects stale success/failure after a backend change or reset', () => {
    const started = knownReposReducer(initialState, localRepoDiscoveryStarted('remote'));
    expect(knownReposReducer(started, localRepoDiscoveryFailed('local'))).toBe(started);
    expect(knownReposReducer(started, localRepoDiscoverySucceeded('local', []))).toBe(started);
    const failed = knownReposReducer(started, localRepoDiscoveryFailed('remote'));
    expect(failed.discovery.status).toBe('error');
    expect(knownReposReducer(failed, localRepoDiscoverySucceeded('remote', []))).toBe(failed);
    const reset = knownReposReducer(started, resetLocalRepoDiscovery());
    expect(knownReposReducer(reset, localRepoDiscoverySucceeded('remote', []))).toBe(reset);
  });
});
