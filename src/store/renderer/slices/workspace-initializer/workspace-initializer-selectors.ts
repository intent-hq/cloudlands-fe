import {
  selectCanCreateWorkspace,
  selectPrincipalActionContext,
  selectWorkspaceCreationVisible,
} from '../principal/principal-selectors';
import { selectGitLabAuthInstanceBaseUrl } from '../gitlab-auth/gitlab-auth-selectors';
import { KNOWN_REPOS_REFRESH_ID, mergeKnownRepos } from './utils/known-repos';
import { store } from '../../store';
import { getItem, getItems } from '@themislib/themis/utils/collections/collection-utils';
import {
  selectOrchestratorSpecialist,
  selectSpecialists,
} from '../specialists/specialists-selectors';
import { resolveNewWorkspaceSpecialistDefault } from './utils/new-workspace-specialist-default';

export const selectWorkspaceInitializerHydrated = store.createSelector(
  (state) => state.workspaceInitializer.hydrated,
);

export const selectCompactWorkspaceInitializerFormState = store.createSelector(
  (state) => state.workspaceInitializer.compactFormState,
);

export const selectWorkspaceInitializerOnboardingFormState = store.createSelector(
  (state) => state.workspaceInitializer.onboardingFormState,
);

export const selectWorkspaceInitializerLastSelectedRepo = store.createSelector(
  (state) => state.workspaceInitializer.lastSelectedRepo,
);

export const selectWorkspaceInitializerBranchByRepo = store.createSelector(
  (state) => state.workspaceInitializer.branchByRepo,
);

export const selectWorkspaceInitializerDefaultParentPath = store.createSelector(
  (state) => state.workspaceInitializer.defaultParentPath,
);

export const selectWorkspaceInitializerRecentRepos = store.createSelector((state) =>
  getItems(state.workspaceInitializer.recentRepos),
);

export const selectWorkspaceInitializerRecentRepoRefresh = store.createSelector(
  (state, id: string) => getItem(state.workspaceInitializer.recentRepoRefreshes, id),
);

export const selectWorkspaceInitializerDirectoryStatusCheck = store.createSelector(
  (state, id: string) => getItem(state.workspaceInitializer.directoryStatusChecks, id),
);

export const selectWorkspaceInitializerDismissedRecentRepoKeys = store.createSelector(
  (state) => state.workspaceInitializer.dismissedRecentRepoKeys,
);

export const selectWorkspaceInitializerRemoteSetups = store.createSelector((state) =>
  getItems(state.workspaceInitializer.remoteSetups),
);

export const selectWorkspaceInitializerLastSubmittedAgent = store.createSelector(
  (state) => state.workspaceInitializer.lastSubmittedAgent,
);

export const selectWorkspaceInitializerAgentByRepo = store.createSelector(
  (state) => state.workspaceInitializer.agentByRepo,
);

/** Specialist ids used to create workspaces or picked in the agent composer, most recent first. */
export const selectWorkspaceInitializerRecentSpecialistIds = store.createSelector(
  (state) => state.workspaceInitializer.recentSpecialistIds,
);

/** The agent setup last used to create a workspace in `repoKey` (`agentSettingsRepoKey`). */
export const selectWorkspaceInitializerAgentForRepo = store.createSelector(
  (state, repoKey: string) => state.workspaceInitializer.agentByRepo[repoKey] ?? null,
);

export const selectWorkspaceInitializerPendingGitHubPrefill = store.createSelector(
  (state) => state.workspaceInitializer.pendingGitHubPrefill,
);

export const selectWorkspaceInitializerDraftAuthority = store.createSelector(
  (state, id: string) => ({
    restore: getItem(state.workspaceInitializer.draftRestores, id),
    clear: getItem(state.workspaceInitializer.draftClears, id),
  }),
);

export const selectWorkspaceInitializationOutcome = store.createSelector(
  (state, consumerId: string, resourceId: string) => {
    const outcome = getItem(state.workspaceInitializer.initializationOutcomes, consumerId);
    return outcome?.resourceId === resourceId ? outcome : undefined;
  },
);

export const selectWorkspaceInitializationOutcomeForConsumer = store.createSelector(
  (state, consumerId: string) =>
    getItem(state.workspaceInitializer.initializationOutcomes, consumerId),
);

export const selectWorkspaceInitializationResume = store.createSelector(
  (state, consumerId: string) =>
    getItem(state.workspaceInitializer.initializationResumes, consumerId),
);

/**
 * The specialist id the New Workspace modal would currently start with
 * (`null` = General): its remembered selection, or the orchestrator when team
 * mode is remembered. Lets other surfaces (e.g. workspace-create proposals)
 * default to the same initial agent as the modal.
 */
export const selectNewWorkspaceDefaultSpecialist = store.createSelector((state): string | null =>
  resolveNewWorkspaceSpecialistDefault({
    compactFormState: state.workspaceInitializer.compactFormState,
    lastSubmittedAgent: state.workspaceInitializer.lastSubmittedAgent,
    specialists: selectSpecialists.select(state),
    orchestratorId: selectOrchestratorSpecialist.select(state)?.id ?? null,
  }),
);

/** A probe is requested on mount and renewed after connection/identity admission changes. */
export const selectWorkspaceInitializerGitCheckContext = store.createSelector((state) => {
  const request = state.workspaceInitializer.gitCheckRequest;
  const context = selectPrincipalActionContext.select(state);
  return request && context && selectCanCreateWorkspace.select(state)
    ? JSON.stringify([context, request])
    : null;
});

export const selectWorkspaceInitializerGitAvailability = store.createSelector((state) => {
  const context = selectWorkspaceInitializerGitCheckContext.select(state);
  const result = state.workspaceInitializer.gitCheck;
  return context && result?.context === context ? result.available : null;
});

/**
 * Every known repo, merged exactly like the New Workspace form picker: the
 * saved list at once, then the full list once the shared load lands.
 * Dismissed repos are removed; entries keep `lastUsedAt` when known.
 */
export const selectKnownRepos = store.createSelector((state) => {
  const refresh = getItem(state.workspaceInitializer.recentRepoRefreshes, KNOWN_REPOS_REFRESH_ID);
  const admission = selectPrincipalActionContext.select(state);
  return mergeKnownRepos({
    saved: getItems(state.workspaceInitializer.recentRepos),
    source: refresh && admission && refresh.admission === admission ? refresh : null,
    dismissed: state.workspaceInitializer.dismissedRecentRepoKeys,
    mode: 'all',
  });
});

/** Repos for the command palette: empty whenever the New Workspace command is hidden. */
export const selectPaletteKnownRepos = store.createSelector((state) =>
  selectWorkspaceCreationVisible.select(state) ? selectKnownRepos.select(state) : [],
);

/** Configured GitLab instance used to label and prefill GitLab entries (undefined when none). */
export const selectKnownReposGitLabInstance = store.createSelector(
  (state) => selectGitLabAuthInstanceBaseUrl.select(state) || undefined,
);
