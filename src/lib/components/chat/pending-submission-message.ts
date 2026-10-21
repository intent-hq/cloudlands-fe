import type { AgentMessage, QueuedMessage } from '$shared/types';
import type { MessageAuthor } from '$shared/types/agent-message';
import type { PendingSubmission } from '$store/renderer/slices/pending-submissions/pending-submissions-types';

/** Display only. Never insert these rows into the authoritative transcript. */
export function pendingSubmissionMessage(
  submission: Pick<PendingSubmission, 'id' | 'content' | 'imageBlocks' | 'fileBlocks'> &
    Partial<PendingSubmission> & { author?: MessageAuthor | null },
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
    // A processing row is a drained queue entry: keep the daemon's served author
    // so its sender row and preamble strip match the confirmed row.
    ...(submission.author !== undefined ? { author: submission.author } : {}),
  };
}

export function processingSubmissionMessage(row: QueuedMessage): AgentMessage {
  return pendingSubmissionMessage({ ...row, createdAt: Date.parse(row.queuedAt) });
}
