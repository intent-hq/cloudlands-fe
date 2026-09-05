/**
 * Pure utility functions for initialRepo deduplication and state mapping.
 * Extracted from workspace creation shell.svelte $effect logic.
 */

import type { WorkspaceCreationRecentRepo } from '$store/renderer/slices/workspace-creation-settings/workspace-creation-settings-types';

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

export type LastSelectedRepoHydrationAction = 'wait' | 'skip' | 'restore' | 'restore-recent';

export interface LastSelectedRepoHydrationInput {
  isHydrated: boolean;
  alreadyHandled: boolean;
  hasPrefillData: boolean;
  isFormPersistenceEnabled: boolean;
  currentRepoPath?: string;
  hasLastSelectedRepo: boolean;
  recentRepos: WorkspaceCreationRecentRepo[];
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

/**
 * Map a recent-repo entry to the repo-selection shape used to restore form
 * state. Preserves `githubUrl` so a GitHub-type recent repo restores as a
 * GitHub selection instead of degrading to a URL-less one.
 */
export function mapRecentRepoToSelection(repo: WorkspaceCreationRecentRepo): {
  path: string;
  type: 'local' | 'github';
  githubUrl?: string;
  isValidPath: boolean;
} {
  return {
    path: repo.path,
    type: repo.type,
    githubUrl: repo.githubUrl,
    isValidPath: true,
  };
}

export function getLastSelectedRepoHydrationAction({
  isHydrated,
  alreadyHandled,
  hasPrefillData,
  isFormPersistenceEnabled,
  currentRepoPath,
  hasLastSelectedRepo,
  recentRepos,
}: LastSelectedRepoHydrationInput): LastSelectedRepoHydrationAction {
  if (!isHydrated || alreadyHandled || hasPrefillData) return 'wait';
  if (!isFormPersistenceEnabled || currentRepoPath) return 'skip';
  if (hasLastSelectedRepo) return 'restore';
  // Fall back to the most recent repo when lastSelectedRepo is unset
  if (recentRepos.length > 0) return 'restore-recent';
  return 'wait';
}
