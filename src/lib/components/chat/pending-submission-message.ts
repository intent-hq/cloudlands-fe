import type { AgentMessage, QueuedMessage } from '$shared/types';
import { createMessageId } from '$shared/types/branded-ids';
import type { PendingSubmission } from '$store/renderer/slices/pending-submissions/pending-submissions-types';

/** Display only. Never insert these rows into the authoritative transcript. */
export function pendingSubmissionMessage(
  submission: Pick<PendingSubmission, 'id' | 'content' | 'imageBlocks' | 'fileBlocks'> &
    Partial<PendingSubmission>,
): AgentMessage {
  return {
    id: createMessageId(submission.id),
    appMessageId: submission.appMessageId,
    role: 'user',
    timestamp: new Date(submission.createdAt ?? 0).toISOString(),
    contentBlocks: [
      ...(submission.content ? [{ type: 'text' as const, text: submission.content }] : []),
      ...(submission.imageBlocks ?? []),
      ...(submission.fileBlocks ?? []),
    ],
    metadata: submission.messageMetadata,
  };
}

export function processingSubmissionMessage(row: QueuedMessage): AgentMessage {
  return pendingSubmissionMessage({ ...row, createdAt: Date.parse(row.queuedAt) });
}
