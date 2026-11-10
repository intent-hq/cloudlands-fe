/** Queue visibility uses daemon-served attribution, shared with transcript authorship. */

import type { QueuedMessage } from '$shared/types';
import { isUserAuthoredMetadata } from './message-authorship';

/**
 * Authenticated human stamps take precedence over semantic type/source hints.
 * Automatic ingress strips human stamps; unstamped legacy rows use the shared
 * metadata fallback. Visibility never grants edit/delete authority.
 */
export function isUserQueuedMessage(message: QueuedMessage): boolean {
  return isUserAuthoredMetadata(message.messageMetadata);
}
