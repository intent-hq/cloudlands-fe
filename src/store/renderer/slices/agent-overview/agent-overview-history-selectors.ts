import { store } from '../../store';
import { emptyGraphHistoryState } from './agent-overview-history-slice';

export const selectGraphHistory = store.createSelector((state, workspaceId: string) =>
  state.agentOverviewHistory.byWorkspaceId[workspaceId] ?? emptyGraphHistoryState,
);

export const selectGraphHistoryStatus = store.createSelector(
  (state, workspaceId: string) => selectGraphHistory.select(state, workspaceId).status,
);