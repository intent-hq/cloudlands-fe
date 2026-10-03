/** Queue visibility uses daemon-served attribution, shared with transcript authorship. */

import type { QueuedMessage } from '$shared/types';
import { isUserAuthoredMetadata } from './message-authorship';
import { getQueuedMessageId } from './queue-info';

/**
 * Authenticated human stamps take precedence over semantic type/source hints.
 * Automatic ingress strips human stamps; unstamped legacy rows use the shared
 * metadata fallback. Visibility never grants edit/delete authority.
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
