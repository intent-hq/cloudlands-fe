import { activeStreamsTracker } from '$features/agent/services/active-streams-tracker';
import { selectAllWorkspaceAgents } from '../workspace-agents/workspace-agents-selectors';
import { getItems, type Collection } from '@augmentcode/themis/utils/collections/collection-utils';
import { store } from '../../store';
import type { OpenPrWarningItem } from './workspace-operations-types';

export const selectShowDeleteWarning = store.createSelector((state) => {
  return state.workspaceOperations.showDeleteWarning;
});

export const selectPendingDeleteWorkspaceId = store.createSelector((state) => {
  return state.workspaceOperations.pendingDeleteWorkspaceId;
});

export const selectActiveHookNamesForDelete = store.createSelector((state) => {
  return state.workspaceOperations.activeHookNamesForDelete;
});

export const selectOpenPrsForDelete = store.createSelector((state): OpenPrWarningItem[] => {
  return getItems<OpenPrWarningItem, 'number'>(
    state.workspaceOperations.openPrsForDelete as Collection<OpenPrWarningItem, 'number'>,
  );
});

export const selectLocalChangesForDelete = store.createSelector((state) => {
  return state.workspaceOperations.localChangesForDelete;
});

export const selectShowArchiveWarning = store.createSelector((state) => {
  return state.workspaceOperations.showArchiveWarning;
});

export const selectPendingArchiveWorkspaceId = store.createSelector((state) => {
  return state.workspaceOperations.pendingArchiveWorkspaceId;
});

export const selectActiveHookNamesForArchive = store.createSelector((state) => {
  return state.workspaceOperations.activeHookNamesForArchive;
});

export const selectOpenPrsForArchive = store.createSelector((state): OpenPrWarningItem[] => {
  return getItems<OpenPrWarningItem, 'number'>(
    state.workspaceOperations.openPrsForArchive as Collection<OpenPrWarningItem, 'number'>,
  );
});

export const selectLocalChangesForArchive = store.createSelector((state) => {
  return state.workspaceOperations.localChangesForArchive;
});

export const selectPendingBulkRepoKey = store.createSelector((state) => {
  return state.workspaceOperations.pendingBulkRepoKey;
});

export const selectBulkArchiveComputeToken = store.createSelector((state) => {
  return state.workspaceOperations.bulkArchiveComputeToken;
});

export const selectPendingBulkDeleteRepoKey = store.createSelector((state) => {
  return state.workspaceOperations.pendingBulkDeleteRepoKey;
});

export const selectPendingRemoveRepoPath = store.createSelector((state) => {
  return state.workspaceOperations.pendingRemoveRepoPath;
});

export const selectRunningAgentsForDelete = store.createSelector((state) => {
  const workspaceId = state.workspaceOperations.pendingDeleteWorkspaceId;
  if (!workspaceId) return [];
  const agents = selectAllWorkspaceAgents.select(state, workspaceId);
  return activeStreamsTracker.getStreamingAgentIdsForWorkspace(workspaceId).map((id) => {
    const agent = agents.find((session) => session.id === id);
    return {
      id,
      name: agent?.name || id.substring(0, 8),
      specialist: agent?.metadata?.specialist,
      state: 'running' as const,
    };
  });
});

export const selectRunningAgentsForArchive = store.createSelector((state) => {
  const workspaceId = state.workspaceOperations.pendingArchiveWorkspaceId;
  if (!workspaceId) return [];
  const agents = selectAllWorkspaceAgents.select(state, workspaceId);
  return activeStreamsTracker.getStreamingAgentIdsForWorkspace(workspaceId).map((id) => {
    const agent = agents.find((session) => session.id === id);
    return {
      id,
      name: agent?.name || id.substring(0, 8),
      specialist: agent?.metadata?.specialist,
      state: 'running' as const,
    };
  });
});
