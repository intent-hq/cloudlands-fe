import type { Collection } from '@themislib/themis/utils/collections/collection-utils';
import type { Result } from '$shared/types';

export type AgentModelResult = Result<
  { success: boolean; modelId?: string; error?: string },
  string
>;

/** Runtime-only lease callbacks; never copied into Redux state. */
export type AgentModelWriteOptions = {
  source?: 'control' | 'encoder';
  intent?: number;
  canSend?: () => boolean;
  canMutate?: () => boolean;
  onConfirmedEffort?: (effort: string | null) => void;
  canReconcileAccepted?: () => boolean;
};

export type AgentModelOperation =
  | { kind: 'model'; model: string; providerId?: string; commit?: boolean }
  | { kind: 'session'; model: string; providerId?: string }
  | { kind: 'effort'; effort: string | null; previous: string | null }
  | { kind: 'reconcile'; current: string | null; levels?: readonly string[] | null };

export type AgentModelRequest = {
  requestId: string;
  consumerId: string;
  workspaceId: string;
  agentId: string;
  connection: string | null;
  operation: AgentModelOperation;
};

export type AgentModelOutcome = {
  status: 'success' | 'failure' | 'cancelled';
  modelResult?: AgentModelResult;
  /** An effort failure after a successful model write must not undo the model. */
  modelAccepted?: boolean;
  error?: string;
};

export type AgentModelMutation = Omit<AgentModelRequest, 'operation'> & {
  status: 'pending' | AgentModelOutcome['status'];
  modelAccepted?: boolean;
  error?: string;
};

export type AgentModelState = {
  mutations: Collection<AgentModelMutation, 'requestId'>;
};
