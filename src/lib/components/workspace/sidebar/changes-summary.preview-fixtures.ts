import { appClient } from '$lib/client';
import { overrideMockIpcHandler } from '$shared/ipc-mock-router';
import { WORKSPACE_CHANNELS } from '$shared/ipc/channels';
import { selectWorkspaceById } from '$store/renderer/slices/workspace/workspace-selectors';
import { store } from '$store/renderer/store';

/** Preview-only seams: branch interactions must never mutate a real repository. */
export function installChangesSummaryMocks(workspaceId: string, branch: string) {
  const originalBranches = appClient.git.getBranches;
  const originalUpdate = appClient.workspaces.update;
  appClient.git.getBranches = async () => ({
    branches: ['main', 'develop'],
    remoteBranches: [],
    defaultBranch: 'main',
    currentBranch: branch,
  });
  appClient.workspaces.update = async (request) => {
    const workspace = selectWorkspaceById.select(store.state, workspaceId);
    if (!workspace) throw new Error('Changes summary preview workspace is not mounted');
    const updated = { ...workspace, ...request };
    return {
      success: true,
      workspace: {
        ...updated,
        // Update requests use null to clear; the returned Workspace uses optional scalars.
        prUrl: updated.prUrl ?? undefined,
        prNumber: updated.prNumber ?? undefined,
        prStatus: updated.prStatus ?? undefined,
      },
    };
  };
  const restoreRename = overrideMockIpcHandler(WORKSPACE_CHANNELS.RENAME_BRANCH, () => ({
    success: true,
  }));
  return () => {
    restoreRename();
    appClient.git.getBranches = originalBranches;
    appClient.workspaces.update = originalUpdate;
  };
}
