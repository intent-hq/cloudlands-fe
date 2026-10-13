import type { RendererRecoveryHandle } from '$features/events/renderer-event-recovery';

export interface AgentMetadataDemand {
  hud?: boolean;
  lineStats?: boolean;
  agentId?: string;
  bin?: 'topLevel' | 'delegated' | 'background' | 'retired';
  parentAgentId?: string;
  orphanedOnly?: boolean;
}
export const agentMetadataDemands = new Map<string, Set<AgentMetadataDemand>>();
export const agentMetadataDemandListeners = new Set<() => void>();
const owners = new Map<string, RendererRecoveryHandle>();

export function bindAgentMetadataDemandOwner(
  workspaceId: string,
  handle: RendererRecoveryHandle,
): () => void {
  owners.set(workspaceId, handle);
  return () => {
    if (owners.get(workspaceId) === handle) owners.delete(workspaceId);
  };
}
/** HUD and lifecycle reads share one workspace metadata resource. */
export function acquireAgentMetadataDemand(
  workspaceId: string,
  input: AgentMetadataDemand = {},
): () => void {
  const demand = { ...input };
  const set = agentMetadataDemands.get(workspaceId) ?? new Set<AgentMetadataDemand>();
  agentMetadataDemands.set(workspaceId, set);
  set.add(demand);
  for (const listener of agentMetadataDemandListeners) listener();
  // Activation is synchronous. Retain this exact owner, never a replacement
  // discovered after an ordinary caller has already released its demand.
  const handle = owners.get(workspaceId);
  let released = false;
  const remove = () => {
    if (!set.delete(demand)) return;
    if (!set.size && agentMetadataDemands.get(workspaceId) === set)
      agentMetadataDemands.delete(workspaceId);
    for (const listener of agentMetadataDemandListeners) listener();
  };
  return () => {
    if (released) return;
    released = true;
    if (handle && (handle.status.stale || handle.status.running))
      void handle.whenSettled().then(remove);
    else remove();
  };
}
