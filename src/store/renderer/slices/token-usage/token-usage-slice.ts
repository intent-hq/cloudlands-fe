/**
 * Token Usage Slice (renderer)
 *
 * Actions and reducer for the renderer mirror of the daemon-owned per-workspace
 * `TokenUsage` rollup (PROTOCOL §5.23). The lifecycle read service fetches it
 * via `appClient.workspaces.getTokenUsage` on `fetchWorkspaceTokenUsage`, and
 * the daemon-events-bridge dispatches `tokenUsageReceived` on each
 * `workspace:tokenUsage-changed` push.
 */

import { createAction } from "$lib/store-shim/utils/store/create-action";
import { createReducer } from "$lib/store-shim/utils/store/create-reducer";
import { createWorkspaceScopedHelpers } from "../../utils/workspace-scoped";
import type { TokenUsage } from "../../../../features/token-usage/token-usage-types";
import type { TokenUsageState } from "./token-usage-types";
import { emptyWorkspaceTokenUsageState, initialState } from "./token-usage-types";

export type { TokenUsageState, WorkspaceTokenUsageState } from "./token-usage-types";
export { emptyWorkspaceTokenUsageState, initialState } from "./token-usage-types";

// ---------------------------------------------------------------------------
// Actions
// ---------------------------------------------------------------------------

/** Request the workspace's token usage rollup from the daemon. */
export const fetchWorkspaceTokenUsage = createAction<[wsId: string]>(
  "tokenUsage/fetchWorkspaceTokenUsage",
);

/** A rollup arrived (`workspace.getTokenUsage` read or `tokenUsage-changed` push). */
export const tokenUsageReceived = createAction<[wsId: string, usage: TokenUsage]>(
  "tokenUsage/tokenUsageReceived",
);

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
  .with(tokenUsageReceived, (state, { payload: [wsId, usage] }) =>
    setWorkspaceState(state, wsId, {
      byAgentId: usage.byAgentId,
      totals: usage.totals,
      byModel: usage.byModel,
      lastScanAt: usage.lastScanAt,
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

