/**
 * Token Usage Redux Slice
 *
 * Main-process cache of per-workspace aggregated token usage. The saga owns
 * refresh orchestration (throttle + in-flight guard); the reducer owns the
 * cache transitions. Cache entries are pruned on agent deletion and the whole
 * workspace entry is dropped on workspace cleanup.
 */

import { createAction } from "ag-redux-toolkit/utils/store/create-action";
import { createReducer } from "ag-redux-toolkit/utils/store/create-reducer";
import { createWorkspaceScopedHelpers } from "../../../utils/workspace-scoped";
import type { WorkspaceTokenScanResult } from "../../../../features/token-usage/token-usage-types";
import {
  addTotals,
  createEmptyTotals,
  mergeByModel,
} from "../../../../features/token-usage/utils/token-usage-utils";
import type { TokenUsageState } from "./types";
import { emptyWorkspaceTokenUsageState, initialState } from "./types";

export type {
  TokenUsageScanStatus,
  TokenUsageState,
  WorkspaceTokenUsageState,
} from "./types";
export { emptyWorkspaceTokenUsageState, initialState } from "./types";

// ============================================================================
// Actions
// ============================================================================

/** Request a (possibly throttled) refresh of a workspace's token usage. */
export const refreshRequested = createAction<[wsId: string]>(
  "tokenUsage/refreshRequested",
);

/** Saga marker: a scan for this workspace is now in flight. */
export const scanStarted = createAction<[wsId: string]>(
  "tokenUsage/scanStarted",
);

/** A scan finished; replace the workspace cache with the scan result. */
export const scanCompleted = createAction<
  [wsId: string, result: WorkspaceTokenScanResult, completedAt: number]
>("tokenUsage/scanCompleted");

/** A scan failed; release the in-flight guard without touching cached data. */
export const scanFailed = createAction<[wsId: string]>(
  "tokenUsage/scanFailed",
);

/** Prune one agent's cache entry (agent deleted). */
export const agentRemoved = createAction<[wsId: string, agentId: string]>(
  "tokenUsage/agentRemoved",
);

/** Drop the whole workspace entry (workspace closed/deleted). */
export const workspaceCleanedUp = createAction<[wsId: string]>(
  "tokenUsage/workspaceCleanedUp",
);

// ============================================================================
// Workspace-scoped helpers
// ============================================================================

const { getWorkspaceState, setWorkspaceState, clearWorkspaceState } =
  createWorkspaceScopedHelpers(emptyWorkspaceTokenUsageState);

// ============================================================================
// Reducer
// ============================================================================

export const tokenUsageReducer = createReducer<TokenUsageState>(initialState)
  .with(scanStarted, (state, { payload: [wsId] }) => {
    const ws = getWorkspaceState(state, wsId);
    if (ws.status === "scanning") return state;
    return setWorkspaceState(state, wsId, { ...ws, status: "scanning" });
  })
  .with(scanCompleted, (state, { payload: [wsId, result, completedAt] }) => {
    const ws = getWorkspaceState(state, wsId);
    return setWorkspaceState(state, wsId, {
      ...ws,
      byAgentId: result.perAgent,
      totals: result.totals,
      byModel: result.byModel,
      lastScanAt: completedAt,
      status: "idle",
    });
  })
  .with(scanFailed, (state, { payload: [wsId] }) => {
    const ws = getWorkspaceState(state, wsId);
    if (ws.status === "idle") return state;
    return setWorkspaceState(state, wsId, { ...ws, status: "idle" });
  })
  .with(agentRemoved, (state, { payload: [wsId, agentId] }) => {
    const ws = getWorkspaceState(state, wsId);
    if (!(agentId in ws.byAgentId)) return state;

    const { [agentId]: _removed, ...byAgentId } = ws.byAgentId;
    const totals = createEmptyTotals();
    const byModel: typeof ws.byModel = {};
    for (const entry of Object.values(byAgentId)) {
      addTotals(totals, entry);
      mergeByModel(byModel, entry.byModel);
    }
    return setWorkspaceState(state, wsId, { ...ws, byAgentId, totals, byModel });
  })
  .with(workspaceCleanedUp, (state, { payload: [wsId] }) => {
    return clearWorkspaceState(state, wsId);
  });

