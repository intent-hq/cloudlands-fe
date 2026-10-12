import { onBackendReconnected } from '$lib/client/live/backend-transport';
import { store as appStore } from '$store/renderer/store';

// The renderer has one row per agent ID. A read for a new workspace takes
// ownership of that row; an older workspace must not publish into it later.
const owners = new Map<string, { workspaceId?: string; key: string; context: string }>();
let sequence = 0;
let installed = false;

/** Include invalidation even while admission is loading, so successive identities never coalesce. */
export function getAgentReadContext(): string {
  try {
    const state = appStore.state;
    return JSON.stringify([
      state.connections?.windowBackendId,
      state.daemonHealth?.connectionGeneration,
      state.daemonHealth?.health,
      state.workspaceEvents?.subscriptionGeneration,
      state.principal?.context,
      state.principal?.boundPrincipalId,
      state.principal?.invalidation,
    ]);
  } catch {
    // Raw readers also run in isolated stores without a mounted renderer.
    return 'unmounted';
  }
}

function claimOwner(agentId: string, workspaceId?: string) {
  if (!installed) {
    installed = true;
    onBackendReconnected(() => owners.clear());
  }
  const context = getAgentReadContext();
  let owner = owners.get(agentId);
  workspaceId ??= owner?.workspaceId;
  if (!owner || owner.workspaceId !== workspaceId || owner.context !== context) {
    owner = { workspaceId, key: String(++sequence), context };
    owners.set(agentId, owner);
  }
  return owner;
}

/** A mutation must keep the same owner across every await, including reconnects. */
export function captureAgentMutationOwnership(agentId: string, workspaceId?: string) {
  const captured = claimOwner(agentId, workspaceId);
  return {
    key: captured.key,
    isCurrent: (storedWorkspaceId: string | undefined) =>
      owners.get(agentId) === captured &&
      captured.context === getAgentReadContext() &&
      (storedWorkspaceId === undefined ||
        captured.workspaceId === undefined ||
        storedWorkspaceId === captured.workspaceId),
  };
}

export function claimAgentReadOwnership(agentId: string, workspaceId?: string) {
  const captured = claimOwner(agentId, workspaceId);
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
        captured.context === getAgentReadContext() &&
        (currentWorkspace === storedWorkspace || currentWorkspace === captured.workspaceId)
      );
    },
  };
}

/** Fresh events must not reclaim a row from a newer workspace read. */
export function isAgentReadWorkspaceCurrent(agentId: string, workspaceId?: string): boolean {
  if (workspaceId === undefined) return true;
  const owner = owners.get(agentId);
  return !owner || owner.context !== getAgentReadContext() || owner.workspaceId === workspaceId;
}
