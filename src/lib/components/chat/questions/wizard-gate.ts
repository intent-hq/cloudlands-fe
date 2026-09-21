import type { AgentMessage } from '$shared/types';
import { getQuestionFromResourceBlock } from '$shared/types/question-resource';
import type { StoreState } from '$store/renderer/types';
import {
  selectAgentIsResponding,
  selectAgentMessageById,
} from '$store/renderer/slices/agent-session/agent-session-selectors';
import { selectAgentQueueMessages } from '$store/renderer/slices/agent-queue/agent-queue-selectors';
import { isQuestionMessageDismissed } from '$shared/utils/question-dismissal';
import {
  classifyPendingQuestionMarker,
  derivePendingQuestions,
  isQuestionSetAnswered,
  isQuestionSetAnsweredInQueue,
  type PendingQuestionSet,
} from './pending-questions';

/**
 * Production wizard gate. The daemon's `pendingQuestionsMessageId` metadata is
 * authoritative when present: the marked question set stays pending across
 * later automatic/user turns (the marker is written once the asking turn has
 * ended) until the daemon clears it, a tagged answer row names it (in the
 * transcript or still sitting in the agent's queue), or the user dismisses
 * it. Transcript derivation remains the compatibility fallback when
 * the marker is absent; only that fallback gates on the agent's OWN active
 * turn (`selectAgentIsResponding`) — NOT the broad `selectAgentIsRunning`
 * gate, which stays true while the agent merely waits on delegated agents
 * (isWaitingForOtherAgents) and must not suppress the wizard.
 * A question set the user dismissed never pends: the daemon persists
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
  const queuedMessages = selectAgentQueueMessages.select(state, agentId);
  const session = state.agentSessions?.byAgentId[agentId];
  const marker = classifyPendingQuestionMarker(session?.metadata?.pendingQuestionsMessageId);
  const markedMessage =
    marker.kind === 'set'
      ? (messages.find((message) => message.id === marker.messageId) ??
        selectAgentMessageById.select(state, agentId, marker.messageId))
      : undefined;
  const recovery = state.chatState?.byAgentId[agentId]?.pendingQuestionRecovery;
  const recoveredPending =
    marker.kind === 'set' &&
    !markedMessage &&
    recovery?.messageId === marker.messageId &&
    recovery.status === 'found' &&
    recovery.questions &&
    recovery.questions.length > 0
      ? { messageId: marker.messageId, questions: recovery.questions }
      : null;
  // A marked message recovered from the paged history segment is not in the
  // tail; prepend it so the marker path can still find it while the tail is
  // scanned for a tagged answer row.
  const derivationMessages =
    marker.kind === 'set' && markedMessage && !messages.includes(markedMessage)
      ? [markedMessage, ...messages]
      : messages;
  const pending = recoveredPending
    ? showingPendingUserMessage ||
      isQuestionSetAnswered(messages, recoveredPending.messageId) ||
      isQuestionSetAnsweredInQueue(queuedMessages, recoveredPending.messageId)
      ? null
      : recoveredPending
    : derivePendingQuestions(
        derivationMessages,
        isTurnActive,
        showingPendingUserMessage,
        marker.kind === 'set' ? marker.messageId : marker.kind === 'cleared' ? '' : undefined,
        queuedMessages,
      );
  if (!pending) return null;
  if (isQuestionMessageDismissed(session?.metadata, pending.messageId)) return null;
  return pending;
}

/**
 * True when the locally cached marked row carries its terminal question
 * content: a daemon-canonical settled assistant row with at least one
 * question resource. A `provisional` row — one the renderer settled itself
 * (placeholder, firehose-settled row, or a partial frozen when the standing
 * subscription closed mid-turn) — or one still flagged as streaming predates
 * the §7.1 delta that delivers the drained question blocks, so it cannot
 * speak for the marker: the indicator (`deriveAgentHasPendingQuestion`)
 * treats it as absent and stays lit. The wizard itself
 * (`deriveWizardPendingQuestions` → `derivePendingQuestions`) is not gated
 * here: a provisional row that already carries question blocks still yields
 * its set, as it did before the marker existed.
 */
function hasTerminalQuestionContent(message: AgentMessage): boolean {
  return (
    message.role === 'assistant' &&
    message.provisional !== true &&
    message.isStreaming !== true &&
    (message.contentBlocks ?? []).some((block) => getQuestionFromResourceBlock(block) !== null)
  );
}

/**
 * Indicator-only pending predicate for the agent card / panel avatar /
 * sidebar badge. True when the wizard gate yields a set, OR when the daemon
 * marker is set and nothing local resolves it: no dismissal, no tagged answer
 * row (in the tail or still queued), and no local copy of the marked message
 * that actually carries its question content (a frozen partial / empty
 * placeholder left behind when the chat went out of view mid-turn does not
 * count — only the standing `chat.subscribe` delivers the terminal question
 * blocks, and the firehose writes no rows for an uncovered agent). The marker
 * reaches session metadata independently of the transcript, so an
 * out-of-view agent must light up on the marker alone. Mirrors
 * `deriveMarkedQuestionRecoveryState`'s fail-closed stance: a `not-found` /
 * exhausted recovery for the current marker still pends until the daemon
 * clears or replaces the marker. The wizard itself keeps calling
 * `deriveWizardPendingQuestions` — it needs the actual question set.
 */
export function deriveAgentHasPendingQuestion(
  state: StoreState,
  agentId: string,
  messages: readonly AgentMessage[],
): boolean {
  if (deriveWizardPendingQuestions(state, agentId, messages)) return true;
  const session = state.agentSessions?.byAgentId[agentId];
  const marker = classifyPendingQuestionMarker(session?.metadata?.pendingQuestionsMessageId);
  if (marker.kind !== 'set') return false;
  if (isQuestionMessageDismissed(session?.metadata, marker.messageId)) return false;
  if (isQuestionSetAnswered(messages, marker.messageId)) return false;
  const queuedMessages = selectAgentQueueMessages.select(state, agentId);
  if (isQuestionSetAnsweredInQueue(queuedMessages, marker.messageId)) return false;
  const markedMessage =
    messages.find((message) => message.id === marker.messageId) ??
    selectAgentMessageById.select(state, agentId, marker.messageId);
  if (markedMessage) return !hasTerminalQuestionContent(markedMessage);
  const recovery = state.chatState?.byAgentId[agentId]?.pendingQuestionRecovery;
  const hasRecoveredSet =
    recovery?.messageId === marker.messageId &&
    recovery.status === 'found' &&
    !!recovery.questions &&
    recovery.questions.length > 0;
  return !hasRecoveredSet;
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
  const marker = classifyPendingQuestionMarker(
    state.agentSessions?.byAgentId[agentId]?.metadata?.pendingQuestionsMessageId,
  );
  if (marker.kind !== 'set') return null;
  if (selectAgentMessageById.select(state, agentId, marker.messageId)) return null;
  const recovery = state.chatState?.byAgentId[agentId]?.pendingQuestionRecovery;
  if (recovery?.messageId === marker.messageId) {
    // Exhaustion ends network retries, not marker authority: keep the ordinary
    // composer fail-closed until the daemon clears or replaces the marker.
    const hasRecoveredWizard =
      recovery.status === 'found' && !!recovery.questions && recovery.questions.length > 0;
    return {
      messageId: marker.messageId,
      shouldRequest: false,
      loading: !hasRecoveredWizard,
    };
  }
  return { messageId: marker.messageId, shouldRequest: true, loading: true };
}
