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
/** The agent the user explicitly picked in this workspace's Home preview, if any. */
export const selectHomePreviewAgentId = store.createSelector(
  (state, workspaceId: string): string | null =>
    state.homeWorkspaces?.previewAgentIds?.[workspaceId] ?? null,
);
export const selectHomeWorkspaceError = store.createSelector((state) => state.workspace.error);

import { selectPrincipalSnapshot } from '$store/renderer/slices/principal/principal-selectors';
import { homePersistenceKey, type HomeSetAsideRecord } from './home-workspaces-persistence';

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

const NO_SET_ASIDE: Readonly<Record<string, HomeSetAsideRecord>> = Object.freeze({});
/** Set-aside records for the current account/backend only; another scope's records never leak. */
export const selectHomeSetAsideRecords = store.createSelector(
  (state): Readonly<Record<string, HomeSetAsideRecord>> => {
    const scope = selectHomePersistenceScope.select(state);
    return scope && state.homeWorkspaces?.persistenceScope === scope
      ? (state.homeWorkspaces.setAside ?? NO_SET_ASIDE)
      : NO_SET_ASIDE;
  },
);
/** Workspaces the user set aside on Home, oldest first. */
export const selectHomeSetAsideWorkspaceIds = store.createSelector((state): string[] =>
  Object.entries(selectHomeSetAsideRecords.select(state))
    .sort(([, left], [, right]) => left.at - right.at)
    .map(([id]) => id),
);
export const selectHomeWorkspaceIsSetAside = store.createSelector(
  (state, workspaceId: string): boolean =>
    Boolean(selectHomeSetAsideRecords.select(state)[workspaceId]),
);
/** The confirmed window backend the set-aside watcher may reconcile against. */
export const selectHomeSetAsideBackendId = store.createSelector((state): string | null =>
  state.connections?.hasReceivedList ? (state.connections.windowBackendId ?? null) : null,
);
