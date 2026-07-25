import type { ProposalActionDetail, ProposalKind } from '$shared/types/proposal';
import type { WorkspaceId } from '$shared/types/branded-ids';

export type ProposalLifecycleStatus = 'idle' | 'applying' | 'applied' | 'undoing' | 'failed';

export type ProposalLifecycleAction = 'apply' | 'undo';

// Serializable, operation-specific outputs surfaced back to the UI after a
// proposal applies. Today only workspace.create returns anything; new kinds can
// extend this shape with their own optional fields.
export interface ProposalApplyResult {
  workspaceId?: WorkspaceId;
}

export interface ProposalLifecycleEntry {
  status: ProposalLifecycleStatus;
  error?: string;
  /**
   * Stable machine-readable code for the failure, when the daemon provided one
   * on `error.data.code` (e.g. `"base-ref-unresolvable"` for workspace.create
   * base-ref failures, monorepo#761). Consumers should prefer this over
   * matching `error` prose; absent for older daemons and transport failures.
   */
  errorCode?: string;
  startedAt?: number;
  completedAt?: number;
  lastAction?: ProposalLifecycleAction;
  result?: ProposalApplyResult;
}

export type ProposalLifecycleState = Record<string, ProposalLifecycleEntry>;

export interface ApplyProposalRequest {
  proposalId: string;
  kind: ProposalKind;
  detail: ProposalActionDetail;
}

export interface UndoProposalRequest {
  proposalId: string;
  kind: ProposalKind;
}
