import type { AgentMessage } from '$shared/types';
import type { StoreState } from '$store/renderer/types';
import {
  selectAgentIsResponding,
  selectAgentMessageById,
} from '$store/renderer/slices/agent-session/agent-session-selectors';
import { isQuestionMessageDismissed } from '$shared/utils/question-dismissal';
import { derivePendingQuestions, type PendingQuestionSet } from './pending-questions';

/**
 * Production wizard gate: pending questions derive against the agent's OWN
 * active turn (`selectAgentIsResponding`) — NOT the broad
 * `selectAgentIsRunning` gate, which stays true while the agent merely waits
 * on delegated agents (isWaitingForOtherAgents) and must not suppress the
 * wizard. The daemon's `pendingQuestionsMessageId` metadata is authoritative
 * when present; transcript derivation remains the compatibility fallback when
 * it is absent. A question set the user dismissed never pends: the daemon persists
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
  const session = state.agentSessions?.byAgentId[agentId];
  const marker = session?.metadata?.pendingQuestionsMessageId;
  const markedMessage =
    typeof marker === 'string' && marker.length > 0
      ? (messages.find((message) => message.id === marker) ??
        selectAgentMessageById.select(state, agentId, marker))
      : undefined;
  const recovery = state.chatState?.byAgentId[agentId]?.pendingQuestionRecovery;
  const recoveredPending =
    typeof marker === 'string' &&
    marker.length > 0 &&
    !markedMessage &&
    recovery?.messageId === marker &&
    recovery.status === 'found' &&
    recovery.questions &&
    recovery.questions.length > 0
      ? { messageId: marker, questions: recovery.questions }
      : null;
  const pending = recoveredPending
    ? isTurnActive || showingPendingUserMessage
      ? null
      : recoveredPending
    : derivePendingQuestions(
        typeof marker === 'string' && marker.length > 0 && markedMessage
          ? [markedMessage]
          : messages,
        isTurnActive,
        showingPendingUserMessage,
        typeof marker === 'string' ? marker : undefined,
      );
  if (!pending) return null;
  if (isQuestionMessageDismissed(session?.metadata, pending.messageId)) return null;
  return pending;
}

export interface MarkedQuestionRecoveryState {
  messageId: string;
  shouldRequest: boolean;
  loading: boolean;
}

/** Describe the one targeted lookup needed before a non-empty marker can render. */
export function deriveMarkedQuestionRecoveryState(
  state: StoreState,
  agentId: string,
): MarkedQuestionRecoveryState | null {
  const marker = state.agentSessions?.byAgentId[agentId]?.metadata?.pendingQuestionsMessageId;
  if (typeof marker !== 'string' || marker.length === 0) return null;
  if (selectAgentMessageById.select(state, agentId, marker)) return null;
  const recovery = state.chatState?.byAgentId[agentId]?.pendingQuestionRecovery;
  if (recovery?.messageId === marker) {
    // Exhaustion ends network retries, not marker authority: keep the ordinary
    // composer fail-closed until the daemon clears or replaces the marker.
    const hasRecoveredWizard =
      recovery.status === 'found' && !!recovery.questions && recovery.questions.length > 0;
    return {
      messageId: marker,
      shouldRequest: false,
      loading: !hasRecoveredWizard,
    };
  }
  return { messageId: marker, shouldRequest: true, loading: true };
}
