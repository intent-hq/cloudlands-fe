import type { LastAttemptedMessage } from '$store/renderer/slices/chat-state/chat-state-types';
import type { QueuedMessage } from '$shared/types';

/** A queue append can retain an older ID and accumulate text and attachments. */
export function buildQueuedRecordedAttempt(
  message: QueuedMessage,
  attempt: LastAttemptedMessage,
): LastAttemptedMessage {
  return buildRecordedAttempt(message.content, {
    ...attempt.options,
    ...(message.imageBlocks !== undefined ? { imageBlocks: message.imageBlocks } : {}),
    ...(message.fileBlocks !== undefined ? { fileBlocks: message.fileBlocks } : {}),
    ...(message.messageMetadata !== undefined ? { messageMetadata: message.messageMetadata } : {}),
  });
}

/** Retry exactly the entries admitted for one provider turn, preserving their order. */
export function buildProcessedRecordedAttempt(
  messages: readonly QueuedMessage[],
  attempt: LastAttemptedMessage,
): LastAttemptedMessage {
  const options = { ...attempt.options };
  // Absence in the admitted payload is authoritative too; never retain stale files/tags.
  delete options.imageBlocks;
  delete options.fileBlocks;
  delete options.messageMetadata;
  const images = messages.flatMap((message) => message.imageBlocks ?? []);
  const files = messages.flatMap((message) => message.fileBlocks ?? []);
  if (images.length) options.imageBlocks = images;
  if (files.length) options.fileBlocks = files;
  if (messages.length === 1) {
    if (messages[0].messageMetadata !== undefined)
      options.messageMetadata = messages[0].messageMetadata;
  } else if (messages.some((message) => message.messageMetadata !== undefined)) {
    options.messageMetadata = {
      mergedMessageMetadata: messages.flatMap((message) => {
        const metadata = message.messageMetadata;
        return Array.isArray(metadata?.mergedMessageMetadata)
          ? metadata.mergedMessageMetadata
          : [metadata ?? null];
      }),
    };
  }
  return buildRecordedAttempt(messages.map((message) => message.content).join('\n\n'), options);
}

/**
 * Build the retry payload a send attempt carries, for the error banner's "Try
 * again" (#941). `text` already includes any workspace-context prefix, so a
 * retry must not re-prefix it. A model override (retry-with-model, #964) rides
 * along so a subsequent "Try again" re-sends it, and image blocks are included
 * so a retry resends the attachments (#965).
 *
 * The opaque `messageMetadata` tag rides along too, so a retried wizard answer
 * keeps its `question_answers` tag (an untagged resend would leave the daemon's
 * pending question set unanswered and the sticky wizard visible).
 *
 * Single construction site shared by chat-send-service (direct/queue-on-send
 * recording) and agent-send (auto-queue park, #1011). Delivery provenance is
 * separate from payload options and never grants authority. Queue/processing
 * rebuilds intentionally omit local submission provenance.
 */
export function buildRecordedAttempt(
  text: string,
  options: {
    submission?: import('$store/renderer/slices/pending-submissions/pending-submissions-types').SubmissionReference;
    noteIds?: string[];
    model?: string;
    imageBlocks?: Array<{
      type: 'image';
      data?: string;
      mimeType?: string;
      attachmentId?: string;
    }>;
    fileBlocks?: Array<{
      type: 'file';
      attachmentId: string;
      fileName: string;
      mimeType?: string;
      size?: number;
    }>;
    messageMetadata?: Record<string, unknown>;
  },
): LastAttemptedMessage {
  const recordedOptions = {
    ...(options.noteIds !== undefined ? { noteIds: options.noteIds } : {}),
    ...(options.model !== undefined ? { model: options.model } : {}),
    ...(options.imageBlocks !== undefined ? { imageBlocks: options.imageBlocks } : {}),
    ...(options.fileBlocks !== undefined ? { fileBlocks: options.fileBlocks } : {}),
    ...(options.messageMetadata !== undefined ? { messageMetadata: options.messageMetadata } : {}),
  };
  return {
    ...(options.submission
      ? { submission: { reference: options.submission, outcome: 'uncertain' as const } }
      : {}),
    text,
    ...(Object.keys(recordedOptions).length > 0 ? { options: recordedOptions } : {}),
  };
}
