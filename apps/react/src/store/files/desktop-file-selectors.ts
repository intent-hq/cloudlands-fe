import { getFileContentPrunePayload } from '../../../../../src/store/renderer/slices/panel-layout/panel-layout-projections';
import { getFileSaveOperation } from '../../../../../src/store/renderer/slices/files/files-projections';
import { getFileSaveOperations } from '../../../../../src/store/renderer/slices/files/files-projections';
import { store } from '@/store';
import { selectGitWriteContext } from '@/store/git/git-write-selectors';
import { selectWorkspaceById } from '@/store/workspace/workspace-selectors';
import { selectDesktopLayout } from '@/store/desktop/desktop-selectors';
import { selectCurrentWorkspaceTabId } from '@/store/tab-state/tab-state-selectors';
import {
  selectFileReadContext,
  selectFileAbsolutePath,
  selectFileContentEntry,
} from './files-selectors';

type EditScope = {
  workspaceId: string;
  path: string;
  absolutePath: string;
  root: string;
  authority: string;
  panelId: string;
  tabId: string;
};
export const selectDesktopFileEditScope = store.createSelector(
  (state, workspaceId: string, path: string, absolutePath: string): EditScope | null => {
    const authority = selectGitWriteContext.select(state, workspaceId);
    const workspace = selectWorkspaceById.select(state, workspaceId);
    const root = workspace?.worktreePath || workspace?.repositoryPath;
    const layout = selectDesktopLayout.select(state, workspaceId);
    const panel = layout.focusedPanelId ? layout.panels[layout.focusedPanelId] : undefined;
    const tab = panel?.tabs.find((tab) => tab.id === panel.activeTabId);
    if (
      !authority ||
      !root ||
      selectCurrentWorkspaceTabId.select(state) !== workspaceId ||
      !panel ||
      tab?.type !== 'file' ||
      tab.filePath !== path
    )
      return null;
    return { workspaceId, path, absolutePath, root, authority, panelId: panel.id, tabId: tab.id };
  },
);
export const selectDesktopFileEditAuthorityCurrent = store.createSelector(
  (state, scope: EditScope) => {
    const workspace = selectWorkspaceById.select(state, scope.workspaceId);
    return (
      selectGitWriteContext.select(state, scope.workspaceId) === scope.authority &&
      (workspace?.worktreePath || workspace?.repositoryPath) === scope.root &&
      selectFileContentEntry.select(state, scope.workspaceId, scope.path)?.absolutePath ===
        scope.absolutePath
    );
  },
);
export const selectDesktopFileEditCurrent = store.createSelector((state, scope: EditScope) => {
  const tab = selectDesktopLayout
    .select(state, scope.workspaceId)
    .panels[scope.panelId]?.tabs.find((tab) => tab.id === scope.tabId);
  return (
    selectDesktopFileEditAuthorityCurrent.select(state, scope) &&
    tab?.type === 'file' &&
    tab.filePath === scope.path
  );
});

export const selectDesktopFileEditRetired = store.createSelector(
  (state, workspaceId: string, path: string) => {
    const latest = getFileSaveOperations(state, workspaceId, path).at(-1);
    return latest?.status === 'cancelled' && !!latest.error;
  },
);

export const selectDesktopFilePrunePayload = store.createSelector(getFileContentPrunePayload);
export const selectDesktopFilePanelLayouts = store.createSelector(
  (state) => state.panelLayout.byWorkspaceId,
);
export const selectDesktopFileSaveOperation = store.createSelector(getFileSaveOperation);
export const selectDesktopFileCanPrune = store.createSelector(
  (state, workspaceId: string, path: string) => {
    const entry = selectFileContentEntry.select(state, workspaceId, path);
    return (
      !entry ||
      (!entry.saving &&
        entry.localContent === entry.originalContent &&
        !getFileSaveOperations(state, workspaceId, path).some((operation) =>
          ['queued', 'running', 'uncertain'].includes(operation.status),
        ))
    );
  },
);

/** Primitive authority identity: unrelated workspace metadata never retires a file view. */
export const selectDesktopFileIdentity = store.createSelector(
  (state, workspaceId: string, path: string) => {
    const read = selectFileReadContext.select(state, workspaceId);
    const absolute = selectFileAbsolutePath.select(state, workspaceId, path);
    return read && absolute
      ? JSON.stringify([read, selectGitWriteContext.select(state, workspaceId), absolute])
      : null;
  },
);
export const selectDesktopFileViewIdentity = store.createSelector(
  (state, workspaceId: string, path: string, panelId: string, tabId: string) => {
    const tab = selectDesktopLayout
      .select(state, workspaceId)
      .panels[panelId]?.tabs.find((tab) => tab.id === tabId);
    return tab?.type === 'file' && tab.filePath === path
      ? selectDesktopFileIdentity.select(state, workspaceId, path)
      : null;
  },
);
