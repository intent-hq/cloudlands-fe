import type { QueuedMessage, Workspace } from '$shared/types';
import type { SubmissionCorrelation } from '$shared/types/agent-message';
import type { Collection } from '@themislib/themis/utils/collections/collection-utils';

/** All values are captured from admitted renderer ownership, never message metadata. */
export interface SubmissionScope {
  agentId: string;
  workspaceId: string;
  authority: string;
  principalId: string;
  participation: string;
  owner: string;
  /** Fresh admission epoch after scope loss; never reused by asynchronous callers. */
  lifetime?: string;
}

export interface SubmissionInput {
  id: string;
  appMessageId?: string;
  content: string;
  destination: 'conversation' | 'queue';
  createdAt: number;
  imageBlocks?: QueuedMessage['imageBlocks'];
  fileBlocks?: QueuedMessage['fileBlocks'];
  contextItems?: QueuedMessage['contextItems'];
  messageMetadata?: Record<string, unknown>;
}

export interface PendingSubmission extends SubmissionInput {
  status: 'preparing' | 'sending' | 'accepted' | 'uncertain';
}

interface SubmissionOperation {
  id: string;
  observationVersion: number;
  observed: boolean;
}

export interface SubmissionTombstone {
  id: string;
  at: number;
  reason: 'queue' | 'processing' | 'history' | 'rejected';
  /** Original contribution tag while delivery evidence precedes rendered history. */
  messageMetadata?: SubmissionInput['messageMetadata'];
}

export interface SubmissionEvidence extends SubmissionCorrelation, Partial<QueuedMessage> {}

export interface PendingSubmissionEntry {
  scope: SubmissionScope;
  supported: boolean;
  /** Captured effective rights, used only to detect loss; never grants authority. */
  participationRights?: Pick<Workspace, 'myRole' | 'canManage'>;
  submissions: Collection<PendingSubmission, 'id'>;
  operations: Collection<SubmissionOperation, 'id'>;
  /** Consumed local content remains visible until persistence/restoration evidence. */
  processing: Collection<QueuedMessage, 'id'>;
  tombstones: Collection<SubmissionTombstone, 'id'>;
  /** Partial mutation echoes for display only. Never counted or used for mutation controls. */
  seeds: Collection<QueuedMessage, 'id'>;
  generation: number;
  /** Current reads also fence older mutation echoes without invalidating sibling reads. */
  observationVersion: number;
  queueReadId: string | null;
  historyReadId: string | null;
  queueFresh: boolean;
  historyFresh: boolean;
  refreshNeeded: boolean;
  attemptActive: boolean;
}

export interface PendingSubmissionsState {
  byAgentId: Record<string, PendingSubmissionEntry>;
}

export interface SubmissionRead {
  scope: SubmissionScope;
  id: string;
  generation: number;
  kind: 'queue' | 'history';
}

export interface SubmissionReference {
  scope: SubmissionScope;
  id: string;
}
