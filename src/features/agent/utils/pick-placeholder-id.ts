/**
 * Placeholder-ID selection helper for streaming assistant messages.
 *
 * Extracted to a dedicated utility module so `agent-stream-lifecycle.ts`
 * (orchestration) does not export utility functions, per AGENTS.md.
 */

import { v4 as uuidv4 } from 'uuid';
import { createMessageId } from '$shared/types/branded-ids';
import type { AgentMessage } from '$shared/types';

/**
 * Pick the ID for a newly-created streaming assistant placeholder.
 *
 * `reusableId` is a canonical `msg_*` ID captured from the existing streaming
 * message at handler-registration time.  Because the snapshot is stale by the
 * time a placeholder is actually created, we re-validate against the current
 * `messages` list: if any message already carries that ID it must be the
 * now-finalized copy, and reusing it would collide with that finalized entry
 * during session dedup.  In that case we mint a fresh `msg_*` ID instead.
 */
export function pickPlaceholderId(
  reusableId: string | undefined,
  messages: readonly AgentMessage[],
): string {
  if (reusableId && !messages.some((m) => m.id === reusableId)) {
    return reusableId;
  }
  return createMessageId('msg_' + uuidv4());
}
