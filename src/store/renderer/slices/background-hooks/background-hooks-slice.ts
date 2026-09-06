/**
 * background-hooks slice — per-workspace live hook list (PROTOCOL §5.40).
 *
 * The `BackgroundHooksRow` chip row dispatches
 * `backgroundHooksSubscribeRequested` on mount and
 * `backgroundHooksUnsubscribeRequested` on teardown. The app-owned
 * `backgroundHooksSaga` owns the `hook:*` events.subscribe +
 * `hook.list` seed round-trip and writes every fold result back via
 * `backgroundHooksUpdated`, so the component renders purely from selectors
 * and never touches the live backend transport. Run/cancel triggers
 * (`runBackgroundHookRequested` / `cancelBackgroundHookRequested`) have no
 * reducer case — the daemon's `hook:*` events converge the list.
 */
import { createAction } from '@augmentcode/themis/utils/store/create-action';
import { createReducer } from '@augmentcode/themis/utils/store/create-reducer';
import {
  createCollection,
  type Collection,
} from '@augmentcode/themis/utils/collections/collection-utils';
import { createWorkspaceScopedHelpers } from '../../utils/workspace-scoped';
import { removeWorkspaceEntity } from '../workspace/workspace-slice';
import type { BackgroundHook } from '$features/hooks/background-hooks-service';

export type BackgroundHooksSnapshotStatus = 'loading' | 'ready' | 'failed';

/** Per-workspace live hook state (all wire states; selectors filter). */
interface BackgroundHooksWorkspaceState {
  hooks: Collection<BackgroundHook, 'hookId'>;
  /**
   * No live `hook:*` subscription backs this entry (last subscriber
   * released) — the retained list may be outdated. Consumers that treat an
   * entry as authoritative (`getActiveHookNames`) must fall back to an
   * on-demand `hook.list` while set; only an AUTHORITATIVE
   * `backgroundHooksUpdated` (a successful full `hook.list` snapshot)
   * clears it — provisional writes (event folds, failed-seed cached
   * deliveries) preserve it.
   */
  stale: boolean;
  snapshotStatus: BackgroundHooksSnapshotStatus;
}

/** Root background-hooks state, keyed by workspace ID. */
export interface BackgroundHooksState {
  byWorkspaceId: Record<string, BackgroundHooksWorkspaceState>;
}

const emptyBackgroundHooksWorkspaceState: BackgroundHooksWorkspaceState = {
  hooks: createCollection<BackgroundHook, 'hookId'>('hookId'),
  stale: false,
  snapshotStatus: 'loading',
};

export const initialState: BackgroundHooksState = {
  byWorkspaceId: {},
};

const { setWorkspaceState, clearWorkspaceState } = createWorkspaceScopedHelpers(
  emptyBackgroundHooksWorkspaceState,
);

// ── Actions ──

/** Trigger: open (or refcount) the workspace's `hook:*` live subscription. */
export const backgroundHooksSubscribeRequested = createAction<[workspaceId: string]>(
  'backgroundHooks/subscribeRequested',
);

/** Trigger: release one subscriber; the last release disposes and clears. */
export const backgroundHooksUnsubscribeRequested = createAction<[workspaceId: string]>(
  'backgroundHooks/unsubscribeRequested',
);

/**
 * Trigger: on-demand `hook.list` refetch for the workspace's live
 * subscription — `hook:*` events never carry `lastLogs` (§5.40), so
 * consumers dispatch this to refresh it. The fresh list arrives via
 * `backgroundHooksUpdated`; no reducer case.
 */
export const backgroundHooksRefetchRequested = createAction<[workspaceId: string]>(
  'backgroundHooks/refetchRequested',
);

export const backgroundHooksSnapshotFailed = createAction<[workspaceId: string]>(
  'backgroundHooks/snapshotFailed',
);

/**
 * Service → reducer: full hook list after a seed or event fold.
 * `provisional: true` marks a non-authoritative write (an event fold on the
 * cached rows, or a failed-seed cached delivery) — it updates the rows but
 * PRESERVES the `stale` flag; only an authoritative write (a successful
 * full `hook.list` snapshot, `provisional` omitted/false) clears it.
 */
export const backgroundHooksUpdated =
  createAction<[workspaceId: string, hooks: BackgroundHook[], provisional?: boolean]>(
    'backgroundHooks/updated',
  );

/**
 * Service → reducer: last subscriber released — RETAIN the cached list but
 * mark it stale so no consumer serves it as authoritative while
 * unsubscribed. Retention prevents a warm reactivation from flashing empty;
 * the reactivation seed refreshes the rows in the background.
 */
export const backgroundHooksMarkedStale = createAction<[workspaceId: string]>(
  'backgroundHooks/markedStale',
);

/** Trigger: `hook.runNow` (§5.40) — outcome arrives via `hook:*` events. */
export const runBackgroundHookRequested = createAction<[workspaceId: string, hookId: string]>(
  'backgroundHooks/runRequested',
);

/** Trigger: `hook.cancel` (§5.40) — `hook:cancelled` drops the chip. */
export const cancelBackgroundHookRequested = createAction<[workspaceId: string, hookId: string]>(
  'backgroundHooks/cancelRequested',
);

// ── Reducer ──

export const backgroundHooksReducer = createReducer<BackgroundHooksState>(initialState);
backgroundHooksReducer.with(
  backgroundHooksUpdated,
  (state, { payload: [workspaceId, hooks, provisional] }) =>
    setWorkspaceState(state, workspaceId, {
      hooks: createCollection<BackgroundHook, 'hookId'>('hookId', hooks),
      stale: provisional === true ? (state.byWorkspaceId[workspaceId]?.stale ?? false) : false,
      snapshotStatus:
        provisional === true
          ? (state.byWorkspaceId[workspaceId]?.snapshotStatus ?? 'loading')
          : 'ready',
    }),
);
backgroundHooksReducer.with(backgroundHooksSnapshotFailed, (state, { payload: [workspaceId] }) => {
  const entry = state.byWorkspaceId[workspaceId] ?? emptyBackgroundHooksWorkspaceState;
  return setWorkspaceState(state, workspaceId, { ...entry, snapshotStatus: 'failed' });
});
backgroundHooksReducer.with(backgroundHooksMarkedStale, (state, { payload: [workspaceId] }) => {
  const entry = state.byWorkspaceId[workspaceId];
  if (!entry) return state;
  return setWorkspaceState(state, workspaceId, { ...entry, stale: true });
});
backgroundHooksReducer.with(removeWorkspaceEntity, (state, { payload: [wsId] }) =>
  clearWorkspaceState(state, wsId),
);
