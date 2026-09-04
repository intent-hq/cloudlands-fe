import { describe, it, expect } from 'vitest';
import {
  gitReducer,
  initialState,
  setGitStatus,
  getGitWorkspaceState,
  setSecondaryRootGit,
  setSecondaryRootGitError,
  setSecondaryRootGitLoading,
  setSecondaryRootCommitFiles,
} from './git-slice';
import type { CommitInfo, GitStatus } from '$shared/types';
import { workspaceUnmounted } from '../workspace-lifecycle/workspace-lifecycle-slice';
import { createCollection, getItems } from '@augmentcode/themis/utils/collections/collection-utils';

const reduce = gitReducer;

const makeGitStatus = (overrides: Partial<GitStatus> = {}): GitStatus => ({
  branch: 'main',
  ahead: 1,
  behind: 0,
  diverged: false,
  files: [],
  hasUncommittedChanges: false,
  hasUntrackedFiles: false,
  ...overrides,
});

describe('gitReducer', () => {
  it('should return initial state', () => {
    const state = reduce(undefined, { type: '@@INIT' });
    expect(state).toEqual(initialState);
  });

  describe('setGitStatus', () => {
    it('should default ahead/behind to 0 when missing', () => {
      const status = makeGitStatus({ ahead: 0, behind: 0, branch: 'main' });
      const state = reduce(initialState, setGitStatus('ws-1', status));
      const ws = getGitWorkspaceState(state, 'ws-1');
      expect(ws.ahead).toBe(0);
      expect(ws.behind).toBe(0);
    });
  });

  describe('secondary root reads', () => {
    it('stores root-keyed loading state without clearing cached data', () => {
      const loaded = reduce(
        initialState,
        setSecondaryRootGit('ws-1', 'root-1', {
          status: makeGitStatus({ branch: 'feature' }),
          commits: [],
          commitFiles: {},
          nextToken: undefined,
        }),
      );
      const state = reduce(loaded, setSecondaryRootGitLoading('ws-1', 'root-1'));
      expect(getGitWorkspaceState(state, 'ws-1').secondaryRoots['root-1']).toEqual(
        expect.objectContaining({
          status: expect.objectContaining({ branch: 'feature' }),
          loading: true,
          error: null,
        }),
      );
    });

    it('stores successful results under the requested root', () => {
      const status = makeGitStatus({ branch: 'secondary' });
      const commits = [
        { hash: 'newer', message: 'newer' } as CommitInfo,
        { hash: 'older', message: 'older' } as CommitInfo,
      ];
      const state = reduce(
        initialState,
        setSecondaryRootGit('ws-1', 'root-2', {
          status,
          commits,
          commitFiles: {
            newer: [{ path: 'newer.ts', additions: 1, deletions: 0 }],
            older: null,
          },
          nextToken: 'next',
        }),
      );
      const root = getGitWorkspaceState(state, 'ws-1').secondaryRoots['root-2'];
      expect(getItems(root.commits)).toEqual(commits);
      expect(getItems(root.commitFiles)).toEqual([
        {
          commitHash: 'newer',
          files: createCollection('path', [{ path: 'newer.ts', additions: 1, deletions: 0 }]),
        },
        { commitHash: 'older', files: null },
      ]);
      expect(root).toEqual(
        expect.objectContaining({ status, nextToken: 'next', loading: false, error: null }),
      );
    });

    it('stores errors without clearing cached root data', () => {
      const loaded = reduce(
        initialState,
        setSecondaryRootGit('ws-1', 'root-1', {
          status: makeGitStatus(),
          commits: [],
          commitFiles: {},
          nextToken: undefined,
        }),
      );
      const state = reduce(loaded, setSecondaryRootGitError('ws-1', 'root-1', 'daemon error'));
      expect(getGitWorkspaceState(state, 'ws-1').secondaryRoots['root-1']).toEqual(
        expect.objectContaining({ loading: false, error: 'daemon error' }),
      );
    });

    it('clears every secondary root when the workspace unmounts', () => {
      const loaded = reduce(
        initialState,
        setSecondaryRootGit('ws-1', 'root-1', {
          status: makeGitStatus(),
          commits: [],
          commitFiles: {},
          nextToken: undefined,
        }),
      );
      const state = reduce(loaded, workspaceUnmounted('ws-1'));
      expect(state.byWorkspaceId['ws-1']).toBeUndefined();
    });

    it('stores recovered commit files without changing other root data', () => {
      const loaded = reduce(
        initialState,
        setSecondaryRootGit('ws-1', 'root-1', {
          status: makeGitStatus(),
          commits: [],
          commitFiles: { abc123: null },
          nextToken: undefined,
        }),
      );
      const state = reduce(
        loaded,
        setSecondaryRootCommitFiles('ws-1', 'root-1', 'abc123', [
          { path: 'recovered.ts', additions: 1, deletions: 0 },
        ]),
      );
      expect(getGitWorkspaceState(state, 'ws-1').secondaryRoots['root-1'].commitFiles).toEqual(
        createCollection('commitHash', [
          {
            commitHash: 'abc123',
            files: createCollection('path', [{ path: 'recovered.ts', additions: 1, deletions: 0 }]),
          },
        ]),
      );
    });
  });
});
