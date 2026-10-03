import { evidenceSubmissionIds } from './pending-submissions-model';
import type { QueuedMessage } from '$shared/types';
import { getItems } from '@themislib/themis/utils/collections/collection-utils';
import type { PendingSubmission, PendingSubmissionEntry } from './pending-submissions-types';

/** A display row is not a QueuedMessage mutation target. Always use confirmedId + existing ACLs. */
export interface PendingQueueDisplayRow {
  key: string;
  confirmedId?: string;
  confirmed?: QueuedMessage;
  content: string;
  imageBlocks: NonNullable<QueuedMessage['imageBlocks']>;
  fileBlocks: NonNullable<QueuedMessage['fileBlocks']>;
  contextItems: NonNullable<QueuedMessage['contextItems']>;
  contributions: PendingSubmission[];
  /** Only withholds controls; false never grants authority. */
  blocksMutations: boolean;
}

function confirmedRow(message: QueuedMessage, blocked: boolean): PendingQueueDisplayRow {
  return {
    key: message.id,
    confirmedId: message.id,
    confirmed: message,
    content: message.content,
    imageBlocks: [...(message.imageBlocks ?? [])],
    fileBlocks: [...(message.fileBlocks ?? [])],
    contextItems: [...(message.contextItems ?? [])],
    contributions: [],
    blocksMutations: blocked,
  };
}

/** Pure view: confirmed inputs remain untouched, including history-overlapping retries. */
export function projectPendingSubmissions(
  entry: PendingSubmissionEntry | undefined,
  confirmedQueue: QueuedMessage[],
): {
  conversation: PendingSubmission[];
  processing: QueuedMessage[];
  queue: PendingQueueDisplayRow[];
} {
  const supported = entry?.supported === true;
  const checking = supported && (entry.refreshNeeded || entry.attemptActive);
  const queue = confirmedQueue.map((message) => confirmedRow(message, checking));
  if (!entry) return { conversation: [], processing: [], queue };
  const pending = getItems(entry.submissions);
  const queuedIds = new Set(
    confirmedQueue.flatMap((row) => evidenceSubmissionIds(row, entry.scope.principalId)),
  );
  const processing = getItems(entry.processing).filter(
    (row) => !evidenceSubmissionIds(row, entry.scope.principalId).some((id) => queuedIds.has(id)),
  );
  const conversation = pending.filter((s) => s.destination === 'conversation');
  if (!supported) return { conversation, processing, queue };
  for (const seed of getItems(entry.seeds)) {
    const index = queue.findIndex((row) => row.confirmedId === seed.id);
    const row = confirmedRow(seed, true);
    if (index >= 0) {
      // Mutation echoes lack serve-time author/eligibility, so preserve the full snapshot.
      row.confirmed = queue[index].confirmed;
      queue[index] = row;
    } else {
      row.confirmedId = undefined;
      row.confirmed = undefined;
      queue.push(row);
    }
  }
  const eligible = confirmedQueue.filter((row) => row.mergeEligible === true);
  const target =
    !checking &&
    eligible.length === 1 &&
    eligible[0].author?.principalId === entry.scope.principalId &&
    !!eligible[0].submissionIds?.length &&
    !eligible[0].recoverySources
      ? eligible[0].id
      : undefined;
  let localTarget: PendingQueueDisplayRow | undefined;
  for (const submission of pending.filter((s) => s.destination === 'queue')) {
    const row =
      localTarget ?? (target ? queue.find((row) => row.confirmedId === target) : undefined);
    if (row) {
      row.content = [row.content, submission.content].filter(Boolean).join('\n\n');
      row.imageBlocks.push(...(submission.imageBlocks ?? []));
      row.fileBlocks.push(...(submission.fileBlocks ?? []));
      row.contextItems.push(...(submission.contextItems ?? []));
      row.contributions.push(submission);
      row.blocksMutations = true;
      localTarget = row;
    } else {
      const created: PendingQueueDisplayRow = {
        key: submission.id,
        content: submission.content,
        imageBlocks: [...(submission.imageBlocks ?? [])],
        fileBlocks: [...(submission.fileBlocks ?? [])],
        contextItems: [...(submission.contextItems ?? [])],
        contributions: [submission],
        blocksMutations: true,
      };
      queue.push(created);
      // Do not speculate across reconnect/processing ambiguity.
      if (!checking) localTarget = created;
    }
  }
  return { conversation, processing, queue };
}
