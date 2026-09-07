/**
 * Browser Tab Registry Saga (REV-2 §5.45)
 *
 * The daemon's browser tab registry is the source of truth for every
 * embedded-browser tab; this client is the **host** of the tabs whose webview
 * it renders and reports them there. localStorage keeps only geometry (panel
 * placement, viewport mode) for registry-acknowledged tabs.
 *
 * - **Report** (host → daemon): after any panel-layout mutation the hosted
 *   browser tabs of the workspace are diffed against what the daemon last
 *   acknowledged; changed tabs go out as `browser.upsertTab`, vanished ones as
 *   `browser.removeTab`. Single-flight per workspace with one trailing rerun,
 *   so a navigation burst costs one in-flight call plus at most one more.
 *   A tab the registry has not seen yet (legacy layout, offline open) is
 *   reported the same way and then acknowledged locally — that is the
 *   localStorage → registry migration, idempotent because an acknowledged tab
 *   stops persisting its URL.
 * - **Restore** (daemon → host): when a workspace layout settles (`restored` /
 *   `empty` / `invalid`) the registry rows are applied over the geometry-only
 *   tabs; rows with no local tab are materialised (live when hosted here,
 *   mirror otherwise), local tabs the registry dropped are destroyed.
 * - **Connect / reconnect**: every settled workspace is loaded, then one
 *   `browser.syncTabs` snapshot of everything this client hosts (across all
 *   known workspaces — the daemon deletes any absent row of this host) is
 *   sent and its `drop` list applied.
 * - **Events**: `browser:tab-*` echoes for own tabs are ignored (the local
 *   state is the truth for a tab this client hosts, so a canonical-URL echo
 *   never triggers a second `upsertTab`); a `hostClientId` change re-homes the
 *   tab (mirror ↔ live) and the row's visibility moves it between its panel
 *   and the hidden set; `tab-closed` destroys the local tab.
 *
 * **Lifecycle.** Every workspace has a reducer-owned `{ generation, phase }`
 * record (`browser-tab-registry` slice): `unmounted → loading → applied →
 * reporting`. A load bumps the generation and reads the rows; the workspace
 * becomes `applied` only once every row is in the layout — a materialised
 * row is awaited through the routing saga's terminal placement action — and
 * only an `applied` / `reporting` workspace reports tabs, takes part in a
 * snapshot or applies events. Teardown (`workspaceUnmounted`,
 * `workspaceDeleted`, `clearPanelLayout`) bumps the generation in the
 * reducer, so every asynchronous step here — listing, materialisation,
 * `upsertTab` reply, `syncTabs` reply — re-reads the generation it started
 * under and discards its result when it moved. A snapshot is therefore
 * computed only from layouts applied under the current generation; if any
 * loaded workspace is not, the whole sync is retried rather than sent with
 * that workspace missing (the daemon would delete its rows).
 *
 * Within one generation a listing that raced a `browser:tab-*` event (the
 * workspace's `tabsRevision` moved while it was in flight or being applied)
 * is re-read; a tab closed here — reported earlier and no longer in the
 * layout — stays excluded from listings, echoes and snapshots until the
 * daemon acknowledges the removal; an `upsertTab` reply or a `syncTabs`
 * acknowledgement is applied against the tab's *current* host, so a re-home
 * that landed in the meantime wins.
 *
 * A tab's `title` is canonical data: `''` locally / `null` in the registry
 * means "none" and the UI renders its fallback label; any other string —
 * including one equal to that label — is reported and restored verbatim.
 */
import { deepEqual } from 'fast-equals';
import {
  all,
  call,
  delay,
  fork,
  put,
  race,
  spawn,
  take,
  takeEvery,
  type SagaGenerator,
} from 'typed-redux-saga';
import { getItems } from '@augmentcode/themis/utils/collections/collection-utils';

import { appClient } from '$lib/client';
import { createLogger } from '$lib/utils/client-logger';
import type { BrowserTab, BrowserTabInput } from '$shared/types/browser-clients';
import { selectActiveBackendId } from '../../../utils/backend-storage-namespace';
import { takeSingleFlightInContext } from '../../../utils/context-saga-effects';
import {
  selectOwnClientId,
  selectWorkspaceBrowserTabsRevision,
} from '../../browser-clients/browser-clients-selectors';
import {
  browserTabClosed,
  browserTabUpserted,
  ownClientIdReceived,
} from '../../browser-clients/browser-clients-slice';
import {
  selectBrowserTabRegistryWorkspace,
  selectBrowserTabsClosing,
} from '../../browser-tab-registry/browser-tab-registry-selectors';
import {
  registryApplied,
  registryLoading,
  registryRemovalAcknowledged,
  registryRemovalsPending,
  registryReset,
  registrySnapshotAcknowledged,
  registryTabForgotten,
  registryTabReported,
  registryUnmounted,
  type BrowserTabClosingState,
  type WorkspaceBrowserTabRegistryState,
} from '../../browser-tab-registry/browser-tab-registry-slice';
import {
  selectDaemonConnectionGeneration,
  selectDaemonHealth,
} from '../../daemon-health/daemon-health-selectors';
import { connectionStatusChanged } from '../../daemon-health/daemon-health-slice';
import {
  selectWorkspaceItems,
  selectWorkspaceListLoadedForBackend,
} from '../../workspace/workspace-selectors';
import { setWorkspaceHasLoaded } from '../../workspace/workspace-slice';
import { workspaceUnmounted } from '../../workspace-lifecycle/workspace-lifecycle-slice';
import { selectPanelLayoutWorkspace, selectPanelLayoutWorkspaces } from '../panel-layout-selectors';
import {
  acknowledgeBrowserTabHost,
  applyBrowserTabRegistryRow,
  browserTabRegistryReportRequested,
  closeTab,
  openHiddenTab,
  openTabInRightmostColumn,
  openTabInRightmostColumnRequested,
  restoreHiddenTab,
  setRestoreStatus,
} from '../panel-layout-slice';
import type { PanelTab, WorkspacePanelLayoutState } from '../panel-layout-types';
import type { RehydratableBrowserTab } from '../browser-tab-rehydration';
import { rehydrateTunneledBrowserTabs } from './panel-layout-saga';

const logger = createLogger('BrowserTabRegistrySaga');

/** Layout mutations within one tick collapse into one report. */
export const REPORT_DEBOUNCE_MS = 50;
/** Longest a connect-time sync waits for the workspace list before giving up. */
const WORKSPACE_LIST_WAIT_MS = 30_000;
/** A listing that keeps racing `browser:tab-*` events is re-read this many times. */
const MAX_LIST_ATTEMPTS = 3;
/** Connect-time sync attempts (workspace list / listing failures) before waiting for the next connect. */
const MAX_SYNC_ATTEMPTS = 3;
export const SYNC_RETRY_MS = 5_000;
/** Longest a materialised row waits for the routing saga to place it. */
const PLACEMENT_WAIT_MS = 5_000;

type Visibility = BrowserTab['visibility'];
type HostedTab = { tab: PanelTab; visibility: Visibility };
type Listing = { rows: BrowserTab[]; revision: number };
/**
 * One workspace's connect-time load: its rows, the registry generation they
 * were read under, and whether they were applied to a settled layout.
 */
type WorkspaceLoad = { rows: BrowserTab[]; generation: number; applied: boolean };
type Closing = Record<string, BrowserTabClosingState>;

/** Connect-time sync guards: one sync per connection generation, reset on backend change. */
let syncedBackendId: string | null = null;
let syncedConnectionGeneration: number | null = null;

function isActive(ws: WorkspaceBrowserTabRegistryState): boolean {
  return ws.phase === 'applied' || ws.phase === 'reporting';
}

function* isCurrentGeneration(wsId: string, generation: number): SagaGenerator<boolean> {
  return (yield* selectBrowserTabRegistryWorkspace.effect(wsId)).generation === generation;
}

/**
 * A row / echo for a tab with no local counterpart that this client is in
 * the middle of closing: its removal is pending, or it was reported from
 * here and has since left the layout — the debounced reporter has not
 * computed the removal yet. Rematerialising it would undo the close.
 */
function closedHere(
  ws: WorkspaceBrowserTabRegistryState,
  closing: Closing,
  tabId: string,
): boolean {
  return tabId in closing || tabId in ws.reported;
}

function isSettled(layout: WorkspacePanelLayoutState): boolean {
  return (
    layout.restoreStatus === 'restored' ||
    layout.restoreStatus === 'empty' ||
    layout.restoreStatus === 'invalid'
  );
}

function collectBrowserTabs(layout: WorkspacePanelLayoutState): HostedTab[] {
  const out: HostedTab[] = [];
  for (const panel of Object.values(layout.panels)) {
    for (const tab of panel.tabs) {
      if (tab.type === 'browser') out.push({ tab, visibility: 'visible' });
    }
  }
  for (const tab of getItems(layout.hiddenTabs)) {
    if (tab.type === 'browser') out.push({ tab, visibility: 'hidden' });
  }
  return out;
}

/** A tab this client renders: acknowledged as ours, or not yet seen by the registry. */
function hostedHere(tab: PanelTab, ownClientId: string): boolean {
  return tab.hostClientId === undefined || tab.hostClientId === ownClientId;
}

/** Geometry-only shells (URL stripped, awaiting the registry row) are not reportable. */
function hasReportableUrl(tab: PanelTab): boolean {
  return typeof tab.browserUrl === 'string';
}

function toInput(wsId: string, { tab, visibility }: HostedTab): BrowserTabInput {
  return {
    tabId: tab.id,
    workspaceId: wsId,
    url: tab.browserUrl ?? '',
    requestedUrl: tab.browserRequestedUrl ?? null,
    title: tab.title || null,
    ownerAgentId: tab.ownerAgentId ?? null,
    ownerAgentName: tab.ownerAgentName ?? null,
    visibility,
    emulatedSize: tab.emulatedSize ?? null,
  };
}

function rowToInput(row: BrowserTab): BrowserTabInput {
  return {
    tabId: row.tabId,
    workspaceId: row.workspaceId,
    url: row.url,
    requestedUrl: row.requestedUrl ?? null,
    title: row.title ?? null,
    ownerAgentId: row.ownerAgentId ?? null,
    ownerAgentName: row.ownerAgentName ?? null,
    visibility: row.visibility,
    emulatedSize: row.emulatedSize ?? null,
  };
}

function rowToTab(row: BrowserTab): Omit<PanelTab, 'id'> {
  return {
    type: 'browser',
    title: row.title ?? '',
    closable: true,
    browserUrl: row.url,
    hostClientId: row.hostClientId,
    ...(row.requestedUrl === undefined ? {} : { browserRequestedUrl: row.requestedUrl }),
    ...(row.ownerAgentId === undefined ? {} : { ownerAgentId: row.ownerAgentId }),
    ...(row.ownerAgentName === undefined ? {} : { ownerAgentName: row.ownerAgentName }),
    ...(row.emulatedSize === undefined ? {} : { emulatedSize: row.emulatedSize }),
    viewport: row.emulatedSize ? { mode: 'custom', ...row.emulatedSize } : { mode: 'fit' },
  };
}

function rehydratable(row: BrowserTab): RehydratableBrowserTab | null {
  if (!row.requestedUrl || !row.url) return null;
  return { tabId: row.tabId, requestedUrl: row.requestedUrl, storedUrl: row.url };
}

function* waitForOwnClientId(): SagaGenerator<string> {
  const known = yield* selectOwnClientId.effect();
  if (known) return known;
  const action = yield* take(ownClientIdReceived);
  return action.payload[0];
}

/**
 * Materialise a registry row with no local tab: live when hosted here, a
 * mirror otherwise. Hidden rows only stay hidden when owned — the FE hides
 * owned tabs only — and a restore never steals focus (`agentDriven`). A
 * visible row goes through the routing saga (column reconciliation), whose
 * terminal `openTabInRightmostColumn` is awaited so the caller sees the tab
 * in the layout when this returns; the routing saga not answering is
 * reported by the caller's layout check.
 */
function* materialiseRow(wsId: string, row: BrowserTab): SagaGenerator<void> {
  const tab = rowToTab(row);
  if (row.visibility === 'hidden' && row.ownerAgentId) {
    yield* put(openHiddenTab(wsId, tab, row.tabId));
    return;
  }
  const placed = (action: { type: string; payload?: unknown }) =>
    action.type === openTabInRightmostColumn.type &&
    (action.payload as { wsId?: unknown; newTabId?: unknown }).wsId === wsId &&
    (action.payload as { newTabId?: unknown }).newTabId === row.tabId;
  yield* race({
    placement: all([
      take(placed),
      put(
        openTabInRightmostColumnRequested(wsId, tab, {
          newTabId: row.tabId,
          allowDuplicate: true,
          agentDriven: true,
        }),
      ),
    ]),
    timeout: delay(PLACEMENT_WAIT_MS),
  });
}

/**
 * Move an existing tab between its panel and the hidden set to match the
 * row. Only owned tabs are ever hidden (the FE hides owned tabs only, and
 * `closeTab` destroys anything else), and a reveal never steals focus.
 */
function* reconcileVisibility(
  wsId: string,
  existing: HostedTab,
  row: BrowserTab,
): SagaGenerator<void> {
  const target: Visibility = row.visibility === 'hidden' && row.ownerAgentId ? 'hidden' : 'visible';
  if (existing.visibility === target) return;
  if (target === 'visible') yield* put(restoreHiddenTab(wsId, row.tabId, undefined, false));
  else yield* put(closeTab(wsId, row.tabId));
}

/**
 * Apply the daemon's rows for one settled workspace over the local layout,
 * under `generation`. A tab this client already hosts that still carries a
 * URL is local truth (it may have navigated while the daemon was
 * unreachable) and is only acknowledged; everything else — including a
 * mirror the daemon re-homed here while we were away, whose URL and
 * visibility are stale — follows the row. Local tabs the registry no longer
 * holds are destroyed unless they can still be (re)reported from local
 * state. The workspace becomes `applied` only if the generation held
 * throughout and every materialised row is in the layout; otherwise nothing
 * is recorded and false is returned.
 */
function* applyRows(
  wsId: string,
  generation: number,
  rows: BrowserTab[],
  ownClientId: string,
): SagaGenerator<boolean> {
  const layout = yield* selectPanelLayoutWorkspace.effect(wsId);
  const registry = yield* selectBrowserTabRegistryWorkspace.effect(wsId);
  const closing = yield* selectBrowserTabsClosing.effect();
  // Rebuilt from the listing — what the daemon holds: anything acknowledged
  // earlier but absent now (cleared layout, other host, restart) is no longer ours.
  const reported: Record<string, BrowserTabInput> = {};
  const known = new Set(rows.map((row) => row.tabId));
  const local = new Map(collectBrowserTabs(layout).map((h) => [h.tab.id, h]));
  const toRehydrate: RehydratableBrowserTab[] = [];
  const materialised: string[] = [];
  for (const row of rows) {
    const existing = local.get(row.tabId);
    const mine = row.hostClientId === ownClientId;
    if (!existing) {
      if (closedHere(registry, closing, row.tabId)) {
        // Closed here already: kept as reported so the next run removes it
        // (an acknowledged removal only awaits its echo).
        const previous = registry.reported[row.tabId];
        if (previous) reported[row.tabId] = previous;
        else if (mine && closing[row.tabId] === 'pending') reported[row.tabId] = rowToInput(row);
        continue;
      }
      yield* call(materialiseRow, wsId, row);
      materialised.push(row.tabId);
      if (mine) reported[row.tabId] = rowToInput(row);
    } else if (mine && hostedHere(existing.tab, ownClientId) && hasReportableUrl(existing.tab)) {
      reported[row.tabId] = rowToInput(row);
      if (existing.tab.hostClientId !== ownClientId) {
        yield* put(acknowledgeBrowserTabHost(wsId, row.tabId, ownClientId));
      }
    } else {
      yield* put(applyBrowserTabRegistryRow(wsId, row.tabId, row));
      yield* call(reconcileVisibility, wsId, existing, row);
      if (mine) reported[row.tabId] = rowToInput(row);
    }
    if (mine) {
      const item = rehydratable(row);
      if (item) toRehydrate.push(item);
    }
  }
  for (const [tabId, { tab }] of local) {
    if (known.has(tabId) || tab.hostClientId === undefined) continue;
    if (tab.hostClientId === ownClientId && hasReportableUrl(tab)) continue;
    yield* put(closeTab(wsId, tabId, undefined, undefined, { destroy: true }));
  }
  if (!(yield* call(isCurrentGeneration, wsId, generation))) return false;
  const placed = new Set(
    collectBrowserTabs(yield* selectPanelLayoutWorkspace.effect(wsId)).map((h) => h.tab.id),
  );
  const missing = materialised.filter((tabId) => !placed.has(tabId));
  if (missing.length > 0) {
    logger.warn('registry rows were not placed in the layout; not applied', { wsId, missing });
    return false;
  }
  yield* put(registryApplied(wsId, generation, reported));
  if (toRehydrate.length > 0) yield* spawn(rehydrateTunneledBrowserTabs, wsId, toRehydrate);
  yield* put(browserTabRegistryReportRequested(wsId));
  return true;
}

/**
 * Read the workspace's registry rows. A `browser:tab-*` event landing while
 * the read is in flight bumps the workspace's `tabsRevision`; such a listing
 * may predate the event (a closed tab still listed) and is re-read. The
 * listing carries the revision it was read against.
 */
function* listRows(wsId: string): SagaGenerator<Listing | null> {
  try {
    for (let attempt = 0; attempt < MAX_LIST_ATTEMPTS; attempt++) {
      const revision = yield* selectWorkspaceBrowserTabsRevision.effect(wsId);
      const rows = (yield* call(
        [appClient.browser, appClient.browser.listTabs],
        wsId,
      )) as BrowserTab[];
      if ((yield* selectWorkspaceBrowserTabsRevision.effect(wsId)) === revision) {
        return { rows, revision };
      }
    }
    logger.warn('browser.listTabs kept racing browser:tab-* events; skipping', { wsId });
    return null;
  } catch (error) {
    logger.warn('browser.listTabs failed', {
      wsId,
      error: error instanceof Error ? error.message : error,
    });
    return null;
  }
}

/**
 * Load one workspace: start a new generation, read its rows and, when its
 * layout is settled, apply them. Rows that changed while being applied (an
 * event landed) are re-read and re-applied. Returns null when the load
 * failed or its generation moved — nothing was recorded then.
 */
function* loadWorkspace(wsId: string, ownClientId: string): SagaGenerator<WorkspaceLoad | null> {
  yield* put(registryLoading(wsId));
  const { generation } = yield* selectBrowserTabRegistryWorkspace.effect(wsId);
  for (let attempt = 0; attempt < MAX_LIST_ATTEMPTS; attempt++) {
    const listing = yield* call(listRows, wsId);
    if (listing === null) return null;
    if (!(yield* call(isCurrentGeneration, wsId, generation))) return null;
    const layout = yield* selectPanelLayoutWorkspace.effect(wsId);
    if (!isSettled(layout)) return { rows: listing.rows, generation, applied: false };
    if (!(yield* call(applyRows, wsId, generation, listing.rows, ownClientId))) return null;
    if ((yield* selectWorkspaceBrowserTabsRevision.effect(wsId)) === listing.revision) {
      return { rows: listing.rows, generation, applied: true };
    }
  }
  logger.warn('registry rows kept changing while being applied; skipping', { wsId });
  return null;
}

/** A workspace layout settled: pull its registry rows over the geometry. */
function* reconcileOnSettle(action: ReturnType<typeof setRestoreStatus>): SagaGenerator<void> {
  const [wsId, status] = action.payload;
  if (status !== 'restored' && status !== 'empty' && status !== 'invalid') return;
  if ((yield* selectDaemonHealth.effect()) === 'down') return;
  const ownClientId = yield* waitForOwnClientId();
  yield* call(loadWorkspace, wsId, ownClientId);
}

/**
 * `workspaceUnmounted` leaves the layout in place, so the tabs the workspace
 * reported but no longer holds were closed before the unmount — closes the
 * debounced reporter may not have computed yet, and which it will not
 * compute for an unmounted workspace. They are recorded as pending removals
 * (and removed now when the daemon is reachable); the rest left with the
 * workspace and are forgotten. A layout that is not settled cannot be
 * diffed: nothing is read as closed then.
 */
function* onWorkspaceUnmounted(action: ReturnType<typeof workspaceUnmounted>): SagaGenerator<void> {
  const [wsId] = action.payload;
  const registry = yield* selectBrowserTabRegistryWorkspace.effect(wsId);
  const reported = Object.keys(registry.reported);
  if (reported.length === 0) return;
  const layout = yield* selectPanelLayoutWorkspace.effect(wsId);
  const present = new Set(collectBrowserTabs(layout).map((h) => h.tab.id));
  const closed = isSettled(layout) ? reported.filter((tabId) => !present.has(tabId)) : [];
  yield* put(registryUnmounted(wsId, closed));
  if (closed.length === 0 || (yield* selectDaemonHealth.effect()) === 'down') return;
  for (const tabId of closed) yield* call(removeReportedTab, tabId);
}

function* removeReportedTab(tabId: string): SagaGenerator<void> {
  try {
    yield* call([appClient.browser, appClient.browser.removeTab], tabId);
    yield* put(registryRemovalAcknowledged(tabId));
  } catch (error) {
    logger.warn('browser.removeTab failed; dropping on next sync', {
      tabId,
      error: error instanceof Error ? error.message : error,
    });
  }
}

function findBrowserTab(layout: WorkspacePanelLayoutState, tabId: string): PanelTab | undefined {
  return collectBrowserTabs(layout).find((h) => h.tab.id === tabId)?.tab;
}

function* reportWorkspaceTabs(action: { type: string; payload?: unknown }): SagaGenerator<void> {
  const wsId = reportContext(action);
  if (wsId !== null) yield* call(reportHostedTabs, wsId);
}

/**
 * Diff the workspace's hosted tabs against what the daemon last acknowledged
 * and report the delta. Single-flight per workspace (see the saga root);
 * only an applied workspace reports. The run is fenced on the generation it
 * read before every `upsertTab` — a layout torn down and rebuilt while an
 * earlier call was in flight has newer tabs than the ones read here — and a
 * reply whose generation moved is dropped. Removals are recorded before the
 * health gate so a tab closed while the daemon is unreachable stays closed
 * across the reconnect, and are sent regardless of the generation: a close
 * stays a close. A tab is recorded as reported when its `upsertTab` goes out
 * — so a row or echo for it arriving before the reply is not rematerialised
 * — and forgotten again if the call fails.
 */
function* reportHostedTabs(wsId: string): SagaGenerator<void> {
  yield* delay(REPORT_DEBOUNCE_MS);
  const ownClientId = yield* selectOwnClientId.effect();
  if (!ownClientId) return;
  const registry = yield* selectBrowserTabRegistryWorkspace.effect(wsId);
  if (!isActive(registry)) return;
  const { generation } = registry;
  const layout = yield* selectPanelLayoutWorkspace.effect(wsId);
  if (!isSettled(layout)) return;
  const hosted = collectBrowserTabs(layout);
  const present = new Set(hosted.map((h) => h.tab.id));
  const removed = Object.keys(registry.reported).filter((tabId) => !present.has(tabId));
  if (removed.length > 0) yield* put(registryRemovalsPending(wsId, removed));
  if ((yield* selectDaemonHealth.effect()) === 'down') return;
  for (const tabId of removed) yield* call(removeReportedTab, tabId);
  for (const item of hosted) {
    if (!(yield* call(isCurrentGeneration, wsId, generation))) return;
    const { tab } = item;
    if (!hostedHere(tab, ownClientId)) {
      if (tab.id in registry.reported) yield* put(registryTabForgotten(wsId, tab.id));
      continue;
    }
    if (!hasReportableUrl(tab)) continue;
    const input = toInput(wsId, item);
    if (deepEqual(registry.reported[tab.id], input)) continue;
    yield* put(registryTabReported(wsId, generation, tab.id, input));
    try {
      const { workspaceId: _ws, ...report } = input;
      const row = yield* call([appClient.browser, appClient.browser.upsertTab], wsId, report);
      if (!(yield* call(isCurrentGeneration, wsId, generation))) return;
      // The reply describes the tab as it was sent; a re-home that landed in
      // the meantime is newer and wins, a close is reported by the rerun.
      const current = findBrowserTab(yield* selectPanelLayoutWorkspace.effect(wsId), tab.id);
      if (current && !hostedHere(current, ownClientId)) {
        yield* put(registryTabForgotten(wsId, tab.id));
        continue;
      }
      if (current && current.hostClientId !== row.hostClientId) {
        yield* put(acknowledgeBrowserTabHost(wsId, tab.id, row.hostClientId));
      }
    } catch (error) {
      logger.warn('browser.upsertTab failed', {
        wsId,
        tabId: tab.id,
        error: error instanceof Error ? error.message : error,
      });
      if (yield* call(isCurrentGeneration, wsId, generation)) {
        yield* put(registryTabForgotten(wsId, tab.id));
      }
    }
  }
}

function reportContext(action: { type: string; payload?: unknown }): string | null {
  const payload = action.payload;
  if (typeof payload === 'string') return payload;
  if (Array.isArray(payload) && typeof payload[0] === 'string') return payload[0];
  if (payload && typeof payload === 'object' && 'wsId' in payload) {
    const { wsId } = payload as { wsId?: unknown };
    if (typeof wsId === 'string') return wsId;
  }
  return null;
}

function isLayoutMutation(action: unknown): action is { type: string; payload?: unknown } {
  return (
    typeof action === 'object' &&
    action !== null &&
    'type' in action &&
    typeof action.type === 'string' &&
    action.type.startsWith('panelLayout/') &&
    reportContext(action as { type: string; payload?: unknown }) !== null
  );
}

/**
 * `browser:tab-opened` / `browser:tab-updated`. Applied to an applied
 * workspace only: a row landing while the workspace is loading moves its
 * `tabsRevision`, which makes the load re-read and apply the row itself.
 */
function* onRegistryRow(action: ReturnType<typeof browserTabUpserted>): SagaGenerator<void> {
  const [wsId, row] = action.payload;
  const ownClientId = yield* selectOwnClientId.effect();
  if (!ownClientId) return;
  const registry = yield* selectBrowserTabRegistryWorkspace.effect(wsId);
  if (!isActive(registry)) return;
  const { generation } = registry;
  const layout = yield* selectPanelLayoutWorkspace.effect(wsId);
  if (!isSettled(layout)) return;
  const existing = collectBrowserTabs(layout).find((h) => h.tab.id === row.tabId);
  const mine = row.hostClientId === ownClientId;
  if (!existing) {
    // An echo for a tab already closed here: the daemon is being told.
    if (closedHere(registry, yield* selectBrowserTabsClosing.effect(), row.tabId)) return;
    yield* call(materialiseRow, wsId, row);
    if (mine) yield* put(registryTabReported(wsId, generation, row.tabId, rowToInput(row)));
    return;
  }
  if (mine && existing.tab.hostClientId === ownClientId) return;
  if (mine && existing.tab.hostClientId === undefined) {
    // The registry took our unacknowledged report; local state stays truth.
    yield* put(acknowledgeBrowserTabHost(wsId, row.tabId, ownClientId));
    return;
  }
  yield* put(applyBrowserTabRegistryRow(wsId, row.tabId, row));
  yield* call(reconcileVisibility, wsId, existing, row);
  if (mine) {
    yield* put(registryTabReported(wsId, generation, row.tabId, rowToInput(row)));
    const item = rehydratable(row);
    if (item) yield* spawn(rehydrateTunneledBrowserTabs, wsId, [item]);
  } else if (row.tabId in registry.reported) {
    yield* put(registryTabForgotten(wsId, row.tabId));
  }
}

/**
 * `browser:tab-closed`: the row is gone or tombstoned — drop the local tab.
 * The reducer already forgot the tab's bookkeeping.
 */
function* onRegistryClose(action: ReturnType<typeof browserTabClosed>): SagaGenerator<void> {
  const [wsId, tabId] = action.payload;
  const layout = yield* selectPanelLayoutWorkspace.effect(wsId);
  if (!collectBrowserTabs(layout).some((h) => h.tab.id === tabId)) return;
  yield* put(closeTab(wsId, tabId, undefined, undefined, { destroy: true }));
}

function* waitForWorkspaceList(backendId: string): SagaGenerator<boolean> {
  if (yield* selectWorkspaceListLoadedForBackend.effect(backendId)) return true;
  const isLoadedForBackend = (action: unknown): boolean => {
    if (typeof action !== 'object' || action === null) return false;
    const { type, payload } = action as { type?: unknown; payload?: unknown };
    if (type !== setWorkspaceHasLoaded.type || !Array.isArray(payload)) return false;
    const [hasLoaded, loadedBackendId] = payload as [boolean, string | undefined];
    return hasLoaded === true && (loadedBackendId === undefined || loadedBackendId === backendId);
  };
  const outcome = yield* race({
    loaded: take(isLoadedForBackend),
    timeout: delay(WORKSPACE_LIST_WAIT_MS),
  });
  return outcome.loaded !== undefined;
}

/**
 * One connect-time sync: load every settled workspace (unsettled ones are
 * only listed), then send one `browser.syncTabs` snapshot of everything this
 * client hosts. A loaded workspace contributes the hosted tabs of its layout
 * — read only while it is still applied under the generation it was loaded
 * in. Rows of unsettled workspaces are passed through verbatim — only while
 * the workspace is still in the generation they were read under: one that
 * settled and loaded meanwhile may have reported tabs its old rows lack. In
 * either case, if the generation moved (load failed, torn down or loaded
 * since) the whole attempt is abandoned, because the daemon deletes any row
 * of this host missing from the snapshot. Returns false when the attempt
 * could not complete (retryable).
 */
function* syncTabsOnce(backendId: string, ownClientId: string): SagaGenerator<boolean> {
  if (!(yield* call(waitForWorkspaceList, backendId))) {
    logger.warn('workspace list did not load; skipping browser.syncTabs');
    return false;
  }
  const workspaces = yield* selectWorkspaceItems.effect();
  const layouts = yield* selectPanelLayoutWorkspaces.effect();
  const loads = yield* all(
    workspaces.map((ws) => {
      const layout = layouts[ws.id];
      return layout && isSettled(layout)
        ? call(loadWorkspace, ws.id, ownClientId)
        : call(listUnsettledWorkspace, ws.id);
    }),
  );
  if (loads.some((load) => load === null)) {
    logger.warn('a workspace could not be loaded; skipping browser.syncTabs');
    return false;
  }

  const snapshot: BrowserTabInput[] = [];
  const unacknowledged: Array<[wsId: string, tabId: string]> = [];
  const applied: string[] = [];
  const closing = yield* selectBrowserTabsClosing.effect();
  // Removals the daemon has not acknowledged: the snapshot omits them so the
  // daemon deletes them; they are forgotten only once it has.
  const omitted = Object.keys(closing).filter((tabId) => closing[tabId] === 'pending');
  for (const [index, ws] of workspaces.entries()) {
    const load = loads[index] as WorkspaceLoad;
    const registry = yield* selectBrowserTabRegistryWorkspace.effect(ws.id);
    if (registry.generation !== load.generation || (load.applied && !isActive(registry))) {
      logger.warn('workspace layout moved before the snapshot; skipping browser.syncTabs', {
        wsId: ws.id,
      });
      return false;
    }
    if (!load.applied) {
      for (const row of load.rows) {
        if (row.hostClientId !== ownClientId || row.tabId in closing) continue;
        snapshot.push(rowToInput(row));
      }
      continue;
    }
    const layout = yield* selectPanelLayoutWorkspace.effect(ws.id);
    const reported: Record<string, BrowserTabInput> = {};
    for (const hosted of collectBrowserTabs(layout)) {
      if (!hostedHere(hosted.tab, ownClientId) || !hasReportableUrl(hosted.tab)) continue;
      if (hosted.tab.id in closing) continue;
      const input = toInput(ws.id, hosted);
      snapshot.push(input);
      reported[hosted.tab.id] = input;
      if (hosted.tab.hostClientId !== ownClientId) unacknowledged.push([ws.id, hosted.tab.id]);
    }
    yield* put(registryApplied(ws.id, load.generation, reported));
    applied.push(ws.id);
  }

  try {
    const { drop } = yield* call([appClient.browser, appClient.browser.syncTabs], snapshot);
    yield* put(registrySnapshotAcknowledged(omitted, drop));
    const dropped = new Set(drop);
    // The acknowledgement describes the snapshot as sent; a tab re-homed or
    // closed while the call was in flight is newer and keeps its state — a
    // dropped tab that has since become another host's mirror stays.
    const current = yield* selectPanelLayoutWorkspaces.effect();
    for (const tabId of dropped) {
      for (const [wsId, layout] of Object.entries(current)) {
        const tab = findBrowserTab(layout, tabId);
        if (tab === undefined || !hostedHere(tab, ownClientId)) continue;
        yield* put(closeTab(wsId, tabId, undefined, undefined, { destroy: true }));
      }
    }
    for (const [wsId, tabId] of unacknowledged) {
      if (dropped.has(tabId)) continue;
      const tab = findBrowserTab(yield* selectPanelLayoutWorkspace.effect(wsId), tabId);
      if (tab === undefined || tab.hostClientId !== undefined) continue;
      yield* put(acknowledgeBrowserTabHost(wsId, tabId, ownClientId));
    }
    for (const wsId of applied) yield* put(browserTabRegistryReportRequested(wsId));
    return true;
  } catch (error) {
    logger.warn('browser.syncTabs failed', {
      error: error instanceof Error ? error.message : error,
    });
    return false;
  }
}

/** The rows of a workspace whose layout has not settled: nothing to apply them to. */
function* listUnsettledWorkspace(wsId: string): SagaGenerator<WorkspaceLoad | null> {
  const { generation } = yield* selectBrowserTabRegistryWorkspace.effect(wsId);
  const listing = yield* call(listRows, wsId);
  return listing === null ? null : { rows: listing.rows, generation, applied: false };
}

/**
 * Connect / reconnect: one sync per connection generation. A failed attempt
 * is retried a few times and, if still failing, releases the generation so
 * the next `connected` runs it again.
 */
function* syncOnConnect(): SagaGenerator<void> {
  const backendId = yield* selectActiveBackendId();
  if (syncedBackendId !== backendId) {
    syncedBackendId = backendId;
    syncedConnectionGeneration = null;
    yield* put(registryReset());
  }
  const generation = yield* selectDaemonConnectionGeneration.effect();
  if (syncedConnectionGeneration === generation) return;
  syncedConnectionGeneration = generation;

  const ownClientId = yield* waitForOwnClientId();
  for (let attempt = 0; attempt < MAX_SYNC_ATTEMPTS; attempt++) {
    if (attempt > 0) {
      yield* delay(SYNC_RETRY_MS);
      if (syncedConnectionGeneration !== generation) return;
      if ((yield* selectDaemonHealth.effect()) === 'down') break;
    }
    if (yield* call(syncTabsOnce, backendId, ownClientId)) return;
  }
  if (syncedConnectionGeneration === generation) syncedConnectionGeneration = null;
}

function* onConnectionStatus(
  action: ReturnType<typeof connectionStatusChanged>,
): SagaGenerator<void> {
  if (action.payload[0] !== 'connected') return;
  yield* call(syncOnConnect);
}

export function* browserTabRegistrySaga(): SagaGenerator<void> {
  syncedBackendId = null;
  syncedConnectionGeneration = null;
  yield* takeSingleFlightInContext(
    isLayoutMutation,
    (action) => reportContext(action) as string,
    reportWorkspaceTabs,
  );
  yield* takeEvery(setRestoreStatus, reconcileOnSettle);
  yield* takeEvery(workspaceUnmounted, onWorkspaceUnmounted);
  yield* takeEvery(browserTabUpserted, onRegistryRow);
  yield* takeEvery(browserTabClosed, onRegistryClose);
  yield* takeEvery(connectionStatusChanged, onConnectionStatus);
  // Attached, not spawned: a root cancellation (HMR, store teardown) must
  // take the startup sync down with it rather than let a half-built snapshot
  // reach the daemon later and delete this host's rows.
  if ((yield* selectDaemonHealth.effect()) !== 'down') yield* fork(syncOnConnect);
}
