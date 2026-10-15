import { getItem } from '@themislib/themis/utils/collections/collection-utils';
import type { Workspace } from '$shared/types';
import { CHIEF_WORKSPACE_ID, ROOT_WORKSPACE_ID } from '$shared/types/branded-ids';
import type { WorkspaceState } from './workspace-slice';
import {
  getPrincipalActionContext,
  getPrincipalSnapshot,
  getHostRole,
  getCanAdministerHost,
  getCollaborationReady,
  getPrincipalRevoked,
  type PrincipalProjectionState,
} from '../principal/principal-projections';
export type WorkspaceAuthorityProjectionState = PrincipalProjectionState & {
  workspace: WorkspaceState;
};
export const getWorkspaceListLoadedForBackend = (
  state: WorkspaceAuthorityProjectionState,
  backendId: string,
) => {
  if (!state.workspace.hasLoaded || state.workspace.loadedBackendId !== backendId) return false;
  const context = getPrincipalActionContext(state);
  if (
    state.workspace.capabilityContext != null ||
    getPrincipalSnapshot(state)?.capabilities.hostMembership
  ) {
    return context !== null && context === state.workspace.capabilityContext;
  }
  return true;
};

export const getWorkspaceCapabilitiesReady = (state: WorkspaceAuthorityProjectionState) => {
  const context = getPrincipalActionContext(state);
  return (
    context !== null &&
    state.workspace.capabilityContext === context &&
    getWorkspaceListLoadedForBackend(state, state.connections.windowBackendId)
  );
};

export const getWorkspaceById = (state: WorkspaceAuthorityProjectionState, wsId: string) => {
  return getItem(state.workspace.workspaces, wsId as Workspace['id']);
};

export const getCanManageWorkspace = (state: WorkspaceAuthorityProjectionState, wsId: string) => {
  const snapshot = getPrincipalSnapshot(state);
  const role = getHostRole(state);
  if (!snapshot || role === null) return false;
  // Virtual host administration never inherits member workspace rights.
  if (wsId === CHIEF_WORKSPACE_ID || wsId === ROOT_WORKSPACE_ID) return role === 'owner';
  const workspace = getWorkspaceById(state, wsId);
  if (!workspace) return false;
  if (snapshot.capabilities.hostMembership) {
    return getWorkspaceCapabilitiesReady(state) && workspace?.canManage === true;
  }
  // A guest may retain ownership of one workspace without owning the host.
  return workspace.myRole === 'owner' || (role === 'owner' && workspace.myRole !== 'collaborator');
};

export const getWorkspaceManagementDenied = (
  state: WorkspaceAuthorityProjectionState,
  wsId: string,
) => {
  if (getPrincipalRevoked(state)) return true;
  const role = getHostRole(state);
  if (role === null) return false;
  if (wsId === CHIEF_WORKSPACE_ID || wsId === ROOT_WORKSPACE_ID) return role !== 'owner';
  const workspace = getWorkspaceById(state, wsId);
  if (getPrincipalSnapshot(state)?.capabilities.hostMembership) {
    return getWorkspaceCapabilitiesReady(state) && workspace?.canManage === false;
  }
  return workspace?.myRole === 'collaborator';
};

export const getWorkspaceManagementVisible = (
  state: WorkspaceAuthorityProjectionState,
  wsId: string,
) =>
  getCanManageWorkspace(state, wsId) &&
  (getCanAdministerHost(state) || getCollaborationReady(state));

export const getIsWorkspaceCollaborator = (
  state: WorkspaceAuthorityProjectionState,
  wsId: string,
) => getWorkspaceActionContext(state, wsId) === null;

export const getWorkspaceActionContext = (
  state: WorkspaceAuthorityProjectionState,
  wsId: string,
) =>
  getHostRole(state) !== 'guest' && getWorkspaceManagementVisible(state, wsId)
    ? getPrincipalActionContext(state)
    : null;

export const getWorkspaceParticipationContext = (
  state: WorkspaceAuthorityProjectionState,
  wsId: string,
) => {
  const snapshot = getPrincipalSnapshot(state);
  if (!snapshot) return null;
  // Chief is a host-owner surface, without an ordinary workspace membership row.
  if (wsId === CHIEF_WORKSPACE_ID)
    return getCanAdministerHost(state) ? getPrincipalActionContext(state) : null;
  if (snapshot.capabilities.hostMembership && !getWorkspaceCapabilitiesReady(state)) return null;
  if (!getCanAdministerHost(state) && !getCollaborationReady(state)) return null;
  const row = getWorkspaceById(state, wsId);
  if (!row || (row.myRole !== 'owner' && row.myRole !== 'collaborator' && row.canManage !== true))
    return null;
  return getPrincipalActionContext(state);
};

export const getWorkspacePermissionContext = (
  state: WorkspaceAuthorityProjectionState,
  wsId: string,
) =>
  getPrincipalSnapshot(state)?.capabilities.hostMembership
    ? getWorkspaceManagementVisible(state, wsId)
      ? getPrincipalActionContext(state)
      : null
    : getWorkspaceParticipationContext(state, wsId);

export const getWorkspaceDeletionTokens = (state: WorkspaceAuthorityProjectionState) =>
  state.workspace.deletionTokens;

/** workspace.update collaborator fields from the frozen daemon capability contract. */
export const getWorkspaceUpdateContext = (
  state: WorkspaceAuthorityProjectionState,
  wsId: string,
  fields: string[],
): string | null => {
  const context = getWorkspaceParticipationContext(state, wsId);
  if (!context) return null;
  // workspace.update has a scoped owner/manager gate, independently of the
  // host-execution gate on scripts, terminals and direct lifecycle methods.
  if (getWorkspaceManagementVisible(state, wsId)) return context;
  return fields.every((field) =>
    ['id', 'title', 'tags', 'statusMessage', 'statusImageAssetId'].includes(field),
  )
    ? context
    : null;
};

export const getWorkspaceListReadStatus = (state: WorkspaceAuthorityProjectionState) => {
  const read = state.workspace.listReadStatus;
  return read?.context === getPrincipalActionContext(state) ? read.status : undefined;
};
