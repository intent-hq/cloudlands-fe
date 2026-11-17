/**
 * Host Requirements Selectors
 */

import { getItems } from '@themislib/themis/utils/collections/collection-utils';
import { isGitOptionalWithoutForge } from '$lib/components/workspace/initializer/plain-folder-create';
import { store } from '../../store';
import { selectIsOrchestratorBackend } from '../principal/principal-selectors';
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

/**
 * Node.js is needed only where providers run. An orchestrator runs none
 * (agents run on its machines), so there it needs git only (PROTOCOL
 * `methods/nodes.md` → "Orchestrator mode").
 */
export const selectNodeRequired = store.createSelector(
  (state) => !selectIsOrchestratorBackend.select(state),
);

/** Terminal gate: node meets the minimum version (where required) AND git is available (unless optional). */
export const selectAllRequirementsMet = store.createSelector(
  (state) =>
    (state.hostRequirements.node.ok || !selectNodeRequired.select(state)) &&
    (state.hostRequirements.git.available || gitOptional(state)),
);

export const selectProviderCliRequirements = store.createSelector((state) => {
  const result = state.hostRequirements.providerCli;
  return result ? { context: result.context, warnings: getItems(result.warnings) } : undefined;
});
