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
 * - **Connect / reconnect**: every settled workspace is reconciled, then one
 *   `browser.syncTabs` snapshot of everything this client hosts (across all
 *   known workspaces — the daemon deletes any absent row of this host) is
 *   sent and its `drop` list applied.
 * - **Events**: `browser:tab-*` echoes for own tabs are ignored (the local
 *   state is the truth for a tab this client hosts, so a canonical-URL echo
 *   never triggers a second `upsertTab`); a `hostClientId` change re-homes the
 *   tab (mirror ↔ live) and the row's visibility moves it between its panel
 *   and the hidden set; `tab-closed` destroys the local tab.
 * - **Races**: a listing that raced a `browser:tab-*` event (the
 *   `tabsRevision` moved while it was in flight) or the workspace's teardown
 *   (its layout epoch moved — the revision restarts at 0 on remount, so it
 *   cannot fence that) is re-read rather than applied; a report run dies with
 *   its workspace's unmount, so a late `upsertTab` reply cannot bookkeep into
 *   the remounted layout; a tab closed here — reported earlier and no longer
 *   in the layout — stays excluded from listings, echoes and snapshots until
 *   the daemon acknowledges the removal; an `upsertTab` reply or a `syncTabs`
 *   acknowledgement is applied against the tab's *current* host, so a re-home
 *   that landed in the meantime wins.
 *
 * Reported inputs, pending removals and echo bookkeeping are transient
 * saga-local state (a module-level Map), never Redux. An unmounted workspace
 * forgets its reported map: its tabs left the layout without being closed.
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
  selectDaemonConnectionGeneration,
  selectDaemonHealth,
} from '../../daemon-health/daemon-health-selectors';
import { connectionStatusChanged } from '../../daemon-health/daemon-health-slice';
import {
  selectWorkspaceItems,
  selectWorkspaceListLoadedForBackend,
} from '../../workspace/workspace-selectors';
import { setWorkspaceHasLoaded } from '../../workspace/workspace-slice';
import {
  workspaceDeleted,
  workspaceUnmounted,
} from '../../workspace-lifecycle/workspace-lifecycle-slice';
import { selectPanelLayoutWorkspace, selectPanelLayoutWorkspaces } from '../panel-layout-selectors';
import {
  acknowledgeBrowserTabHost,
  applyBrowserTabRegistryRow,
  browserTabRegistryReportRequested,
  clearPanelLayout,
  closeTab,
  openHiddenTab,
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

type Visibility = BrowserTab['visibility'];
type HostedTab = { tab: PanelTab; visibility: Visibility };
/** Registry rows with the workspace state they were read against (see `isCurrent`). */
type Listing = { rows: BrowserTab[]; revision: number; epoch: number };

type Registry = {
  backendId: string | null;
  connectionGeneration: number | null;
  /** What the daemon holds for the tabs this client hosts, by workspace then tab. */
  reported: Map<string, Map<string, BrowserTabInput>>;
  /**
   * Tabs closed here whose `removeTab` the daemon has not acknowledged (in
   * flight, or failed while offline): their rows are ignored and the next
   * snapshot omits them so the daemon deletes them.
   */
  pendingRemovals: Set<string>;
  /** `removeTab` calls the daemon acknowledged, until their `tab-closed` echo lands. */
  awaitingCloseEcho: Set<string>;
  /** Tabs with an `upsertTab` in flight (their `reported` entry lands with the reply). */
  reporting: Set<string>;
  /**
   * Per-workspace layout lifetime counter, bumped on unmount / delete /
   * clear. Unlike `tabsRevision` it never restarts, so a listing read against
   * a layout that has since been torn down is recognisable after the remount.
   * Deliberately survives `resetRegistry`.
   */
  layoutEpochs: Map<string, number>;
};

const registry: Registry = {
  backendId: null,
  connectionGeneration: null,
  reported: new Map(),
  pendingRemovals: new Set(),
  awaitingCloseEcho: new Set(),
  reporting: new Set(),
  layoutEpochs: new Map(),
};

function resetRegistry(backendId: string | null): void {
  registry.backendId = backendId;
  registry.connectionGeneration = null;
  registry.reported.clear();
  registry.pendingRemovals.clear();
  registry.awaitingCloseEcho.clear();
  registry.reporting.clear();
}

function reportedFor(wsId: string): Map<string, BrowserTabInput> {
  let map = registry.reported.get(wsId);
  if (!map) {
    map = new Map();
    registry.reported.set(wsId, map);
  }
  return map;
}

function layoutEpoch(wsId: string): number {
  return registry.layoutEpochs.get(wsId) ?? 0;
}

/** A tab this client closed whose removal the daemon has not confirmed yet. */
function isClosingHere(tabId: string): boolean {
  return registry.pendingRemovals.has(tabId) || registry.awaitingCloseEcho.has(tabId);
}

/**
 * A row / echo for a tab with no local counterpart that this client is in
 * the middle of closing: its removal is pending, or it was reported (or is
 * being reported) from here and has since left the layout — the debounced
 * reporter has not computed the removal yet. Rematerialising it would undo
 * the close.
 */
function closedHere(wsId: string, tabId: string): boolean {
  return isClosingHere(tabId) || registry.reporting.has(tabId) || reportedFor(wsId).has(tabId);
}

function matchesWorkspace(wsId: string, types: readonly string[]) {
  return (action: { type: string; payload?: unknown }) =>
    types.includes(action.type) && Array.isArray(action.payload) && action.payload[0] === wsId;
}

/** The layout a listing was read against is gone (remount restarts `tabsRevision`). */
function matchesWorkspaceTeardown(wsId: string) {
  return matchesWorkspace(wsId, [
    workspaceUnmounted.type,
    workspaceDeleted.type,
    clearPanelLayout.type,
  ]);
}

/**
 * The workspace left. `clearPanelLayout` alone is not this: closing the last
 * panel clears the layout as a user close, whose in-flight report must finish
 * so the rerun can send the removals.
 */
function matchesWorkspaceGone(wsId: string) {
  return matchesWorkspace(wsId, [workspaceUnmounted.type, workspaceDeleted.type]);
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
 * owned tabs only — and a restore never steals focus (`agentDriven`).
 */
function* materialiseRow(wsId: string, row: BrowserTab): SagaGenerator<void> {
  const tab = rowToTab(row);
  if (row.visibility === 'hidden' && row.ownerAgentId) {
    yield* put(openHiddenTab(wsId, tab, row.tabId));
    return;
  }
  yield* put(
    openTabInRightmostColumnRequested(wsId, tab, {
      newTabId: row.tabId,
      allowDuplicate: true,
      agentDriven: true,
    }),
  );
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
 * Apply the daemon's rows for one settled workspace over the local layout.
 * A tab this client already hosts that still carries a URL is local truth
 * (it may have navigated while the daemon was unreachable) and is only
 * acknowledged; everything else — including a mirror the daemon re-homed
 * here while we were away, whose URL and visibility are stale — follows the
 * row. Local tabs the registry no longer holds are destroyed unless they can
 * still be (re)reported from local state. A listing that went stale between
 * read and apply — a `browser:tab-*` event, or the layout it was read
 * against torn down and remounted — is re-read first.
 */
function* applyRegistryRows(
  wsId: string,
  listing: Listing,
  ownClientId: string,
): SagaGenerator<void> {
  let { rows } = listing;
  if (!(yield* call(isCurrent, wsId, listing))) {
    const fresh = yield* call(listRows, wsId);
    if (!fresh) return;
    rows = fresh.rows;
  }
  const layout = yield* selectPanelLayoutWorkspace.effect(wsId);
  if (!isSettled(layout)) return;
  const known = new Set(rows.map((row) => row.tabId));
  // The listing is what the daemon holds: anything acknowledged earlier but
  // absent now (cleared layout, other host, restart) is no longer ours.
  const reported = reportedFor(wsId);
  for (const tabId of [...reported.keys()]) {
    if (!known.has(tabId)) reported.delete(tabId);
  }
  const local = new Map(collectBrowserTabs(layout).map((h) => [h.tab.id, h]));
  const toRehydrate: RehydratableBrowserTab[] = [];
  for (const row of rows) {
    const existing = local.get(row.tabId);
    const mine = row.hostClientId === ownClientId;
    if (!existing) {
      // Closed here already: the daemon learns it from removeTab / the snapshot.
      if (closedHere(wsId, row.tabId)) continue;
      yield* call(materialiseRow, wsId, row);
      if (mine) reported.set(row.tabId, rowToInput(row));
    } else if (mine && hostedHere(existing.tab, ownClientId) && hasReportableUrl(existing.tab)) {
      reported.set(row.tabId, rowToInput(row));
      if (existing.tab.hostClientId !== ownClientId) {
        yield* put(acknowledgeBrowserTabHost(wsId, row.tabId, ownClientId));
      }
    } else {
      yield* put(applyBrowserTabRegistryRow(wsId, row.tabId, row));
      yield* call(reconcileVisibility, wsId, existing, row);
      if (mine) reported.set(row.tabId, rowToInput(row));
      else reported.delete(row.tabId);
    }
    if (mine) {
      const item = rehydratable(row);
      if (item) toRehydrate.push(item);
    }
  }
  for (const [tabId, { tab }] of local) {
    if (known.has(tabId) || tab.hostClientId === undefined) continue;
    if (tab.hostClientId === ownClientId && hasReportableUrl(tab)) continue;
    reported.delete(tabId);
    yield* put(closeTab(wsId, tabId, undefined, undefined, { destroy: true }));
  }
  if (toRehydrate.length > 0) yield* spawn(rehydrateTunneledBrowserTabs, wsId, toRehydrate);
  yield* put(browserTabRegistryReportRequested(wsId));
}

/** The listing still describes the workspace state it was read against. */
function* isCurrent(wsId: string, listing: Listing): SagaGenerator<boolean> {
  const revision = yield* selectWorkspaceBrowserTabsRevision.effect(wsId);
  return revision === listing.revision && layoutEpoch(wsId) === listing.epoch;
}

/**
 * Read the workspace's registry rows. A `browser:tab-*` event landing while
 * the read is in flight bumps the workspace's `tabsRevision`; such a listing
 * may predate the event (a closed tab still listed) and is re-read. A read
 * the workspace's teardown overtook is discarded: the layout it targeted is
 * gone. The listing carries the revision and layout epoch it was read
 * against so a consumer that holds it for a while can tell it went stale.
 */
function* listRows(wsId: string): SagaGenerator<Listing | null> {
  try {
    for (let attempt = 0; attempt < MAX_LIST_ATTEMPTS; attempt++) {
      const listing: Listing = {
        rows: [],
        revision: yield* selectWorkspaceBrowserTabsRevision.effect(wsId),
        epoch: layoutEpoch(wsId),
      };
      const read = yield* race({
        rows: call([appClient.browser, appClient.browser.listTabs], wsId),
        teardown: take(matchesWorkspaceTeardown(wsId)),
      });
      if (read.teardown) return null;
      listing.rows = read.rows as BrowserTab[];
      if (yield* call(isCurrent, wsId, listing)) return listing;
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

/** A workspace layout settled: pull its registry rows over the geometry. */
function* reconcileOnSettle(action: ReturnType<typeof setRestoreStatus>): SagaGenerator<void> {
  const [wsId, status] = action.payload;
  if (status !== 'restored' && status !== 'empty' && status !== 'invalid') return;
  if ((yield* selectDaemonHealth.effect()) === 'down') return;
  const ownClientId = yield* waitForOwnClientId();
  const listing = yield* call(listRows, wsId);
  if (listing) yield* call(applyRegistryRows, wsId, listing, ownClientId);
}

function* removeReportedTab(tabId: string): SagaGenerator<void> {
  try {
    yield* call([appClient.browser, appClient.browser.removeTab], tabId);
    registry.pendingRemovals.delete(tabId);
    registry.awaitingCloseEcho.add(tabId);
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

/**
 * Report the workspace's hosted tabs; the run dies with the workspace. Left
 * running, an `upsertTab` reply landing after the unmount would bookkeep the
 * tab into the remounted layout's map, and while in flight the tab would
 * count as closing here and the remount's restore skip its row.
 */
function* reportWorkspaceTabs(action: { type: string; payload?: unknown }): SagaGenerator<void> {
  const wsId = reportContext(action);
  if (wsId === null) return;
  yield* race({
    report: call(reportHostedTabs, wsId),
    gone: take(matchesWorkspaceGone(wsId)),
  });
}

/**
 * Diff the workspace's hosted tabs against what the daemon last acknowledged
 * and report the delta. Single-flight per workspace (see the saga root).
 * Removals are recorded before the health gate so a tab closed while the
 * daemon is unreachable stays closed across the reconnect.
 */
function* reportHostedTabs(wsId: string): SagaGenerator<void> {
  yield* delay(REPORT_DEBOUNCE_MS);
  const ownClientId = yield* selectOwnClientId.effect();
  if (!ownClientId) return;
  const layout = yield* selectPanelLayoutWorkspace.effect(wsId);
  if (!isSettled(layout)) return;
  const reported = reportedFor(wsId);
  const hosted = collectBrowserTabs(layout);
  const present = new Set(hosted.map((h) => h.tab.id));
  const removed = [...reported.keys()].filter((tabId) => !present.has(tabId));
  for (const tabId of removed) {
    reported.delete(tabId);
    registry.pendingRemovals.add(tabId);
  }
  if ((yield* selectDaemonHealth.effect()) === 'down') return;
  for (const tabId of removed) yield* call(removeReportedTab, tabId);
  for (const item of hosted) {
    const { tab } = item;
    if (!hostedHere(tab, ownClientId)) {
      reported.delete(tab.id);
      continue;
    }
    if (!hasReportableUrl(tab)) continue;
    const input = toInput(wsId, item);
    if (deepEqual(reported.get(tab.id), input)) continue;
    registry.reporting.add(tab.id);
    try {
      const { workspaceId: _ws, ...report } = input;
      const row = yield* call([appClient.browser, appClient.browser.upsertTab], wsId, report);
      // The reply describes the tab as it was sent; a re-home that landed in
      // the meantime is newer and wins, a close is reported by the rerun.
      const current = findBrowserTab(yield* selectPanelLayoutWorkspace.effect(wsId), tab.id);
      if (current && !hostedHere(current, ownClientId)) continue;
      reported.set(tab.id, input);
      if (current && current.hostClientId !== row.hostClientId) {
        yield* put(acknowledgeBrowserTabHost(wsId, tab.id, row.hostClientId));
      }
    } catch (error) {
      logger.warn('browser.upsertTab failed', {
        wsId,
        tabId: tab.id,
        error: error instanceof Error ? error.message : error,
      });
    } finally {
      registry.reporting.delete(tab.id);
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

/** `browser:tab-opened` / `browser:tab-updated`. */
function* onRegistryRow(action: ReturnType<typeof browserTabUpserted>): SagaGenerator<void> {
  const [wsId, row] = action.payload;
  const ownClientId = yield* selectOwnClientId.effect();
  if (!ownClientId) return;
  const layout = yield* selectPanelLayoutWorkspace.effect(wsId);
  if (!isSettled(layout)) return;
  const existing = collectBrowserTabs(layout).find((h) => h.tab.id === row.tabId);
  const mine = row.hostClientId === ownClientId;
  if (!existing) {
    // An echo for a tab already closed here: the daemon is being told.
    if (closedHere(wsId, row.tabId)) return;
    yield* call(materialiseRow, wsId, row);
    if (mine) reportedFor(wsId).set(row.tabId, rowToInput(row));
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
  const reported = reportedFor(wsId);
  if (mine) {
    reported.set(row.tabId, rowToInput(row));
    const item = rehydratable(row);
    if (item) yield* spawn(rehydrateTunneledBrowserTabs, wsId, [item]);
  } else {
    reported.delete(row.tabId);
  }
}

/** `browser:tab-closed`: the row is gone or tombstoned — drop the local tab. */
function* onRegistryClose(action: ReturnType<typeof browserTabClosed>): SagaGenerator<void> {
  const [wsId, tabId] = action.payload;
  reportedFor(wsId).delete(tabId);
  registry.pendingRemovals.delete(tabId);
  registry.awaitingCloseEcho.delete(tabId);
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
 * One connect-time sync: reconcile every settled workspace against the
 * registry, then send one `browser.syncTabs` snapshot of everything this
 * client hosts. Rows of unsettled workspaces are passed through verbatim —
 * the daemon deletes any row of this host missing from the snapshot. Returns
 * false when the attempt could not complete (retryable).
 */
function* syncTabsOnce(backendId: string, ownClientId: string): SagaGenerator<boolean> {
  if (!(yield* call(waitForWorkspaceList, backendId))) {
    logger.warn('workspace list did not load; skipping browser.syncTabs');
    return false;
  }
  const workspaces = yield* selectWorkspaceItems.effect();
  const listings = yield* all(workspaces.map((ws) => call(listRows, ws.id)));
  if (listings.some((listing) => listing === null)) {
    logger.warn('browser.listTabs failed for a workspace; skipping browser.syncTabs');
    return false;
  }

  const snapshot: BrowserTabInput[] = [];
  const unacknowledged: Array<[wsId: string, tabId: string]> = [];
  // Removals the daemon has not acknowledged: the snapshot omits them so the
  // daemon deletes them; they are forgotten only once it has.
  const dropping = new Set(registry.pendingRemovals);
  const layouts = yield* selectPanelLayoutWorkspaces.effect();
  for (const [index, ws] of workspaces.entries()) {
    const listing = listings[index] as Listing;
    const layout = layouts[ws.id];
    if (layout && isSettled(layout)) {
      yield* call(applyRegistryRows, ws.id, listing, ownClientId);
      const settled = yield* selectPanelLayoutWorkspace.effect(ws.id);
      const reported = reportedFor(ws.id);
      reported.clear();
      for (const hosted of collectBrowserTabs(settled)) {
        if (!hostedHere(hosted.tab, ownClientId) || !hasReportableUrl(hosted.tab)) continue;
        if (isClosingHere(hosted.tab.id)) continue;
        const input = toInput(ws.id, hosted);
        snapshot.push(input);
        reported.set(hosted.tab.id, input);
        if (hosted.tab.hostClientId !== ownClientId) unacknowledged.push([ws.id, hosted.tab.id]);
      }
    } else {
      for (const row of listing.rows) {
        if (row.hostClientId !== ownClientId || isClosingHere(row.tabId)) continue;
        snapshot.push(rowToInput(row));
      }
    }
  }

  try {
    const { drop } = yield* call([appClient.browser, appClient.browser.syncTabs], snapshot);
    for (const tabId of dropping) registry.pendingRemovals.delete(tabId);
    const dropped = new Set(drop);
    for (const tabId of dropped) {
      for (const [wsId, reported] of registry.reported) {
        if (!reported.delete(tabId)) continue;
        yield* put(closeTab(wsId, tabId, undefined, undefined, { destroy: true }));
      }
    }
    // The acknowledgement describes the snapshot as sent; a tab re-homed or
    // closed while the call was in flight is newer and keeps its state.
    for (const [wsId, tabId] of unacknowledged) {
      if (dropped.has(tabId)) continue;
      const current = findBrowserTab(yield* selectPanelLayoutWorkspace.effect(wsId), tabId);
      if (current === undefined || current.hostClientId !== undefined) continue;
      yield* put(acknowledgeBrowserTabHost(wsId, tabId, ownClientId));
    }
    for (const ws of workspaces) {
      const layout = layouts[ws.id];
      if (layout && isSettled(layout)) yield* put(browserTabRegistryReportRequested(ws.id));
    }
    return true;
  } catch (error) {
    logger.warn('browser.syncTabs failed', {
      error: error instanceof Error ? error.message : error,
    });
    return false;
  }
}

/**
 * Connect / reconnect: one sync per connection generation. A failed attempt
 * is retried a few times and, if still failing, releases the generation so
 * the next `connected` runs it again.
 */
function* syncOnConnect(): SagaGenerator<void> {
  const backendId = yield* selectActiveBackendId();
  if (registry.backendId !== backendId) resetRegistry(backendId);
  const generation = yield* selectDaemonConnectionGeneration.effect();
  if (registry.connectionGeneration === generation) return;
  registry.connectionGeneration = generation;

  const ownClientId = yield* waitForOwnClientId();
  for (let attempt = 0; attempt < MAX_SYNC_ATTEMPTS; attempt++) {
    if (attempt > 0) {
      yield* delay(SYNC_RETRY_MS);
      if (registry.connectionGeneration !== generation) return;
      if ((yield* selectDaemonHealth.effect()) === 'down') break;
    }
    if (yield* call(syncTabsOnce, backendId, ownClientId)) return;
  }
  if (registry.connectionGeneration === generation) registry.connectionGeneration = null;
}

function* onConnectionStatus(
  action: ReturnType<typeof connectionStatusChanged>,
): SagaGenerator<void> {
  if (action.payload[0] !== 'connected') return;
  yield* call(syncOnConnect);
}

/**
 * A torn-down layout starts a new epoch, so a listing read against the old
 * one is stale even though the remount restarts `tabsRevision` at 0. An
 * unmounted or deleted workspace also forgets what it reported: its tabs left
 * the layout without being closed, so a later reconcile must not read their
 * absence as a close. Pending removals are kept — those were. A cleared
 * layout keeps its map: closing the last panel is a close.
 */
function* forgetWorkspace(
  action:
    | ReturnType<typeof workspaceUnmounted>
    | ReturnType<typeof workspaceDeleted>
    | ReturnType<typeof clearPanelLayout>,
): SagaGenerator<void> {
  const [wsId] = action.payload;
  registry.layoutEpochs.set(wsId, layoutEpoch(wsId) + 1);
  if (action.type !== clearPanelLayout.type) registry.reported.delete(wsId);
}

export function* browserTabRegistrySaga(): SagaGenerator<void> {
  resetRegistry(null);
  yield* takeSingleFlightInContext(
    isLayoutMutation,
    (action) => reportContext(action) as string,
    reportWorkspaceTabs,
  );
  yield* takeEvery(setRestoreStatus, reconcileOnSettle);
  yield* takeEvery(browserTabUpserted, onRegistryRow);
  yield* takeEvery(browserTabClosed, onRegistryClose);
  yield* takeEvery([workspaceUnmounted, workspaceDeleted, clearPanelLayout], forgetWorkspace);
  yield* takeEvery(connectionStatusChanged, onConnectionStatus);
  // Attached, not spawned: a root cancellation (HMR, store teardown) must
  // take the startup sync down with it rather than let a half-built snapshot
  // reach the daemon later and delete this host's rows.
  if ((yield* selectDaemonHealth.effect()) !== 'down') yield* fork(syncOnConnect);
}
