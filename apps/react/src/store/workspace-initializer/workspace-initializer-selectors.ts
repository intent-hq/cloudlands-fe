import { store } from '@/store';
import {
  getPrincipalActionContext,
  getCanCreateWorkspace,
} from '../../../../../src/store/renderer/slices/principal/principal-projections';
import * as drafts from '../../../../../src/store/renderer/slices/workspace-initializer/workspace-initializer-projections';
import * as creation from '../../../../../src/store/renderer/slices/workspace-initializer/workspace-local-creation-projections';
export const selectWorkspaceInitializerState = store.createSelector(
  (state) => state.workspaceInitializer,
);
export const selectWorkspaceInitializerPersistedState = store.createSelector(
  drafts.getWorkspaceInitializerPersistedState,
);
export const selectWorkspaceInitializerGitCheckContext = store.createSelector((state) =>
  drafts.getWorkspaceInitializerGitCheckContext(
    state,
    getPrincipalActionContext(state),
    getCanCreateWorkspace(state),
  ),
);
export const selectWorkspaceInitializerGitAvailability = store.createSelector((state) =>
  drafts.getWorkspaceInitializerGitAvailability(
    state,
    selectWorkspaceInitializerGitCheckContext.select(state),
  ),
);
export const selectWorkspaceLocalCreationAuthority = store.createSelector(
  creation.getWorkspaceLocalCreationAuthority,
);
export const selectWorkspaceLocalCreationLease = store.createSelector(
  creation.getWorkspaceLocalCreationLease,
);
export const selectWorkspaceLocalCreation = store.createSelector(
  creation.getWorkspaceLocalCreation,
);

export const selectWorkspaceLocalCreationProgress = store.createSelector((state) => {
  const intent = creation.getWorkspaceLocalCreation(state);
  return intent ? (state.workspaceCreateProgress.byProgressId[intent.id] ?? null) : null;
});

export const selectWorkspaceLocalCreationReady = store.createSelector(
  creation.getWorkspaceLocalCreationReady,
);

export const selectWorkspaceInitializerReceiptContext = store.createSelector(
  drafts.getWorkspaceInitializerReceiptContext,
);
