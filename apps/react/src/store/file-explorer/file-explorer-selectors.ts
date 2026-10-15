import { store } from '@/store';
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
