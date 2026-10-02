import type { Collection } from '@themislib/themis/utils/collections/collection-utils';

export type AgentMutationUiOperation =
  | { kind: 'rename'; name: string }
  | { kind: 'stop' }
  | { kind: 'retire' }
  | { kind: 'delete'; name?: string }
  | { kind: 'cancelSubscriptions'; subscriptionId?: string; groupId?: string };

export interface AgentMutationUiEntry {
  id: string;
  requestId: string;
  agentId: string;
  operation: AgentMutationUiOperation;
  status: 'pending' | 'succeeded' | 'failed' | 'cancelled';
  error?: string;
  consumed?: true;
}

export interface AgentMutationUiWorkspaceState {
  consumers: Collection<AgentMutationUiEntry, 'id'>;
}

export interface AgentMutationUiState {
  byWorkspaceId: Record<string, AgentMutationUiWorkspaceState>;
}
