/**
 * pr-monitor slice — per-workspace live PR-monitor list (PROTOCOL §6.9).
 *
 * Consumers (the `MonitoredPrsRow` chip row, the sidebar PR list, the
 * workspace cards) dispatch `prMonitorsSubscribeRequested` on mount and
 * `prMonitorsUnsubscribeRequested` on teardown. The companion service
 * middleware (`$features/pr-monitor/pr-monitor-read-service`,
 * `createPrMonitorMiddleware`) owns the `prMonitor:*` events.subscribe +
 * `prMonitor.list` seed round-trip and writes every fold result back via
 * `prMonitorsUpdated`, so components render purely from selectors and never
 * touch the live backend transport. Cancel/flush triggers
 * (`cancelPrMonitorRequested` / `flushPrMonitorRequested`) have no reducer
 * case — the daemon's `prMonitor:*` events converge the list.
 */
import { createAction } from "$lib/store-shim/utils/store/create-action";
import { createReducer } from "$lib/store-shim/utils/store/create-reducer";
import {
  createCollection,
  type Collection,
} from "$lib/store-shim/utils/collections/collection-utils";
import { createWorkspaceScopedHelpers } from "../../utils/workspace-scoped";
import { removeWorkspaceEntity } from "../workspace/workspace-slice";
import type { PrMonitorRow } from "$features/pr-monitor/pr-monitor-service";

/** Per-workspace live monitor state (active + completed; selectors filter). */
export interface PrMonitorWorkspaceState {
  monitors: Collection<PrMonitorRow, "monitorId">;
}

/** Root pr-monitor state, keyed by workspace ID. */
export interface PrMonitorState {
  byWorkspaceId: Record<string, PrMonitorWorkspaceState>;
}

export const emptyPrMonitorWorkspaceState: PrMonitorWorkspaceState = {
  monitors: createCollection<PrMonitorRow, "monitorId">("monitorId"),
};

export const initialState: PrMonitorState = {
  byWorkspaceId: {},
};

const { setWorkspaceState, clearWorkspaceState } = createWorkspaceScopedHelpers(
  emptyPrMonitorWorkspaceState,
);

// ── Actions ──

/** Trigger: open (or refcount) the workspace's `prMonitor:*` live subscription. */
export const prMonitorsSubscribeRequested = createAction<[workspaceId: string]>(
  "prMonitor/subscribeRequested",
);

/** Trigger: release one subscriber; the last release disposes and clears. */
export const prMonitorsUnsubscribeRequested = createAction<[workspaceId: string]>(
  "prMonitor/unsubscribeRequested",
);

/**
 * Trigger: on-demand `prMonitor.list` refetch — `prMonitor:*` events never
 * carry `lastSnapshot` (§6.9), so consumers dispatch this to refresh it.
 * The fresh list arrives via `prMonitorsUpdated`; no reducer case.
 */
export const prMonitorsRefetchRequested = createAction<[workspaceId: string]>(
  "prMonitor/refetchRequested",
);

/** Service → reducer: full monitor list after a seed or event fold. */
export const prMonitorsUpdated = createAction<
  [workspaceId: string, monitors: PrMonitorRow[]]
>("prMonitor/updated");

/** Service → reducer: last subscriber released — drop the cached list. */
export const prMonitorsCleared = createAction<[workspaceId: string]>(
  "prMonitor/cleared",
);

/** Trigger: `prMonitor.flush` (§6.9) — outcome arrives via `prMonitor:*` events. */
export const flushPrMonitorRequested = createAction<
  [workspaceId: string, monitorId: string]
>("prMonitor/flushRequested");

/** Trigger: `prMonitor.cancel` (§6.9) — `prMonitor:cancelled` drops the row. */
export const cancelPrMonitorRequested = createAction<
  [workspaceId: string, monitorId: string]
>("prMonitor/cancelRequested");

// ── Reducer ──

export const prMonitorReducer = createReducer<PrMonitorState>(initialState)
  .with(prMonitorsUpdated, (state, { payload: [workspaceId, monitors] }) =>
    setWorkspaceState(state, workspaceId, {
      monitors: createCollection<PrMonitorRow, "monitorId">("monitorId", monitors),
    }),
  )
  .with(prMonitorsCleared, (state, { payload: [workspaceId] }) =>
    clearWorkspaceState(state, workspaceId),
  )
  .with(removeWorkspaceEntity, (state, { payload: [wsId] }) =>
    clearWorkspaceState(state, wsId),
  );
