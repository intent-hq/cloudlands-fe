import { describe, it, expect } from 'vitest';
import {
  getGitHubPickOwner,
  getRecentRepoLabel,
  getRecentRepoTooltip,
  getRepoFolderName,
  getWorkspaceOwnedCheckoutPaths,
  isDaemonManagedRepoPath,
  matchesRecentRepoSearch,
  type GitHubPickSelection,
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

describe('getRecentRepoTooltip', () => {
  it('returns the full path for local repos', () => {
    expect(getRecentRepoTooltip(localRepo('/Users/clem/code/intent'))).toBe(
      '/Users/clem/code/intent',
    );
  });

  it('returns nothing for GitHub repos', () => {
    expect(
      getRecentRepoTooltip({ path: '', type: 'github', name: 'monorepo', owner: 'intent-hq' }),
    ).toBeUndefined();
  });

  it('returns nothing for a local repo without a path', () => {
    expect(getRecentRepoTooltip(localRepo(''))).toBeUndefined();
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

describe('getGitHubPickOwner', () => {
  const parseGitHubUrl = (input: string) => {
    const match = /^https:\/\/github\.com\/([^/]+)\/([^/]+?)(?:\.git)?$/.exec(input.trim());
    return match ? { owner: match[1], repo: match[2] } : null;
  };
  const owner = (selection: GitHubPickSelection) => getGitHubPickOwner(selection, parseGitHubUrl);

  it('resolves the owner from a confirmed GitHub URL', () => {
    expect(
      owner({
        selectedValue: 'intent-hq/intent',
        selectedRepoType: 'github',
        confirmedGithubUrl: 'https://github.com/intent-hq/intent.git',
      }),
    ).toBe('intent-hq');
  });

  it('prefers the confirmed URL over the shorthand value', () => {
    expect(
      owner({
        selectedValue: 'stale-owner/intent',
        selectedRepoType: 'github',
        confirmedGithubUrl: 'https://github.com/intent-hq/intent',
      }),
    ).toBe('intent-hq');
  });

  it('falls back to the owner/repo shorthand for a restored GitHub pick', () => {
    expect(owner({ selectedValue: 'intent-hq/intent', selectedRepoType: 'github' })).toBe(
      'intent-hq',
    );
    expect(
      owner({
        selectedValue: 'intent-hq/intent',
        selectedRepoType: 'github',
        confirmedGithubUrl: '',
      }),
    ).toBe('intent-hq');
  });

  it('resolves the owner from a full GitHub URL value when nothing is confirmed', () => {
    expect(
      owner({ selectedValue: 'https://github.com/intent-hq/intent', selectedRepoType: 'github' }),
    ).toBe('intent-hq');
    expect(
      owner({
        selectedValue: 'https://github.com/intent-hq/intent.git',
        selectedRepoType: 'github',
        confirmedGithubUrl: '',
      }),
    ).toBe('intent-hq');
  });

  it('resolves the owner from an SSH value when the parser accepts it', () => {
    const parseSsh = (input: string) => {
      const match = /^git@github\.com:([^/]+)\/([^/]+?)(?:\.git)?$/.exec(input);
      return match ? { owner: match[1], repo: match[2] } : parseGitHubUrl(input);
    };
    expect(
      getGitHubPickOwner(
        { selectedValue: 'git@github.com:intent-hq/intent.git', selectedRepoType: 'github' },
        parseSsh,
      ),
    ).toBe('intent-hq');
  });

  it('returns nothing for a non-GitHub URL value', () => {
    expect(
      owner({ selectedValue: 'https://gitlab.com/intent-hq/intent', selectedRepoType: 'github' }),
    ).toBeUndefined();
  });

  it('ignores a local path even when a segment looks like an owner', () => {
    expect(owner({ selectedValue: 'intent-hq/intent', selectedRepoType: 'local' })).toBeUndefined();
    expect(
      owner({ selectedValue: '/Users/clem/code/intent-hq/intent', selectedRepoType: 'local' }),
    ).toBeUndefined();
  });

  it('ignores a stale confirmed URL once the pick is local', () => {
    expect(
      owner({
        selectedValue: '/Users/clem/code/intent',
        selectedRepoType: 'local',
        confirmedGithubUrl: 'https://github.com/intent-hq/intent',
      }),
    ).toBeUndefined();
  });

  it('never treats Windows or absolute paths as shorthand', () => {
    expect(
      owner({ selectedValue: 'C:\\code\\intent', selectedRepoType: 'github' }),
    ).toBeUndefined();
    expect(owner({ selectedValue: 'C:/intent', selectedRepoType: 'github' })).toBeUndefined();
    expect(
      owner({ selectedValue: '/intent-hq/intent', selectedRepoType: 'github' }),
    ).toBeUndefined();
    expect(owner({ selectedValue: 'a/b/c', selectedRepoType: 'github' })).toBeUndefined();
  });

  it('returns nothing for the empty and new-repo states', () => {
    expect(owner({ selectedValue: '', selectedRepoType: 'github' })).toBeUndefined();
    expect(
      owner({ selectedValue: '/Users/clem/code/new-repo', selectedRepoType: 'new' }),
    ).toBeUndefined();
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
