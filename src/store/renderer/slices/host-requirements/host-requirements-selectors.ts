/**
 * Host Requirements Selectors
 */

import { getItems } from '@themislib/themis/utils/collections/collection-utils';
import { isGitOptionalWithoutForge } from '$lib/components/workspace/initializer/plain-folder-create';
import { store } from '../../store';
import type { StoreState } from '../../types';

export const selectGitRequirement = store.createSelector((state) => state.hostRequirements.git);

export const selectNodeRequirement = store.createSelector((state) => state.hostRequirements.node);

/** Informational only — never part of the onboarding gate. */
export const selectGhRequirement = store.createSelector((state) => state.hostRequirements.gh);

export const selectHostRequirementsChecking = store.createSelector(
  (state) => state.hostRequirements.checking,
);

export const selectHostRequirementsHasCheckedOnce = store.createSelector(
  (state) => state.hostRequirements.hasCheckedOnce,
);

/**
 * Labs: with no forge connected Git is not needed to finish onboarding; it is
 * needed only when a git workspace is created. Reads raw state so a partial
 * store (tests, older daemons) keeps Git required.
 */
function gitOptional(state: StoreState): boolean {
  const gitlabFailed = state.gitlabAuth?.statusFailed === true;
  return isGitOptionalWithoutForge({
    labsEnabled: state.userPreferences?.labsPlainFolderWorkspacesEnabled === true,
    protocolVersion: state.daemonHealth?.stats?.protocolVersion,
    githubConnected: state.githubAuth?.isAuthenticated === true,
    githubSettled: state.githubAuth?.statusSettled === true,
    githubFailed: state.githubAuth?.statusFailed === true,
    gitlabConnected: state.gitlabAuth?.isConfigured === true,
    gitlabSettled: state.gitlabAuth?.statusReady === true || gitlabFailed,
    gitlabFailed,
  });
}

export const selectGitOptional = store.createSelector(gitOptional);

/** Terminal gate: node meets the minimum version AND git is available (unless optional). */
export const selectAllRequirementsMet = store.createSelector(
  (state) =>
    state.hostRequirements.node.ok && (state.hostRequirements.git.available || gitOptional(state)),
);

export const selectProviderCliRequirements = store.createSelector((state) => {
  const result = state.hostRequirements.providerCli;
  return result ? { context: result.context, warnings: getItems(result.warnings) } : undefined;
});
