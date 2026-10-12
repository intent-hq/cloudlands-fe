import { getItems } from '@themislib/themis/utils/collections/collection-utils';
import type { StoreSelectorSelect } from '@themislib/themis/types';
import type { AgentSessionState } from '../agent-session/agent-session-types';
import type { ConnectionsState } from '../connections/connections-types';
import type { WorkspaceState } from '../workspace/workspace-slice';

type PermissionRecoveryProjectionState = {
  connections: Pick<ConnectionsState, 'windowBackendId'>;
  workspace: Pick<WorkspaceState, 'workspaces'>;
  agentSessions: Pick<AgentSessionState, 'byAgentId'>;
};

/** Share the original expressions while each renderer owns its selector bindings. */
export function createPermissionRecoveryProjections<
  State extends PermissionRecoveryProjectionState,
>({
  selectPrincipalActionContext,
  selectWorkspaceListLoadedForBackend,
  selectWorkspacePermissionContext,
  selectWorkspaceManagementDenied,
}: {
  selectPrincipalActionContext: { select: StoreSelectorSelect<string | null, [], State> };
  selectWorkspaceListLoadedForBackend: { select: StoreSelectorSelect<boolean, [string], State> };
  selectWorkspacePermissionContext: { select: StoreSelectorSelect<string | null, [string], State> };
  selectWorkspaceManagementDenied: { select: StoreSelectorSelect<boolean, [string], State> };
}) {
  // A current subscription and management grants own snapshots, never agent discovery.
  // Wait for capability hydration so initial list loading does not cause a second read.
  const getPermissionRecoveryScope = (state: State) => {
    const context = selectPrincipalActionContext.select(state);
    if (
      !context ||
      !selectWorkspaceListLoadedForBackend.select(state, state.connections.windowBackendId)
    )
      return null;
    const workspaceIds = getItems(state.workspace.workspaces)
      .filter((workspace) => selectWorkspacePermissionContext.select(state, workspace.id) !== null)
      .map((workspace) => workspace.id)
      .sort();
    return JSON.stringify([context, workspaceIds]);
  };

  // Late identity/capability hydration can admit cached prompts without another RPC.
  const getPermissionRecoveryAgents = (state: State) =>
    JSON.stringify(
      Object.values(state.agentSessions.byAgentId)
        .flatMap<[string, string, string | null, boolean]>((agent) => {
          if (!agent.workspaceId) return [];
          const context = selectWorkspacePermissionContext.select(state, agent.workspaceId);
          return [
            [
              agent.id,
              agent.workspaceId,
              context,
              selectWorkspaceManagementDenied.select(state, agent.workspaceId),
            ],
          ];
        })
        .sort((a, b) => a[0].localeCompare(b[0])),
    );

  return { getPermissionRecoveryScope, getPermissionRecoveryAgents };
}
