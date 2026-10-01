import type { Collection } from '@themislib/themis/utils/collections/collection-utils';
import type { ExecuteAcceptRequest, MergeStrategy } from '$features/accept-changes/types';

export type ExecuteAcceptOptions = Omit<
  ExecuteAcceptRequest,
  'workspaceId' | 'action' | 'options'
> &
  NonNullable<ExecuteAcceptRequest['options']>;

export interface MergePRAcceptOptions {
  mergeMethod?: MergeStrategy;
  commitTitle?: string;
  commitMessage?: string;
}

export interface MergeToTrunkOptions {
  hasStaged: boolean;
  commitMessage: string;
  targetBranch: string;
  mergeHeadSha: string | null;
  squash?: boolean;
  rebaseFirst?: boolean;
  localOnly?: boolean;
}

export interface MergePRWorkflowOptions extends MergePRAcceptOptions {
  prNumber: number;
  mergeHeadSha: string | null;
}

export interface UndoAcceptOptions {
  action: 'undo-commit' | 'undo-push';
  commitHash: string;
}

export type AcceptOperationKind =
  | 'prepare'
  | 'execute'
  | 'mergePR'
  | 'addRemote'
  | 'resetToTrunk'
  | 'merge'
  | 'mergePRWorkflow'
  | 'resetAndContinue'
  | 'archiveAndStart'
  | 'undo';

export interface AcceptOperation {
  kind: AcceptOperationKind;
  requestId: string;
  status: 'running' | 'succeeded' | 'failed' | 'cancelled';
  error: string | null;
}

export interface AcceptWorkflowWorkspaceState {
  operations: Collection<AcceptOperation, 'kind'>;
  mergeDrawerOpen: boolean;
  mergeOptions: Partial<MergeOptions>;
  observerRequested: boolean;
  consumerCount: number;
}

export interface MergeOptions {
  squash: boolean;
  viaPR: boolean;
  pushAfter: boolean;
}

export interface AcceptWorkflowState {
  byWorkspaceId: Record<string, AcceptWorkflowWorkspaceState>;
}
