/**
 * Token Usage Slice (renderer)
 *
 * Actions and reducer for the renderer mirror of per-workspace token usage.
 * The saga fetches snapshots over IPC and subscribes to main-process pushes;
 * the reducer only stores aggregated numbers per workspace.
 */

import { createAction } from "ag-redux-toolkit/utils/store/create-action";
import { createReducer } from "ag-redux-toolkit/utils/store/create-reducer";
import { createWorkspaceScopedHelpers } from "../../utils/workspace-scoped";
import type { WorkspaceTokenUsageSnapshot } from "../../../../features/token-usage/token-usage-types";
import type { TokenUsageState } from "./token-usage-types";
import { emptyWorkspaceTokenUsageState, initialState } from "./token-usage-types";

export type { TokenUsageState, WorkspaceTokenUsageState } from "./token-usage-types";
export { emptyWorkspaceTokenUsageState, initialState } from "./token-usage-types";

// ---------------------------------------------------------------------------
// Actions
// ---------------------------------------------------------------------------

/** Request the workspace's token usage snapshot from the main process. */
export const fetchWorkspaceTokenUsage = createAction<[wsId: string]>(
  "tokenUsage/fetchWorkspaceTokenUsage",
);

/** A snapshot arrived (GET response or CHANGED push). */
export const tokenUsageReceived = createAction<
  [wsId: string, snapshot: WorkspaceTokenUsageSnapshot]
>("tokenUsage/tokenUsageReceived");

/** A fetch failed; keep cached numbers but mark them stale. */
export const tokenUsageFetchFailed = createAction<[wsId: string]>(
  "tokenUsage/tokenUsageFetchFailed",
);

/** Drop the workspace entry (workspace closed/removed). */
export const clearWorkspaceTokenUsage = createAction<[wsId: string]>(
  "tokenUsage/clearWorkspaceTokenUsage",
);

// ---------------------------------------------------------------------------
// Workspace-scoped helpers
// ---------------------------------------------------------------------------

const { setWorkspaceState, clearWorkspaceState } =
  createWorkspaceScopedHelpers(emptyWorkspaceTokenUsageState);

// ---------------------------------------------------------------------------
// Reducer
// ---------------------------------------------------------------------------

export const tokenUsageReducer = createReducer<TokenUsageState>(initialState)
  .with(tokenUsageReceived, (state, { payload: [wsId, snapshot] }) =>
    setWorkspaceState(state, wsId, {
      byAgentId: snapshot.byAgentId,
      totals: snapshot.totals,
      byModel: snapshot.byModel,
      lastScanAt: snapshot.lastScanAt,
      isStale: false,
    }),
  )
  .with(tokenUsageFetchFailed, (state, { payload: [wsId] }) => {
    const ws = state.byWorkspaceId[wsId];
    if (!ws || ws.isStale) return state;
    return setWorkspaceState(state, wsId, { ...ws, isStale: true });
  })
  .with(clearWorkspaceTokenUsage, (state, { payload: [wsId] }) =>
    clearWorkspaceState(state, wsId),
  );

