import { onBackendReconnected } from '$lib/client/live/backend-transport';
import { store as appStore } from '$store/renderer/store';

// The renderer has one row per agent ID. A read for a new workspace takes
// ownership of that row; an older workspace must not publish into it later.
const owners = new Map<string, { workspaceId?: string; key: string }>();
let sequence = 0;
let installed = false;

export function claimAgentReadOwnership(agentId: string, workspaceId?: string) {
  if (!installed) {
    installed = true;
    onBackendReconnected(() => owners.clear());
  }
  let owner = owners.get(agentId);
  workspaceId ??= owner?.workspaceId;
  if (!owner || owner.workspaceId !== workspaceId) {
    owner = { workspaceId, key: String(++sequence) };
    owners.set(agentId, owner);
  }
  const captured = owner;
  const storedWorkspace = appStore.state.agentSessions?.byAgentId[agentId]?.workspaceId;
  return {
    key: captured.key,
    bindWorkspace: (resolvedWorkspaceId: string) => {
      captured.workspaceId ??= resolvedWorkspaceId;
    },
    isCurrent: () => {
      const currentWorkspace = appStore.state.agentSessions?.byAgentId[agentId]?.workspaceId;
      return (
        owners.get(agentId) === captured &&
        (currentWorkspace === storedWorkspace || currentWorkspace === captured.workspaceId)
      );
    },
  };
}

/** Events and mutation echoes must not reclaim a row from a newer workspace read. */
export function isAgentReadWorkspaceCurrent(agentId: string, workspaceId?: string): boolean {
  if (workspaceId === undefined) return true;
  const owner = owners.get(agentId);
  return !owner || owner.workspaceId === workspaceId;
}
