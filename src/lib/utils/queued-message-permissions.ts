import type { QueuedMessage } from '$shared/types';
import { isUserQueuedMessage } from './queued-message-visibility';

/** Visibility never grants mutation rights. Unknown authors cannot be edited. */
export function queuedMessagePermissions(
  message: QueuedMessage | undefined,
  ownPrincipalId: string | null | undefined,
  ownerPrincipalId: string | null | undefined,
  isHostOwner = false,
): { edit: boolean; remove: boolean; sendNow: boolean } {
  if (!message || !ownPrincipalId) return { edit: false, remove: false, sendNow: false };
  const authorId = message.messageMetadata?.fromPrincipalId ?? message.author?.principalId;
  const own =
    isUserQueuedMessage(message) &&
    message.author?.principalId !== null &&
    authorId === ownPrincipalId;
  const owner = ownPrincipalId === ownerPrincipalId;
  return { edit: own, remove: own || owner || isHostOwner, sendNow: own || isHostOwner };
}
