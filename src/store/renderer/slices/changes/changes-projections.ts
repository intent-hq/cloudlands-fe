import { getItem } from '@themislib/themis/utils/collections/collection-utils';
import type {
  FileTrackingState,
  CommitInfo,
  LineChangeStats,
  AgentLineStatsRequestState,
} from './changes-types';
import { emptyAgentLineStatsRequestState, emptyWorkspaceState } from './changes-slice';

type ChangesProjectionState = { changes: FileTrackingState };

export const getAgentLineStats = (
  state: ChangesProjectionState,
  agentId: string,
): LineChangeStats | undefined => state.changes.agentStats[agentId];

const getAgentLineStatsRequest = (
  state: ChangesProjectionState,
  agentId: string,
): AgentLineStatsRequestState =>
  state.changes.agentLineStatsRequests[agentId] ?? emptyAgentLineStatsRequestState;

export const getShouldRequestAgentLineStats = (
  state: ChangesProjectionState,
  agentId: string,
  forceRefresh = false,
): boolean => {
  const requestState = getAgentLineStatsRequest(state, agentId);
  if (requestState.isLoading) return false;
  if (!forceRefresh && getAgentLineStats(state, agentId)) return false;
  return true;
};

export const getCommitHistory = (state: ChangesProjectionState, workspaceId: string) =>
  (state.changes.byWorkspaceId[workspaceId] ?? emptyWorkspaceState).history;

export const getCommitByHash = (state: ChangesProjectionState, workspaceId: string, hash: string) =>
  getItem((state.changes.byWorkspaceId[workspaceId] ?? emptyWorkspaceState).commitEntities, hash);

export const getCurrentCommits = (state: ChangesProjectionState, workspaceId: string) => {
  const ws = state.changes.byWorkspaceId[workspaceId] ?? emptyWorkspaceState;
  return ws.currentCommitIds
    .map((hash) => getItem(ws.commitEntities, hash))
    .filter((commit): commit is CommitInfo => commit !== undefined);
};

export const getOlderCommits = (state: ChangesProjectionState, workspaceId: string) => {
  const ws = state.changes.byWorkspaceId[workspaceId] ?? emptyWorkspaceState;
  return ws.olderCommitIds
    .map((hash) => getItem(ws.commitEntities, hash))
    .filter((commit): commit is CommitInfo => commit !== undefined);
};
