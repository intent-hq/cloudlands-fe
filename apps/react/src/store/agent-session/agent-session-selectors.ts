import { store } from '../index';
import * as projections from '../../../../../src/store/renderer/slices/agent-session/agent-session-projections';
export const selectAgentSessionsById = store.createSelector(projections.getAgentSessionsById);
export const selectAgentSession = store.createSelector(projections.getAgentSession);
export const selectAgentDetailHydrated = store.createSelector(projections.getAgentDetailHydrated);
export const selectAgentProvider = store.createSelector(projections.getAgentSessionProvider);
export const selectAgentSessionWorkspaceId = store.createSelector(
  projections.getAgentSessionWorkspaceId,
);
export const selectAgentReasoningEffort = store.createSelector(projections.getAgentReasoningEffort);

import * as history from '../../../../../src/store/renderer/slices/agent-session/agent-history-projections';
export const selectAgentHistoryMessages = store.createSelector(history.getAgentHistoryMessages);
export const selectHistorySegmentMeta = store.createSelector(history.getHistorySegmentMeta);
export const selectHasHistorySegment = store.createSelector(history.getHasHistorySegment);
export const selectAgentMessages = store.createSelector(
  (state, agentId: string) => state.agentSessions.byAgentId[agentId]?.messages ?? EMPTY_MESSAGES,
);
const EMPTY_MESSAGES: import('$shared/types').AgentMessage[] = [];

export const selectAgentIsResponding = store.createSelector(projections.getAgentIsResponding);
