import { describe, it, expect } from 'vitest';
import {
  getRecentRepoLabel,
  getRepoFolderName,
  getWorkspaceOwnedCheckoutPaths,
  isDaemonManagedRepoPath,
  matchesRecentRepoSearch,
  type RecentRepoEntry,
} from '../recent-repo-display';

const localRepo = (path: string, overrides: Partial<RecentRepoEntry> = {}): RecentRepoEntry => ({
  path,
  type: 'local',
  name: 'monorepo',
  owner: 'intent-hq',
  ...overrides,
});

describe('getRepoFolderName', () => {
  it('returns the last POSIX path segment', () => {
    expect(getRepoFolderName('/Users/clem/code/intent')).toBe('intent');
  });

  it('returns the last Windows path segment', () => {
    expect(getRepoFolderName('C:\\Users\\clem\\code\\intent')).toBe('intent');
  });

  it('ignores trailing separators', () => {
    expect(getRepoFolderName('/Users/clem/code/intent/')).toBe('intent');
  });

  it('returns empty string for an empty path', () => {
    expect(getRepoFolderName('')).toBe('');
  });
});

describe('getRecentRepoLabel', () => {
  it('leads with the folder name and dims owner/repo for local repos', () => {
    expect(getRecentRepoLabel(localRepo('/Users/clem/code/intent'))).toEqual({
      primary: 'intent',
      suffix: 'intent-hq/monorepo',
    });
  });

  it('distinguishes two clones of the same GitHub repo', () => {
    const a = getRecentRepoLabel(localRepo('/Users/clem/code/intent'));
    const b = getRecentRepoLabel(localRepo('/Users/clem/code/monorepo-2'));
    expect(a.primary).toBe('intent');
    expect(b.primary).toBe('monorepo-2');
    expect(a.suffix).toBe(b.suffix);
  });

  it('shows only the folder name when owner is unknown', () => {
    expect(getRecentRepoLabel(localRepo('/Users/clem/code/intent', { owner: undefined }))).toEqual({
      primary: 'intent',
      suffix: undefined,
    });
  });

  it('falls back to the repo name when the path has no segments', () => {
    expect(getRecentRepoLabel(localRepo('', { owner: undefined })).primary).toBe('monorepo');
  });

  it('keeps the owner / name rendering for GitHub repos', () => {
    expect(
      getRecentRepoLabel({ path: '', type: 'github', name: 'monorepo', owner: 'intent-hq' }),
    ).toEqual({ ownerPrefix: 'intent-hq', primary: 'monorepo' });
  });
});

describe('matchesRecentRepoSearch', () => {
  const repo = localRepo('/Users/clem/code/intent');

  it('matches everything for an empty search', () => {
    expect(matchesRecentRepoSearch(repo, '')).toBe(true);
    expect(matchesRecentRepoSearch(repo, '   ')).toBe(true);
  });

  it('matches the folder name', () => {
    expect(matchesRecentRepoSearch(repo, 'intent')).toBe(true);
  });

  it('matches a folder name that differs from the repo name', () => {
    expect(matchesRecentRepoSearch(localRepo('/Users/clem/code/monorepo-2'), 'monorepo-2')).toBe(
      true,
    );
  });

  it('matches repo name, path, owner and owner/name', () => {
    expect(matchesRecentRepoSearch(repo, 'MONOREPO')).toBe(true);
    expect(matchesRecentRepoSearch(repo, '/code/')).toBe(true);
    expect(matchesRecentRepoSearch(repo, 'intent-hq')).toBe(true);
    expect(matchesRecentRepoSearch(repo, 'intent-hq/monorepo')).toBe(true);
  });

  it('does not match unrelated terms', () => {
    expect(matchesRecentRepoSearch(repo, 'zzz')).toBe(false);
  });
});

describe('isDaemonManagedRepoPath', () => {
  it('detects repo-cache checkouts', () => {
    expect(isDaemonManagedRepoPath('/Users/clem/Workspaces/.repo-cache/intent-hq/monorepo')).toBe(
      true,
    );
  });

  it('detects legacy clone checkouts', () => {
    expect(isDaemonManagedRepoPath('/Users/clem/Workspaces/.clones/monorepo')).toBe(true);
  });

  it('normalizes Windows separators', () => {
    expect(isDaemonManagedRepoPath('C:\\Workspaces\\.repo-cache\\intent-hq\\monorepo')).toBe(true);
  });

  it('leaves user-local repos alone', () => {
    expect(isDaemonManagedRepoPath('/Users/clem/code/monorepo')).toBe(false);
    expect(isDaemonManagedRepoPath('/Users/clem/code/repo-cache-tools')).toBe(false);
  });
});

describe('getWorkspaceOwnedCheckoutPaths', () => {
  it('collects standalone checkouts where the repo is its own worktree', () => {
    const owned = getWorkspaceOwnedCheckoutPaths([
      { repositoryPath: '/ws/standalone', worktreePath: '/ws/standalone' },
      { repositoryPath: '/Users/clem/code/monorepo', worktreePath: '/ws/feature-branch' },
    ]);
    expect(owned).toEqual(new Set(['/ws/standalone']));
  });

  it('ignores workspaces missing either path', () => {
    expect(
      getWorkspaceOwnedCheckoutPaths([
        { repositoryPath: '/ws/only-repo' },
        { worktreePath: '/ws/only-worktree' },
        {},
      ]),
    ).toEqual(new Set());
  });

  it('returns an empty set for no workspaces', () => {
    expect(getWorkspaceOwnedCheckoutPaths([])).toEqual(new Set());
  });
});
