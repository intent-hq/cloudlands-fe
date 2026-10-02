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
}

export interface QueuedMessageMutation {
  requestId: string;
  consumerId: string;
  workspaceId: string;
  agentId: string;
  messageId: string;
  kind: QueuedMessageMutationOperation['kind'];
  editing?: boolean;
  status: 'pending' | 'succeeded' | 'failed' | 'cancelled';
  sendOutcome?: QueuedMessageSendOutcome;
  error?: string;
}

export type QueuedMessageMutationResult = {
  status: Exclude<QueuedMessageMutation['status'], 'pending'>;
  sendOutcome?: QueuedMessageSendOutcome;
  error?: string;
};

/** Renderer-visible queued message state keyed by agent ID. */
export interface AgentQueueState {
  byAgentId: Record<string, AgentQueueEntryState>;
  mutations: Collection<QueuedMessageMutation, 'requestId'>;
}
