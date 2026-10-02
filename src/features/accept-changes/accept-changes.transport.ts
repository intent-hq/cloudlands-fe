/** Single-RPC transport shared by the saga owners. Never dispatches or takes a mutation lease. */
import { backendRequest } from '$lib/client/live/backend-transport';
import type { WorkspaceId } from '$shared/types/branded-ids';
import type {
  ExecuteAcceptOptions,
  MergePRAcceptOptions,
} from '$store/renderer/slices/accept-workflow/accept-workflow-types';
import type {
  AcceptAction,
  AcceptChangesResult,
  ExecuteAcceptRequest,
  PrepareAcceptResponse,
  WorkspaceGitStatus,
} from './types';

export const acceptChangesTransport = {
  prepare(workspaceId: WorkspaceId, action: AcceptAction, files?: string[]) {
    return backendRequest<PrepareAcceptResponse>('accept-changes.prepare', {
      workspaceId,
      action,
      files,
    });
  },
  execute(workspaceId: WorkspaceId, action: AcceptAction, options?: ExecuteAcceptOptions) {
    const request: ExecuteAcceptRequest = {
      workspaceId,
      action,
      files: options?.files,
      commitMessage: options?.commitMessage,
      prTitle: options?.prTitle,
      prBody: options?.prBody,
      targetBranch: options?.targetBranch,
      mergeStrategy: options?.mergeStrategy,
      upToCommitHash: options?.upToCommitHash,
      undoCommitsMetadata: options?.undoCommitsMetadata,
      options: {
        stageUnstaged: options?.stageUnstaged,
        pushAfterCommit: options?.pushAfterCommit,
        createPRAfterPush: options?.createPRAfterPush,
        rebaseFirst: options?.rebaseFirst,
        localOnly: options?.localOnly,
      },
    };
    return backendRequest<AcceptChangesResult>('accept-changes.execute', request);
  },
  mergePR(workspaceId: WorkspaceId, prNumber: number, options?: MergePRAcceptOptions) {
    return backendRequest<AcceptChangesResult>('accept-changes.mergePR', {
      workspaceId,
      prNumber,
      mergeMethod: options?.mergeMethod,
      commitTitle: options?.commitTitle,
      commitMessage: options?.commitMessage,
    });
  },
  addRemote(workspaceId: WorkspaceId, remoteUrl: string) {
    return backendRequest<WorkspaceGitStatus>('accept-changes.addRemote', {
      workspaceId,
      remoteUrl,
    });
  },
  resetToTrunk(workspaceId: WorkspaceId) {
    return backendRequest<AcceptChangesResult>('accept-changes.execute', {
      workspaceId,
      action: 'reset-to-trunk',
    });
  },
};
