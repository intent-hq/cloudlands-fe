// Compatibility binding for Svelte consumers; remove at Svelte cutover.
import { store } from '../../store';
import * as projections from './principal-projections';
export const selectPrincipalState = store.createSelector(projections.getPrincipalState);
export const selectPrincipalConnectionContext = store.createSelector(
  projections.getPrincipalConnectionContext,
);
export const selectPrincipalSnapshot = store.createSelector(projections.getPrincipalSnapshot);
export const selectHostRole = store.createSelector(projections.getHostRole);
export const selectCanAdministerHost = store.createSelector(projections.getCanAdministerHost);
export const selectPrincipalRevoked = store.createSelector(projections.getPrincipalRevoked);
export const selectHostAdministrationDenied = store.createSelector(
  projections.getHostAdministrationDenied,
);
export const selectHostAdministrationContext = store.createSelector(
  projections.getHostAdministrationContext,
);
export const selectCanCreateWorkspace = store.createSelector(projections.getCanCreateWorkspace);
export const selectCollaborationReady = store.createSelector(projections.getCollaborationReady);
export const selectCollaborationCapabilities = store.createSelector(
  projections.getCollaborationCapabilities,
);
export const selectPrincipalActionContext = store.createSelector(
  projections.getPrincipalActionContext,
);
export const selectWorkspaceCreationVisible = store.createSelector(
  projections.getWorkspaceCreationVisible,
);
