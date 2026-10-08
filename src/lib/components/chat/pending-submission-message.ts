import type { AgentMessage, QueuedMessage } from '$shared/types';
import type { PendingSubmission } from '$store/renderer/slices/pending-submissions/pending-submissions-types';

/** Display only. Never insert these rows into the authoritative transcript. */
export function pendingSubmissionMessage(
  submission: Pick<PendingSubmission, 'id' | 'content' | 'imageBlocks' | 'fileBlocks'> &
    Partial<PendingSubmission>,
): AgentMessage {
  return {
    // Submission IDs are opaque wire identities, already admitted by the sender/daemon.
    id: submission.id,
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
