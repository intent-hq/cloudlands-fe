/**
 * PR Status Selectors
 *
 * Selectors for workspace-scoped PR status state.
 */

import { createSelector } from "../../utils/create-selector";
import { getPRStatusWorkspaceState } from "./pr-status-slice";

export const selectPRStatusIsRefreshing = createSelector(
  (state, wsId: string) => getPRStatusWorkspaceState(state.prStatus, wsId).isRefreshing
);

export const selectPRStatusLastRefreshTime = createSelector(
  (state, wsId: string) => getPRStatusWorkspaceState(state.prStatus, wsId).lastRefreshTime
);

export const selectPRStatusLastError = createSelector(
  (state, wsId: string) => getPRStatusWorkspaceState(state.prStatus, wsId).lastError
);

