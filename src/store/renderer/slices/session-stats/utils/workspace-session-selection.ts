import type { AgentSession } from '$shared/types/agent-session';
import { isAuggieSession } from '$shared/types/agent-session';
import { AgentStatus } from '$shared/types';
import type { WorkspaceStatsSessionRequest } from '../session-stats-types';

interface WorkspaceStatsCandidate {
  agentId: string;
  sessionId: string | null | undefined;
  messageCount: number;
  activeRank: number;
  foregroundRank: number;
  recency: number;
}

interface ResolvedWorkspaceStatsCandidate extends WorkspaceStatsCandidate {
  sessionId: string;
}

export const MAX_WORKSPACE_STATS_SESSION_IDS = 20;

function isBackgroundAgent(agent: AgentSession): boolean {
  return !!(agent.isBackground || agent.metadata?.isBackground);
}

function isActiveStatsCandidate(agent: AgentSession): boolean {
  return (
    agent.isProcessing === true ||
    agent.isStreaming === true ||
    agent.isResponding === true ||
    agent.status === AgentStatus.Active ||
    agent.status === AgentStatus.Processing ||
    agent.status === AgentStatus.Waiting
  );
}

function timestampValue(value: Date | string | undefined): number {
  if (!value) return 0;
  const timestamp = value instanceof Date ? value.getTime() : Date.parse(value);
  return Number.isFinite(timestamp) ? timestamp : 0;
}

function agentRecency(agent: AgentSession): number {
  return Math.max(
    timestampValue(agent.lastActivity),
    timestampValue(agent.updatedAt),
    timestampValue(agent.endedAt),
    timestampValue(agent.startedAt),
    timestampValue(agent.createdAt),
  );
}

function hasResolvedSessionId(
  entry: WorkspaceStatsCandidate,
): entry is ResolvedWorkspaceStatsCandidate {
  return typeof entry.sessionId === 'string' && entry.sessionId.length > 0;
}

export function getWorkspaceStatsSessionRequests(
  agents: AgentSession[],
  maxSessionIds = MAX_WORKSPACE_STATS_SESSION_IDS,
): WorkspaceStatsSessionRequest[] {
  const seen = new Set<string>();
  return agents
    .filter(isAuggieSession)
    .map((agent) => ({
      agentId: String(agent.id),
      sessionId: agent.acpSessionId ?? agent.backendSessionId,
      activeRank: isActiveStatsCandidate(agent) ? 1 : 0,
      foregroundRank: isBackgroundAgent(agent) ? 0 : 1,
      recency: agentRecency(agent),
      messageCount: Array.isArray(agent.messages) ? agent.messages.length : 0,
    }))
    .filter(hasResolvedSessionId)
    .sort((a, b) =>
      b.activeRank - a.activeRank ||
      b.foregroundRank - a.foregroundRank ||
      b.recency - a.recency,
    )
    .reduce<WorkspaceStatsSessionRequest[]>((requests, entry) => {
      if (requests.length >= maxSessionIds || seen.has(entry.sessionId)) {
        return requests;
      }
      seen.add(entry.sessionId);
      requests.push({
        agentId: entry.agentId,
        sessionId: entry.sessionId,
        messageCount: entry.messageCount,
        isActive: entry.activeRank > 0,
      });
      return requests;
    }, []);
}

export function getWorkspaceStatsSessionIds(
  agents: AgentSession[],
  maxSessionIds = MAX_WORKSPACE_STATS_SESSION_IDS,
): string[] {
  return getWorkspaceStatsSessionRequests(agents, maxSessionIds).map(
    (request) => request.sessionId,
  );
}