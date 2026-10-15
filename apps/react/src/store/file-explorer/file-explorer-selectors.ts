import { store } from '@/store';
import { toFilePorcelainStatus } from '$lib/client/file-git-status';
import { workspaceRelativeFilePath } from '../../../../../src/features/file/utils/workspace-file-path';
import { selectGitWorkspaceState } from '../git/git-selectors';
import { selectDesktopLayout } from '../desktop/desktop-selectors';
import { selectCurrentWorkspaceTabId } from '../tab-state/tab-state-selectors';
import { selectIsWorkspaceHydrated } from '../workspace-lifecycle/workspace-lifecycle-selectors';
import { selectFileReadContext } from '../files/files-selectors';
import { selectWorkspaceById } from '../workspace/workspace-selectors';
import {
  projectFileExplorerState,
  projectFlattenedNodes,
  getFileSearch,
} from '../../../../../src/store/renderer/slices/file-explorer/file-explorer-projections';

export const selectFileExplorerRoot = store.createSelector((state, workspaceId: string) => {
  const workspace = selectWorkspaceById.select(state, workspaceId);
  return (workspace?.worktreePath || workspace?.repositoryPath || '').replace(/\/+$/, '');
});
export const selectFileExplorerContext = store.createSelector((state, workspaceId: string) => {
  const authority = selectFileReadContext.select(state, workspaceId);
  const root = selectFileExplorerRoot.select(state, workspaceId);
  return authority && root ? JSON.stringify([authority, root]) : null;
});
export const selectFileExplorerState = store.createSelector((state, workspaceId: string) =>
  projectFileExplorerState(state.fileExplorer, workspaceId),
);
export const selectFileExplorerRows = store.createSelector((state, workspaceId: string) =>
  projectFlattenedNodes(selectFileExplorerState.select(state, workspaceId), false),
);

export const selectFileSearch = store.createSelector(
  (state, workspaceId: string, consumerId: string, context?: string) =>
    getFileSearch(state.fileExplorer, workspaceId, consumerId, context),
);

/** Presentation-only join; the Git slice remains the sole status owner. */
export const selectDesktopFileExplorerGitStatus = store.createSelector(
  (state, workspaceId: string) => {
    const files = selectGitWorkspaceState.select(state, workspaceId).status?.files ?? [];
    return Object.fromEntries(
      files.map((file) => [file.path, { status: toFilePorcelainStatus(file.status, file.staged) }]),
    );
  },
);

export const selectDesktopFileExplorerRows = store.createSelector(
  (state, workspaceId: string, showOnlyChanged = false) => {
    const explorer = selectFileExplorerState.select(state, workspaceId);
    if (
      !selectFileExplorerContext.select(state, workspaceId) ||
      explorer.workspacePath !== selectFileExplorerRoot.select(state, workspaceId)
    )
      return [];
    const rows = projectFlattenedNodes({
      ...explorer,
      gitStatus: selectDesktopFileExplorerGitStatus.select(state, workspaceId),
    });
    return showOnlyChanged
      ? rows.filter((row) =>
          row.node.type === 'file' ? row.gitStatus !== undefined : row.directoryHasChanges === true,
        )
      : rows;
  },
);

/** The focused primary-root file tab owns selection, including adjacent-panel opens. */
export const selectDesktopFileExplorerSelectedPath = store.createSelector(
  (state, workspaceId: string) => {
    if (!selectFileExplorerContext.select(state, workspaceId)) return null;
    const layout = selectDesktopLayout.select(state, workspaceId);
    const panel = layout.panels[layout.focusedPanelId ?? ''];
    const tab = panel?.tabs.find((item) => item.id === panel.activeTabId);
    if (tab?.type !== 'file' || tab.data?.gitRootId) return null;
    const root = selectFileExplorerRoot.select(state, workspaceId);
    const relative = workspaceRelativeFilePath(tab.filePath, root);
    return relative ? `${root}/${relative}` : null;
  },
);

/** Resource identity excludes visibility so parking preserves the canonical tree. */
export const selectDesktopFileExplorerLifetime = store.createSelector(
  (state, workspaceId: string) => {
    const workspace = selectWorkspaceById.select(state, workspaceId);
    return {
      context: selectFileExplorerContext.select(state, workspaceId),
      membership: JSON.stringify([workspace?.myRole ?? null, workspace?.canManage ?? null]),
      mounted: selectIsWorkspaceHydrated.select(state, workspaceId),
      active: selectCurrentWorkspaceTabId.select(state) === workspaceId,
    };
  },
);
