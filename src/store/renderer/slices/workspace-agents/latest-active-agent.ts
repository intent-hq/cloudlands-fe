import type { AgentSession } from '$shared/types';
import { classifyAgentScope } from '$shared/utils/agent-scope';

function parsedTime(value: Date | string | undefined): number {
  if (value === undefined) return Number.NEGATIVE_INFINITY;
  const time = new Date(value).getTime();
  return Number.isFinite(time) ? time : Number.NEGATIVE_INFINITY;
}

/** Latest activity signal: the session's activity stamp or its newest message, whichever is later. */
function activityTimestamp(agent: AgentSession): number {
  let newest = parsedTime(agent.lastActivity ?? agent.updatedAt ?? agent.createdAt);
  for (const message of agent.messages) newest = Math.max(newest, parsedTime(message.timestamp));
  return newest;
}

function byLatestActivity(left: AgentSession, right: AgentSession): number {
  return (
    activityTimestamp(right) - activityTimestamp(left) ||
    parsedTime(right.createdAt) - parsedTime(left.createdAt) ||
    String(left.id).localeCompare(String(right.id))
  );
}

/**
 * The working top-level agent (neither background nor delegated) with the most recent
 * activity. Falls back to the most recently active working agent of any scope so a
 * workspace with agents never resolves to nothing.
 */
export function resolveLatestActiveTopLevelAgent(agents: AgentSession[]): AgentSession | null {
  const working = agents
    .filter((agent) => agent.status !== 'deleted' && !agent.pendingDeleteAt && !agent.retiredAt)
    .sort(byLatestActivity);
  return (
    working.find((agent) => classifyAgentScope(agent) === 'topLevel' && !agent.parentSessionId) ??
    working[0] ??
    null
  );
}
