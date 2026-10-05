import {
  createCollection,
  getItem,
  getItems,
} from '@themislib/themis/utils/collections/collection-utils';
import type {
  PendingSubmissionEntry,
  SubmissionEvidence,
  SubmissionScope,
  SubmissionRead,
  SubmissionTombstone,
} from './pending-submissions-types';

export const PENDING_SUBMISSION_LIMIT = 128;
export const SUBMISSION_TOMBSTONE_LIMIT = 1024;
export const SUBMISSION_TOMBSTONE_TTL = 10 * 60 * 1000;

export function sameSubmissionScope(a: SubmissionScope, b: SubmissionScope): boolean {
  return (
    a.agentId === b.agentId &&
    a.workspaceId === b.workspaceId &&
    a.authority === b.authority &&
    a.principalId === b.principalId &&
    a.participation === b.participation &&
    a.owner === b.owner &&
    a.lifetime === b.lifetime
  );
}

export function supportsSubmissionCorrelation(value: unknown): boolean {
  return value === 1;
}

/** Provider streaming alone does not make confirmed queue work ambiguous. */
export function hasUnresolvedQueueProcessing(entry: PendingSubmissionEntry): boolean {
  return entry.attemptActive && getItems(entry.processing).length > 0;
}

export function createPendingEntry(
  scope: SubmissionScope,
  capability: unknown,
): PendingSubmissionEntry {
  return {
    scope,
    supported: supportsSubmissionCorrelation(capability),
    submissions: createCollection('id'),
    operations: createCollection('id'),
    processing: createCollection('id'),
    tombstones: createCollection('id'),
    seeds: createCollection('id'),
    generation: 0,
    observationVersion: 0,
    queueReadId: null,
    historyReadId: null,
    queueFresh: false,
    historyFresh: false,
    refreshNeeded: true,
    attemptActive: false,
  };
}

export function submissionReadIsCurrent(
  entry: PendingSubmissionEntry | undefined,
  read: SubmissionRead,
): boolean {
  return (
    !!entry &&
    sameSubmissionScope(entry.scope, read.scope) &&
    entry.generation === read.generation &&
    (read.kind === 'queue' ? entry.queueReadId : entry.historyReadId) === read.id
  );
}

/** Shared evidence always uses trusted leaf authors; a raw reply may match only its own request. */
export function evidenceSubmissionIds(evidence: SubmissionEvidence, principalId: string): string[] {
  if (evidence.recoverySources)
    return evidence.recoverySources.flatMap((source) =>
      source.author?.principalId === principalId ? (source.submissionIds ?? []) : [],
    );
  return evidence.author?.principalId === principalId ? (evidence.submissionIds ?? []) : [];
}

export function pruneSubmissionTombstones(
  entry: PendingSubmissionEntry,
  now: number,
): PendingSubmissionEntry {
  return {
    ...entry,
    tombstones: createCollection(
      'id',
      getItems(entry.tombstones)
        .filter((item) => now - item.at < SUBMISSION_TOMBSTONE_TTL)
        .slice(-SUBMISSION_TOMBSTONE_LIMIT),
    ),
  };
}

export function retireSubmissions(
  entry: PendingSubmissionEntry,
  ids: string[],
  reason: SubmissionTombstone['reason'],
  now: number,
): PendingSubmissionEntry {
  const known = new Set(
    [
      ...getItems(entry.submissions),
      ...getItems(entry.operations),
      ...getItems(entry.processing).flatMap((row) =>
        evidenceSubmissionIds(row, entry.scope.principalId).map((id) => ({ id })),
      ),
      ...getItems(entry.tombstones),
    ].map((s) => s.id),
  );
  const matched = new Set(ids.filter((id) => known.has(id)));
  const tombstones = getItems(entry.tombstones).filter((item) => !matched.has(item.id));
  for (const id of matched) {
    const prior = getItem(entry.tombstones, id);
    // Processing snapshots outlive terminal retention. Do not restart an evicted
    // terminal clock merely because another observation touches that snapshot.
    const operation = getItem(entry.operations, id);
    const submission = getItem(entry.submissions, id);
    if (prior || submission || (operation && !operation.observed)) {
      const messageMetadata = prior?.messageMetadata ?? submission?.messageMetadata;
      tombstones.push({
        id,
        at: prior?.at ?? now,
        reason,
        ...(messageMetadata ? { messageMetadata } : {}),
      });
    }
  }
  return pruneSubmissionTombstones(
    {
      ...entry,
      submissions: createCollection(
        'id',
        getItems(entry.submissions).filter((item) => !matched.has(item.id)),
      ),
      processing: createCollection(
        'id',
        getItems(entry.processing).filter(
          (item) =>
            !evidenceSubmissionIds(item, entry.scope.principalId).some((id) => matched.has(id)),
        ),
      ),
      operations: createCollection(
        'id',
        getItems(entry.operations).map((op) =>
          matched.has(op.id) ? { ...op, observed: true } : op,
        ),
      ),
      tombstones: createCollection(
        'id',
        tombstones.sort((a, b) => a.at - b.at),
      ),
    },
    now,
  );
}
