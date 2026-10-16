import { describe, expect, it } from 'vitest';
import type { Workspace } from '$shared/types';
import type { KnownRepo } from '$shared/types/known-repo';
import type { RepositoryTarget } from '$shared/types/repository-context';
import {
  aggregateRecentRepositories,
  recentRepositoryOriginPaths,
} from './recent-repository-refresh';

const ownedCheckout = (overrides: Partial<Workspace> = {}) =>
  ({
    id: 'ws-owned',
    repositoryPath: '/workspaces/gamma',
    worktreePath: '/workspaces/gamma',
    repositoryName: 'gamma',
    repositoryOwner: 'octo',
    lastActivity: '2026-02-01T00:00:00Z',
    updatedAt: '2026-02-01T00:00:00Z',
    ...overrides,
  }) as Workspace;

const localCopy = {
  ...ownedCheckout({ id: 'ws-local', repositoryPath: '/src/local', repositoryName: 'local' }),
  worktreePath: '/worktrees/local',
};

describe('recentRepositoryOriginPaths', () => {
  it('bounds probes to local, non-daemon-managed repository paths', () => {
    const remote = ownedCheckout({
      id: 'ws-remote',
      repositoryPath: '/remote/repo',
      worktreePath: '/remote/worktree',
      isRemote: true,
    });
    const registry = [
      { path: '/registry/local', name: 'local' },
      { path: '/workspaces/.repo-cache/octo/managed', name: 'managed' },
      { path: 'octo/known', name: 'known', githubUrl: 'https://github.com/octo/known' },
    ] as KnownRepo[];

    expect(recentRepositoryOriginPaths([remote, localCopy], registry)).toEqual([
      '/src/local',
      '/registry/local',
    ]);
  });
});

describe('aggregateRecentRepositories', () => {
  it('surfaces owned checkouts as forge picks and user sources as local copies', () => {
    expect(
      aggregateRecentRepositories([], [ownedCheckout(), localCopy], [], new Map()),
    ).toMatchObject([
      { path: 'octo/gamma', type: 'github', owner: 'octo', name: 'gamma' },
      { path: '/src/local', type: 'local', name: 'local' },
    ]);
  });

  it('uses an observed GitLab origin as the owned checkout identity', () => {
    const identity: RepositoryTarget = {
      provider: 'gitlab',
      instanceBaseUrl: 'https://git.example.test:8443/Forge',
      projectPath: 'Team/Sub/Actual',
    };

    expect(
      aggregateRecentRepositories(
        [],
        [ownedCheckout()],
        [],
        new Map([['/workspaces/gamma', identity]]),
        identity.instanceBaseUrl,
      ),
    ).toEqual([
      {
        path: 'https://git.example.test:8443/Forge/Team/Sub/Actual',
        type: 'github',
        githubUrl: 'https://git.example.test:8443/Forge/Team/Sub/Actual',
        name: 'gamma',
        owner: 'octo',
        repositoryIdentity: identity,
      },
    ]);
  });

  it('deduplicates registry and workspace identities and orders sources by recency', () => {
    const registry = [
      {
        path: 'Octo/Gamma',
        name: 'Gamma',
        owner: 'Octo',
        githubUrl: 'https://github.com/Octo/Gamma',
        lastUsedAt: '2026-01-15T00:00:00Z',
      },
      {
        path: 'octo/beta',
        name: 'beta',
        owner: 'octo',
        githubUrl: 'https://github.com/octo/beta',
        lastUsedAt: '2026-01-01T00:00:00Z',
      },
    ] as KnownRepo[];
    const result = aggregateRecentRepositories(
      [
        {
          path: 'octo/omega',
          type: 'github',
          githubUrl: 'https://github.com/octo/omega',
          name: 'omega',
          owner: 'octo',
        },
      ],
      [ownedCheckout()],
      registry,
      new Map(),
    );

    expect(result.map((repo) => repo.path)).toEqual(['octo/gamma', 'octo/beta', 'octo/omega']);
    expect(result.filter((repo) => repo.name.toLowerCase() === 'gamma')).toHaveLength(1);
    expect(result[0]).toMatchObject({
      githubUrl: 'https://github.com/Octo/Gamma',
      repositoryIdentity: {
        provider: 'github',
        instanceBaseUrl: 'https://github.com',
        projectPath: 'Octo/Gamma',
      },
    });
  });

  it('excludes daemon-managed and workspace-owned paths from local history', () => {
    const result = aggregateRecentRepositories(
      [
        { path: '/workspaces/gamma', type: 'local', name: 'owned' },
        { path: '/workspaces/.repo-cache/octo/managed', type: 'local', name: 'managed' },
        { path: '/saved', type: 'local', name: 'saved' },
      ],
      [ownedCheckout()],
      [],
      new Map(),
    );

    expect(result.map((repo) => repo.path)).toEqual(['octo/gamma', '/saved']);
  });
});
