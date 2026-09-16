import { store } from '../../store';
import { getItems } from '@augmentcode/themis/utils/collections/collection-utils';
import {
  selectOrchestratorSpecialist,
  selectSpecialists,
} from '../specialists/specialists-selectors';
import type { WorkspaceInitializerOperation } from './workspace-initializer-types';
import { resolveNewWorkspaceSpecialistDefault } from './utils/new-workspace-specialist-default';

const EMPTY_OPERATION: WorkspaceInitializerOperation<never> = {
  status: 'idle',
  version: 0,
  data: null,
  error: null,
};

const operation = <T>(
  entries: Record<string, WorkspaceInitializerOperation<T>>,
  key: string,
): WorkspaceInitializerOperation<T> => entries[key] ?? EMPTY_OPERATION;

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

export const selectWorkspaceInitializerGitHubBranchListing = store.createSelector(
  (state, owner: string, repo: string, prefix = '') =>
    state.workspaceInitializer.githubBranchListings[JSON.stringify([owner, repo, prefix])],
);

export const selectWorkspaceInitializerPrefillRead = store.createSelector(
  (state, consume: boolean) =>
    operation(state.workspaceInitializer.prefillReads, consume ? 'consume' : 'peek'),
);
export const selectWorkspaceInitializerDraftRestore = store.createSelector(
  (state, surface: string) => operation(state.workspaceInitializer.draftRestores, surface),
);
export const selectWorkspaceInitializerSetupScriptGeneration = store.createSelector(
  (state, workspaceId: string) =>
    operation(state.workspaceInitializer.setupScriptGenerations, workspaceId),
);
export const selectWorkspaceInitializerSpecialistPreviews = store.createSelector(
  (state, provider: string) => operation(state.workspaceInitializer.specialistPreviews, provider),
);
export const selectWorkspaceInitializerCreateRequest = store.createSelector(
  (state, progressId: string) => operation(state.workspaceInitializer.createRequests, progressId),
);
export const selectWorkspaceInitializerDirectoryStatus = store.createSelector(
  (state, path: string) => operation(state.workspaceInitializer.directoryStatusReads, path),
);
export const selectWorkspaceInitializerPullRequest = store.createSelector(
  (state, owner: string, repo: string, number: number) =>
    operation(state.workspaceInitializer.pullRequestReads, JSON.stringify([owner, repo, number])),
);
export const selectWorkspaceInitializerGitRemote = store.createSelector((state, repoPath: string) =>
  operation(state.workspaceInitializer.gitRemoteReads, repoPath),
);
export const selectWorkspaceInitializerGitAvailability = store.createSelector((state) =>
  operation(state.workspaceInitializer.gitAvailabilityReads, 'default'),
);
export const selectWorkspaceInitializerProviderAvailability = store.createSelector(
  (state, key: string) => operation(state.workspaceInitializer.providerAvailabilityReads, key),
);
export const selectWorkspaceInitializerProviderTest = store.createSelector((state, key: string) =>
  operation(state.workspaceInitializer.providerTests, key),
);
export const selectWorkspaceInitializerPromptEnhancement = store.createSelector(
  (state, key: string) => operation(state.workspaceInitializer.promptEnhancements, key),
);
export const selectWorkspaceInitializerModelResolution = store.createSelector(
  (state, key: string) => operation(state.workspaceInitializer.modelResolutions, key),
);
export const selectWorkspaceInitializerRepositoryPull = store.createSelector((state, key: string) =>
  operation(state.workspaceInitializer.repositoryPulls, key),
);
export const selectWorkspaceInitializerReasoningEffortUpdate = store.createSelector(
  (state, agentId: string) => operation(state.workspaceInitializer.reasoningEffortUpdates, agentId),
);
