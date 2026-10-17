import { describe, expect, it } from 'vitest';
import {
  readSkipIsolation,
  resolveSidebarRepositoryDefault,
  type SidebarRepository,
} from '../sidebar-repository-default';

const clone = '/workspaces/ideate-future/intent';

function githubGroup(overrides: Partial<SidebarRepository> = {}): SidebarRepository {
  return {
    isGithub: true,
    owner: 'intent-hq',
    name: 'intent',
    repoPath: clone,
    workspaces: [{ repositoryPath: clone, worktreePath: clone }],
    ...overrides,
  };
}

describe('resolveSidebarRepositoryDefault', () => {
  it('returns the saved state when no sidebar repository is selected', () => {
    const saved = { repoPath: '/repos/a', repoType: 'local' as const };
    expect(resolveSidebarRepositoryDefault(undefined, saved)).toBe(saved);
    expect(resolveSidebarRepositoryDefault(githubGroup({ repoPath: undefined }), saved)).toBe(
      saved,
    );
  });

  it('turns a workspace-owned clone into a GitHub pick', () => {
    expect(
      resolveSidebarRepositoryDefault(githubGroup(), {
        selectedSpecialist: 'spec-writer',
        skipIsolation: true,
      }),
    ).toMatchObject({
      repoPath: 'intent-hq/intent',
      repoType: 'github',
      githubUrl: 'https://github.com/intent-hq/intent',
      skipIsolation: false,
      branch: '',
      selectedSpecialist: 'spec-writer',
    });
  });

  it.each([
    ['shorthand', { repoPath: 'Intent-HQ/Intent', githubUrl: '' }],
    ['URL', { repoPath: 'intent-hq/intent', githubUrl: 'https://github.com/intent-hq/intent' }],
  ])('keeps a saved GitHub pick of the same repository by %s', (_, fields) => {
    const saved = { ...fields, repoType: 'github' as const, branch: 'release' };
    expect(resolveSidebarRepositoryDefault(githubGroup(), saved)).toBe(saved);
  });

  it('keeps a saved user checkout of the same repository', () => {
    const saved = {
      repoPath: '/home/me/code/intent',
      repoType: 'local' as const,
      githubUrl: 'https://github.com/intent-hq/intent',
      branch: 'feature',
      skipIsolation: true,
    };
    expect(resolveSidebarRepositoryDefault(githubGroup(), saved)).toBe(saved);
  });

  it('replaces a saved local copy of any workspace clone in the group', () => {
    const otherClone = '/workspaces/shy-gopher/intent';
    const group = githubGroup({
      workspaces: [
        { repositoryPath: clone, worktreePath: clone },
        { repositoryPath: otherClone, worktreePath: otherClone },
      ],
    });
    expect(
      resolveSidebarRepositoryDefault(group, {
        repoPath: otherClone,
        repoType: 'local',
        githubUrl: 'https://github.com/intent-hq/intent',
        branch: 'main',
      }),
    ).toMatchObject({ repoPath: 'intent-hq/intent', repoType: 'github', branch: '' });
  });

  it('replaces a saved pick of a different GitHub repository', () => {
    expect(
      resolveSidebarRepositoryDefault(githubGroup(), {
        repoPath: 'intent-hq/monorepo',
        repoType: 'github',
        githubUrl: 'https://github.com/intent-hq/monorepo',
        branch: 'dev',
      }),
    ).toMatchObject({ repoPath: 'intent-hq/intent', repoType: 'github', branch: '' });
  });

  it('copies a GitHub repository backed by a user checkout, not a workspace clone', () => {
    const group = githubGroup({
      repoPath: '/home/me/code/intent',
      workspaces: [{ repositoryPath: '/home/me/code/intent', worktreePath: '/ws/a/intent' }],
    });
    expect(resolveSidebarRepositoryDefault(group, { skipIsolation: true })).toMatchObject({
      repoPath: '/home/me/code/intent',
      repoType: 'local',
      githubUrl: 'https://github.com/intent-hq/intent',
      skipIsolation: true,
    });
  });

  it('keeps a new-repo draft out of the same-repository match', () => {
    expect(
      resolveSidebarRepositoryDefault(githubGroup(), {
        repoPath: 'intent-hq/intent',
        repoType: 'github',
        isNewRepo: true,
      }),
    ).toMatchObject({ repoPath: 'intent-hq/intent', repoType: 'github', isNewRepo: false });
  });

  it('copies a local repository group as before', () => {
    const group: SidebarRepository = {
      isGithub: false,
      name: 'tools',
      repoPath: '/repos/tools',
      workspaces: [],
    };
    expect(resolveSidebarRepositoryDefault(group, null)).toMatchObject({
      repoPath: '/repos/tools',
      repoType: 'local',
      githubUrl: '',
    });
  });
});

describe('readSkipIsolation', () => {
  it('falls back to the legacy skipWorktree key', () => {
    expect(readSkipIsolation({ skipWorktree: true } as never)).toBe(true);
    expect(readSkipIsolation({ skipIsolation: false, skipWorktree: true } as never)).toBe(false);
    expect(readSkipIsolation(null)).toBeUndefined();
  });
});
