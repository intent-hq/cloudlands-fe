import type { SubmissionScope } from '../pending-submissions/pending-submissions-types';
import type { QueuedMessage } from '$shared/types';
import type { Collection } from '@themislib/themis/utils/collections/collection-utils';
import type { QueuedMessageSendOutcome } from '../chat-state/chat-state-types';

/** Queue metadata and messages for a single agent. */
export interface AgentQueueEntryState {
  workspaceId?: string;
  messages: Collection<QueuedMessage, 'id'>;
  /** Bounded tombstone list for locally removed queued messages. */
  recentlyRemovedMessageIds: string[];
  isHydrating: boolean;
  error: string | null;
}

export type { QueuedMessageSendOutcome };

export type QueuedMessageMutationOperation =
  { kind: 'edit'; content: string; editing?: boolean } | { kind: 'remove' } | { kind: 'sendNow' };

/** One queued edit/remove/send-now request, correlated to the consumer that issued it. */
export interface QueuedMessageMutationRequest {
  requestId: string;
  consumerId: string;
  workspaceId: string;
  agentId: string;
  messageId: string;
  operation: QueuedMessageMutationOperation;
  /** Opt-in immutable backend/principal/admission identity; consumerId is a fresh view lease. */
  removalScope?: SubmissionScope;
  /** Stable daemon identity, independent of reconnect/admission generations. */
  removalBackendId?: string;
}

export interface QueuedMessageMutation {
  requestId: string;
  consumerId: string;
  workspaceId: string;
  agentId: string;
  messageId: string;
  removalScope?: SubmissionScope;
  /** Stable daemon identity, independent of reconnect/admission generations. */
  removalBackendId?: string;
  /** Recorded at the final wire boundary; retained when the consumer departs. */
  removalDispatched?: boolean;
  removalOutcome?: 'no-longer-queued' | 'failed' | 'unknown';
  kind: QueuedMessageMutationOperation['kind'];
  editing?: boolean;
  status: 'pending' | 'succeeded' | 'failed' | 'cancelled';
  sendOutcome?: QueuedMessageSendOutcome;
  error?: string;
}

export type QueuedMessageMutationResult = {
  status: Exclude<QueuedMessageMutation['status'], 'pending'>;
  removalOutcome?: QueuedMessageMutation['removalOutcome'];
  sendOutcome?: QueuedMessageSendOutcome;
  error?: string;
};

/** Renderer-visible queued message state keyed by agent ID. */
export interface AgentQueueState {
  byAgentId: Record<string, AgentQueueEntryState>;
  mutations: Collection<QueuedMessageMutation, 'requestId'>;
}

/** Runtime lease only, never stored in Redux. Once false, guards must stay false. */
export interface QueueRemovalAuthority {
  isCurrent(): boolean;
  /** May remain true after view departure for the captured principal's queue mirror. */
  canPublish(): boolean;
}
