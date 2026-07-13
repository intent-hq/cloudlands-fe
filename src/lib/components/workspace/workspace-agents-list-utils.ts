import type { AgentSession } from '$shared/types';

export interface WorkspaceAgentsVisibilitySummary {
  totalCount: number;
  topLevelForegroundCount: number;
  delegatedCount: number;
  backgroundCount: number;
}

function isBackgroundAgent(agent: AgentSession): boolean {
  return !!(agent.isBackground || agent.metadata?.isBackground);
}

function getParentAgentId(agent: AgentSession): AgentSession['id'] | undefined {
  return typeof agent.metadata?.createdByAgentId === 'string'
    ? (agent.metadata.createdByAgentId as AgentSession['id'])
    : undefined;
}

export function getWorkspaceAgentsVisibilitySummary(
  agents: AgentSession[],
): WorkspaceAgentsVisibilitySummary {
  const dedupedAgents: AgentSession[] = [];
  const seen = new Set<string>();

  for (const agent of Array.isArray(agents) ? agents : []) {
    if (agent?.id && !seen.has(agent.id)) {
      seen.add(agent.id);
      dedupedAgents.push(agent);
    }
  }

  const agentIds = new Set(dedupedAgents.map((agent) => agent.id));
  const delegatedIds = new Set<string>();
  let backgroundCount = 0;

  for (const agent of dedupedAgents) {
    if (isBackgroundAgent(agent)) {
      backgroundCount++;
    }

    const parentId = getParentAgentId(agent);
    if (parentId && agentIds.has(parentId)) {
      delegatedIds.add(agent.id);
    }
  }

  const topLevelForegroundCount = dedupedAgents.filter(
    (agent) => !isBackgroundAgent(agent) && !delegatedIds.has(agent.id),
  ).length;

  return {
    totalCount: dedupedAgents.length,
    topLevelForegroundCount,
    delegatedCount: delegatedIds.size,
    backgroundCount,
  };
}
