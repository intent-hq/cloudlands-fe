import {
  describe,
  it,
  expect,
} from 'vitest';
import {
  groupAndSortWorkspaces,
  type GroupKeyInfo,
} from '../workspace-sorting';
import type { Workspace } from '$shared/types';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Minimal workspace factory — only fields the sorting logic cares about. */
function makeWorkspace(overrides: Partial<Workspace> & { id: string }): Workspace {
  return {
    title: overrides.id,
    branch: 'main',
    changesets: [],
    timeline: [],
    conversationInfo: [],
    status: 'active' as any,
    createdAt: '2025-01-01T00:00:00Z',
    updatedAt: '2025-01-01T00:00:00Z',
    ...overrides,
  } as Workspace;
}

/** Standard getGroupKey that mirrors SpacesListOverlay logic. */
function getGroupKey(ws: Workspace): GroupKeyInfo & { isGithub: boolean; owner?: string } {
  if (ws.repositoryOwner && ws.repositoryName) {
    return {
      key: `${ws.repositoryOwner}/${ws.repositoryName}`,
      label: `${ws.repositoryOwner}/${ws.repositoryName}`,
      isGithub: true,
      owner: ws.repositoryOwner,
    };
  } else if (ws.repositoryPath) {
    return {
      key: ws.repositoryPath,
      label: ws.repositoryPath.split('/').pop() || ws.repositoryPath,
      isGithub: false,
    };
  }
  return { key: 'unknown', label: 'Unknown Repository', isGithub: false };
}

const getId = (ws: Workspace) => ws.id;

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('groupAndSortWorkspaces', () => {
  it('empty input returns no groups', () => {
    const result = groupAndSortWorkspaces({
      workspaces: [],
      getId,
      getGroupKey,
    });
    expect(result).toEqual([]);
  });

  it('groups workspaces by repo and sorts groups by most recent workspace', () => {
    // Array order = recency (index 0 is most recent)
    const workspaces = [
      makeWorkspace({ id: 'ws-a1', repositoryOwner: 'orgA', repositoryName: 'repoA' }),
      makeWorkspace({ id: 'ws-b1', repositoryOwner: 'orgB', repositoryName: 'repoB' }),
      makeWorkspace({ id: 'ws-c1', repositoryOwner: 'orgC', repositoryName: 'repoC' }),
      makeWorkspace({ id: 'ws-b2', repositoryOwner: 'orgB', repositoryName: 'repoB' }),
    ];

    const groups = groupAndSortWorkspaces({ workspaces, getId, getGroupKey });

    // Group order: orgA (idx 0), orgB (idx 1), orgC (idx 2)
    expect(groups.map((g) => g.groupKey.key)).toEqual([
      'orgA/repoA',
      'orgB/repoB',
      'orgC/repoC',
    ]);
  });

  it('sorts workspaces within a single group by recency', () => {
    const workspaces = [
      makeWorkspace({ id: 'newest', repositoryOwner: 'org', repositoryName: 'repo' }),
      makeWorkspace({ id: 'middle', repositoryOwner: 'org', repositoryName: 'repo' }),
      makeWorkspace({ id: 'oldest', repositoryOwner: 'org', repositoryName: 'repo' }),
    ];

    const groups = groupAndSortWorkspaces({ workspaces, getId, getGroupKey });

    expect(groups).toHaveLength(1);
    expect(groups[0].workspaces.map((ws) => ws.id)).toEqual(['newest', 'middle', 'oldest']);
  });

  it('replicates the user bug scenario — augmentcode/augment should sort before reve-ai', () => {
    // Pre-sorted by recency (most recent first):
    //   nodexa (now), augment (14m), blank-repo (4d), reve-image (4d), reve-core (2w)
    const workspaces = [
      makeWorkspace({ id: 'nodexa-1', repositoryOwner: 'NodexaAI', repositoryName: 'nodexa' }),
      makeWorkspace({
        id: 'augment-1',
        repositoryOwner: 'augmentcode',
        repositoryName: 'augment',
      }),
      makeWorkspace({ id: 'blank-1', repositoryPath: '/home/user/local-project' }),
      makeWorkspace({
        id: 'reve-img-1',
        repositoryOwner: 'reve-ai',
        repositoryName: 'reve-image-search',
      }),
      makeWorkspace({
        id: 'reve-core-1',
        repositoryOwner: 'reve-ai',
        repositoryName: 'reve-core',
      }),
    ];

    const groups = groupAndSortWorkspaces({ workspaces, getId, getGroupKey });
    const keys = groups.map((g) => g.groupKey.key);

    // augmentcode/augment (idx 1) MUST come before reve-ai repos (idx 3,4)
    expect(keys.indexOf('augmentcode/augment')).toBeLessThan(
      keys.indexOf('reve-ai/reve-image-search'),
    );
    expect(keys.indexOf('augmentcode/augment')).toBeLessThan(keys.indexOf('reve-ai/reve-core'));

    // Full expected order
    expect(keys).toEqual([
      'NodexaAI/nodexa',
      'augmentcode/augment',
      '/home/user/local-project',
      'reve-ai/reve-image-search',
      'reve-ai/reve-core',
    ]);
  });

  it('handles single workspace per group', () => {
    const workspaces = [
      makeWorkspace({ id: 'a', repositoryOwner: 'o1', repositoryName: 'r1' }),
      makeWorkspace({ id: 'b', repositoryOwner: 'o2', repositoryName: 'r2' }),
      makeWorkspace({ id: 'c', repositoryOwner: 'o3', repositoryName: 'r3' }),
    ];

    const groups = groupAndSortWorkspaces({ workspaces, getId, getGroupKey });

    expect(groups).toHaveLength(3);
    groups.forEach((g) => expect(g.workspaces).toHaveLength(1));
    expect(groups.map((g) => g.groupKey.key)).toEqual(['o1/r1', 'o2/r2', 'o3/r3']);
  });

  it('handles all workspaces in one group', () => {
    const workspaces = [
      makeWorkspace({ id: 'a', repositoryOwner: 'org', repositoryName: 'repo' }),
      makeWorkspace({ id: 'b', repositoryOwner: 'org', repositoryName: 'repo' }),
      makeWorkspace({ id: 'c', repositoryOwner: 'org', repositoryName: 'repo' }),
    ];

    const groups = groupAndSortWorkspaces({ workspaces, getId, getGroupKey });

    expect(groups).toHaveLength(1);
    expect(groups[0].workspaces.map((ws) => ws.id)).toEqual(['a', 'b', 'c']);
  });

  it('workspaces with no repo info are grouped under a fallback key', () => {
    const workspaces = [
      makeWorkspace({ id: 'known', repositoryOwner: 'org', repositoryName: 'repo' }),
      makeWorkspace({ id: 'orphan-1' }), // no repositoryOwner, repositoryName, or repositoryPath
      makeWorkspace({ id: 'orphan-2' }),
    ];

    const groups = groupAndSortWorkspaces({ workspaces, getId, getGroupKey });

    expect(groups).toHaveLength(2);
    // First group: org/repo (most recent, idx 0)
    expect(groups[0].groupKey.key).toBe('org/repo');
    // Second group: unknown fallback (idx 1)
    expect(groups[1].groupKey.key).toBe('unknown');
    expect(groups[1].groupKey.label).toBe('Unknown Repository');
    expect(groups[1].workspaces.map((ws) => ws.id)).toEqual(['orphan-1', 'orphan-2']);
  });

  it('preserves extra metadata from getGroupKey on each group', () => {
    const workspaces = [
      makeWorkspace({ id: 'a', repositoryOwner: 'org', repositoryName: 'repo' }),
    ];

    const groups = groupAndSortWorkspaces({ workspaces, getId, getGroupKey });

    expect(groups[0].groupKey).toMatchObject({
      key: 'org/repo',
      label: 'org/repo',
      isGithub: true,
      owner: 'org',
    });
  });

  it('works with a custom getId and getGroupKey', () => {
    type SimpleItem = { uid: string; category: string };
    const items: SimpleItem[] = [
      { uid: '1', category: 'A' },
      { uid: '2', category: 'B' },
      { uid: '3', category: 'A' },
    ];

    const groups = groupAndSortWorkspaces({
      workspaces: items,
      getId: (item) => item.uid,
      getGroupKey: (item) => ({ key: item.category, label: item.category }),
    });

    expect(groups).toHaveLength(2);
    expect(groups[0].groupKey.key).toBe('A'); // idx 0 is most recent
    expect(groups[0].workspaces.map((i) => i.uid)).toEqual(['1', '3']);
    expect(groups[1].groupKey.key).toBe('B');
  });

});
