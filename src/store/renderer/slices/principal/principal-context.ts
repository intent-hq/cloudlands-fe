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
