import { WorkspaceStatusEnum } from '$shared/types';
import { selectKnownRepos } from '$store/renderer/slices/known-repos/known-repos-selectors';
import {
  selectWorkspaceItems,
  selectIsCollaboratorOnlyClient,
} from '$store/renderer/slices/workspace/workspace-selectors';
import {
  buildRepoPathLookup,
  groupWorkspacesByRepository,
} from '$lib/components/workspace/utils/workspace-grouping';
import { store } from '$store/renderer/store';
export const selectHomeWorkspaceView = store.createSelector((state) => state.homeWorkspaces);
export const selectHomeWorkspaceError = store.createSelector((state) => state.workspace.error);

import { selectPrincipalSnapshot } from '$store/renderer/slices/principal/principal-selectors';
import { homePersistenceKey } from './home-workspaces-persistence';

/** Storage never borrows an unconfirmed boot identity or another window's account. */
export const selectHomePersistenceScope = store.createSelector((state): string | null => {
  const principal = selectPrincipalSnapshot.select(state)?.principal.id;
  const backend = state.connections?.hasReceivedList ? state.connections.windowBackendId : null;
  return principal && backend ? homePersistenceKey(backend, principal) : null;
});

/** Resolve the sidebar selection using the same repository identities as Home. */
export const selectHomeWorkspaceRepository = store.createSelector((state) => {
  const { repoKey } = selectHomeWorkspaceView.select(state);
  if (!repoKey) return undefined;
  const collaborator = selectIsCollaboratorOnlyClient.select(state);
  const workspaces = selectWorkspaceItems
    .select(state)
    .filter(
      (workspace) => workspace.status !== WorkspaceStatusEnum.Deleted && !workspace.pendingDeleteAt,
    );
  const knownRepos = collaborator ? [] : selectKnownRepos.select(state);
  return groupWorkspacesByRepository({
    workspaces,
    knownRepos,
    repoPathLookup: buildRepoPathLookup(workspaces, knownRepos),
    includeKnownRepos: !collaborator,
  }).find((repo) => repo.key === repoKey);
});
