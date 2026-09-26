import { store } from '../../store';
import type { HostRole } from '$shared/types/principal';
import { selectLabsMultiplayerEnabled } from '../user-preferences/user-preferences-selectors';

export const selectPrincipalState = store.createSelector((state) => state.principal);

/** The boot-time local backend default is not a binding. Wait for the actual window id. */
export const selectPrincipalConnectionContext = store.createSelector((state): string | null => {
  if (
    !state.connections?.hasReceivedList ||
    state.daemonHealth?.health === 'down' ||
    !state.workspaceEvents?.subscriptionGeneration ||
    state.connections.authRejected?.id === state.connections.windowBackendId
  )
    return null;
  return JSON.stringify([
    state.connections.windowBackendId,
    state.daemonHealth?.connectionGeneration,
    state.workspaceEvents.subscriptionGeneration,
  ]);
});

export const selectPrincipalSnapshot = store.createSelector((state) => {
  const principal = state.principal;
  return principal?.status === 'ready' &&
    principal.context !== null &&
    principal.context === selectPrincipalConnectionContext.select(state)
    ? principal.snapshot
    : null;
});

/** Truth about the connected host, independent of saved sessions, profiles, repos and labs. */
export const selectHostRole = store.createSelector((state): HostRole | null => {
  const snapshot = selectPrincipalSnapshot.select(state);
  if (!snapshot) return null;
  return snapshot.capabilities.hostMembership
    ? (snapshot.principal.hostRole ?? null)
    : snapshot.principal.isAdministrator
      ? 'owner'
      : 'guest';
});

export const selectCanAdministerHost = store.createSelector(
  (state) => selectHostRole.select(state) === 'owner',
);

export const selectPrincipalRevoked = store.createSelector(
  (state) =>
    state.principal?.status === 'revoked' &&
    state.principal.context !== null &&
    state.principal.context === selectPrincipalConnectionContext.select(state),
);

/** A confirmed denial can redirect; loading or malformed authority must preserve intent. */
export const selectHostAdministrationDenied = store.createSelector((state) => {
  const role = selectHostRole.select(state);
  return role === 'member' || role === 'guest' || selectPrincipalRevoked.select(state);
});

/** Owner-only reads are bound to the current admitted connection. */
export const selectHostAdministrationContext = store.createSelector((state) =>
  selectCanAdministerHost.select(state) ? selectPrincipalConnectionContext.select(state) : null,
);

export const selectCanCreateWorkspace = store.createSelector((state) => {
  const role = selectHostRole.select(state);
  return role === 'owner' || role === 'member';
});

/** Visibility only. Re-enabling Multiplayer requires a fresh read, without changing the person's role. */
export const selectCollaborationReady = store.createSelector(
  (state) =>
    selectLabsMultiplayerEnabled.select(state) === true &&
    !!selectPrincipalSnapshot.select(state) &&
    state.principal.refreshedPresentationVersion === state.principal.presentationVersion,
);

export const selectCollaborationCapabilities = store.createSelector((state) => {
  const ready = selectCollaborationReady.select(state);
  const capabilities = selectPrincipalSnapshot.select(state)?.capabilities;
  return {
    hostMembership: ready && capabilities?.hostMembership === true,
    manageHostMembers:
      ready && capabilities?.hostMembership === true && selectCanAdministerHost.select(state),
    personalPairing: ready && capabilities?.personalPairing === true,
    authenticatedDevices: ready && capabilities?.authenticatedDevices === true,
    collaborationIdentity: ready && capabilities?.collaborationIdentity === true,
  };
});
