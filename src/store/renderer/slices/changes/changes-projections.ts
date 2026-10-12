import type {
  FileTrackingState,
  LineChangeStats,
  AgentLineStatsRequestState,
} from './changes-types';
import { emptyAgentLineStatsRequestState } from './changes-slice';

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
