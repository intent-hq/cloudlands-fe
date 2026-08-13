/**
 * gitRoots slice reducer + selector tests (multi git root tracking,
 * intent-hq/monorepo#2053).
 */
import { describe, expect, it } from 'vitest';
import { getItems } from '@augmentcode/themis/utils/collections/collection-utils';
import {
  initialState as workspaceInitialState,
  removeWorkspaceEntity,
  setWorkspaceEntity,
  workspaceReducer,
} from '../workspace/workspace-slice';
import type { GitRootRow } from '$features/git-roots/git-roots-service';
import type { Workspace, WorkspaceId } from '$shared/types';
import { PullRequestStatus, WorkspaceStatus } from '$shared/types';
import { gitRootsReducer, gitRootsUpdated, initialState } from './git-roots-slice';
import {
  selectGitRoots,
  selectHasSecondaryGitRoots,
  selectWorkspaceGitRootEntries,
} from './git-roots-selectors';

function makeRoot(overrides: Partial<GitRootRow> = {}): GitRootRow {
  return {
    id: 'root-1',
    workspaceId: 'ws-1',
    path: '/repos/monorepo/packages/intentd',
    source: 'agent',
    branch: 'feature/subtree',
    repoOwner: 'intent-hq',
    repoName: 'intentd',
    createdAt: '2026-08-13T10:00:00Z',
    updatedAt: '2026-08-13T10:05:00Z',
    ...overrides,
  };
}

function makeWorkspace(overrides: Partial<Workspace> = {}): Workspace {
  return {
    id: 'ws-1' as WorkspaceId,
    title: 'Subtree work',
    branch: 'feature/main-work',
    changesets: [],
    timeline: [],
    conversationInfo: [],
    status: WorkspaceStatus.Active,
    createdAt: '2026-08-13T09:00:00Z',
    updatedAt: '2026-08-13T09:00:00Z',
    worktreePath: '/repos/monorepo',
    repositoryOwner: 'intent-hq',
    repositoryName: 'monorepo',
    prNumber: 5,
    prUrl: 'https://github.com/intent-hq/monorepo/pull/5',
    prStatus: PullRequestStatus.Open,
    ...overrides,
  };
}

describe('gitRootsReducer', () => {
  it('starts with no workspaces', () => {
    const state = gitRootsReducer(undefined, { type: '@@INIT' });
    expect(state).toEqual(initialState);
  });

  it('gitRootsUpdated stores the list as a Collection keyed by id', () => {
    const gitRoots = [makeRoot(), makeRoot({ id: 'root-2', source: 'auto' })];
    const state = gitRootsReducer(initialState, gitRootsUpdated('ws-1', gitRoots));

    const ws = state.byWorkspaceId['ws-1'];
    expect(ws).toBeDefined();
    expect(getItems(ws.gitRoots)).toEqual(gitRoots);
    expect(ws.gitRoots.map['root-2'].source).toBe('auto');
  });

  it('gitRootsUpdated replaces the previous list for the same workspace', () => {
    let state = gitRootsReducer(
      initialState,
      gitRootsUpdated('ws-1', [makeRoot(), makeRoot({ id: 'root-2' })]),
    );
    state = gitRootsReducer(
      state,
      gitRootsUpdated('ws-1', [makeRoot({ id: 'root-2', branch: 'other' })]),
    );

    expect(getItems(state.byWorkspaceId['ws-1'].gitRoots)).toEqual([
      makeRoot({ id: 'root-2', branch: 'other' }),
    ]);
  });

  it('keeps workspaces isolated', () => {
    let state = gitRootsReducer(initialState, gitRootsUpdated('ws-1', [makeRoot()]));
    state = gitRootsReducer(
      state,
      gitRootsUpdated('ws-2', [makeRoot({ id: 'root-9', workspaceId: 'ws-2' })]),
    );

    expect(getItems(state.byWorkspaceId['ws-1'].gitRoots)).toHaveLength(1);
    expect(getItems(state.byWorkspaceId['ws-2'].gitRoots)[0].id).toBe('root-9');
  });

  it("removeWorkspaceEntity clears the workspace's roots", () => {
    let state = gitRootsReducer(initialState, gitRootsUpdated('ws-1', [makeRoot()]));
    state = gitRootsReducer(state, removeWorkspaceEntity('ws-1'));
    expect(state.byWorkspaceId['ws-1']).toBeUndefined();
  });
});

describe('git-roots selectors', () => {
  function stateWith(gitRoots: GitRootRow[], workspace?: Workspace) {
    return {
      gitRoots: gitRootsReducer(initialState, gitRootsUpdated('ws-1', gitRoots)),
      workspace: workspace
        ? workspaceReducer(workspaceInitialState, setWorkspaceEntity(workspace))
        : workspaceInitialState,
    };
  }

  it('selectGitRoots returns an empty list for unknown workspaces', () => {
    expect(selectGitRoots.select(stateWith([]), 'ws-9')).toEqual([]);
  });

  it('selectGitRoots returns registered roots in seed order', () => {
    const roots = [makeRoot(), makeRoot({ id: 'root-2', source: 'auto' })];
    expect(selectGitRoots.select(stateWith(roots), 'ws-1')).toEqual(roots);
  });

  it('selectWorkspaceGitRootEntries synthesizes the primary root first from the workspace', () => {
    const root = makeRoot();
    const workspace = makeWorkspace();
    const entries = selectWorkspaceGitRootEntries.select(stateWith([root], workspace), 'ws-1');

    expect(entries).toHaveLength(2);
    expect(entries[0]).toEqual({
      key: 'primary',
      isPrimary: true,
      path: '/repos/monorepo',
      branch: 'feature/main-work',
      repoOwner: 'intent-hq',
      repoName: 'monorepo',
      prNumber: 5,
      prUrl: 'https://github.com/intent-hq/monorepo/pull/5',
      prStatus: PullRequestStatus.Open,
      pullRequests: undefined,
    });
    expect(entries[1]).toEqual({
      key: 'root-1',
      isPrimary: false,
      path: root.path,
      branch: root.branch,
      repoOwner: root.repoOwner,
      repoName: root.repoName,
      prNumber: undefined,
      prUrl: undefined,
      prStatus: undefined,
      pullRequests: undefined,
      gitRoot: root,
    });
  });

  it('selectWorkspaceGitRootEntries falls back to workspace.path when worktreePath is absent', () => {
    const workspace = makeWorkspace({ worktreePath: undefined, path: '/plain/checkout' });
    const [primary] = selectWorkspaceGitRootEntries.select(stateWith([], workspace), 'ws-1');
    expect(primary.path).toBe('/plain/checkout');
  });

  it('selectWorkspaceGitRootEntries yields only the primary when no roots are registered', () => {
    const entries = selectWorkspaceGitRootEntries.select(stateWith([], makeWorkspace()), 'ws-1');
    expect(entries).toHaveLength(1);
    expect(entries[0].isPrimary).toBe(true);
  });

  it('selectWorkspaceGitRootEntries omits the primary until the workspace entity is hydrated', () => {
    const root = makeRoot();
    const entries = selectWorkspaceGitRootEntries.select(stateWith([root]), 'ws-1');
    expect(entries).toHaveLength(1);
    expect(entries[0].isPrimary).toBe(false);
    expect(entries[0].gitRoot).toEqual(root);
  });

  it('selectHasSecondaryGitRoots gates on registered roots only', () => {
    expect(selectHasSecondaryGitRoots.select(stateWith([], makeWorkspace()), 'ws-1')).toBe(false);
    expect(selectHasSecondaryGitRoots.select(stateWith([makeRoot()]), 'ws-1')).toBe(true);
  });
});
