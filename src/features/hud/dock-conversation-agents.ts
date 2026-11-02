import { appClient } from '$lib/client';
import { resolveCanonicalInitialAgent } from '$store/renderer/slices/workspace-agents/workspace-agents-selectors';
import { classifyAgentScope } from '$shared/utils/agent-scope';
import { CHIEF_WORKSPACE_ID } from '$shared/types/branded-ids';

export interface DockConversationAgentRow {
  id: string;
  name: string;
  /** The workspace's authoritative main agent (never an arbitrary fallback row). */
  isMain: boolean;
}

/** Live agents a dock conversation can address in `workspaceId`. */
export async function loadDockConversationAgents(
  workspaceId: string,
): Promise<DockConversationAgentRow[]> {
  const scopes =
    workspaceId === CHIEF_WORKSPACE_ID
      ? (['topLevel'] as const)
      : (['topLevel', 'delegated', 'background'] as const);
  const rows = (
    await Promise.all(scopes.map((scope) => appClient.agents.list(workspaceId, { scope })))
  ).flat();
  // Older daemons can ignore scope; deduplicate before presenting overrides.
  const agents = [
    ...new Map(
      rows
        .filter(
          (agent) =>
            String(agent.workspaceId) === workspaceId &&
            !agent.retiredAt &&
            agent.status !== 'deleted' &&
            !agent.pendingDeleteAt,
        )
        .map((agent) => [agent.id, agent]),
    ).values(),
  ];
  const mainAgent = resolveCanonicalInitialAgent(
    agents.filter(
      (agent) =>
        classifyAgentScope(agent) === 'topLevel' &&
        !agent.parentSessionId &&
        (agent.isInitialAgent === true ||
          agent.metadata?.isInitialAgent === true ||
          agent.agentMetadata?.isInitialAgent === true),
    ),
  );
  return agents.map((agent) => ({
    id: agent.id,
    name: agent.name || agent.id,
    isMain: workspaceId !== CHIEF_WORKSPACE_ID && agent.id === mainAgent?.id,
  }));
}
