import type { AgentSession } from '$shared/types';
import { classifyAgentScope } from '$shared/utils/agent-scope';

function byCreatedOrder(left: AgentSession, right: AgentSession): number {
  const leftTime = new Date(left.createdAt).getTime();
  const rightTime = new Date(right.createdAt).getTime();
  const normalizedLeft = Number.isFinite(leftTime) ? leftTime : Number.MAX_SAFE_INTEGER;
  const normalizedRight = Number.isFinite(rightTime) ? rightTime : Number.MAX_SAFE_INTEGER;
  return normalizedLeft - normalizedRight || String(left.id).localeCompare(String(right.id));
}

function newestUserMessageTimestamp(agent: AgentSession): number | null {
  let newest: number | null = null;
  for (const message of agent.messages) {
    if (message.role !== 'user') continue;
    const timestamp = new Date(message.timestamp).getTime();
    if (Number.isFinite(timestamp) && (newest === null || timestamp > newest)) newest = timestamp;
  }
  if (newest !== null || !agent.lastUserMessage) return newest;
  // AgentLite restores omit transcripts. Its persisted preview proves a user
  // message exists, and lastActivity is the available durable ordering stamp.
  const restoredTimestamp = new Date(agent.lastActivity ?? agent.updatedAt).getTime();
  return Number.isFinite(restoredTimestamp) ? restoredTimestamp : null;
}

/** Resolve the daemon-owned initial agent without inventing a replacement. */
export function resolveCanonicalInitialAgent(agents: AgentSession[]): AgentSession | null {
  // Retired sessions (§5.5 soft retire) are read-only archive rows — never
  // resolve one as the workspace's initial agent (mirrors resolveEmptyLayoutAgent).
  const ordered = agents.filter((agent) => !agent.retiredAt).sort(byCreatedOrder);
  return (
    ordered.find((agent) => agent.isInitialAgent === true) ??
    ordered.find((agent) => agent.metadata?.isInitialAgent === true) ??
    ordered.find((agent) => !agent.isBackground && !agent.parentSessionId) ??
    ordered.find((agent) => !agent.isBackground) ??
    ordered[0] ??
    null
  );
}

/** First-open defaults use list order, preferring the existing top-level coordinator. */
export function resolveExistingWorkspaceDefaultAgent(
  agents: AgentSession[],
  workspaceId: string,
): AgentSession | null {
  const eligible = agents.filter(
    (agent) =>
      String(agent.workspaceId) === workspaceId &&
      agent.status !== 'deleted' &&
      !agent.pendingDeleteAt &&
      !agent.retiredAt &&
      classifyAgentScope(agent) === 'topLevel' &&
      !agent.parentSessionId,
  );
  return (
    eligible.find(
      (agent) => (agent.metadata?.specialist ?? agent.agentMetadata?.specialist) === 'spec-writer',
    ) ??
    eligible[0] ??
    null
  );
}

/** Resolve the primary agent that should fill an otherwise empty restored layout. */
export function resolveEmptyLayoutAgent(
  agents: AgentSession[],
  workspaceId: string,
  allowInitialAgent = false,
): AgentSession | null {
  const eligibleAgents = agents.filter(
    (agent) =>
      String(agent.workspaceId) === workspaceId &&
      agent.status !== 'deleted' &&
      !agent.pendingDeleteAt &&
      !agent.retiredAt,
  );
  if (allowInitialAgent) {
    const initialAgent = [...eligibleAgents]
      .sort(byCreatedOrder)
      .find(
        (agent) =>
          agent.isInitialAgent === true ||
          agent.metadata?.isInitialAgent === true ||
          agent.agentMetadata?.isInitialAgent === true,
      );
    if (initialAgent) return initialAgent;
  }
  // The primary candidate must be a top-level row (shared `agent-scope` bin —
  // neither delegated nor background). Forked sessions (`parentSessionId`) are
  // excluded as a separate rule: a fork is not delegated, but it is a
  // continuation of another session rather than the workspace's own primary.
  const orderedPrimaryAgents = agents
    .filter(
      (agent) =>
        String(agent.workspaceId) === workspaceId &&
        agent.status !== 'deleted' &&
        !agent.pendingDeleteAt &&
        !agent.retiredAt &&
        agent.isInitialAgent !== true &&
        agent.metadata?.isInitialAgent !== true &&
        agent.agentMetadata?.isInitialAgent !== true &&
        classifyAgentScope(agent) === 'topLevel' &&
        !agent.parentSessionId,
    )
    .sort(byCreatedOrder);
  let newestAgent: AgentSession | null = null;
  let newestTimestamp = Number.NEGATIVE_INFINITY;
  for (const agent of orderedPrimaryAgents) {
    const timestamp = newestUserMessageTimestamp(agent);
    if (timestamp !== null && timestamp > newestTimestamp) {
      newestAgent = agent;
      newestTimestamp = timestamp;
    }
  }
  return newestAgent;
}
