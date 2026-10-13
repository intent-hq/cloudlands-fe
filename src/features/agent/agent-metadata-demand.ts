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
  return () => {
    if (!set.delete(demand)) return;
    if (!set.size) agentMetadataDemands.delete(workspaceId);
    for (const listener of agentMetadataDemandListeners) listener();
  };
}
