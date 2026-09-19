import { activeStreamsTracker } from '$features/agent/services/active-streams-tracker';
import { selectAllWorkspaceAgents } from '../workspace-agents/workspace-agents-selectors';
import { getItems, type Collection } from '@augmentcode/themis/utils/collections/collection-utils';
import { store } from '../../store';
import type { OpenPrWarningItem } from './workspace-operations-types';
import { selectWorkspaceById } from '../workspace/workspace-selectors';

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

export const selectShowBulkArchiveConfirm = store.createSelector((state) => {
  return state.workspaceOperations.showBulkArchiveConfirm;
});

export const selectShowBulkDeleteConfirm = store.createSelector((state) => {
  return state.workspaceOperations.showBulkDeleteConfirm;
});

export const selectPendingBulkWorkspaceIds = store.createSelector((state) => {
  return state.workspaceOperations.pendingBulkWorkspaceIds;
});

export const selectPendingBulkWorkspaces = store.createSelector((state) => {
  return state.workspaceOperations.pendingBulkWorkspaceIds.flatMap((id) => {
    const workspace = selectWorkspaceById.select(state, id);
    return workspace ? [workspace] : [];
  });
});

export const selectPendingBulkGroupLabel = store.createSelector((state) => {
  return state.workspaceOperations.pendingBulkGroupLabel;
});

export const selectBulkActiveAgentCount = store.createSelector((state) => {
  return state.workspaceOperations.bulkActiveAgentCount;
});

export const selectBulkActiveHookCount = store.createSelector((state) => {
  return state.workspaceOperations.bulkActiveHookCount;
});

export const selectBulkOpenPrCount = store.createSelector((state) => {
  return state.workspaceOperations.bulkOpenPrCount;
});

export const selectBulkPreflightReady = store.createSelector((state) => {
  return state.workspaceOperations.bulkPreflightReady;
});

export const selectBulkOperationInFlight = store.createSelector((state) => {
  return state.workspaceOperations.bulkOperationInFlight;
});

export const selectBulkComputeToken = store.createSelector((state) => {
  return state.workspaceOperations.bulkComputeToken;
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
