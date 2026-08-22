import type { BulkOperationProposal, WorkspaceCreateProposal } from './types/proposal';

export interface WorkspaceProposalApplyPayload {
  proposal: WorkspaceCreateProposal | BulkOperationProposal;
  editedFields?: Record<string, unknown>;
  selectedBulkItemIds?: string[];
}
