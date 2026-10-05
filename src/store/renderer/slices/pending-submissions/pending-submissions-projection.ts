import { evidenceSubmissionIds, hasUnresolvedQueueProcessing } from './pending-submissions-model';
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

function attachmentFree(message: {
  imageBlocks?: QueuedMessage['imageBlocks'];
  fileBlocks?: QueuedMessage['fileBlocks'];
}): boolean {
  return !message.imageBlocks?.length && !message.fileBlocks?.length;
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
  const checking = supported && (entry.refreshNeeded || hasUnresolvedQueueProcessing(entry));
  const queue = confirmedQueue.map((message) => confirmedRow(message, checking));
  if (!entry) return { conversation: [], processing: [], queue };
  const seededIds = new Set(
    getItems(entry.seeds).flatMap((row) => evidenceSubmissionIds(row, entry.scope.principalId)),
  );
  const pending = getItems(entry.submissions).filter((s) => !seededIds.has(s.id));
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
    const aliases = evidenceSubmissionIds(seed, entry.scope.principalId);
    row.contributions = getItems(entry.submissions).filter((s) => aliases.includes(s.id));
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
  let localTarget = target ? queue.find((row) => row.confirmedId === target) : undefined;
  for (const submission of pending.filter((s) => s.destination === 'queue')) {
    // Match daemon adjacency: either side's attachments end a text-only merge.
    // Never fall back to an older confirmed target after creating a separate row.
    const row =
      localTarget && attachmentFree(localTarget) && attachmentFree(submission)
        ? localTarget
        : undefined;
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
  // ACK seeds arrive in callback order. Only unconfirmed rows use admission
  // order; authoritative queue snapshots retain their own ordering.
  const admissionOrder = new Map(
    getItems(entry.submissions).map((submission, index) => [submission.id, index]),
  );
  const order = (row: PendingQueueDisplayRow) =>
    Math.min(...row.contributions.map((s) => admissionOrder.get(s.id) ?? Infinity));
  const provisional = queue.filter((row) => !row.confirmedId).sort((a, b) => order(a) - order(b));
  let index = 0;
  for (let i = 0; i < queue.length; i += 1)
    if (!queue[i].confirmedId) queue[i] = provisional[index++];
  return { conversation, processing, queue };
}

/** Unanchored contributions may still be merged by the daemon; never target their local keys. */
export function queueDisplayBlocksMutation(
  rows: readonly PendingQueueDisplayRow[],
  messageId?: string,
): boolean {
  return rows.some(
    (row) =>
      row.blocksMutations &&
      (!row.confirmedId ||
        messageId === undefined ||
        messageId === row.confirmedId ||
        (!!row.confirmed?.editingMessageId && messageId === row.confirmed.editingMessageId)),
  );
}
