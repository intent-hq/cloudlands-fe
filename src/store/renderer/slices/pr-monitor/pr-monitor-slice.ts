/**
 * pr-monitor slice — per-workspace live PR-monitor list (PROTOCOL §6.9).
 *
 * The companion `prMonitorSaga` owns the active workspace's `prMonitor:*`
 * events.subscribe + `prMonitor.list` seed round-trip and writes every fold
 * result back via `prMonitorsUpdated`, so components render purely from
 * selectors and never touch the live backend transport. Cancel/flush triggers
 * (`cancelPrMonitorRequested` / `flushPrMonitorRequested`) have no reducer
 * case — the daemon's `prMonitor:*` events converge the list.
 */
import { createAction } from '@augmentcode/themis/utils/store/create-action';
import { createReducer } from '@augmentcode/themis/utils/store/create-reducer';
import {
  createCollection,
  type Collection,
} from '@augmentcode/themis/utils/collections/collection-utils';
import { createWorkspaceScopedHelpers } from '../../utils/workspace-scoped';
import { removeWorkspaceEntity } from '../workspace/workspace-slice';
import type { PrMonitorRow } from '$features/pr-monitor/pr-monitor-service';

export type PrMonitorSnapshotStatus = 'loading' | 'ready' | 'failed';

/** Per-workspace live monitor state (active + completed; selectors filter). */
interface PrMonitorWorkspaceState {
  monitors: Collection<PrMonitorRow, 'monitorId'>;
  snapshotStatus: PrMonitorSnapshotStatus;
}

/** Root pr-monitor state, keyed by workspace ID. */
export interface PrMonitorState {
  byWorkspaceId: Record<string, PrMonitorWorkspaceState>;
}

const emptyPrMonitorWorkspaceState: PrMonitorWorkspaceState = {
  monitors: createCollection<PrMonitorRow, 'monitorId'>('monitorId'),
  snapshotStatus: 'loading',
};

export const initialState: PrMonitorState = {
  byWorkspaceId: {},
};

const { setWorkspaceState, clearWorkspaceState } = createWorkspaceScopedHelpers(
  emptyPrMonitorWorkspaceState,
);

// ── Actions ──

/** Service → reducer: full monitor list after a seed or event fold. */
export const prMonitorsUpdated =
  createAction<[workspaceId: string, monitors: PrMonitorRow[]]>('prMonitor/updated');

export const prMonitorsSnapshotFailed = createAction<[workspaceId: string]>(
  'prMonitor/snapshotFailed',
);

/** Trigger: `prMonitor.flush` (§6.9) — outcome arrives via `prMonitor:*` events.
 * `check: true` asks the daemon to re-poll the PR first (§5.42 additive param). */
export const flushPrMonitorRequested = createAction<
  [workspaceId: string, monitorId: string, check?: boolean]
>('prMonitor/flushRequested');

/** Trigger: `prMonitor.cancel` (§6.9) — `prMonitor:cancelled` drops the row. */
export const cancelPrMonitorRequested = createAction<[workspaceId: string, monitorId: string]>(
  'prMonitor/cancelRequested',
);

// ── Reducer ──

export const prMonitorReducer = createReducer<PrMonitorState>(initialState);

prMonitorReducer.with(prMonitorsUpdated, (state, { payload: [workspaceId, monitors] }) => {
  return setWorkspaceState(state, workspaceId, {
    monitors: createCollection<PrMonitorRow, 'monitorId'>('monitorId', monitors),
    snapshotStatus: 'ready',
  });
});

prMonitorReducer.with(prMonitorsSnapshotFailed, (state, { payload: [workspaceId] }) => {
  const entry = state.byWorkspaceId[workspaceId] ?? emptyPrMonitorWorkspaceState;
  return setWorkspaceState(state, workspaceId, { ...entry, snapshotStatus: 'failed' });
});

prMonitorReducer.with(removeWorkspaceEntity, (state, { payload: [wsId] }) =>
  clearWorkspaceState(state, wsId),
);
