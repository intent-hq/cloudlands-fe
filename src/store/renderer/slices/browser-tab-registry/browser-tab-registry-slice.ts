/**
 * Browser Tab Registry Slice (renderer)
 *
 * Reducer-owned lifecycle bookkeeping for the registry saga (see the types
 * file for the state machine). The saga is the only dispatcher of the
 * `registry*` actions; teardown transitions ride the existing lifecycle and
 * panel-layout actions.
 */

import { createAction } from '@augmentcode/themis/utils/store/create-action';
import { createReducer } from '@augmentcode/themis/utils/store/create-reducer';
import type { BrowserTabInput } from '$shared/types/browser-clients';
import { omitKey } from '../../utils/utils';
import { createWorkspaceScopedHelpers } from '../../utils/workspace-scoped';
import { browserTabClosed } from '../browser-clients/browser-clients-slice';
import { clearPanelLayout } from '../panel-layout/panel-layout-slice';
import {
  workspaceDeleted,
  workspaceUnmounted,
} from '../workspace-lifecycle/workspace-lifecycle-slice';
import type {
  BrowserTabRegistryState,
  WorkspaceBrowserTabRegistryState,
} from './browser-tab-registry-types';
import { emptyWorkspaceBrowserTabRegistryState, initialState } from './browser-tab-registry-types';

export type {
  BrowserTabClosingState,
  BrowserTabRegistryState,
  WorkspaceBrowserTabRegistryState,
} from './browser-tab-registry-types';
export { initialState } from './browser-tab-registry-types';

const { getWorkspaceState, setWorkspaceState } = createWorkspaceScopedHelpers(
  emptyWorkspaceBrowserTabRegistryState,
);

// ---------------------------------------------------------------------------
// Actions
// ---------------------------------------------------------------------------

/** A load of the workspace's rows starts: new generation, `loading`. */
export const registryLoading = createAction<[wsId: string]>('browserTabRegistry/loading');

/**
 * The rows read under `generation` are in the layout; `reported` is what the
 * daemon holds for the tabs this client hosts. Ignored for a stale generation.
 */
export const registryApplied = createAction<
  [wsId: string, generation: number, reported: Record<string, BrowserTabInput>]
>('browserTabRegistry/applied');

/** One hosted tab was (or is being) reported as `input`. Ignored for a stale generation. */
export const registryTabReported = createAction<
  [wsId: string, generation: number, tabId: string, input: BrowserTabInput]
>('browserTabRegistry/tabReported');

/** The tab is no longer this client's to report (re-homed, failed report, dropped). */
export const registryTabForgotten = createAction<[wsId: string, tabId: string]>(
  'browserTabRegistry/tabForgotten',
);

/**
 * Hosted tabs filled from their rows and queued for tunnel re-resolution;
 * they stay `unresolved` until a resolution is established. Ignored for a
 * stale generation.
 */
export const registryTabsUnresolved = createAction<
  [wsId: string, generation: number, tabIds: string[]]
>('browserTabRegistry/tabsUnresolved');

/** The tab's tunnel re-resolution was established: its URL is live for this session. */
export const registryTabResolved = createAction<[wsId: string, tabId: string]>(
  'browserTabRegistry/tabResolved',
);

/** Tabs that left the layout: closed here, their removal still to be confirmed. */
export const registryRemovalsPending = createAction<[wsId: string, tabIds: string[]]>(
  'browserTabRegistry/removalsPending',
);

/** `browser.removeTab` succeeded; the `browser:tab-closed` echo is still to land. */
export const registryRemovalAcknowledged = createAction<[tabId: string]>(
  'browserTabRegistry/removalAcknowledged',
);

/**
 * `browser.syncTabs` succeeded: the pending removals the snapshot omitted are
 * deleted daemon-side, and so is everything in `drop` — nothing is left to
 * close for either. This settles `closing` only; what a workspace reported
 * is forgotten per workspace, under its own generation (`registryTabForgotten`).
 */
export const registrySnapshotAcknowledged = createAction<[omitted: string[], dropped: string[]]>(
  'browserTabRegistry/snapshotAcknowledged',
);

/**
 * The active backend changed: nothing recorded applies any more. Every
 * workspace is torn down into a new generation (the counter never restarts,
 * so a step started under the old backend cannot match a generation the new
 * one reaches).
 */
export const registryReset = createAction('browserTabRegistry/reset');

// ---------------------------------------------------------------------------
// Reducer
// ---------------------------------------------------------------------------

export const browserTabRegistryReducer = createReducer<BrowserTabRegistryState>(initialState);

// `unresolved` follows `reported`: a tab forgotten, removed or torn down has
// nothing left to re-resolve.
function bump(
  state: BrowserTabRegistryState,
  wsId: string,
  phase: WorkspaceBrowserTabRegistryState['phase'],
  keep: boolean,
): BrowserTabRegistryState {
  const ws = getWorkspaceState(state, wsId);
  return setWorkspaceState(state, wsId, {
    generation: ws.generation + 1,
    phase,
    reported: keep ? ws.reported : {},
    unresolved: keep ? ws.unresolved : {},
  });
}

function forgetTab(state: BrowserTabRegistryState, wsId: string, tabId: string) {
  const ws = getWorkspaceState(state, wsId);
  if (!(tabId in ws.reported) && !(tabId in ws.unresolved)) return state;
  return setWorkspaceState(state, wsId, {
    ...ws,
    reported: omitKey(ws.reported, tabId),
    unresolved: omitKey(ws.unresolved, tabId),
  });
}

browserTabRegistryReducer.with(registryLoading, (state, { payload: [wsId] }) =>
  bump(state, wsId, 'loading', true),
);

browserTabRegistryReducer.with(registryApplied, (state, { payload: [wsId, gen, reported] }) => {
  const ws = getWorkspaceState(state, wsId);
  if (ws.generation !== gen || ws.phase === 'unmounted') return state;
  const unresolved = Object.fromEntries(
    Object.keys(ws.unresolved)
      .filter((tabId) => tabId in reported)
      .map((tabId) => [tabId, true as const]),
  );
  return setWorkspaceState(state, wsId, { ...ws, phase: 'applied', reported, unresolved });
});

browserTabRegistryReducer.with(
  registryTabsUnresolved,
  (state, { payload: [wsId, gen, tabIds] }) => {
    const ws = getWorkspaceState(state, wsId);
    if (ws.generation !== gen || ws.phase === 'unmounted' || tabIds.length === 0) return state;
    const unresolved = { ...ws.unresolved };
    for (const tabId of tabIds) unresolved[tabId] = true;
    return setWorkspaceState(state, wsId, { ...ws, unresolved });
  },
);

browserTabRegistryReducer.with(registryTabResolved, (state, { payload: [wsId, tabId] }) => {
  const ws = getWorkspaceState(state, wsId);
  if (!(tabId in ws.unresolved)) return state;
  return setWorkspaceState(state, wsId, { ...ws, unresolved: omitKey(ws.unresolved, tabId) });
});

browserTabRegistryReducer.with(
  registryTabReported,
  (state, { payload: [wsId, gen, tabId, input] }) => {
    const ws = getWorkspaceState(state, wsId);
    if (ws.generation !== gen || ws.phase === 'unmounted' || ws.phase === 'loading') return state;
    return setWorkspaceState(state, wsId, {
      ...ws,
      phase: 'reporting',
      reported: { ...ws.reported, [tabId]: input },
    });
  },
);

browserTabRegistryReducer.with(registryTabForgotten, (state, { payload: [wsId, tabId] }) =>
  forgetTab(state, wsId, tabId),
);

browserTabRegistryReducer.with(registryRemovalsPending, (state, { payload: [wsId, tabIds] }) => {
  if (tabIds.length === 0) return state;
  const ws = getWorkspaceState(state, wsId);
  const reported = { ...ws.reported };
  const unresolved = { ...ws.unresolved };
  const closing = { ...state.closing };
  for (const tabId of tabIds) {
    delete reported[tabId];
    delete unresolved[tabId];
    closing[tabId] = 'pending';
  }
  return setWorkspaceState({ ...state, closing }, wsId, { ...ws, reported, unresolved });
});

// The echo may have landed before the reply: nothing is awaited then.
browserTabRegistryReducer.with(registryRemovalAcknowledged, (state, { payload: [tabId] }) => {
  if (state.closing[tabId] !== 'pending') return state;
  return { ...state, closing: { ...state.closing, [tabId]: 'acknowledged' } };
});

browserTabRegistryReducer.with(
  registrySnapshotAcknowledged,
  (state, { payload: [omitted, dropped] }) => {
    let closing = state.closing;
    for (const tabId of omitted)
      if (closing[tabId] === 'pending') closing = omitKey(closing, tabId);
    for (const tabId of dropped) if (tabId in closing) closing = omitKey(closing, tabId);
    return closing === state.closing ? state : { ...state, closing };
  },
);

// `browser:tab-closed`: the daemon confirmed the tab is gone.
browserTabRegistryReducer.with(browserTabClosed, (state, { payload: [wsId, tabId] }) => {
  const next = forgetTab(state, wsId, tabId);
  if (!(tabId in next.closing)) return next;
  return { ...next, closing: omitKey(next.closing, tabId) };
});

// --- Teardown: a new generation fences every step still in flight ---
// A deleted or unmounted workspace forgets what it reported: its tabs left
// with it (an unmount leaves the layout in place; a tab closed before it was
// recorded as a removal at the close). A cleared layout keeps its map for the
// saga's removal diff, which runs after this reducer: closing the last panel
// is a close. Pending removals survive all three — those were closes.
browserTabRegistryReducer.with(workspaceUnmounted, (state, { payload: [wsId] }) =>
  bump(state, wsId, 'unmounted', false),
);
browserTabRegistryReducer.with(workspaceDeleted, (state, { payload: [wsId] }) =>
  bump(state, wsId, 'unmounted', false),
);
browserTabRegistryReducer.with(clearPanelLayout, (state, { payload: [wsId] }) =>
  bump(state, wsId, 'unmounted', true),
);

browserTabRegistryReducer.with(registryReset, (state) => ({
  ...initialState,
  byWorkspaceId: Object.fromEntries(
    Object.entries(state.byWorkspaceId).map(([wsId, ws]) => [
      wsId,
      { ...emptyWorkspaceBrowserTabRegistryState, generation: ws.generation + 1 },
    ]),
  ),
}));
