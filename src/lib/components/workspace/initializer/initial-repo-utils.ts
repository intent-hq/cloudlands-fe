/**
 * Pure utility functions for initialRepo deduplication and state mapping.
 * Extracted from CompactWorkspaceInitializer.svelte $effect logic.
 */

export interface InitialRepoInfo {
  repoPath?: string;
  isGithub?: boolean;
  owner?: string;
  name?: string;
  environmentType?: string;
  sshConfig?: any;
  previousWorkspaceId?: string;
  previousWorkspaceTitle?: string;
}

export interface InitialRepoFormState {
  repoPath?: string;
  repoType?: 'local' | 'github' | 'remote';
  isValidPath?: boolean;
  isNewRepo?: boolean;
  scope?: string;
  branch?: string;
  githubUrl?: string;
  remoteSetup?: { type: 'remote'; ssh: any } | null;
  pendingPreviousWorkspace?: { id: string; title: string } | null;
}

/**
 * Generate a stable deduplication key from an InitialRepoInfo.
 * Concatenates non-empty fields with ':' so the same repo always produces the same key.
 */
export function getInitialRepoKey(repo: InitialRepoInfo | undefined | null): string {
  if (!repo) return '';
  return [repo.repoPath, repo.owner, repo.name, repo.environmentType, repo.previousWorkspaceId]
    .filter(Boolean)
    .join(':');
}

/**
 * Map an InitialRepoInfo to a plain object describing the form-state changes
 * the component should apply.  This is a pure function with no side effects.
 */
export function mapInitialRepoToFormState(repo: InitialRepoInfo): InitialRepoFormState {
  const state: InitialRepoFormState = {};

  if (repo.repoPath) {
    state.repoPath = repo.repoPath;
    state.isValidPath = true;
    state.isNewRepo = false;
    state.scope = '';
    state.branch = '';
    state.repoType = 'local';

    if (repo.owner && repo.name) {
      state.githubUrl = `https://github.com/${repo.owner}/${repo.name}`;
    }
  }

  if (repo.environmentType === 'remote' && repo.sshConfig) {
    state.remoteSetup = {
      type: 'remote',
      ssh: repo.sshConfig,
    };
  }

  if (repo.previousWorkspaceId && repo.previousWorkspaceTitle) {
    state.pendingPreviousWorkspace = {
      id: repo.previousWorkspaceId,
      title: repo.previousWorkspaceTitle,
    };
  }

  return state;
}
