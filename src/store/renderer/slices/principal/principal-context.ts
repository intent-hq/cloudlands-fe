import type { StoreState } from '../../types';

/** The boot-time local backend default is not a binding. Wait for the actual window id. */
export function getPrincipalConnectionContext(
  state: Pick<StoreState, 'connections' | 'daemonHealth' | 'workspaceEvents'>,
): string | null {
  if (
    !state.connections?.hasReceivedList ||
    state.daemonHealth?.health === 'down' ||
    !state.workspaceEvents?.subscriptionGeneration ||
    state.workspaceEvents.subscriptionPending === true ||
    state.connections.authRejected?.id === state.connections.windowBackendId
  )
    return null;
  return JSON.stringify([
    state.connections.windowBackendId,
    state.daemonHealth?.connectionGeneration,
    state.workspaceEvents.subscriptionGeneration,
  ]);
}

/** Stable identity for a read or action within one admitted principal lifetime. */
export function getPrincipalActionContext(
  state: Pick<StoreState, 'connections' | 'daemonHealth' | 'workspaceEvents' | 'principal'>,
): string | null {
  const connection = getPrincipalConnectionContext(state);
  const principal = state.principal;
  if (principal?.status !== 'ready' || !connection || principal.context !== connection) return null;
  const snapshot = principal.snapshot;
  if (!snapshot) return null;
  const role = snapshot.capabilities.hostMembership
    ? (snapshot.principal.hostRole ?? null)
    : snapshot.principal.isAdministrator
      ? 'owner'
      : 'guest';
  return JSON.stringify([
    connection,
    snapshot.principal.id,
    snapshot.principal.hostMembershipRevision ?? null,
    role,
    principal.invalidation,
    principal.presentationVersion,
  ]);
}
