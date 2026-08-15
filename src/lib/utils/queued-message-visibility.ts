/**
 * Queued-message visibility.
 *
 * Queue entries arrive via `agent.getQueue` / `agent:queue:updated`
 * (PROTOCOL §5.5). User-typed entries never carry an origin tag; daemon-origin
 * entries (agent-to-agent sends, event-notification wakes, hook wakes,
 * PR-monitor wakes, system wakes) carry `messageMetadata` with a `type`
 * string, a daemon-stamped `fromAgentId`, or `source: 'system'`. Benign
 * fields that can appear on user entries (`userAppMessageId`, `queueInfo`) do
 * not mark an entry as non-user. Absent or malformed metadata means the entry
 * is shown (fail open). Display-only: the daemon queue, drain order, and
 * flush behavior are untouched.
 */

import type { QueuedMessage } from '$shared/types';

/**
 * Canonical queue-visibility predicate: true when a queued entry is
 * user-authored and should render in the queued-messages section. An entry
 * is NON-user (hidden) iff its `messageMetadata` is an object and any of:
 * `type` is a string (except the user-authored `question_answers` wizard
 * tag), `fromAgentId` is a non-empty string, or `source === 'system'`.
 * Every daemon-origin entry — agent-to-agent sends, event-notification
 * wakes, hook wakes, PR-monitor wakes, `questions_dismissed`,
 * `source: 'system'` — stays hidden.
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
  // The Q&A wizard's answer message is USER-authored despite its tag
  // (`{ type: 'question_answers', answeredQuestionsMessageId }`, see
  // questions/answer-message.ts): it travels through the ordinary send path
  // and can be auto-queued during the turn-startup race, so it must stay
  // visible (editable/removable/sendable) in the queue.
  if (md.type === 'question_answers') return true;
  if (typeof md.type === 'string') return false;
  if (typeof md.fromAgentId === 'string' && md.fromAgentId.trim() !== '') return false;
  if (md.source === 'system') return false;
  return true;
}
