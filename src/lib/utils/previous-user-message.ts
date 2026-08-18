/**
 * Previous-user-message selection for chat jump navigation.
 *
 * Transcript rows arrive via `agent.getConversation` / `chat.subscribe`
 * (PROTOCOL §5.5). User-typed rows never carry an origin tag; automated
 * user-role rows (agent-to-agent sends, event-notification wakes, hook wakes,
 * PR-monitor wakes, system wakes) carry `metadata` with a string `type`, a
 * daemon-stamped `fromAgentId`, or `source: 'system'` — the same authorship
 * rules as `isUserQueuedMessage` in queued-message-visibility.ts, plus a
 * text-prefix fallback for legacy rows that lost metadata during persistence.
 */

import type { AgentMessage } from '$shared/types';
import { extractAllContent } from '$shared/types';
import { isUserAuthoredMetadata } from './message-authorship';

const LEGACY_AUTOMATED_PREFIXES = ['[WORKSPACE EVENTS]', '[TASK WAKE]', '[AGENT MESSAGE]'];

/**
 * True when a transcript message is automated (system-initiated, not
 * user-typed). A message is automated iff the shared authorship core
 * (message-authorship.ts, also used by `isUserQueuedMessage`) classifies its
 * `metadata` as non-user — string `type` except the user-authored
 * `question_answers` wizard tag, non-empty `fromAgentId`, or
 * `source === 'system'` — or, as a legacy fallback for rows that lost
 * metadata, its text starts with a known automated-message prefix.
 */
export function isAutomatedChatMessage(message: AgentMessage): boolean {
  const metadata = message.metadata;
  if (metadata && typeof metadata === 'object') {
    const md = metadata as Record<string, unknown>;
    // Strict parity with the canonical predicate (which has no text
    // fallback): a `question_answers` row is user-authored, pinned even
    // against the legacy prefix fallback below.
    if (md.type === 'question_answers') return false;
    if (!isUserAuthoredMetadata(metadata)) return true;
  }

  // Fallback for legacy messages that lost metadata during persistence
  const text = extractAllContent(message);
  return LEGACY_AUTOMATED_PREFIXES.some((prefix) => text.startsWith(prefix));
}

/**
 * Pick the nearest user-authored message that precedes `currentMessageId`
 * in the full message order. Works when the current message is itself an
 * automated row: the walk starts from its position in the unfiltered list.
 * Returns `null` when the current message is not in the list or no
 * user-authored message precedes it (callers scroll to top).
 */
export function findPreviousUserMessage(
  messages: AgentMessage[],
  currentMessageId: string,
): AgentMessage | null {
  const currentIndex = messages.findIndex((m) => m.id === currentMessageId);
  if (currentIndex < 0) return null;

  for (let i = currentIndex - 1; i >= 0; i--) {
    const message = messages[i];
    if (message.role === 'user' && !isAutomatedChatMessage(message)) {
      return message;
    }
  }
  return null;
}
