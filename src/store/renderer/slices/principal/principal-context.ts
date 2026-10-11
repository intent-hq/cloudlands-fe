import type { ConnectionsState } from '../connections/connections-types';
import type { DaemonHealthState } from '../daemon-health/daemon-health-types';
import type { WorkspaceEventsState } from '../workspace-events/workspace-events-slice';

export type PrincipalConnectionState = {
  connections: ConnectionsState;
  daemonHealth: DaemonHealthState;
  workspaceEvents: WorkspaceEventsState;
};

/** The boot-time local backend default is not a binding. Wait for the actual window id. */
export function getPrincipalConnectionContext(state: PrincipalConnectionState): string | null {
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
