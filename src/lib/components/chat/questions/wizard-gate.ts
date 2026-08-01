import type { AgentMessage } from '$shared/types';
import type { StoreState } from '$store/renderer/types';
import { selectAgentIsResponding } from '$store/renderer/slices/agent-session/agent-session-selectors';
import { derivePendingQuestions, type PendingQuestionSet } from './pending-questions';

/**
 * Production wizard gate: pending questions derive against the agent's OWN
 * active turn (`selectAgentIsResponding`) — NOT the broad
 * `selectAgentIsRunning` gate, which stays true while the agent merely waits
 * on delegated agents (isWaitingForOtherAgents) and must not suppress the
 * wizard. A question set the user dismissed never pends: the daemon persists
 * `dismissedQuestionsMessageId` in session metadata (`agent.dismissQuestions`,
 * PROTOCOL §5.5), so the suppression survives reload/rehydrate; a NEWER
 * question-bearing message (different id) pends normally. Lives outside
 * pending-questions.ts so that module stays dependency-light (no stores).
 * Shared by ChatPanel and the regression suite so tests exercise the real
 * gate.
 */
export function deriveWizardPendingQuestions(
  state: StoreState,
  agentId: string,
  messages: readonly AgentMessage[],
  showingPendingUserMessage = false,
): PendingQuestionSet | null {
  const isTurnActive = selectAgentIsResponding.select(state, agentId);
  const pending = derivePendingQuestions(messages, isTurnActive, showingPendingUserMessage);
  if (!pending) return null;
  const session = state.agentSessions?.byAgentId[agentId];
  const dismissedId = session?.metadata?.dismissedQuestionsMessageId;
  if (typeof dismissedId === 'string' && dismissedId === pending.messageId) return null;
  return pending;
}
