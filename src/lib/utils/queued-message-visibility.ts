/**
 * Queued-message visibility.
 *
 * Queue entries arrive via `agent.getQueue` / `agent:queue:updated`
 * (PROTOCOL §5.5). User-typed entries never carry an origin tag; daemon-origin
 * entries (agent-to-agent sends, event-notification wakes, hook wakes, system
 * wakes) carry `messageMetadata` with a `type` string, a daemon-stamped
 * `fromAgentId`, or `source: 'system'`. Benign fields that can appear on user
 * entries (`userAppMessageId`, `queueInfo`) do not mark an entry as non-user.
 * Absent or malformed metadata means the entry is shown (fail open, matching
 * the graceful fallback of the attribution utils). Display-only: the daemon
 * queue, drain order, and flush behavior are untouched.
 */

import type { QueuedMessage } from '$shared/types';

/**
 * True when a queued entry is user-authored and should render in the
 * queued-messages section. An entry is NON-user (hidden) iff its
 * `messageMetadata` is an object and any of: `type` is a string,
 * `fromAgentId` is a non-empty string, or `source === 'system'`.
 */
export function isUserQueuedMessage(message: QueuedMessage): boolean {
  const metadata = message.messageMetadata;
  if (!metadata || typeof metadata !== 'object') return true;
  const md = metadata as Record<string, unknown>;
  // Explicit contract pin for dismissal notifications (`agent.dismissQuestions`,
  // `{ type: 'questions_dismissed', source: 'system', dismissedQuestionsMessageId }`):
  // the undelivered entry never renders in the queued-message list. Redundant
  // with the generic string-`type` rule below, kept as belt-and-braces.
  if (md.type === 'questions_dismissed') return false;
  if (typeof md.type === 'string') return false;
  if (typeof md.fromAgentId === 'string' && md.fromAgentId.trim() !== '') return false;
  if (md.source === 'system') return false;
  return true;
}
