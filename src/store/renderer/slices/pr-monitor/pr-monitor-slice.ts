/**
 * pr-monitor slice — per-workspace live PR-monitor list (PROTOCOL §6.9).
 *
 * The companion `prMonitorSaga` shares selected-tab and mounted-chat leases on `prMonitor:*`
 * events.subscribe + `prMonitor.list` seed round-trip and writes every fold
 * result back via `prMonitorsUpdated`, so components render purely from
 * selectors and never touch the live backend transport. Cancel/flush triggers
 * (`cancelPrMonitorRequested` / `flushPrMonitorRequested`) have no reducer
 * case — the daemon's `prMonitor:*` events converge the list.
 */
import { createAction } from '@themislib/themis/utils/store/create-action';
import { createReducer } from '@themislib/themis/utils/store/create-reducer';
import {
  createCollection,
  type Collection,
} from '@themislib/themis/utils/collections/collection-utils';
import { createWorkspaceScopedHelpers } from '../../utils/workspace-scoped';
import { removeWorkspaceEntity } from '../workspace/workspace-slice';
import type {
  ReviewMonitorRow,
  PrMonitorOrigin,
  ReviewMonitoringSupport,
} from '$shared/types/pr-monitor';

export type PrMonitorSnapshotStatus = 'loading' | 'ready' | 'failed';

/** Per-workspace live monitor state (active + completed; selectors filter). */
interface PrMonitorWorkspaceState {
  monitors: Collection<ReviewMonitorRow, 'monitorId'>;
  snapshotStatus: PrMonitorSnapshotStatus;
  support?: ReviewMonitoringSupport;
}

/** Root pr-monitor state, keyed by workspace ID. */
export interface PrMonitorState {
  byWorkspaceId: Record<string, PrMonitorWorkspaceState>;
}

const emptyPrMonitorWorkspaceState: PrMonitorWorkspaceState = {
  monitors: createCollection<ReviewMonitorRow, 'monitorId'>('monitorId'),
  snapshotStatus: 'loading',
};

export const initialState: PrMonitorState = {
  byWorkspaceId: {},
};

const { setWorkspaceState, clearWorkspaceState } = createWorkspaceScopedHelpers(
  emptyPrMonitorWorkspaceState,
);

// ── Actions ──

/** Refcounted view-time leases, shared with the selected-workspace preload. */
export const prMonitorsSubscribeRequested = createAction<[workspaceId: string]>(
  'prMonitor/subscribeRequested',
);
export const prMonitorsUnsubscribeRequested = createAction<[workspaceId: string]>(
  'prMonitor/unsubscribeRequested',
);
export const prMonitorsActiveWorkspaceChanged = createAction<[workspaceId: string | null]>(
  'prMonitor/activeWorkspaceChanged',
);

/** Service → reducer: full monitor list after a seed or event fold. */
export const prMonitorsUpdated =
  createAction<[workspaceId: string, monitors: ReviewMonitorRow[]]>('prMonitor/updated');

export const prMonitorsSnapshotFailed = createAction<[workspaceId: string]>(
  'prMonitor/snapshotFailed',
);

/** Trigger: `prMonitor.flush` (§6.9) — outcome arrives via `prMonitor:*` events.
 * `check: true` asks the daemon to re-poll the PR first (§5.42 additive param). */
export const flushPrMonitorRequested = createAction<
  [workspaceId: string, monitorId: string, check?: boolean, origin?: PrMonitorOrigin]
>('prMonitor/flushRequested');

/** Trigger: `prMonitor.cancel` (§6.9) — `prMonitor:cancelled` drops the row. */
export const cancelPrMonitorRequested = createAction<
  [workspaceId: string, monitorId: string, origin?: PrMonitorOrigin]
>('prMonitor/cancelRequested');

export const prMonitorsConnectionChanged = createAction<[workspaceId: string]>(
  'prMonitor/connectionChanged',
);
export const prMonitorsSupportUpdated = createAction<
  [workspaceId: string, support: ReviewMonitoringSupport]
>('prMonitor/supportUpdated');

// ── Reducer ──

export const prMonitorReducer = createReducer<PrMonitorState>(initialState);

prMonitorReducer.with(prMonitorsUpdated, (state, { payload: [workspaceId, monitors] }) => {
  return setWorkspaceState(state, workspaceId, {
    monitors: createCollection<ReviewMonitorRow, 'monitorId'>('monitorId', monitors),
    snapshotStatus: 'ready',
    support: state.byWorkspaceId[workspaceId]?.support,
  });
});

prMonitorReducer.with(prMonitorsSnapshotFailed, (state, { payload: [workspaceId] }) => {
  const entry = state.byWorkspaceId[workspaceId] ?? emptyPrMonitorWorkspaceState;
  return setWorkspaceState(state, workspaceId, { ...entry, snapshotStatus: 'failed' });
});

prMonitorReducer.with(removeWorkspaceEntity, (state, { payload: [wsId] }) =>
  clearWorkspaceState(state, wsId),
);

prMonitorReducer.with(prMonitorsConnectionChanged, (state, { payload: [workspaceId] }) =>
  setWorkspaceState(state, workspaceId, emptyPrMonitorWorkspaceState),
);
prMonitorReducer.with(prMonitorsSupportUpdated, (state, { payload: [workspaceId, support] }) =>
  setWorkspaceState(state, workspaceId, {
    ...(state.byWorkspaceId[workspaceId] ?? emptyPrMonitorWorkspaceState),
    support,
  }),
);
