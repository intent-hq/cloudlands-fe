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
 * is shown (fail open, matching the graceful fallback of the attribution
 * utils). Display-only: the daemon queue, drain order, and flush behavior are
 * untouched.
 */

import type { QueuedMessage } from '$shared/types';
import { getAgentMessageAttribution } from './agent-message-attribution';
import { getHookWakeAttribution } from './hook-wake-attribution';
import { getPrMonitorWakeAttribution } from './pr-monitor-wake-attribution';

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

/**
 * Canonical queue-visibility predicate: an entry renders in the
 * queued-messages section iff it is user-authored (fail-open
 * {@link isUserQueuedMessage} rules) OR it has a renderable attribution that
 * QueuedMessageList shows as a compact row — an agent-to-agent send
 * (`agent_message`), an event-notification wake (`event_notification`
 * metadata, or the `[WORKSPACE EVENTS]` content prefix for daemons that don't
 * send queue metadata yet), a background-hook wake (`hook_wake`), or a
 * PR-monitor wake (`pr_monitor_wake`). Every other daemon-origin entry —
 * `questions_dismissed`, `source: 'system'`, unknown string `type`s, and
 * tagged entries whose attribution metadata is unusable — stays hidden.
 */
export function isVisibleQueuedMessage(message: QueuedMessage): boolean {
  if (isUserQueuedMessage(message)) return true;
  const metadata = message.messageMetadata;
  if (metadata && typeof metadata === 'object') {
    const md = metadata as Record<string, unknown>;
    if (md.type === 'event_notification') return true;
  }
  if (message.content.startsWith('[WORKSPACE EVENTS]')) return true;
  if (getAgentMessageAttribution(metadata)) return true;
  if (getHookWakeAttribution(metadata)) return true;
  if (getPrMonitorWakeAttribution(metadata)) return true;
  return false;
}
