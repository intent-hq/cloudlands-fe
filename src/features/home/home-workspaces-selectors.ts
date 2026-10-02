import { store } from '$store/renderer/store';
export const selectHomeWorkspaceView = store.createSelector((state) => state.homeWorkspaces);
export const selectHomeWorkspaceError = store.createSelector((state) => state.workspace.error);
export const selectHomeWorkspaceSummaries = store.createSelector(
  (state) => state.workspaceSummaries.byWorkspaceId,
);

import { selectPrincipalSnapshot } from '$store/renderer/slices/principal/principal-selectors';
import { homePersistenceKey } from './home-workspaces-persistence';

/** Storage never borrows an unconfirmed boot identity or another window's account. */
export const selectHomePersistenceScope = store.createSelector((state): string | null => {
  const principal = selectPrincipalSnapshot.select(state)?.principal.id;
  const backend = state.connections?.hasReceivedList ? state.connections.windowBackendId : null;
  return principal && backend ? homePersistenceKey(backend, principal) : null;
});
