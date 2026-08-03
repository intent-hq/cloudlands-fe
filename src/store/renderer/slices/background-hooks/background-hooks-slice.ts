/**
 * background-hooks slice — per-workspace live hook list (PROTOCOL §5.40).
 *
 * The `BackgroundHooksRow` chip row dispatches
 * `backgroundHooksSubscribeRequested` on mount and
 * `backgroundHooksUnsubscribeRequested` on teardown. The companion service
 * middleware (`$features/hooks/background-hooks-service`,
 * `createBackgroundHooksMiddleware`) owns the `hook:*` events.subscribe +
 * `hook.list` seed round-trip and writes every fold result back via
 * `backgroundHooksUpdated`, so the component renders purely from selectors
 * and never touches the live backend transport. Run/cancel triggers
 * (`runBackgroundHookRequested` / `cancelBackgroundHookRequested`) have no
 * reducer case — the daemon's `hook:*` events converge the list.
 */
import { createAction } from "$lib/store-shim/utils/store/create-action";
import { createReducer } from "$lib/store-shim/utils/store/create-reducer";
import {
  createCollection,
  type Collection,
} from "$lib/store-shim/utils/collections/collection-utils";
import { createWorkspaceScopedHelpers } from "../../utils/workspace-scoped";
import { removeWorkspaceEntity } from "../workspace/workspace-slice";
import type { BackgroundHook } from "$features/hooks/background-hooks-service";

/** Per-workspace live hook state (all wire states; selectors filter). */
export interface BackgroundHooksWorkspaceState {
  hooks: Collection<BackgroundHook, "hookId">;
}

/** Root background-hooks state, keyed by workspace ID. */
export interface BackgroundHooksState {
  byWorkspaceId: Record<string, BackgroundHooksWorkspaceState>;
}

export const emptyBackgroundHooksWorkspaceState: BackgroundHooksWorkspaceState = {
  hooks: createCollection<BackgroundHook, "hookId">("hookId"),
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
  "backgroundHooks/subscribeRequested",
);

/** Trigger: release one subscriber; the last release disposes and clears. */
export const backgroundHooksUnsubscribeRequested = createAction<[workspaceId: string]>(
  "backgroundHooks/unsubscribeRequested",
);

/**
 * Trigger: on-demand `hook.list` refetch for the workspace's live
 * subscription — `hook:*` events never carry `lastLogs` (§5.40), so
 * consumers dispatch this to refresh it. The fresh list arrives via
 * `backgroundHooksUpdated`; no reducer case.
 */
export const backgroundHooksRefetchRequested = createAction<[workspaceId: string]>(
  "backgroundHooks/refetchRequested",
);

/** Service → reducer: full hook list after a seed or event fold. */
export const backgroundHooksUpdated = createAction<
  [workspaceId: string, hooks: BackgroundHook[]]
>("backgroundHooks/updated");

/** Service → reducer: last subscriber released — drop the cached list. */
export const backgroundHooksCleared = createAction<[workspaceId: string]>(
  "backgroundHooks/cleared",
);

/** Trigger: `hook.runNow` (§5.40) — outcome arrives via `hook:*` events. */
export const runBackgroundHookRequested = createAction<
  [workspaceId: string, hookId: string]
>("backgroundHooks/runRequested");

/** Trigger: `hook.cancel` (§5.40) — `hook:cancelled` drops the chip. */
export const cancelBackgroundHookRequested = createAction<
  [workspaceId: string, hookId: string]
>("backgroundHooks/cancelRequested");

// ── Reducer ──

export const backgroundHooksReducer = createReducer<BackgroundHooksState>(initialState)
  .with(backgroundHooksUpdated, (state, { payload: [workspaceId, hooks] }) =>
    setWorkspaceState(state, workspaceId, {
      hooks: createCollection<BackgroundHook, "hookId">("hookId", hooks),
    }),
  )
  .with(backgroundHooksCleared, (state, { payload: [workspaceId] }) =>
    clearWorkspaceState(state, workspaceId),
  )
  .with(removeWorkspaceEntity, (state, { payload: [wsId] }) =>
    clearWorkspaceState(state, wsId),
  );
