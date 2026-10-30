import type { ProposalActionDetail, ProposalKind } from '$shared/types/proposal';
import type { WorkspaceId } from '$shared/types/branded-ids';
import type { WorkspaceCreateProposalOutcome } from '$shared/types';

export type ProposalLifecycleStatus =
  | 'idle'
  | 'applying'
  | 'applied'
  | 'undoing'
  | 'failed'
  // Daemon-persisted dismissal (`agent.resolveProposal` outcome 'dismissed',
  // PROTOCOL §5.5) reconciled into local lifecycle state — the proposal never
  // pends again and its transcript card renders the dismissed outcome.
  | 'dismissed';

export type ProposalLifecycleAction = 'apply' | 'undo' | 'dismiss';

// Serializable, operation-specific outputs surfaced back to the UI after a
// proposal applies. Today only workspace.create returns anything; new kinds can
// extend this shape with their own optional fields.
export interface ProposalApplyResult {
  workspaceId?: WorkspaceId;
  /**
   * The daemon's handling of a workspace-create card's `origin` (PROTOCOL
   * §5.1). Present → the daemon resolved (or deliberately declined) the card,
   * so the client must not call `agent.resolveProposal` for it.
   */
  proposalOrigin?: WorkspaceCreateProposalOutcome;
  transfer?: {
    workspaceId: string;
    sourceWorkspacePath: string;
    sourceConnectionId: string;
    destinationConnectionId: string;
    phase: 'transferring' | 'imported';
  };
}

export interface ProposalLifecycleEntry {
  status: ProposalLifecycleStatus;
  error?: string;
  /**
   * Machine-readable code for the failure, from the transport error's
   * `data.code`. Only daemon-authored codes (e.g. `"base-ref-unresolvable"`
   * for workspace.create base-ref failures, monorepo#761) are a stable
   * contract; the FE bridge fills in mapped codes (`"INVALID_PARAMS"`,
   * `"TRANSPORT_ERROR"`, ...) when the daemon sent none. Consumers must
   * exact-match the daemon codes they understand — prefer that over matching
   * `error` prose, but never key behavior off the bridge-mapped values.
   */
  errorCode?: string;
  transferProgress?: 'building' | 'relaying' | 'committing';
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
