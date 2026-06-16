/**
 * PR Status Selectors
 *
 * Selectors for workspace-scoped PR status state.
 */

import { store } from "../../store";
import { getPRStatusWorkspaceState } from "./pr-status-slice";

export const selectPRStatusIsRefreshing = store.createSelector(
  (state, wsId: string) => getPRStatusWorkspaceState(state.prStatus, wsId).isRefreshing
);

export const selectPRStatusLastRefreshTime = store.createSelector(
  (state, wsId: string) => getPRStatusWorkspaceState(state.prStatus, wsId).lastRefreshTime
);

