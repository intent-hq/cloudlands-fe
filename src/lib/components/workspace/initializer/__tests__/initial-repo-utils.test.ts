import {
  describe,
  it,
  expect,
} from 'vitest';
import {
  getLastSelectedRepoHydrationAction,
  getInitialRepoKey,
  mapInitialRepoToFormState,
  type InitialRepoInfo,
} from '../initial-repo-utils';

describe('getInitialRepoKey', () => {
  it('returns empty string for undefined/null', () => {
    expect(getInitialRepoKey(undefined)).toBe('');
    expect(getInitialRepoKey(null)).toBe('');
  });

  it('returns empty string for empty fields', () => {
    expect(getInitialRepoKey({})).toBe('');
    expect(getInitialRepoKey({ repoPath: '', owner: '', name: '' })).toBe('');
  });

  it('generates key from repoPath alone', () => {
    expect(getInitialRepoKey({ repoPath: '/home/user/repo' })).toBe('/home/user/repo');
  });

  it('generates composite key from repoPath + owner + name', () => {
    const repo: InitialRepoInfo = { repoPath: '/home/user/repo', owner: 'acme', name: 'app' };
    expect(getInitialRepoKey(repo)).toBe('/home/user/repo:acme:app');
  });

  it('includes previousWorkspaceId when present', () => {
    const repo: InitialRepoInfo = {
      repoPath: '/home/user/repo',
      previousWorkspaceId: 'ws-123',
    };
    expect(getInitialRepoKey(repo)).toBe('/home/user/repo:ws-123');
  });

  it('same repo info produces same key (idempotent)', () => {
    const repo: InitialRepoInfo = { repoPath: '/a', owner: 'b', name: 'c' };
    expect(getInitialRepoKey(repo)).toBe(getInitialRepoKey(repo));
  });

  it('includes environmentType when present', () => {
    const repo: InitialRepoInfo = { repoPath: '/home/user/repo', environmentType: 'remote' };
    expect(getInitialRepoKey(repo)).toBe('/home/user/repo:remote');
  });

  it('different repos produce different keys', () => {
    const repo1: InitialRepoInfo = { repoPath: '/repo1' };
    const repo2: InitialRepoInfo = { repoPath: '/repo2' };
    expect(getInitialRepoKey(repo1)).not.toBe(getInitialRepoKey(repo2));
  });
});

describe('mapInitialRepoToFormState', () => {
  it('maps local repo with repoPath correctly', () => {
    const state = mapInitialRepoToFormState({ repoPath: '/home/user/repo' });
    expect(state.repoPath).toBe('/home/user/repo');
    expect(state.repoType).toBe('local');
    expect(state.isValidPath).toBe(true);
    expect(state.isNewRepo).toBe(false);
    expect(state.branch).toBe('');
    expect(state.scope).toBe('');
  });

  it('sets githubUrl when owner and name are present', () => {
    const state = mapInitialRepoToFormState({
      repoPath: '/home/user/repo',
      owner: 'acme',
      name: 'app',
    });
    expect(state.githubUrl).toBe('https://github.com/acme/app');
  });

  it('does not set githubUrl when owner/name are missing', () => {
    const state = mapInitialRepoToFormState({ repoPath: '/home/user/repo' });
    expect(state.githubUrl).toBeUndefined();
  });

  it('does not set githubUrl when only owner is present', () => {
    const state = mapInitialRepoToFormState({ repoPath: '/r', owner: 'acme' });
    expect(state.githubUrl).toBeUndefined();
  });

  it('maps remote repo with sshConfig', () => {
    const sshConfig = { host: 'example.com', user: 'deploy' };
    const state = mapInitialRepoToFormState({
      environmentType: 'remote',
      sshConfig,
    });
    expect(state.remoteSetup).toEqual({ type: 'remote', ssh: sshConfig });
  });

  it('does not set remoteSetup for non-remote environmentType', () => {
    const state = mapInitialRepoToFormState({
      repoPath: '/r',
      environmentType: 'local',
      sshConfig: { host: 'x' },
    });
    expect(state.remoteSetup).toBeUndefined();
  });

  it('maps previousWorkspaceId/title to pendingPreviousWorkspace', () => {
    const state = mapInitialRepoToFormState({
      repoPath: '/r',
      previousWorkspaceId: 'ws-1',
      previousWorkspaceTitle: 'My Workspace',
    });
    expect(state.pendingPreviousWorkspace).toEqual({ id: 'ws-1', title: 'My Workspace' });
  });

  it('does not set pendingPreviousWorkspace when id or title is missing', () => {
    expect(
      mapInitialRepoToFormState({ previousWorkspaceId: 'ws-1' }).pendingPreviousWorkspace,
    ).toBeUndefined();
    expect(
      mapInitialRepoToFormState({ previousWorkspaceTitle: 'title' }).pendingPreviousWorkspace,
    ).toBeUndefined();
  });

  it('handles repo with no repoPath', () => {
    const state = mapInitialRepoToFormState({});
    expect(state.repoPath).toBeUndefined();
    expect(state.repoType).toBeUndefined();
    expect(state.isValidPath).toBeUndefined();
    expect(state.isNewRepo).toBeUndefined();
    expect(state.githubUrl).toBeUndefined();
  });
});

describe('getLastSelectedRepoHydrationAction', () => {
  const readyInput = {
    isHydrated: true,
    alreadyHandled: false,
    hasPrefillData: false,
    isFormPersistenceEnabled: true,
    currentRepoPath: '',
    hasLastSelectedRepo: true,
  };

  it('waits for both Redux hydration and lastSelectedRepo readiness', () => {
    expect(getLastSelectedRepoHydrationAction({ ...readyInput, isHydrated: false })).toBe('wait');
    expect(getLastSelectedRepoHydrationAction({ ...readyInput, hasLastSelectedRepo: false })).toBe('wait');
  });

  it('restores only when hydration is ready and no repo has been selected', () => {
    expect(getLastSelectedRepoHydrationAction(readyInput)).toBe('restore');
  });

  it('skips replay when persistence is disabled or current form state already has a repo', () => {
    expect(
      getLastSelectedRepoHydrationAction({ ...readyInput, isFormPersistenceEnabled: false }),
    ).toBe('skip');
    expect(
      getLastSelectedRepoHydrationAction({ ...readyInput, currentRepoPath: '/typed' }),
    ).toBe('skip');
  });
});
