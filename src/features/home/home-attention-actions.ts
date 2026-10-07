import type { AgentSession } from '$shared/types';
import {
  agentSessionDismissQuestionsRequested,
  agentSessionRetryLastMessageRequested,
} from '$store/renderer/slices/agent-session/agent-session-slice';
import { canRetryHomeAgent, currentHomeQuestion, isHomeAttentionAgent } from './home-attention';

/** Recheck live state after confirmation; never substitute a newer question id. */
export function homeDismissQuestionAction(
  workspaceId: string,
  agent: AgentSession | undefined,
  messageId: string,
) {
  if (
    !agent ||
    !isHomeAttentionAgent(workspaceId, agent) ||
    currentHomeQuestion(agent) !== messageId
  )
    return null;
  return agentSessionDismissQuestionsRequested(agent.id, workspaceId, messageId);
}

/** A click may arrive after recovery; do not resend into a newly active turn. */
export function homeRetryAgentAction(workspaceId: string, agent: AgentSession | undefined) {
  if (!agent || !isHomeAttentionAgent(workspaceId, agent) || !canRetryHomeAgent(agent)) return null;
  return agentSessionRetryLastMessageRequested(agent.id, workspaceId);
}
