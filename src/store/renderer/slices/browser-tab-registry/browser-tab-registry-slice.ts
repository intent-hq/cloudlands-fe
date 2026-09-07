/**
 * Browser Tab Registry Slice (renderer)
 *
 * Reducer-owned lifecycle bookkeeping for the registry saga (see the types
 * file for the state machine). The saga is the only dispatcher of the
 * `registry*` actions; teardown transitions ride the existing lifecycle and
 * panel-layout actions. An unmount keeps the report map for the saga, which
 * diffs it against the layout the unmount leaves in place (`registryUnmounted`).
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

/** Tabs that left the layout: closed here, their removal still to be confirmed. */
export const registryRemovalsPending = createAction<[wsId: string, tabIds: string[]]>(
  'browserTabRegistry/removalsPending',
);

/** `browser.removeTab` succeeded; the `browser:tab-closed` echo is still to land. */
export const registryRemovalAcknowledged = createAction<[tabId: string]>(
  'browserTabRegistry/removalAcknowledged',
);

/**
 * The unmounted workspace's report map was diffed against its layout:
 * `closed` had left it (removal pending), the rest left with the workspace.
 */
export const registryUnmounted = createAction<[wsId: string, closed: string[]]>(
  'browserTabRegistry/unmounted',
);

/**
 * `browser.syncTabs` succeeded: the pending removals the snapshot omitted are
 * deleted daemon-side, and so is everything in `drop`.
 */
export const registrySnapshotAcknowledged = createAction<[omitted: string[], dropped: string[]]>(
  'browserTabRegistry/snapshotAcknowledged',
);

/** The active backend changed: nothing recorded applies any more. */
export const registryReset = createAction('browserTabRegistry/reset');

// ---------------------------------------------------------------------------
// Reducer
// ---------------------------------------------------------------------------

export const browserTabRegistryReducer = createReducer<BrowserTabRegistryState>(initialState);

function bump(
  state: BrowserTabRegistryState,
  wsId: string,
  phase: WorkspaceBrowserTabRegistryState['phase'],
  reported: Record<string, BrowserTabInput>,
): BrowserTabRegistryState {
  const ws = getWorkspaceState(state, wsId);
  return setWorkspaceState(state, wsId, { generation: ws.generation + 1, phase, reported });
}

function forgetTab(state: BrowserTabRegistryState, wsId: string, tabId: string) {
  const ws = getWorkspaceState(state, wsId);
  if (!(tabId in ws.reported)) return state;
  return setWorkspaceState(state, wsId, { ...ws, reported: omitKey(ws.reported, tabId) });
}

browserTabRegistryReducer.with(registryLoading, (state, { payload: [wsId] }) =>
  bump(state, wsId, 'loading', getWorkspaceState(state, wsId).reported),
);

browserTabRegistryReducer.with(registryApplied, (state, { payload: [wsId, gen, reported] }) => {
  const ws = getWorkspaceState(state, wsId);
  if (ws.generation !== gen || ws.phase === 'unmounted') return state;
  return setWorkspaceState(state, wsId, { ...ws, phase: 'applied', reported });
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
  const closing = { ...state.closing };
  for (const tabId of tabIds) {
    delete reported[tabId];
    closing[tabId] = 'pending';
  }
  return setWorkspaceState({ ...state, closing }, wsId, { ...ws, reported });
});

// The echo may have landed before the reply: nothing is awaited then.
browserTabRegistryReducer.with(registryRemovalAcknowledged, (state, { payload: [tabId] }) => {
  if (state.closing[tabId] !== 'pending') return state;
  return { ...state, closing: { ...state.closing, [tabId]: 'acknowledged' } };
});

browserTabRegistryReducer.with(registryUnmounted, (state, { payload: [wsId, closed] }) => {
  let next = state;
  if (closed.length > 0) {
    const closing = { ...state.closing };
    for (const tabId of closed) closing[tabId] = 'pending';
    next = { ...next, closing };
  }
  const ws = getWorkspaceState(next, wsId);
  if (ws.phase !== 'unmounted' || Object.keys(ws.reported).length === 0) return next;
  return setWorkspaceState(next, wsId, { ...ws, reported: {} });
});

browserTabRegistryReducer.with(
  registrySnapshotAcknowledged,
  (state, { payload: [omitted, dropped] }) => {
    let next = state;
    let closing = state.closing;
    for (const tabId of omitted)
      if (closing[tabId] === 'pending') closing = omitKey(closing, tabId);
    for (const tabId of dropped) {
      closing = omitKey(closing, tabId);
      for (const wsId of Object.keys(next.byWorkspaceId)) next = forgetTab(next, wsId, tabId);
    }
    return closing === state.closing ? next : { ...next, closing };
  },
);

// `browser:tab-closed`: the daemon confirmed the tab is gone.
browserTabRegistryReducer.with(browserTabClosed, (state, { payload: [wsId, tabId] }) => {
  const next = forgetTab(state, wsId, tabId);
  if (!(tabId in next.closing)) return next;
  return { ...next, closing: omitKey(next.closing, tabId) };
});

// --- Teardown: a new generation fences every step still in flight ---
// A deleted workspace forgets what it reported along with its layout. An
// unmounted one keeps its layout, so the map stays for the saga to tell the
// tabs closed before the unmount from those that left with it
// (`registryUnmounted`). A cleared layout keeps its map too: closing the
// last panel is a close, reported by the next run. Pending removals survive
// all three — those were closes.
browserTabRegistryReducer.with(workspaceUnmounted, (state, { payload: [wsId] }) =>
  bump(state, wsId, 'unmounted', getWorkspaceState(state, wsId).reported),
);
browserTabRegistryReducer.with(workspaceDeleted, (state, { payload: [wsId] }) =>
  bump(state, wsId, 'unmounted', {}),
);
browserTabRegistryReducer.with(clearPanelLayout, (state, { payload: [wsId] }) =>
  bump(state, wsId, 'unmounted', getWorkspaceState(state, wsId).reported),
);

browserTabRegistryReducer.with(registryReset, () => initialState);
