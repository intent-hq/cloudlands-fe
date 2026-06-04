import type { CreateWorkspaceRequest } from './types';
import type { BulkOperationProposal, WorkspaceCreateProposal } from './types/proposal';

export const APP_WORKSPACE_OPERATION_CHANNEL = 'app:workspace-operation-requested' as const;

export type AppWorkspaceOperationName =
  | 'open'
  | 'archive'
  | 'delete'
  | 'create'
  | 'bulkArchive'
  | 'bulkDelete';

export interface AppWorkspaceOperationRequest {
  operation: AppWorkspaceOperationName;
  workspaceId?: string;
  ids?: string[];
  params?: CreateWorkspaceRequest;
  openInNewWindow?: boolean;
  agentId?: string;
  requestedAt?: string;
}

export interface WorkspaceProposalApplyPayload {
  proposal: WorkspaceCreateProposal | BulkOperationProposal;
  editedFields?: Record<string, unknown>;
  selectedBulkItemIds?: string[];
}
