import type { AgentSession } from '$shared/types';
import { AgentStatus } from '$shared/types/agent.types';
import { getAgentAttentionRequest } from '$shared/utils/agent-attention';
import { classifyAgentScope } from '$shared/utils/agent-scope';
import { isQuestionMessageDismissed } from '$shared/utils/question-dismissal';
import {
  hasAgentActiveTurnEvidence,
  toAgentRuntimeStateInput,
} from '$shared/utils/agent-runtime-state';
import type { HomeTriageInput } from './home-model';

export interface HomeAttentionRequest {
  agentId: string;
  agentName: string;
  kind: 'question' | 'discussion' | 'blocker' | 'failed';
  reason?: string;
  timestamp?: string;
  questionMessageId: string | null;
  canRetry: boolean;
}

export function isHomeAttentionAgent(workspaceId: string, agent: AgentSession): boolean {
  return (
    agent.workspaceId === workspaceId &&
    !agent.retiredAt &&
    !agent.pendingDeleteAt &&
    agent.status !== AgentStatus.Deleted &&
    !agent.notificationsMuted &&
    classifyAgentScope(agent) === 'topLevel'
  );
}

export function currentHomeQuestion(agent: AgentSession): string | null {
  const pending = agent.metadata?.pendingQuestionsMessageId;
  return typeof pending === 'string' &&
    pending.length > 0 &&
    !isQuestionMessageDismissed(agent.metadata, pending)
    ? pending
    : null;
}

export function canRetryHomeAgent(agent: AgentSession): boolean {
  return (
    agent.status === AgentStatus.Error &&
    !hasAgentActiveTurnEvidence(toAgentRuntimeStateInput(agent))
  );
}

/** Reuse daemon-owned pending fields; a transcript's old wording is not attention. */
export function getHomeAttentionRequests(
  workspaceId: string,
  agents: AgentSession[],
): HomeAttentionRequest[] {
  return agents
    .filter((agent) => isHomeAttentionAgent(workspaceId, agent))
    .flatMap<HomeAttentionRequest>((agent) => {
      const request = getAgentAttentionRequest(agent);
      const questionMessageId = currentHomeQuestion(agent);
      const failed = agent.status === AgentStatus.Error;
      if (!request && !questionMessageId && !failed) return [];
      const timestamp = request?.timestamp ?? (failed ? agent.stopReasonTimestamp : undefined);
      return [
        {
          agentId: agent.id,
          agentName: agent.name,
          kind: request?.kind ?? (failed ? 'failed' : 'question'),
          reason: request?.reason,
          timestamp: timestamp && Number.isFinite(Date.parse(timestamp)) ? timestamp : undefined,
          questionMessageId,
          canRetry: canRetryHomeAgent(agent),
        },
      ];
    });
}

/** Mirrors Home grouping precedence, while distinguishing the actionable cause. */
export function getHomeStatusCause(workspace: HomeTriageInput) {
  if (workspace.displayStatus === 'failed') return 'failed';
  if (workspace.displayStatus === 'blocked') return 'blocked';
  if (workspace.attention === 'review_required') return 'review';
  if (workspace.displayStatus === 'needs_attention') return 'question';
  if (workspace.displayStatus === 'pr_ready') return 'pull-request';
  if (workspace.activity === 'agent_running' || workspace.displayStatus === 'in_progress')
    return 'running';
  if (workspace.displayStatus === 'pr_merged') return 'merged';
  if (workspace.displayStatus === 'complete') return 'complete';
  if (workspace.attention === 'unread') return 'unread';
  return 'idle';
}
