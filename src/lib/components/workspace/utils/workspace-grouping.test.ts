import {
  describe,
  expect,
  it,
} from 'vitest';
import type { Workspace } from '$shared/types';
import { WorkspaceStatus } from '$shared/types';
import {
  buildRepoPathLookup,
  getGroupKey,
  type RepoGithubInfo,
} from './workspace-grouping';

/** Minimal workspace factory — only the fields the grouping utils inspect. */
function makeWorkspace(overrides: Partial<Workspace> = {}): Workspace {
  return {
    id: overrides.id ?? 'ws-1',
    title: overrides.title ?? 'Test Workspace',
    branch: 'main',
    changesets: [],
    timeline: [],
    conversationInfo: [],
    status: WorkspaceStatus.Active,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...overrides,
  } as Workspace;
}

// ---------------------------------------------------------------------------
// buildRepoPathLookup
// ---------------------------------------------------------------------------
describe('buildRepoPathLookup', () => {
  it('builds lookup from workspaces with full info', () => {
    const ws = makeWorkspace({
      repositoryPath: '/home/user/repos/my-app',
      repositoryOwner: 'acme',
      repositoryName: 'my-app',
    });
    const lookup = buildRepoPathLookup([ws]);
    expect(lookup.get('/home/user/repos/my-app')).toEqual({ owner: 'acme', name: 'my-app' });
  });

  it('seeds from knownRepos when provided', () => {
    const knownRepos = [{ path: '/repos/foo', name: 'foo', owner: 'org' }];
    const lookup = buildRepoPathLookup([], knownRepos);
    expect(lookup.get('/repos/foo')).toEqual({ owner: 'org', name: 'foo' });
  });

  it('workspace data overlays/overrides knownRepos', () => {
    const knownRepos = [{ path: '/repos/foo', name: 'foo', owner: 'old-org' }];
    const ws = makeWorkspace({
      repositoryPath: '/repos/foo',
      repositoryOwner: 'new-org',
      repositoryName: 'foo',
    });
    const lookup = buildRepoPathLookup([ws], knownRepos);
    expect(lookup.get('/repos/foo')).toEqual({ owner: 'new-org', name: 'foo' });
  });

  it('skips knownRepos entries with missing owner', () => {
    const knownRepos = [{ path: '/repos/bar', name: 'bar' }]; // no owner
    const lookup = buildRepoPathLookup([], knownRepos);
    expect(lookup.has('/repos/bar')).toBe(false);
  });

  it('skips knownRepos entries with missing path', () => {
    const knownRepos = [{ path: '', name: 'bar', owner: 'org' }];
    const lookup = buildRepoPathLookup([], knownRepos);
    expect(lookup.size).toBe(0);
  });

  it('skips workspace entries missing repositoryOwner or repositoryName', () => {
    const ws = makeWorkspace({ repositoryPath: '/repos/x' }); // no owner/name
    const lookup = buildRepoPathLookup([ws]);
    expect(lookup.size).toBe(0);
  });

  it('returns empty map for empty workspace list', () => {
    const lookup = buildRepoPathLookup([]);
    expect(lookup.size).toBe(0);
  });

  it('archived/deleted workspaces should be filtered by callers to avoid stale metadata', () => {
    // Simulate the filtering that callers should do before passing to buildRepoPathLookup.
    // An archived workspace with stale owner/name should NOT pollute the lookup.
    const archivedWs = makeWorkspace({
      id: 'ws-archived',
      repositoryPath: '/repos/shared',
      repositoryOwner: 'old-org',
      repositoryName: 'old-name',
      status: WorkspaceStatus.Archived,
    });
    const activeWs = makeWorkspace({
      id: 'ws-active',
      repositoryPath: '/repos/shared',
      repositoryOwner: 'new-org',
      repositoryName: 'shared',
      status: WorkspaceStatus.Active,
    });

    // If callers filter out archived workspaces, only active data is used
    const activeOnly = [archivedWs, activeWs].filter(
      (w) => w.status !== WorkspaceStatus.Archived && w.status !== WorkspaceStatus.Deleted,
    );
    const lookup = buildRepoPathLookup(activeOnly);
    expect(lookup.get('/repos/shared')).toEqual({ owner: 'new-org', name: 'shared' });
  });

  it('last workspace with same path wins', () => {
    const ws1 = makeWorkspace({
      id: 'ws-1',
      repositoryPath: '/repos/shared',
      repositoryOwner: 'alpha',
      repositoryName: 'shared',
    });
    const ws2 = makeWorkspace({
      id: 'ws-2',
      repositoryPath: '/repos/shared',
      repositoryOwner: 'beta',
      repositoryName: 'shared',
    });
    const lookup = buildRepoPathLookup([ws1, ws2]);
    expect(lookup.get('/repos/shared')).toEqual({ owner: 'beta', name: 'shared' });
  });
});

// ---------------------------------------------------------------------------
// getGroupKey
// ---------------------------------------------------------------------------
describe('getGroupKey', () => {
  const emptyLookup = new Map<string, RepoGithubInfo>();

  it('returns owner/name key for workspace with full info', () => {
    const ws = makeWorkspace({ repositoryOwner: 'acme', repositoryName: 'app' });
    const result = getGroupKey(ws, emptyLookup);
    expect(result).toEqual({
      key: 'acme/app',
      label: 'acme/app',
      isGithub: true,
      owner: 'acme',
    });
  });

  it('returns name-only key when owner is missing but name exists', () => {
    const ws = makeWorkspace({ repositoryName: 'local-repo' });
    const result = getGroupKey(ws, emptyLookup);
    expect(result).toEqual({
      key: 'local-repo',
      label: 'local-repo',
      isGithub: false,
    });
  });

  it('resolves path-only workspace via lookup (PR #439 regression)', () => {
    const lookup = new Map<string, RepoGithubInfo>([
      ['/home/user/intent', { owner: 'augmentcode', name: 'intent' }],
    ]);
    const ws = makeWorkspace({ repositoryPath: '/home/user/intent' });
    const result = getGroupKey(ws, lookup);
    expect(result).toEqual({
      key: 'augmentcode/intent',
      label: 'augmentcode/intent',
      isGithub: true,
      owner: 'augmentcode',
    });
  });

  it('falls back to path-based group when lookup has no match', () => {
    const ws = makeWorkspace({ repositoryPath: '/home/user/unknown-project' });
    const result = getGroupKey(ws, emptyLookup);
    expect(result).toEqual({
      key: '/home/user/unknown-project',
      label: 'unknown-project',
      isGithub: false,
    });
  });

  it('uses folder name as label for path-based fallback', () => {
    const ws = makeWorkspace({ repositoryPath: '/a/b/my-folder' });
    const result = getGroupKey(ws, emptyLookup);
    expect(result.label).toBe('my-folder');
  });

  it('handles path with trailing empty segment gracefully', () => {
    // split('/').pop() on '/a/b/' yields '' so fallback to full path
    const ws = makeWorkspace({ repositoryPath: '/a/b/' });
    const result = getGroupKey(ws, emptyLookup);
    expect(result.label).toBe('/a/b/');
  });

  it('returns "Unknown Repository" for workspace with no repo info', () => {
    const ws = makeWorkspace({});
    const result = getGroupKey(ws, emptyLookup);
    expect(result).toEqual({
      key: 'Unknown Repository',
      label: 'Unknown Repository',
      isGithub: false,
    });
  });

  it('respects custom noRepoLabel parameter', () => {
    const ws = makeWorkspace({});
    const result = getGroupKey(ws, emptyLookup, 'No Repository');
    expect(result.key).toBe('No Repository');
    expect(result.label).toBe('No Repository');
  });

  it('prefers direct owner/name over lookup even if path also matches', () => {
    const lookup = new Map<string, RepoGithubInfo>([
      ['/repos/app', { owner: 'lookup-org', name: 'app' }],
    ]);
    const ws = makeWorkspace({
      repositoryPath: '/repos/app',
      repositoryOwner: 'direct-org',
      repositoryName: 'app',
    });
    const result = getGroupKey(ws, lookup);
    expect(result.owner).toBe('direct-org');
    expect(result.key).toBe('direct-org/app');
  });
});

// ---------------------------------------------------------------------------
// Integration: buildRepoPathLookup + getGroupKey working together
// ---------------------------------------------------------------------------
describe('workspace grouping integration', () => {
  it('PR #439 regression: path-only workspace merges into owner/name group', () => {
    // Workspace A has full info, workspace B only has repositoryPath
    const wsA = makeWorkspace({
      id: 'ws-full',
      repositoryPath: '/home/user/intent',
      repositoryOwner: 'augmentcode',
      repositoryName: 'intent',
    });
    const wsB = makeWorkspace({
      id: 'ws-path-only',
      repositoryPath: '/home/user/intent',
      // no owner or name
    });

    const lookup = buildRepoPathLookup([wsA, wsB]);
    const keyA = getGroupKey(wsA, lookup);
    const keyB = getGroupKey(wsB, lookup);

    // Both should resolve to the same group
    expect(keyA.key).toBe('augmentcode/intent');
    expect(keyB.key).toBe('augmentcode/intent');
    expect(keyA.key).toBe(keyB.key);
  });

  it('multiple workspaces for same repo — mixed info — all in one group', () => {
    const workspaces = [
      makeWorkspace({
        id: 'ws-1',
        repositoryPath: '/repos/myapp',
        repositoryOwner: 'org',
        repositoryName: 'myapp',
      }),
      makeWorkspace({ id: 'ws-2', repositoryPath: '/repos/myapp' }),
      makeWorkspace({ id: 'ws-3', repositoryPath: '/repos/myapp' }),
    ];

    const lookup = buildRepoPathLookup(workspaces);
    const keys = workspaces.map((ws) => getGroupKey(ws, lookup).key);

    expect(new Set(keys).size).toBe(1);
    expect(keys[0]).toBe('org/myapp');
  });

  it('all workspaces have full info — no dedup needed', () => {
    const workspaces = [
      makeWorkspace({
        id: 'ws-1',
        repositoryOwner: 'a',
        repositoryName: 'r1',
        repositoryPath: '/r1',
      }),
      makeWorkspace({
        id: 'ws-2',
        repositoryOwner: 'b',
        repositoryName: 'r2',
        repositoryPath: '/r2',
      }),
    ];
    const lookup = buildRepoPathLookup(workspaces);
    expect(getGroupKey(workspaces[0], lookup).key).toBe('a/r1');
    expect(getGroupKey(workspaces[1], lookup).key).toBe('b/r2');
  });

  it('all workspaces are path-only — no lookup sources — each gets own group', () => {
    const workspaces = [
      makeWorkspace({ id: 'ws-1', repositoryPath: '/repos/alpha' }),
      makeWorkspace({ id: 'ws-2', repositoryPath: '/repos/beta' }),
    ];
    const lookup = buildRepoPathLookup(workspaces);
    const keys = workspaces.map((ws) => getGroupKey(ws, lookup).key);
    expect(keys).toEqual(['/repos/alpha', '/repos/beta']);
  });

  it('knownRepos enables path-only workspaces to resolve', () => {
    const knownRepos = [{ path: '/repos/secret', name: 'secret', owner: 'corp' }];
    const workspaces = [makeWorkspace({ id: 'ws-1', repositoryPath: '/repos/secret' })];

    const lookup = buildRepoPathLookup(workspaces, knownRepos);
    const result = getGroupKey(workspaces[0], lookup);
    expect(result.key).toBe('corp/secret');
    expect(result.isGithub).toBe(true);
  });

  it('empty workspace list produces empty grouping', () => {
    const lookup = buildRepoPathLookup([]);
    expect(lookup.size).toBe(0);
  });

  it('lookup-resolved group label can be split to extract repo name for handleCreateForRepo', () => {
    // When a path-only workspace is resolved via lookup, getGroupKey returns
    // label: "owner/name". handleCreateForRepo should extract just the name
    // portion to avoid producing invalid GitHub URLs (e.g. "acme/myrepo" instead of "myrepo").
    const wsWithInfo = makeWorkspace({
      id: 'ws-full',
      repositoryPath: '/home/user/myrepo',
      repositoryOwner: 'acme',
      repositoryName: 'myrepo',
    });
    const wsPathOnly = makeWorkspace({
      id: 'ws-path-only',
      repositoryPath: '/home/user/myrepo',
    });

    const lookup = buildRepoPathLookup([wsWithInfo, wsPathOnly]);
    const groupKey = getGroupKey(wsPathOnly, lookup);

    // Verify the label is "owner/name"
    expect(groupKey.label).toBe('acme/myrepo');
    expect(groupKey.isGithub).toBe(true);

    // Simulate the fix: split label to extract just the repo name
    const repoName = groupKey.isGithub
      ? groupKey.label.split('/').pop() || groupKey.label
      : groupKey.label;
    expect(repoName).toBe('myrepo');
  });
});
