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
import { isUserAuthoredMetadata } from './message-authorship';
import { getQueuedMessageId } from './queue-info';

/**
 * Canonical queue-visibility predicate: true when a queued entry is
 * user-authored and should render in the queued-messages section. An entry
 * is NON-user (hidden) iff its `messageMetadata` is an object and any of:
 * `type` is a string (except the user-authored `question_answers` wizard
 * tag), `fromAgentId` is a non-empty string, or `source === 'system'`.
 * Every daemon-origin entry — agent-to-agent sends, event-notification
 * wakes, hook wakes, PR-monitor wakes, `questions_dismissed`,
 * `source: 'system'` — stays hidden. The rules live in the shared
 * authorship core (message-authorship.ts), also used by the transcript
 * predicate in previous-user-message.ts.
 */
export function isUserQueuedMessage(message: QueuedMessage): boolean {
  return isUserAuthoredMetadata(message.messageMetadata);
}

/**
 * Drop queue entries that have already landed in the transcript. The daemon
 * emits the drained user row (stamped `queueInfo.queuedMessageId` = the
 * entry's `id`, PROTOCOL §5.5) BEFORE the shrunk `agent:queue:updated`
 * snapshot, so for one event interval both the row and its queue entry are
 * present; an entry named by a transcript row is omitted for that interval.
 * Rows without the stamp (older daemons) never match, so their entries stay
 * listed until the snapshot removes them. Display-only: the canonical queue
 * state is untouched.
 */
export function omitDrainedQueuedMessages<T extends Pick<QueuedMessage, 'id'>>(
  queuedMessages: readonly T[],
  transcriptMessages: readonly { metadata?: unknown }[],
): T[] {
  const drained = new Set<string>();
  for (const message of transcriptMessages) {
    const id = getQueuedMessageId(message.metadata);
    if (id) drained.add(id);
  }
  if (drained.size === 0) return [...queuedMessages];
  return queuedMessages.filter((queued) => !drained.has(queued.id));
}
