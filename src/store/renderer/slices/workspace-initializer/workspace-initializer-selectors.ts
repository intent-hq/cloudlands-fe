import {
  selectCanCreateWorkspace,
  selectPrincipalActionContext,
} from '../principal/principal-selectors';
import { store } from '../../store';
import { getItems } from '@themislib/themis/utils/collections/collection-utils';
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

export const selectWorkspaceInitializerDismissedRecentRepoKeys = store.createSelector(
  (state) => state.workspaceInitializer.dismissedRecentRepoKeys,
);

export const selectWorkspaceInitializerRemoteSetups = store.createSelector((state) =>
  getItems(state.workspaceInitializer.remoteSetups),
);

export const selectWorkspaceInitializerLastSubmittedAgent = store.createSelector(
  (state) => state.workspaceInitializer.lastSubmittedAgent,
);

export const selectWorkspaceInitializerPendingGitHubPrefill = store.createSelector(
  (state) => state.workspaceInitializer.pendingGitHubPrefill,
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
