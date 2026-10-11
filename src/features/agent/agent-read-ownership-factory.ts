// The renderer has one row per agent ID. A read for a new workspace takes
// ownership of that row; an older workspace must not publish into it later.
export function createAgentReadOwnership({
  onBackendReconnected,
  getSessionWorkspace,
}: {
  onBackendReconnected: (handler: () => void) => () => void;
  getSessionWorkspace: (agentId: string) => string | undefined;
}) {
  let stop: (() => void) | undefined;
  const owners = new Map<string, { workspaceId?: string; key: string }>();
  let sequence = 0;
  let installed = false;

  function claimOwner(agentId: string, workspaceId?: string) {
    if (!installed) {
      installed = true;
      stop = onBackendReconnected(() => owners.clear());
    }
    let owner = owners.get(agentId);
    workspaceId ??= owner?.workspaceId;
    if (!owner || owner.workspaceId !== workspaceId) {
      owner = { workspaceId, key: String(++sequence) };
      owners.set(agentId, owner);
    }
    return owner;
  }

  /** A mutation must keep the same owner across every await, including reconnects. */
  function captureAgentMutationOwnership(agentId: string, workspaceId?: string) {
    const captured = claimOwner(agentId, workspaceId);
    return {
      key: captured.key,
      isCurrent: (storedWorkspaceId: string | undefined) =>
        owners.get(agentId) === captured &&
        (storedWorkspaceId === undefined ||
          captured.workspaceId === undefined ||
          storedWorkspaceId === captured.workspaceId),
    };
  }

  function claimAgentReadOwnership(agentId: string, workspaceId?: string) {
    const captured = claimOwner(agentId, workspaceId);
    const storedWorkspace = getSessionWorkspace(agentId);
    return {
      key: captured.key,
      bindWorkspace: (resolvedWorkspaceId: string) => {
        captured.workspaceId ??= resolvedWorkspaceId;
      },
      isCurrent: () => {
        const currentWorkspace = getSessionWorkspace(agentId);
        return (
          owners.get(agentId) === captured &&
          (currentWorkspace === storedWorkspace || currentWorkspace === captured.workspaceId)
        );
      },
    };
  }

  /** Fresh events must not reclaim a row from a newer workspace read. */
  function isAgentReadWorkspaceCurrent(agentId: string, workspaceId?: string): boolean {
    if (workspaceId === undefined) return true;
    const owner = owners.get(agentId);
    return !owner || owner.workspaceId === workspaceId;
  }

  return {
    claimAgentReadOwnership,
    captureAgentMutationOwnership,
    isAgentReadWorkspaceCurrent,
    release(agentId: string, workspaceId: string) {
      if (owners.get(agentId)?.workspaceId === workspaceId) owners.delete(agentId);
    },
    invalidate() {
      owners.clear();
    },
    dispose() {
      stop?.();
      stop = undefined;
      installed = false;
      owners.clear();
    },
  };
}
