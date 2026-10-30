import type { AgentSession } from '$shared/types';
import { classifyAgentScope } from '$shared/utils/agent-scope';

/** A session that can still be shown: not retired, deleted or awaiting deletion. */
export function isWorkingAgent(agent: AgentSession): boolean {
  return !agent.retiredAt && !agent.pendingDeleteAt && agent.status !== 'deleted';
}

/**
 * Latest activity for ordering agents: the session's activity stamp or its last
 * message, whichever is later. Missing or unparseable times count as 0 (oldest).
 */
export function agentActivityTimestamp(agent: AgentSession): number {
  const stamp = new Date(agent.lastActivity ?? agent.updatedAt ?? agent.createdAt).getTime() || 0;
  const lastMessage = agent.messages.at(-1)?.timestamp;
  const messageTime = lastMessage ? new Date(lastMessage).getTime() || 0 : 0;
  return Math.max(stamp, messageTime);
}

/**
 * The working top-level agent (neither background nor delegated) with the most recent
 * activity; ties go to the newer agent, then the id. Falls back to the most recently
 * active working agent of any scope so a workspace with agents never resolves to nothing.
 */
export function resolveLatestActiveTopLevelAgent(agents: AgentSession[]): AgentSession | null {
  const ranked = agents
    .filter(isWorkingAgent)
    .map((agent) => ({
      agent,
      activity: agentActivityTimestamp(agent),
      created: new Date(agent.createdAt).getTime() || 0,
    }))
    .sort(
      (left, right) =>
        right.activity - left.activity ||
        right.created - left.created ||
        String(left.agent.id).localeCompare(String(right.agent.id)),
    );
  return (
    ranked.find(({ agent }) => classifyAgentScope(agent) === 'topLevel')?.agent ??
    ranked[0]?.agent ??
    null
  );
}
