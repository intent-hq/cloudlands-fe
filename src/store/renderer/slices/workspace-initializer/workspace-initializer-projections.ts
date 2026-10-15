import { getItems } from '@themislib/themis/utils/collections/collection-utils';
import type {
  WorkspaceInitializerHydrationState,
  WorkspaceInitializerState,
} from './workspace-initializer-types';

type InitializerProjectionState = { workspaceInitializer: WorkspaceInitializerState };

/** The daemon settings bag deliberately excludes transient request and hydration state. */
export function getWorkspaceInitializerPersistedState({
  workspaceInitializer: state,
}: InitializerProjectionState): WorkspaceInitializerHydrationState {
  return {
    compactFormState: state.compactFormState,
    onboardingFormState: state.onboardingFormState,
    lastSelectedRepo: state.lastSelectedRepo,
    branchByRepo: state.branchByRepo,
    defaultParentPath: state.defaultParentPath,
    recentRepos: getItems(state.recentRepos),
    dismissedRecentRepoKeys: state.dismissedRecentRepoKeys,
    remoteSetups: getItems(state.remoteSetups),
    lastSubmittedAgent: state.lastSubmittedAgent,
  };
}

export function getWorkspaceInitializerGitCheckContext(
  state: InitializerProjectionState,
  principalActionContext: string | null,
  canCreateWorkspace: boolean,
): string | null {
  const request = state.workspaceInitializer.gitCheckRequest;
  return request && principalActionContext && canCreateWorkspace
    ? JSON.stringify([principalActionContext, request])
    : null;
}

export function getWorkspaceInitializerGitAvailability(
  state: InitializerProjectionState,
  context: string | null,
) {
  const result = state.workspaceInitializer.gitCheck;
  return context && result?.context === context ? result.available : null;
}

/** Persist the retained receipt itself; authority-filtered views are only for UI admission. */
export const getWorkspaceInitializerLocalCreation = (state: InitializerProjectionState) =>
  state.workspaceInitializer.localCreation;

/** A successful receipt read belongs to one admitted host generation. */
export const getWorkspaceInitializerReceiptContext = (state: InitializerProjectionState) =>
  state.workspaceInitializer.localReceiptContext;
