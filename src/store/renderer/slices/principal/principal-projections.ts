import { getPrincipalConnectionContext } from './principal-context';
import type { HostRole } from '$shared/types/principal';
import type { PrincipalState } from './principal-types';
import type { PrincipalConnectionState } from './principal-context';
export type PrincipalProjectionState = PrincipalConnectionState & {
  principal: PrincipalState;
  userPreferences: { labsMultiplayerEnabled: boolean };
};
export const getPrincipalState = (state: PrincipalProjectionState) => state.principal;

export { getPrincipalConnectionContext };

export const getPrincipalSnapshot = (state: PrincipalProjectionState) => {
  const principal = state.principal;
  return principal?.status === 'ready' &&
    principal.context !== null &&
    principal.context === getPrincipalConnectionContext(state)
    ? principal.snapshot
    : null;
};

export const getHostRole = (state: PrincipalProjectionState): HostRole | null => {
  const snapshot = getPrincipalSnapshot(state);
  if (!snapshot) return null;
  return snapshot.capabilities.hostMembership
    ? (snapshot.principal.hostRole ?? null)
    : snapshot.principal.isAdministrator
      ? 'owner'
      : 'guest';
};

export const getCanAdministerHost = (state: PrincipalProjectionState) =>
  getHostRole(state) === 'owner';

export const getPrincipalRevoked = (state: PrincipalProjectionState) =>
  state.principal?.status === 'revoked' &&
  state.principal.context !== null &&
  state.principal.context === getPrincipalConnectionContext(state);

export const getHostAdministrationDenied = (state: PrincipalProjectionState) => {
  const role = getHostRole(state);
  return role === 'member' || role === 'guest' || getPrincipalRevoked(state);
};

export const getHostAdministrationContext = (state: PrincipalProjectionState) =>
  getCanAdministerHost(state) ? getPrincipalConnectionContext(state) : null;

export const getCanCreateWorkspace = (state: PrincipalProjectionState) => {
  const role = getHostRole(state);
  return role === 'owner' || role === 'member';
};

export const getCollaborationReady = (state: PrincipalProjectionState) =>
  state.userPreferences?.labsMultiplayerEnabled === true &&
  !!getPrincipalSnapshot(state) &&
  state.principal.refreshedPresentationVersion === state.principal.presentationVersion;

export const getCollaborationCapabilities = (state: PrincipalProjectionState) => {
  const ready = getCollaborationReady(state);
  const capabilities = getPrincipalSnapshot(state)?.capabilities;
  return {
    hostMembership: ready && capabilities?.hostMembership === true,
    manageHostMembers:
      ready && capabilities?.hostMembership === true && getCanAdministerHost(state),
    personalPairing: ready && capabilities?.personalPairing === true,
    authenticatedDevices: ready && capabilities?.authenticatedDevices === true,
    collaborationIdentity: ready && capabilities?.collaborationIdentity === true,
  };
};

export const getPrincipalActionContext = (state: PrincipalProjectionState) => {
  const snapshot = getPrincipalSnapshot(state);
  if (!snapshot) return null;
  return JSON.stringify([
    getPrincipalConnectionContext(state),
    snapshot.principal.id,
    snapshot.principal.hostMembershipRevision ?? null,
    getHostRole(state),
    state.principal.invalidation,
    state.principal.presentationVersion,
  ]);
};

export const getWorkspaceCreationVisible = (state: PrincipalProjectionState) =>
  getCanCreateWorkspace(state) && (getCanAdministerHost(state) || getCollaborationReady(state));
