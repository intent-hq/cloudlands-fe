import type { LastAttemptedMessage } from '$store/renderer/slices/chat-state/chat-state-types';

/**
 * Build the retry payload a send attempt carries, for the error banner's "Try
 * again" (#941). `text` already includes any workspace-context prefix, so a
 * retry must not re-prefix it. A model override (retry-with-model, #964) rides
 * along so a subsequent "Try again" re-sends it, and image blocks are included
 * so a retry resends the attachments (#965).
 *
 * The opaque `messageMetadata` tag rides along too, so a retried wizard answer
 * keeps its `question_answers` tag (an untagged resend would leave the daemon's
 * question hold pending).
 *
 * Single construction site shared by chat-send-service (direct/queue-on-send
 * recording) and agent-send (auto-queue park, #1011) — the park reducer's
 * structural-equality clear relies on both producing the exact same shape,
 * so drift between hand-rolled copies would silently break it.
 */
export function buildRecordedAttempt(
  text: string,
  options: {
    noteIds?: string[];
    model?: string;
    imageBlocks?: Array<{ type: 'image'; data: string; mimeType: string }>;
    messageMetadata?: Record<string, unknown>;
  },
): LastAttemptedMessage {
  const recordedOptions = {
    ...(options.noteIds !== undefined ? { noteIds: options.noteIds } : {}),
    ...(options.model !== undefined ? { model: options.model } : {}),
    ...(options.imageBlocks !== undefined ? { imageBlocks: options.imageBlocks } : {}),
    ...(options.messageMetadata !== undefined
      ? { messageMetadata: options.messageMetadata }
      : {}),
  };
  return {
    text,
    ...(Object.keys(recordedOptions).length > 0 ? { options: recordedOptions } : {}),
  };
}
