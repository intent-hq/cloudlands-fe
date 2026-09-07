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
 *   tab (mirror ↔ live); `tab-closed` destroys the local tab.
 *
 * Reported inputs, pending removals and echo bookkeeping are transient
 * saga-local state (a module-level Map), never Redux.
 */
import { deepEqual } from 'fast-equals';
import {
  all,
  call,
  delay,
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
import { m } from '$shared/paraglide/messages.js';
import type { BrowserTab, BrowserTabInput } from '$shared/types/browser-clients';
import { selectActiveBackendId } from '../../../utils/backend-storage-namespace';
import { takeSingleFlightInContext } from '../../../utils/context-saga-effects';
import { selectOwnClientId } from '../../browser-clients/browser-clients-selectors';
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
import { workspaceDeleted } from '../../workspace-lifecycle/workspace-lifecycle-slice';
import { selectPanelLayoutWorkspace, selectPanelLayoutWorkspaces } from '../panel-layout-selectors';
import {
  acknowledgeBrowserTabHost,
  applyBrowserTabRegistryRow,
  browserTabRegistryReportRequested,
  closeTab,
  openHiddenTab,
  openTabInRightmostColumnRequested,
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

type Visibility = BrowserTab['visibility'];
type HostedTab = { tab: PanelTab; visibility: Visibility };

type Registry = {
  backendId: string | null;
  connectionGeneration: number | null;
  /** What the daemon holds for the tabs this client hosts, by workspace then tab. */
  reported: Map<string, Map<string, BrowserTabInput>>;
  /** `removeTab` calls that failed (offline): dropped from the next snapshot instead. */
  pendingRemovals: Set<string>;
  /** `removeTab` calls the daemon acknowledged, until their `tab-closed` echo lands. */
  awaitingCloseEcho: Set<string>;
};

const registry: Registry = {
  backendId: null,
  connectionGeneration: null,
  reported: new Map(),
  pendingRemovals: new Set(),
  awaitingCloseEcho: new Set(),
};

function resetRegistry(backendId: string | null): void {
  registry.backendId = backendId;
  registry.connectionGeneration = null;
  registry.reported.clear();
  registry.pendingRemovals.clear();
  registry.awaitingCloseEcho.clear();
}

function reportedFor(wsId: string): Map<string, BrowserTabInput> {
  let map = registry.reported.get(wsId);
  if (!map) {
    map = new Map();
    registry.reported.set(wsId, map);
  }
  return map;
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
    title: row.title ?? m.layout_panelLayout_browser_fallback(),
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
 * Apply the daemon's rows for one settled workspace over the local layout.
 * A tab this client hosts that still carries a URL is local truth (it may
 * have navigated while the daemon was unreachable) and is only acknowledged;
 * everything else follows the row. Local tabs the registry no longer holds
 * are destroyed unless they can still be (re)reported from local state.
 */
function* applyRegistryRows(
  wsId: string,
  rows: BrowserTab[],
  ownClientId: string,
): SagaGenerator<void> {
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
      yield* call(materialiseRow, wsId, row);
      if (mine) reported.set(row.tabId, rowToInput(row));
    } else if (mine && hasReportableUrl(existing.tab)) {
      reported.set(row.tabId, rowToInput(row));
      if (existing.tab.hostClientId !== ownClientId) {
        yield* put(acknowledgeBrowserTabHost(wsId, row.tabId, ownClientId));
      }
    } else {
      yield* put(applyBrowserTabRegistryRow(wsId, row.tabId, row));
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

function* listRows(wsId: string): SagaGenerator<BrowserTab[] | null> {
  try {
    return yield* call([appClient.browser, appClient.browser.listTabs], wsId);
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
  const rows = yield* call(listRows, wsId);
  if (rows) yield* call(applyRegistryRows, wsId, rows, ownClientId);
}

function* removeReportedTab(tabId: string): SagaGenerator<void> {
  try {
    yield* call([appClient.browser, appClient.browser.removeTab], tabId);
    registry.pendingRemovals.delete(tabId);
  } catch (error) {
    registry.pendingRemovals.add(tabId);
    logger.warn('browser.removeTab failed; dropping on next sync', {
      tabId,
      error: error instanceof Error ? error.message : error,
    });
  }
}

/**
 * Diff the workspace's hosted tabs against what the daemon last acknowledged
 * and report the delta. Single-flight per workspace (see the saga root).
 */
function* reportWorkspaceTabs(action: { type: string; payload?: unknown }): SagaGenerator<void> {
  const wsId = reportContext(action);
  if (wsId === null) return;
  yield* delay(REPORT_DEBOUNCE_MS);
  if ((yield* selectDaemonHealth.effect()) === 'down') return;
  const ownClientId = yield* selectOwnClientId.effect();
  if (!ownClientId) return;
  const layout = yield* selectPanelLayoutWorkspace.effect(wsId);
  if (!isSettled(layout)) return;
  const reported = reportedFor(wsId);
  const present = new Set<string>();
  for (const hosted of collectBrowserTabs(layout)) {
    const { tab } = hosted;
    present.add(tab.id);
    if (!hostedHere(tab, ownClientId)) {
      reported.delete(tab.id);
      continue;
    }
    if (!hasReportableUrl(tab)) continue;
    const input = toInput(wsId, hosted);
    if (deepEqual(reported.get(tab.id), input)) continue;
    try {
      const { workspaceId: _ws, ...report } = input;
      const row = yield* call([appClient.browser, appClient.browser.upsertTab], wsId, report);
      reported.set(tab.id, input);
      registry.pendingRemovals.delete(tab.id);
      if (tab.hostClientId !== row.hostClientId) {
        yield* put(acknowledgeBrowserTabHost(wsId, tab.id, row.hostClientId));
      }
    } catch (error) {
      logger.warn('browser.upsertTab failed', {
        wsId,
        tabId: tab.id,
        error: error instanceof Error ? error.message : error,
      });
    }
  }
  for (const tabId of [...reported.keys()]) {
    if (present.has(tabId)) continue;
    reported.delete(tabId);
    yield* call(removeReportedTab, tabId);
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
    // Our own echo for a tab already closed here (its removeTab is pending).
    if (mine) return;
    yield* call(materialiseRow, wsId, row);
    return;
  }
  if (mine && existing.tab.hostClientId === ownClientId) return;
  if (mine && existing.tab.hostClientId === undefined) {
    // The registry took our unacknowledged report; local state stays truth.
    yield* put(acknowledgeBrowserTabHost(wsId, row.tabId, ownClientId));
    return;
  }
  yield* put(applyBrowserTabRegistryRow(wsId, row.tabId, row));
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
 * Connect / reconnect: reconcile every settled workspace against the
 * registry, then send one `browser.syncTabs` snapshot of everything this
 * client hosts. Rows of unsettled workspaces are passed through verbatim —
 * the daemon deletes any row of this host missing from the snapshot.
 */
function* syncOnConnect(): SagaGenerator<void> {
  const backendId = yield* selectActiveBackendId();
  if (registry.backendId !== backendId) resetRegistry(backendId);
  const generation = yield* selectDaemonConnectionGeneration.effect();
  if (registry.connectionGeneration === generation) return;
  registry.connectionGeneration = generation;

  const ownClientId = yield* waitForOwnClientId();
  if (!(yield* call(waitForWorkspaceList, backendId))) {
    logger.warn('workspace list did not load; skipping browser.syncTabs');
    return;
  }
  const workspaces = yield* selectWorkspaceItems.effect();
  const rowsByWorkspace = yield* all(workspaces.map((ws) => call(listRows, ws.id)));
  if (rowsByWorkspace.some((rows) => rows === null)) {
    logger.warn('browser.listTabs failed for a workspace; skipping browser.syncTabs');
    return;
  }

  const snapshot: BrowserTabInput[] = [];
  const unacknowledged: Array<[wsId: string, tabId: string]> = [];
  const layouts = yield* selectPanelLayoutWorkspaces.effect();
  for (const [index, ws] of workspaces.entries()) {
    const rows = rowsByWorkspace[index] as BrowserTab[];
    const layout = layouts[ws.id];
    if (layout && isSettled(layout)) {
      yield* call(applyRegistryRows, ws.id, rows, ownClientId);
      const settled = yield* selectPanelLayoutWorkspace.effect(ws.id);
      const reported = reportedFor(ws.id);
      reported.clear();
      for (const hosted of collectBrowserTabs(settled)) {
        if (!hostedHere(hosted.tab, ownClientId) || !hasReportableUrl(hosted.tab)) continue;
        if (registry.pendingRemovals.has(hosted.tab.id)) continue;
        const input = toInput(ws.id, hosted);
        snapshot.push(input);
        reported.set(hosted.tab.id, input);
        if (hosted.tab.hostClientId !== ownClientId) unacknowledged.push([ws.id, hosted.tab.id]);
      }
    } else {
      for (const row of rows) {
        if (row.hostClientId !== ownClientId || registry.pendingRemovals.has(row.tabId)) continue;
        snapshot.push(rowToInput(row));
      }
    }
  }
  registry.pendingRemovals.clear();

  try {
    const { drop } = yield* call([appClient.browser, appClient.browser.syncTabs], snapshot);
    const dropped = new Set(drop);
    for (const tabId of dropped) {
      for (const [wsId, reported] of registry.reported) {
        if (!reported.delete(tabId)) continue;
        yield* put(closeTab(wsId, tabId, undefined, undefined, { destroy: true }));
      }
    }
    for (const [wsId, tabId] of unacknowledged) {
      if (!dropped.has(tabId)) yield* put(acknowledgeBrowserTabHost(wsId, tabId, ownClientId));
    }
    for (const ws of workspaces) {
      const layout = layouts[ws.id];
      if (layout && isSettled(layout)) yield* put(browserTabRegistryReportRequested(ws.id));
    }
  } catch (error) {
    registry.connectionGeneration = null;
    logger.warn('browser.syncTabs failed', {
      error: error instanceof Error ? error.message : error,
    });
  }
}

function* onConnectionStatus(
  action: ReturnType<typeof connectionStatusChanged>,
): SagaGenerator<void> {
  if (action.payload[0] !== 'connected') return;
  yield* call(syncOnConnect);
}

// A cleared (unmounted) layout needs no handling here: reporting is gated on
// a settled layout, and the reconcile that follows a re-restore drops every
// acknowledged tab the daemon's listing no longer holds.
function* forgetWorkspace(action: ReturnType<typeof workspaceDeleted>): SagaGenerator<void> {
  const [wsId] = action.payload;
  registry.reported.delete(wsId);
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
  yield* takeEvery(workspaceDeleted, forgetWorkspace);
  yield* takeEvery(connectionStatusChanged, onConnectionStatus);
  if ((yield* selectDaemonHealth.effect()) !== 'down') yield* spawn(syncOnConnect);
}
