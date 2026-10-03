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
  return {
    edit: own,
    remove: own || owner || isHostOwner,
    sendNow: (own || isHostOwner) && !isProtectedMonitorWake(message),
  };
}

/** Resolve only an exact active editor identity, never an author/position guess. */
export function findQueuedMessageForEdit(
  messages: readonly QueuedMessage[],
  messageId: string | null,
): QueuedMessage | undefined {
  if (!messageId) return undefined;
  return messages.find((message) =>
    message.editing && message.editingMessageId
      ? message.editingMessageId === messageId
      : message.id === messageId,
  );
}

/** Monitor wake delivery belongs to the daemon's monitor lifecycle. */
function isProtectedMonitorWake(message: QueuedMessage): boolean {
  return (
    message.messageMetadata?.type === 'script_monitor_wake' &&
    typeof message.messageMetadata.monitorId === 'string'
  );
}

/** Mirror the daemon's explicit-batch readiness; individual owner sends may authorize imports. */
export function isQueuedMessageReadyForBatch(message: QueuedMessage, now = Date.now()): boolean {
  const metadata = message.messageMetadata;
  const principal = metadata?.fromPrincipalId;
  const unbound =
    metadata &&
    Object.hasOwn(metadata, 'humanAuthor') &&
    !(typeof principal === 'string' && principal.length > 0);
  const held = message.holdKind !== undefined && Date.parse(message.holdUntil ?? '') > now;
  return !message.editing && !held && !unbound && !isProtectedMonitorWake(message);
}
