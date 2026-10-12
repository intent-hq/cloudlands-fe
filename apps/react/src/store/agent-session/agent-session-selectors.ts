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
