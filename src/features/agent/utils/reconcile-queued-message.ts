import type { QueuedMessage } from '$shared/types';

/** Fold a mutation echo only when no authoritative snapshot has superseded it. */
export function reconcileQueuedMessage(
  messages: QueuedMessage[],
  persisted: QueuedMessage,
): QueuedMessage[] {
  if (!messages.some((message) => message.id === persisted.id)) return [...messages, persisted];
  return messages.map((message) =>
    message.id === persisted.id
      ? {
          ...persisted,
          // Raw mutation results lack serve-time profiles. Only getQueue/events
          // can authoritatively clear a previously known author's projection.
          ...(persisted.author == null && message.author !== undefined
            ? { author: message.author }
            : {}),
        }
      : message,
  );
}
