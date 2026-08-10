import { describe, expect, it } from 'vitest';
import {
  deriveRecentRepoEntries,
  detectRecentRepoSource,
  type RecentRepoWorkspace,
} from './recent-repos';

const githubPick: RecentRepoWorkspace = {
  repositoryPath: '/Users/me/Intent/monorepo',
  worktreePath: '/Users/me/Intent/monorepo',
  repositoryOwner: 'intent-hq',
  repositoryName: 'monorepo',
  checkoutMode: 'direct',
  branch: 'main',
};

const localCopy: RecentRepoWorkspace = {
  repositoryPath: '/Users/me/code/intent',
  worktreePath: '/Users/me/Intent/workspaces/fix-login',
  repositoryOwner: 'intent-hq',
  repositoryName: 'monorepo',
  checkoutMode: 'cow',
  branch: 'fix-login',
};

describe('detectRecentRepoSource', () => {
  it('classifies a standalone checkout as github-sourced', () => {
    expect(detectRecentRepoSource(githubPick)).toBe('github');
  });

  it('classifies a distinct source repo dir as a local copy', () => {
    expect(detectRecentRepoSource(localCopy)).toBe('local');
  });

  it('falls back to checkoutMode when worktreePath is absent', () => {
    expect(
      detectRecentRepoSource({ repositoryPath: '/Users/me/code/intent', checkoutMode: 'worktree' }),
    ).toBe('local');
    expect(
      detectRecentRepoSource({ repositoryPath: '/Users/me/code/intent', checkoutMode: 'direct' }),
    ).toBe('github');
  });

  it('defaults to github-sourced when neither signal is present', () => {
    expect(detectRecentRepoSource({ repositoryPath: '/Users/me/code/intent' })).toBe('github');
  });
});

describe('deriveRecentRepoEntries', () => {
  it('derives distinct labels for github-sourced and local-copy entries', () => {
    expect(deriveRecentRepoEntries([githubPick, localCopy])).toEqual([
      {
        source: 'github',
        name: 'monorepo',
        owner: 'intent-hq',
        folderName: undefined,
        path: '/Users/me/Intent/monorepo',
        branch: 'main',
      },
      {
        source: 'local',
        name: 'monorepo',
        owner: 'intent-hq',
        folderName: 'intent',
        path: '/Users/me/code/intent',
        branch: 'fix-login',
      },
    ]);
  });

  it('falls back to the path basename when the daemon sent no repo name', () => {
    const [entry] = deriveRecentRepoEntries([
      { repositoryPath: '/Users/me/code/scratch/', worktreePath: '/Users/me/code/scratch/' },
    ]);
    expect(entry).toMatchObject({ source: 'github', name: 'scratch', branch: 'main' });
  });

  it('derives the folder name from Windows paths', () => {
    const [entry] = deriveRecentRepoEntries([
      {
        repositoryPath: 'C:\\Users\\me\\code\\intent',
        worktreePath: 'C:\\ws\\fix-login',
        repositoryName: 'monorepo',
      },
    ]);
    expect(entry).toMatchObject({ source: 'local', folderName: 'intent' });
  });

  it('excludes daemon-managed repo paths', () => {
    const entries = deriveRecentRepoEntries([
      {
        repositoryPath: '/Users/me/Workspaces/.repo-cache/intent-hq/monorepo',
        worktreePath: '/Users/me/Workspaces/fix-login',
        repositoryName: 'monorepo',
      },
      localCopy,
    ]);
    expect(entries).toHaveLength(1);
    expect(entries[0].path).toBe(localCopy.repositoryPath);
  });

  it('deduplicates local entries by repository path, keeping the first occurrence', () => {
    const entries = deriveRecentRepoEntries([
      localCopy,
      { ...localCopy, branch: 'older-branch', worktreePath: '/Users/me/Intent/workspaces/older' },
    ]);
    expect(entries).toHaveLength(1);
    expect(entries[0].branch).toBe('fix-login');
  });

  it('collapses github workspaces of the same repo into one entry, keeping the first', () => {
    const entries = deriveRecentRepoEntries([
      githubPick,
      {
        ...githubPick,
        repositoryPath: '/Users/me/Intent/workspaces/ws-2/monorepo',
        worktreePath: '/Users/me/Intent/workspaces/ws-2/monorepo',
        branch: 'feature-b',
      },
      {
        ...githubPick,
        repositoryPath: '/Users/me/Intent/workspaces/ws-3/monorepo',
        worktreePath: '/Users/me/Intent/workspaces/ws-3/monorepo',
        repositoryOwner: 'Intent-HQ',
        repositoryName: 'Monorepo',
        branch: 'feature-c',
      },
    ]);
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({
      source: 'github',
      owner: 'intent-hq',
      name: 'monorepo',
      branch: 'main',
      path: githubPick.repositoryPath,
    });
  });

  it('keeps a github clone entry and a genuine local copy of the same repo distinct', () => {
    const entries = deriveRecentRepoEntries([githubPick, localCopy]);
    expect(entries).toHaveLength(2);
    expect(entries.map((entry) => entry.source)).toEqual(['github', 'local']);
  });

  it('keeps two different local dirs of the same repo as two entries', () => {
    const entries = deriveRecentRepoEntries([
      localCopy,
      {
        ...localCopy,
        repositoryPath: '/Users/me/other/intent',
        worktreePath: '/Users/me/Intent/workspaces/other-ws',
      },
    ]);
    expect(entries).toHaveLength(2);
  });

  it('keys owner-less github entries by repo name, keeping distinct names distinct', () => {
    const sameName = deriveRecentRepoEntries([
      { ...githubPick, repositoryOwner: undefined },
      {
        ...githubPick,
        repositoryOwner: undefined,
        repositoryPath: '/Users/me/Intent/workspaces/ws-2/monorepo',
        worktreePath: '/Users/me/Intent/workspaces/ws-2/monorepo',
      },
    ]);
    expect(sameName).toHaveLength(1);

    const byBasename = deriveRecentRepoEntries([
      { repositoryPath: '/Users/me/ws/a', worktreePath: '/Users/me/ws/a' },
      { repositoryPath: '/Users/me/ws/b', worktreePath: '/Users/me/ws/b' },
    ]);
    expect(byBasename).toHaveLength(2);
  });

  it('falls back to the path as key when no name can be derived at all', () => {
    const byPath = deriveRecentRepoEntries([
      { repositoryPath: '/', worktreePath: '/' },
      { repositoryPath: '//', worktreePath: '//' },
    ]);
    expect(byPath).toHaveLength(2);
    expect(byPath.map((entry) => entry.name)).toEqual([undefined, undefined]);
  });

  it('never surfaces a workspace-owned checkout path as a local entry', () => {
    const copyOfOwnedCheckout: RecentRepoWorkspace = {
      ...githubPick,
      worktreePath: '/Users/me/Intent/workspaces/copy-ws',
      checkoutMode: 'cow',
      branch: 'copy-branch',
    };
    const entries = deriveRecentRepoEntries([githubPick, copyOfOwnedCheckout]);
    expect(entries).toHaveLength(1);
    expect(entries[0].source).toBe('github');
  });

  it('skips workspaces without a repository path', () => {
    expect(deriveRecentRepoEntries([{ worktreePath: '/Users/me/Intent/workspaces/x' }])).toEqual(
      [],
    );
  });

  it('caps the number of entries at the limit', () => {
    const many = Array.from({ length: 6 }, (_, i) => ({
      repositoryPath: `/Users/me/code/repo-${i}`,
      worktreePath: `/Users/me/code/repo-${i}`,
    }));
    expect(deriveRecentRepoEntries(many)).toHaveLength(4);
    expect(deriveRecentRepoEntries(many, 2)).toHaveLength(2);
  });
});
