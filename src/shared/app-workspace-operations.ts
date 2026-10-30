import type { WorkspaceCreateOrigin } from './types';
import type { BulkOperationProposal, WorkspaceCreateProposal } from './types/proposal';

export interface WorkspaceProposalApplyPayload {
  proposal: WorkspaceCreateProposal | BulkOperationProposal;
  editedFields?: Record<string, unknown>;
  selectedBulkItemIds?: string[];
  /** Sent as `workspace.create` `origin` so the daemon resolves the card. */
  origin?: WorkspaceCreateOrigin;
}
