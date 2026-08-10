/**
 * pr-monitor slice — per-workspace live PR-monitor list (PROTOCOL §6.9).
 *
 * Consumers (the `MonitoredPrsRow` chip row, the sidebar PR list, the
 * workspace cards) dispatch `prMonitorsSubscribeRequested` on mount and
 * `prMonitorsUnsubscribeRequested` on teardown. The companion
 * `prMonitorSaga` owns the `prMonitor:*` events.subscribe +
 * `prMonitor.list` seed round-trip and writes every fold result back via
 * `prMonitorsUpdated`, so components render purely from selectors and never
 * touch the live backend transport. Cancel/flush triggers
 * (`cancelPrMonitorRequested` / `flushPrMonitorRequested`) have no reducer
 * case — the daemon's `prMonitor:*` events converge the list.
 */
import { createAction } from "@augmentcode/themis/utils/store/create-action";
import { createReducer } from "@augmentcode/themis/utils/store/create-reducer";
import {
  createCollection,
  decreaseRefsCount,
  getRefsCount,
  increaseRefsCount,
  type Collection,
} from "@augmentcode/themis/utils/collections/collection-utils";
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

const { getWorkspaceState, setWorkspaceState, clearWorkspaceState } = createWorkspaceScopedHelpers(
  emptyPrMonitorWorkspaceState,
);

function replaceMonitorRows(
  current: Collection<PrMonitorRow, "monitorId">,
  workspaceId: string,
  monitors: PrMonitorRow[],
): Collection<PrMonitorRow, "monitorId"> {
  const refsCount = getRefsCount(current, workspaceId);
  let next = createCollection<PrMonitorRow, "monitorId">("monitorId", monitors);
  for (let remaining = refsCount; remaining > 0; remaining -= 1) {
    next = increaseRefsCount(next, workspaceId);
  }
  return next;
}

// ── Actions ──

/** Trigger: open (or refcount) the workspace's `prMonitor:*` live subscription. */
export const prMonitorsSubscribeRequested = createAction<[workspaceId: string]>(
  "prMonitor/subscribeRequested",
);

/** Trigger: release one subscriber; the last release disposes and clears. */
export const prMonitorsUnsubscribeRequested = createAction<[workspaceId: string]>(
  "prMonitor/unsubscribeRequested",
);

/** Service → reducer: full monitor list after a seed or event fold. */
export const prMonitorsUpdated =
  createAction<[workspaceId: string, monitors: PrMonitorRow[]]>("prMonitor/updated");

/** Service → reducer: last subscriber released — drop the cached list. */
export const prMonitorsCleared = createAction<[workspaceId: string]>("prMonitor/cleared");

/** Trigger: `prMonitor.flush` (§6.9) — outcome arrives via `prMonitor:*` events. */
export const flushPrMonitorRequested = createAction<[workspaceId: string, monitorId: string]>(
  "prMonitor/flushRequested",
);

/** Trigger: `prMonitor.cancel` (§6.9) — `prMonitor:cancelled` drops the row. */
export const cancelPrMonitorRequested = createAction<[workspaceId: string, monitorId: string]>(
  "prMonitor/cancelRequested",
);

// ── Reducer ──

export const prMonitorReducer = createReducer<PrMonitorState>(initialState);

prMonitorReducer.with(prMonitorsSubscribeRequested, (state, { payload: [workspaceId] }) => {
  if (!workspaceId) return state;
  const workspaceState = getWorkspaceState(state, workspaceId);
  return setWorkspaceState(state, workspaceId, {
    monitors: increaseRefsCount(workspaceState.monitors, workspaceId),
  });
});

prMonitorReducer.with(prMonitorsUnsubscribeRequested, (state, { payload: [workspaceId] }) => {
  const workspaceState = state.byWorkspaceId[workspaceId];
  if (!workspaceId || !workspaceState || getRefsCount(workspaceState.monitors, workspaceId) === 0) {
    return state;
  }
  return setWorkspaceState(state, workspaceId, {
    monitors: decreaseRefsCount(workspaceState.monitors, workspaceId),
  });
});

prMonitorReducer.with(prMonitorsUpdated, (state, { payload: [workspaceId, monitors] }) => {
  const workspaceState = getWorkspaceState(state, workspaceId);
  return setWorkspaceState(state, workspaceId, {
    monitors: replaceMonitorRows(workspaceState.monitors, workspaceId, monitors),
  });
});

prMonitorReducer.with(prMonitorsCleared, (state, { payload: [workspaceId] }) => {
  const workspaceState = state.byWorkspaceId[workspaceId];
  if (!workspaceState) return state;
  if (getRefsCount(workspaceState.monitors, workspaceId) === 0) {
    return clearWorkspaceState(state, workspaceId);
  }
  return setWorkspaceState(state, workspaceId, {
    monitors: replaceMonitorRows(workspaceState.monitors, workspaceId, []),
  });
});

prMonitorReducer.with(removeWorkspaceEntity, (state, { payload: [wsId] }) =>
  clearWorkspaceState(state, wsId),
);
