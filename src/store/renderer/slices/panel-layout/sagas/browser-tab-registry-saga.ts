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
 *   The report carries the `displayed` layout fact (visible AND its panel's
 *   active tab); the daemon keeps it process-local, so it rides every report
 *   and snapshot, and a row that comes back without it (daemon restart) is
 *   re-reported (intent#4835).
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
 *   sent and its `drop` list applied per workspace, under the generation
 *   that workspace contributed from (a stale drop is a no-op there).
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
 * reducer. A snapshot is computed only from layouts applied under the
 * current generation; if any loaded workspace is not, the whole sync is
 * retried rather than sent with that workspace missing (the daemon would
 * delete its rows).
 *
 * **Boundary.** Every step runs under a `Fence` — the workspace generation
 * it read, the connection it was started for, or the removal it sends — and
 * goes through exactly two doors: `wire` (the only place `appClient.browser`
 * is called; fenced before the call and after the reply) and `effect` (the
 * only place a step dispatches; fenced right before). A fence that moved
 * ends the step there (`fenced`). The dispatches outside `effect` are the
 * ones that open a fence (`registryLoading`, `registryReset`), the placement
 * inside the materialisation transaction and its compensation (`unplaceRow`).
 *
 * **Closes.** The tabs a workspace reported that a layout mutation removed
 * were closed here; they are recorded as pending removals in the same
 * dispatch (`recordRemovals`) — before any debounce, so a close made right
 * before an unmount or while the daemon is unreachable survives both — and
 * stay excluded from listings, echoes and snapshots until the daemon
 * acknowledges the removal. Within one generation a listing that raced a
 * `browser:tab-*` event (the workspace's `tabsRevision` moved while it was
 * in flight or being applied) is re-read; an `upsertTab` reply or a
 * `syncTabs` acknowledgement is applied against the tab's *current* host,
 * so a re-home that landed in the meantime wins.
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

import { appClient } from '$lib/client';
import type { ResolvedBrowserLink } from '$lib/utils/browser-url-resolution';
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
  registryTabResolved,
  registryTabsUnresolved,
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
import {
  collectBrowserTabs,
  selectPanelLayoutWorkspace,
  type BrowserTabVisibility as Visibility,
  type LayoutBrowserTab as HostedTab,
} from '../panel-layout-selectors';
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
import {
  rebaseRequestedUrlForNavigation,
  type RehydratableBrowserTab,
} from '../browser-tab-rehydration';
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

type Listing = { rows: BrowserTab[]; revision: number };
/**
 * One workspace's connect-time load: its rows, the generation they were read
 * under, and whether they were applied (a settled layout) or are only held
 * for the snapshot to echo back (an unsettled one).
 */
type WorkspaceLoad = { rows: BrowserTab[]; generation: number; applied: boolean };
type Closing = Record<string, BrowserTabClosingState>;

/**
 * What a step's result is valid against. A step that finds its fence moved
 * discards the result: the workspace's layout was torn down or reloaded, a
 * newer connect owns the sync, or the removal was settled by a snapshot or
 * a close echo meanwhile.
 */
type Fence =
  | { kind: 'workspace'; wsId: string; generation: number }
  | { kind: 'connection'; backendId: string; connectionGeneration: number }
  | { kind: 'removal'; tabId: string };
type WorkspaceFence = Extract<Fence, { kind: 'workspace' }>;
type RemovalFence = Extract<Fence, { kind: 'removal' }>;
type Fences = Fence | Fence[];

class FenceMoved extends Error {
  constructor(readonly fence: Fence) {
    super(`${fence.kind} fence moved`);
  }
}

/** Connect-time sync guards: one sync per connection generation, reset on backend change. */
let syncedBackendId: string | null = null;
let syncedConnectionGeneration: number | null = null;
/** Removals being sent, so two workspaces' reporters do not send the same one. */
const removalsInFlight = new Set<string>();

function isActive(ws: WorkspaceBrowserTabRegistryState): boolean {
  return ws.phase === 'applied' || ws.phase === 'reporting';
}

function workspaceFence(wsId: string, generation: number): WorkspaceFence {
  return { kind: 'workspace', wsId, generation };
}

function* isCurrent(fences: Fences): SagaGenerator<boolean> {
  for (const fence of Array.isArray(fences) ? fences : [fences]) {
    switch (fence.kind) {
      case 'workspace': {
        const ws = yield* selectBrowserTabRegistryWorkspace.effect(fence.wsId);
        if (ws.generation !== fence.generation) return false;
        break;
      }
      case 'connection':
        if (
          syncedBackendId !== fence.backendId ||
          syncedConnectionGeneration !== fence.connectionGeneration
        ) {
          return false;
        }
        break;
      case 'removal':
        if ((yield* selectBrowserTabsClosing.effect())[fence.tabId] !== 'pending') return false;
        break;
    }
  }
  return true;
}

/** End the step here if a fence moved. */
function* check(fences: Fences): SagaGenerator<void> {
  for (const fence of Array.isArray(fences) ? fences : [fences]) {
    if (!(yield* isCurrent(fence))) throw new FenceMoved(fence);
  }
}

/** Run a step to its end or to the fence move that ends it (`null` then). */
function* fenced<T>(step: SagaGenerator<T>): SagaGenerator<T | null> {
  try {
    return yield* step;
  } catch (error) {
    if (error instanceof FenceMoved) return null;
    throw error;
  }
}

type BrowserWire = typeof appClient.browser;
type WireMethod = 'listTabs' | 'upsertTab' | 'removeTab' | 'syncTabs';

/**
 * The one door to the daemon: fenced before the call and after the reply. A
 * failed call is logged and yields `null` — the step decides what a missing
 * reply means; a fence that moved on either side ends the step instead.
 */
function* wire<M extends WireMethod>(
  fences: Fences,
  method: M,
  ...args: Parameters<BrowserWire[M]>
): SagaGenerator<Awaited<ReturnType<BrowserWire[M]>> | null> {
  yield* check(fences);
  const fn = appClient.browser[method] as (...a: unknown[]) => Promise<unknown>;
  let result: unknown = null;
  try {
    result = yield* call([appClient.browser, fn], ...args);
  } catch (error) {
    logger.warn(`browser.${method} failed`, {
      error: error instanceof Error ? error.message : error,
    });
  }
  yield* check(fences);
  return result as Awaited<ReturnType<BrowserWire[M]>> | null;
}

/** The one door to the store for a step's results: fenced right before the dispatch. */
function* effect(fences: Fences, action: { type: string }): SagaGenerator<void> {
  yield* check(fences);
  yield* put(action);
}

function isSettled(layout: WorkspacePanelLayoutState): boolean {
  return (
    layout.restoreStatus === 'restored' ||
    layout.restoreStatus === 'empty' ||
    layout.restoreStatus === 'invalid'
  );
}

/** A tab this client renders: acknowledged as ours, or not yet seen by the registry. */
function hostedHere(tab: PanelTab, ownClientId: string): boolean {
  return tab.hostClientId === undefined || tab.hostClientId === ownClientId;
}

/** Geometry-only shells (URL stripped, awaiting the registry row) are not reportable. */
function hasReportableUrl(tab: PanelTab): boolean {
  return typeof tab.browserUrl === 'string';
}

function toInput(wsId: string, { tab, visibility, displayed }: HostedTab): BrowserTabInput {
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
    displayed,
  };
}

/**
 * What the daemon holds for a row, in report shape. A row without
 * `displayed` (never reported, or the daemon restarted) reads as `null`, so
 * the next report diff sends the layout fact again.
 */
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
    displayed: row.displayed ?? null,
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

/**
 * A tab this client hosts is local truth for its URL and title, but not for
 * a claim it lost to persistence: a remount reinstalls the persisted layout,
 * in which a registry-hosted tab is a geometry shell (owner, requested URL
 * and emulated size stripped with the URL), and a guest that reports its
 * location before the rows land makes the shell look complete. The row
 * still holds the claim (only this host ever reports it, and no local
 * change clears it short of destroying the tab), so the fields the tab
 * lacks are taken from the row — the requested URL rebased onto the local
 * URL when the guest moved, so a navigation off the row's origin still
 * drops it. Null when the tab already carries everything the row holds.
 */
function claimFromRow(tab: PanelTab, row: BrowserTab): BrowserTab | null {
  const url = tab.browserUrl ?? row.url;
  const requestedUrl =
    tab.browserRequestedUrl ??
    (url === row.url
      ? row.requestedUrl
      : rebaseRequestedUrlForNavigation(row.url, url, row.requestedUrl));
  const ownerAgentId = tab.ownerAgentId ?? row.ownerAgentId;
  const ownerAgentName = tab.ownerAgentName ?? row.ownerAgentName;
  const emulatedSize = tab.emulatedSize ?? row.emulatedSize;
  if (
    requestedUrl === tab.browserRequestedUrl &&
    ownerAgentId === tab.ownerAgentId &&
    ownerAgentName === tab.ownerAgentName &&
    emulatedSize === tab.emulatedSize
  ) {
    return null;
  }
  return {
    ...row,
    url,
    title: tab.title,
    requestedUrl,
    ownerAgentId,
    ownerAgentName,
    emulatedSize,
  };
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
 * reported by the caller's layout check. The placement is a transaction on
 * the fence: the saga scheduler queues a `put` behind the actions other
 * sagas put in the same flush, so a generation move can slip between the
 * check and the placement — a row placed under a fence that moved is taken
 * back out before anything else observes the layout, and the step ends.
 */
function* materialiseRow(fence: WorkspaceFence, row: BrowserTab): SagaGenerator<void> {
  const { wsId } = fence;
  const tab = rowToTab(row);
  yield* check(fence);
  if (row.visibility === 'hidden' && row.ownerAgentId) {
    yield* put(openHiddenTab(wsId, tab, row.tabId));
  } else {
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
  if (yield* isCurrent(fence)) return;
  yield* call(unplaceRow, wsId, row.tabId);
  throw new FenceMoved(fence);
}

/**
 * Take a row placed under a fence that moved back out of the layout. The row
 * was never recorded as reported, so no removal follows from this; a cleared
 * layout has nothing to take out.
 */
function* unplaceRow(wsId: string, tabId: string): SagaGenerator<void> {
  const layout = yield* selectPanelLayoutWorkspace.effect(wsId);
  if (!collectBrowserTabs(layout).some((h) => h.tab.id === tabId)) return;
  yield* put(closeTab(wsId, tabId, undefined, undefined, { destroy: true }));
}

/**
 * Move an existing tab between its panel and the hidden set to match the
 * row. Only owned tabs are ever hidden (the FE hides owned tabs only, and
 * `closeTab` destroys anything else), and a reveal never steals focus.
 */
function* reconcileVisibility(
  fence: WorkspaceFence,
  existing: HostedTab,
  row: BrowserTab,
): SagaGenerator<void> {
  const target: Visibility = row.visibility === 'hidden' && row.ownerAgentId ? 'hidden' : 'visible';
  if (existing.visibility === target) return;
  const { wsId } = fence;
  if (target === 'visible') {
    yield* effect(fence, restoreHiddenTab(wsId, row.tabId, undefined, false));
  } else {
    yield* effect(fence, closeTab(wsId, row.tabId));
  }
}

/**
 * Apply the daemon's rows for one settled workspace over the local layout.
 * A tab this client already hosts that still carries a URL is local truth
 * (it may have navigated while the daemon was unreachable): it is only
 * acknowledged, completed with a claim it lost to persistence
 * (`claimFromRow`), and — its guest being the one that produced the URL —
 * not re-resolved, unless it is still `unresolved`: filled from a row at an
 * earlier load without its tunnel re-resolution being established, its URL
 * is the row's copy and the resolution is retried. Everything else —
 * including a mirror the daemon re-homed here while we were away, whose URL
 * and visibility are stale — follows the row, and a row of ours applied
 * that way is queued for tunnel re-resolution, which marks the tab
 * `unresolved` until it lands. A row for a tab being closed here is left alone:
 * rematerialising it would undo the close. Local tabs the registry no
 * longer holds are destroyed unless they can still be (re)reported from
 * local state; they are forgotten first, so the destroy is not read as a
 * close to report. The workspace becomes `applied` only if every
 * materialised row is in the layout; otherwise nothing is recorded and
 * false is returned. A fence that moved anywhere along the way ends the
 * step.
 */
function* applyRows(
  fence: WorkspaceFence,
  rows: BrowserTab[],
  ownClientId: string,
): SagaGenerator<boolean> {
  const { wsId } = fence;
  const layout = yield* selectPanelLayoutWorkspace.effect(wsId);
  const closing = yield* selectBrowserTabsClosing.effect();
  const { unresolved } = yield* selectBrowserTabRegistryWorkspace.effect(wsId);
  // Rebuilt from the listing — what the daemon holds: anything acknowledged
  // earlier but absent now (cleared layout, other host, restart) is no longer ours.
  const reported: Record<string, BrowserTabInput> = {};
  const known = new Set(rows.map((row) => row.tabId));
  const local = new Map(collectBrowserTabs(layout).map((h) => [h.tab.id, h]));
  const toRehydrate: RehydratableBrowserTab[] = [];
  const materialised: string[] = [];
  const applied = (row: BrowserTab) => {
    reported[row.tabId] = rowToInput(row);
    const item = rehydratable(row);
    if (item) toRehydrate.push(item);
  };
  for (const row of rows) {
    const existing = local.get(row.tabId);
    const mine = row.hostClientId === ownClientId;
    if (!existing) {
      if (row.tabId in closing) continue;
      yield* call(materialiseRow, fence, row);
      materialised.push(row.tabId);
      if (mine) applied(row);
    } else if (mine && hostedHere(existing.tab, ownClientId) && hasReportableUrl(existing.tab)) {
      reported[row.tabId] = rowToInput(row);
      const claim = claimFromRow(existing.tab, row);
      if (claim) {
        yield* effect(fence, applyBrowserTabRegistryRow(wsId, row.tabId, claim));
      } else if (existing.tab.hostClientId !== ownClientId) {
        yield* effect(fence, acknowledgeBrowserTabHost(wsId, row.tabId, ownClientId));
      }
      const requestedUrl = claim ? claim.requestedUrl : existing.tab.browserRequestedUrl;
      if (row.tabId in unresolved && requestedUrl && existing.tab.browserUrl) {
        toRehydrate.push({ tabId: row.tabId, requestedUrl, storedUrl: existing.tab.browserUrl });
      }
    } else {
      yield* effect(fence, applyBrowserTabRegistryRow(wsId, row.tabId, row));
      yield* call(reconcileVisibility, fence, existing, row);
      if (mine) applied(row);
    }
  }
  for (const [tabId, { tab }] of local) {
    if (known.has(tabId) || tab.hostClientId === undefined) continue;
    if (tab.hostClientId === ownClientId && hasReportableUrl(tab)) continue;
    yield* effect(fence, registryTabForgotten(wsId, tabId));
    yield* effect(fence, closeTab(wsId, tabId, undefined, undefined, { destroy: true }));
  }
  yield* check(fence);
  const placed = new Set(
    collectBrowserTabs(yield* selectPanelLayoutWorkspace.effect(wsId)).map((h) => h.tab.id),
  );
  const missing = materialised.filter((tabId) => !placed.has(tabId));
  if (missing.length > 0) {
    logger.warn('registry rows were not placed in the layout; not applied', { wsId, missing });
    return false;
  }
  yield* effect(fence, registryApplied(wsId, fence.generation, reported));
  if (toRehydrate.length > 0) yield* call(rehydrateUnderFence, fence, toRehydrate);
  yield* effect(fence, browserTabRegistryReportRequested(wsId));
  return true;
}

/**
 * Re-resolve tunneled URLs detached from the caller (the resolution goes
 * over IPC and must not hold up the load), fenced: a resolution that lands
 * after the layout was torn down and rebuilt must not navigate the tab the
 * rebuild restored. The tabs are `unresolved` until a resolution is
 * established, so the next load retries the ones that failed.
 * `resolveBrowserLinkUrl` never throws: a rewrite it could not establish
 * comes back as the requested URL passed through, or as the rewritten
 * target with an `error` — neither is established.
 */
function* rehydrateUnderFence(
  fence: WorkspaceFence,
  tabs: RehydratableBrowserTab[],
): SagaGenerator<void> {
  const { wsId, generation } = fence;
  yield* effect(
    fence,
    registryTabsUnresolved(
      wsId,
      generation,
      tabs.map((tab) => tab.tabId),
    ),
  );
  yield* spawn(
    rehydrateTunneledBrowserTabs,
    wsId,
    tabs,
    () => isCurrent(fence),
    function* (tab: RehydratableBrowserTab, resolved: ResolvedBrowserLink) {
      if (resolved.error || resolved.url === tab.requestedUrl) return;
      yield* effect(fence, registryTabResolved(wsId, tab.tabId));
    },
  );
}

/**
 * Read the workspace's registry rows. A `browser:tab-*` event landing while
 * the read is in flight bumps the workspace's `tabsRevision`; such a listing
 * may predate the event (a closed tab still listed) and is re-read. The
 * listing carries the revision it was read against.
 */
function* listRows(fence: WorkspaceFence): SagaGenerator<Listing | null> {
  const { wsId } = fence;
  for (let attempt = 0; attempt < MAX_LIST_ATTEMPTS; attempt++) {
    const revision = yield* selectWorkspaceBrowserTabsRevision.effect(wsId);
    const rows = yield* wire(fence, 'listTabs', wsId);
    if (rows === null) return null;
    if ((yield* selectWorkspaceBrowserTabsRevision.effect(wsId)) === revision) {
      return { rows: rows as BrowserTab[], revision };
    }
  }
  logger.warn('browser.listTabs kept racing browser:tab-* events; skipping', { wsId });
  return null;
}

/**
 * Load one workspace: open a new generation, read its rows and, when its
 * layout is settled, apply them; an unsettled workspace's rows are only
 * held, for the connect-time snapshot to echo back. Rows that changed while
 * being applied (an event landed) are re-read and re-applied. Returns null
 * when the load failed or its generation moved — nothing was recorded then.
 */
function* loadWorkspace(wsId: string, ownClientId: string): SagaGenerator<WorkspaceLoad | null> {
  yield* put(registryLoading(wsId));
  const { generation } = yield* selectBrowserTabRegistryWorkspace.effect(wsId);
  return yield* fenced(loadUnder(workspaceFence(wsId, generation), ownClientId));
}

function* loadUnder(
  fence: WorkspaceFence,
  ownClientId: string,
): SagaGenerator<WorkspaceLoad | null> {
  const { wsId, generation } = fence;
  for (let attempt = 0; attempt < MAX_LIST_ATTEMPTS; attempt++) {
    const listing = yield* call(listRows, fence);
    if (listing === null) return null;
    const layout = yield* selectPanelLayoutWorkspace.effect(wsId);
    if (!isSettled(layout)) return { rows: listing.rows, generation, applied: false };
    if (!(yield* call(applyRows, fence, listing.rows, ownClientId))) return null;
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
 * Every layout mutation: the tabs the workspace reported that its layout no
 * longer holds were closed here. They are recorded as pending removals in
 * the same dispatch — before the debounced reporter, so a close made right
 * before an unmount, or while the daemon is unreachable, survives both —
 * and every reporter run sends them, every snapshot omits them, until the
 * daemon acknowledges. The reducer bumps the generation on `clearPanelLayout`
 * before this runs, so closing the last panel records its tabs under the
 * new one; an unmount leaves the layout in place and forgets the map
 * instead (its tabs left with the workspace).
 */
function* recordRemovals(action: { type: string; payload?: unknown }): SagaGenerator<void> {
  const wsId = reportContext(action);
  if (wsId === null) return;
  const registry = yield* selectBrowserTabRegistryWorkspace.effect(wsId);
  const reported = Object.keys(registry.reported);
  if (reported.length === 0) return;
  const layout = yield* selectPanelLayoutWorkspace.effect(wsId);
  const present = new Set(collectBrowserTabs(layout).map((h) => h.tab.id));
  const removed = reported.filter((tabId) => !present.has(tabId));
  if (removed.length === 0) return;
  yield* fenced(
    effect(workspaceFence(wsId, registry.generation), registryRemovalsPending(wsId, removed)),
  );
}

/**
 * Send the recorded removals the daemon has not acknowledged — any
 * workspace's, regardless of its generation: a close stays a close. Each is
 * fenced on the removal itself; one settled meanwhile by a snapshot or a
 * close echo has nothing left to acknowledge. A failed call leaves the
 * removal pending for the next run or snapshot.
 */
function* sendPendingRemovals(): SagaGenerator<void> {
  const closing = yield* selectBrowserTabsClosing.effect();
  for (const [tabId, state] of Object.entries(closing)) {
    if (state !== 'pending' || removalsInFlight.has(tabId)) continue;
    removalsInFlight.add(tabId);
    try {
      yield* fenced(sendRemoval({ kind: 'removal', tabId }));
    } finally {
      removalsInFlight.delete(tabId);
    }
  }
}

function* sendRemoval(fence: RemovalFence): SagaGenerator<void> {
  const reply = yield* wire(fence, 'removeTab', fence.tabId);
  if (reply !== null) yield* effect(fence, registryRemovalAcknowledged(fence.tabId));
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
 * and report the delta. Single-flight per workspace (see the saga root).
 * Pending removals go first, whatever the workspace's phase; only an applied
 * workspace reports. A tab is recorded as reported when its `upsertTab` goes
 * out — so a row or echo for it arriving before the reply is not
 * rematerialised — and forgotten again if the call fails; the reply is
 * applied against the tab's current host (a re-home that landed in the
 * meantime wins). A layout torn down and rebuilt while a call was in flight
 * has newer tabs than the ones read here: the fence ends the run.
 */
function* reportHostedTabs(wsId: string): SagaGenerator<void> {
  yield* delay(REPORT_DEBOUNCE_MS);
  const ownClientId = yield* selectOwnClientId.effect();
  if (!ownClientId) return;
  if ((yield* selectDaemonHealth.effect()) === 'down') return;
  yield* call(sendPendingRemovals);
  const registry = yield* selectBrowserTabRegistryWorkspace.effect(wsId);
  if (!isActive(registry)) return;
  const layout = yield* selectPanelLayoutWorkspace.effect(wsId);
  if (!isSettled(layout)) return;
  yield* fenced(
    reportUnder(workspaceFence(wsId, registry.generation), registry.reported, layout, ownClientId),
  );
}

function* reportUnder(
  fence: WorkspaceFence,
  reported: Record<string, BrowserTabInput>,
  layout: WorkspacePanelLayoutState,
  ownClientId: string,
): SagaGenerator<void> {
  const { wsId, generation } = fence;
  for (const item of collectBrowserTabs(layout)) {
    const { tab } = item;
    if (!hostedHere(tab, ownClientId)) {
      if (tab.id in reported) yield* effect(fence, registryTabForgotten(wsId, tab.id));
      continue;
    }
    if (!hasReportableUrl(tab)) continue;
    const input = toInput(wsId, item);
    if (deepEqual(reported[tab.id], input)) continue;
    yield* effect(fence, registryTabReported(wsId, generation, tab.id, input));
    const { workspaceId: _ws, ...report } = input;
    const row = yield* wire(fence, 'upsertTab', wsId, report);
    if (row === null) {
      yield* effect(fence, registryTabForgotten(wsId, tab.id));
      continue;
    }
    const current = findBrowserTab(yield* selectPanelLayoutWorkspace.effect(wsId), tab.id);
    if (current && !hostedHere(current, ownClientId)) {
      yield* effect(fence, registryTabForgotten(wsId, tab.id));
    } else if (current && current.hostClientId !== row.hostClientId) {
      yield* effect(fence, acknowledgeBrowserTabHost(wsId, tab.id, row.hostClientId));
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
 * A row of ours materialised or re-homed here from the event enters the
 * same fenced re-resolution as one applied from a listing: its URL is the
 * row's, not a guest's, and `applyRows` only retries what is `unresolved`.
 */
function* onRegistryRow(action: ReturnType<typeof browserTabUpserted>): SagaGenerator<void> {
  const [wsId, row] = action.payload;
  const ownClientId = yield* selectOwnClientId.effect();
  if (!ownClientId) return;
  const registry = yield* selectBrowserTabRegistryWorkspace.effect(wsId);
  if (!isActive(registry)) return;
  const layout = yield* selectPanelLayoutWorkspace.effect(wsId);
  if (!isSettled(layout)) return;
  const existing = collectBrowserTabs(layout).find((h) => h.tab.id === row.tabId);
  yield* fenced(
    applyRow(workspaceFence(wsId, registry.generation), registry, existing, row, ownClientId),
  );
}

function* applyRow(
  fence: WorkspaceFence,
  registry: WorkspaceBrowserTabRegistryState,
  existing: HostedTab | undefined,
  row: BrowserTab,
  ownClientId: string,
): SagaGenerator<void> {
  const { wsId, generation } = fence;
  const mine = row.hostClientId === ownClientId;
  const reported = () => registryTabReported(wsId, generation, row.tabId, rowToInput(row));
  const applied = function* (): SagaGenerator<void> {
    yield* effect(fence, reported());
    const item = rehydratable(row);
    if (item) yield* call(rehydrateUnderFence, fence, [item]);
  };
  if (!existing) {
    // An echo for a tab being closed here: the daemon is being told.
    if (row.tabId in (yield* selectBrowserTabsClosing.effect())) return;
    yield* call(materialiseRow, fence, row);
    if (mine) yield* call(applied);
    return;
  }
  if (mine && existing.tab.hostClientId === ownClientId) {
    // Local truth; a claim the persisted shell lost is completed from the echo.
    const claim = hasReportableUrl(existing.tab) ? claimFromRow(existing.tab, row) : null;
    if (claim) yield* effect(fence, applyBrowserTabRegistryRow(wsId, row.tabId, claim));
    return;
  }
  if (mine && existing.tab.hostClientId === undefined) {
    // The registry took our unacknowledged report; local state stays truth.
    yield* effect(fence, acknowledgeBrowserTabHost(wsId, row.tabId, ownClientId));
    return;
  }
  yield* effect(fence, applyBrowserTabRegistryRow(wsId, row.tabId, row));
  yield* call(reconcileVisibility, fence, existing, row);
  if (mine) {
    yield* call(applied);
  } else if (row.tabId in registry.reported) {
    yield* effect(fence, registryTabForgotten(wsId, row.tabId));
  }
}

/**
 * `browser:tab-closed`: the row is gone or tombstoned — drop the local tab.
 * The reducer already forgot the tab's bookkeeping, so the destroy is not
 * read as a close to report.
 */
function* onRegistryClose(action: ReturnType<typeof browserTabClosed>): SagaGenerator<void> {
  const [wsId, tabId] = action.payload;
  const layout = yield* selectPanelLayoutWorkspace.effect(wsId);
  if (!collectBrowserTabs(layout).some((h) => h.tab.id === tabId)) return;
  const { generation } = yield* selectBrowserTabRegistryWorkspace.effect(wsId);
  yield* fenced(
    effect(
      workspaceFence(wsId, generation),
      closeTab(wsId, tabId, undefined, undefined, { destroy: true }),
    ),
  );
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
 * One connect-time sync: load every workspace, then send one
 * `browser.syncTabs` snapshot of everything this client hosts — the daemon
 * deletes any row of this host missing from it. Each workspace contributes
 * under the generation it loaded in (`snapshotEntries`); if any of those
 * moved before the snapshot went out, the attempt is abandoned and retried.
 * The attempt is also fenced on the connection it was started for: a newer
 * connect (reconnect, backend switch) owns the sync from then on, and this
 * one must not send its snapshot — built against the old connection's rows
 * — over the newer one's. The acknowledgement is applied per workspace,
 * against its current generation and each tab's current host: a workspace
 * torn down or a tab re-homed while the call was in flight is newer and
 * keeps its state. Returns false when the attempt could not complete
 * (retryable), true when it completed or was superseded.
 */
function* syncTabsOnce(
  backendId: string,
  connectionGeneration: number,
  ownClientId: string,
): SagaGenerator<boolean> {
  if (!(yield* call(waitForWorkspaceList, backendId))) {
    logger.warn('workspace list did not load; skipping browser.syncTabs');
    return false;
  }
  try {
    return yield* syncUnder({ kind: 'connection', backendId, connectionGeneration }, ownClientId);
  } catch (error) {
    if (error instanceof FenceMoved) return error.fence.kind === 'connection';
    throw error;
  }
}

function* syncUnder(connection: Fence, ownClientId: string): SagaGenerator<boolean> {
  yield* check(connection);
  const workspaces = yield* selectWorkspaceItems.effect();
  const loads = yield* all(workspaces.map((ws) => call(loadWorkspace, ws.id, ownClientId)));
  if (loads.some((load) => load === null)) {
    logger.warn('a workspace could not be loaded; skipping browser.syncTabs');
    return false;
  }
  yield* check(connection);
  const closing = yield* selectBrowserTabsClosing.effect();
  // Removals the daemon has not acknowledged: the snapshot omits them so the
  // daemon deletes them; they are forgotten only once it has.
  const omitted = Object.keys(closing).filter((tabId) => closing[tabId] === 'pending');
  const snapshot: BrowserTabInput[] = [];
  const entries: Array<{ fence: WorkspaceFence; applied: boolean; unacknowledged: string[] }> = [];
  for (const [index, ws] of workspaces.entries()) {
    const load = loads[index] as WorkspaceLoad;
    const fence = workspaceFence(ws.id, load.generation);
    const contribution = yield* call(snapshotEntries, fence, load, ownClientId, closing);
    if (contribution === null) {
      logger.warn('workspace layout moved before the snapshot; skipping browser.syncTabs', {
        wsId: ws.id,
      });
      return false;
    }
    snapshot.push(...contribution.inputs);
    entries.push({ fence, applied: load.applied, unacknowledged: contribution.unacknowledged });
    if (load.applied) {
      yield* effect(
        [connection, fence],
        registryApplied(ws.id, load.generation, contribution.reported),
      );
    }
  }
  yield* check(entries.map((entry) => entry.fence));
  const reply = yield* wire(connection, 'syncTabs', snapshot);
  if (reply === null) return false;
  yield* effect(connection, registrySnapshotAcknowledged(omitted, reply.drop));
  const dropped = new Set(reply.drop);
  for (const entry of entries) {
    yield* fenced(
      reconcileSnapshot(entry.fence, entry.applied, dropped, entry.unacknowledged, ownClientId),
    );
  }
  return true;
}

type SnapshotEntries = {
  inputs: BrowserTabInput[];
  reported: Record<string, BrowserTabInput>;
  unacknowledged: string[];
};

/**
 * One workspace's contribution to the snapshot, read under the generation it
 * loaded in — null once that moved (torn down, or settled and reloaded: it
 * may have reported tabs its old rows lack). An applied workspace
 * contributes the tabs its layout hosts; an unsettled one echoes the rows
 * the daemon holds for this host back unchanged. Removals the daemon has not
 * acknowledged are omitted from both.
 */
function* snapshotEntries(
  fence: WorkspaceFence,
  load: WorkspaceLoad,
  ownClientId: string,
  closing: Closing,
): SagaGenerator<SnapshotEntries | null> {
  const { wsId } = fence;
  const registry = yield* selectBrowserTabRegistryWorkspace.effect(wsId);
  if (registry.generation !== fence.generation || (load.applied && !isActive(registry)))
    return null;
  const inputs: BrowserTabInput[] = [];
  const reported: Record<string, BrowserTabInput> = {};
  const unacknowledged: string[] = [];
  if (!load.applied) {
    for (const row of load.rows) {
      if (row.hostClientId === ownClientId && !(row.tabId in closing)) inputs.push(rowToInput(row));
    }
    return { inputs, reported, unacknowledged };
  }
  const layout = yield* selectPanelLayoutWorkspace.effect(wsId);
  for (const hosted of collectBrowserTabs(layout)) {
    if (!hostedHere(hosted.tab, ownClientId) || !hasReportableUrl(hosted.tab)) continue;
    if (hosted.tab.id in closing) continue;
    const input = toInput(wsId, hosted);
    inputs.push(input);
    reported[hosted.tab.id] = input;
    if (hosted.tab.hostClientId !== ownClientId) unacknowledged.push(hosted.tab.id);
  }
  return { inputs, reported, unacknowledged };
}

/**
 * Apply the acknowledgement to one workspace, under the generation it
 * contributed from: a dropped tab is forgotten (the daemon deleted its row)
 * and, when still hosted here, destroyed — forgotten first, so the destroy
 * is not a close to report; in an applied workspace, an unacknowledged tab
 * the daemon kept is now ours, and the workspace reports whatever the
 * snapshot did not cover. A workspace whose generation moved keeps what it
 * reported since: its rows were read after this snapshot was taken.
 */
function* reconcileSnapshot(
  fence: WorkspaceFence,
  applied: boolean,
  dropped: Set<string>,
  unacknowledged: string[],
  ownClientId: string,
): SagaGenerator<void> {
  const { wsId } = fence;
  for (const tabId of dropped) {
    const { reported } = yield* selectBrowserTabRegistryWorkspace.effect(wsId);
    if (tabId in reported) yield* effect(fence, registryTabForgotten(wsId, tabId));
    const tab = findBrowserTab(yield* selectPanelLayoutWorkspace.effect(wsId), tabId);
    if (tab === undefined || !hostedHere(tab, ownClientId)) continue;
    yield* effect(fence, closeTab(wsId, tabId, undefined, undefined, { destroy: true }));
  }
  if (!applied) return;
  for (const tabId of unacknowledged) {
    if (dropped.has(tabId)) continue;
    const tab = findBrowserTab(yield* selectPanelLayoutWorkspace.effect(wsId), tabId);
    if (tab === undefined || tab.hostClientId !== undefined) continue;
    yield* effect(fence, acknowledgeBrowserTabHost(wsId, tabId, ownClientId));
  }
  yield* effect(fence, browserTabRegistryReportRequested(wsId));
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
      if ((yield* selectDaemonHealth.effect()) === 'down') break;
    }
    if (syncedBackendId !== backendId || syncedConnectionGeneration !== generation) return;
    if (yield* call(syncTabsOnce, backendId, generation, ownClientId)) return;
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
  removalsInFlight.clear();
  yield* takeEvery(isLayoutMutation, recordRemovals);
  yield* takeSingleFlightInContext(
    isLayoutMutation,
    (action) => reportContext(action) as string,
    reportWorkspaceTabs,
  );
  yield* takeEvery(setRestoreStatus, reconcileOnSettle);
  yield* takeEvery(browserTabUpserted, onRegistryRow);
  yield* takeEvery(browserTabClosed, onRegistryClose);
  yield* takeEvery(connectionStatusChanged, onConnectionStatus);
  // Attached, not spawned: a root cancellation (HMR, store teardown) must
  // take the startup sync down with it rather than let a half-built snapshot
  // reach the daemon later and delete this host's rows.
  if ((yield* selectDaemonHealth.effect()) !== 'down') yield* fork(syncOnConnect);
}
