/**
 * Browser Clients Saga (renderer)
 *
 * Wire I/O for the REV-2 browser-client mirror: the own-clientId hello probe
 * and `client.list` on hydrate, single-flight coalesced `client.list`
 * re-reads on `refreshLiveClientsRequested` (the bridge dispatches it for
 * every `client:connected` / `client:disconnected`, so a reconnect burst
 * collapses into one in-flight read plus at most one trailing read; each
 * such presence refresh also requests the mounted workspaces' daemon
 * browser-client resolution, since the pin or default may now resolve
 * differently), and the per-workspace `workspace.getBrowserClient` /
 * `setBrowserClient` / `browser.listTabs` calls keyed by workspace. Every
 * resolution read — mount, `workspace:updated`, presence — goes through one
 * single-flight lane per workspace (one in flight, at most one trailing), and
 * a read that overlapped a pin write in any way (started before it, or
 * during it and settled after) discards its reply and re-queues itself, so an
 * older read can never overwrite the write's echo or a newer read. Pin writes
 * and tab reads are latest-wins per workspace, so a slow earlier pin write
 * cannot overwrite a later daemon echo. A viewer's `browser.navigateTab` /
 * `browser.closeTab` requests (REV-2 Model 3) are fire-and-forget commands to
 * the tab's host: nothing is stored from the reply — the mirror follows the
 * `browser:tab-updated` / `browser:tab-closed` echo — and a failure is
 * surfaced as a toast. A workspace mount reads its browser
 * client (the sidebar indicator's input) and, until the own clientId and
 * `client.list` are known, hydrates them once. Workspace teardown
 * (`workspaceUnmounted` / `workspaceDeleted` / `removeWorkspaceEntity`)
 * cancels the workspace's resolution lane — the in-flight read and its
 * trailing trigger — and every other per-workspace call races the teardown:
 * a reply that lands after the reducer cleared the entry is dropped, so it
 * can neither resurrect a deleted workspace nor leak into a later remount,
 * which starts a fresh lane.
 */
import { appClient } from '$lib/client';
import { createLogger } from '$lib/utils/client-logger';
import { m } from '$shared/paraglide/messages.js';
import { call, put, race, take, takeEvery, takeLatest, type SagaGenerator } from 'typed-redux-saga';

import {
  takeLatestByWorkspace,
  takeSingleFlightInContext,
} from '../../../utils/context-saga-effects';
import { removeWorkspaceEntity } from '../../workspace/workspace-slice';
import { selectMountedWorkspaceIds } from '../../workspace-lifecycle/workspace-lifecycle-selectors';
import {
  workspaceDeleted,
  workspaceMounted,
  workspaceUnmounted,
} from '../../workspace-lifecycle/workspace-lifecycle-slice';
import {
  selectLiveClientsLoaded,
  selectOwnClientId,
  selectWorkspaceBrowserTabsRevision,
} from '../browser-clients-selectors';
import {
  closeBrowserTabRequested,
  fetchWorkspaceBrowserClientRequested,
  fetchWorkspaceBrowserTabsRequested,
  hydrateBrowserClientsRequested,
  liveClientsReceived,
  navigateBrowserTabRequested,
  ownClientIdReceived,
  refreshLiveClientsRequested,
  setWorkspaceBrowserClientRequested,
  workspaceBrowserClientReceived,
  workspaceBrowserTabsReceived,
} from '../browser-clients-slice';

const logger = createLogger('BrowserClientsSaga');
const LIVE_CLIENTS_CONTEXT = 'live-clients';
/** Re-reads allowed when `browser:tab-*` patches keep landing mid-`browser.listTabs`. */
const MAX_TABS_READ_ATTEMPTS = 3;

/**
 * Saga-local, per-workspace pin-write epoch, bumped when a pin write starts
 * and again when it settles. A resolution read captures it before its RPC; a
 * different value afterwards means a write started or settled while the read
 * was in flight, so the reply may predate the write's commit and must not be
 * stored. A read that started mid-write is invalidated by the settlement
 * bump, not only a read that predates the write.
 */
type PinWriteEpochs = Record<string, number>;

type BrowserClientReadAction =
  | ReturnType<typeof fetchWorkspaceBrowserClientRequested>
  | ReturnType<typeof workspaceUnmounted>
  | ReturnType<typeof workspaceDeleted>
  | ReturnType<typeof removeWorkspaceEntity>;

/**
 * Teardown cancels the workspace's resolution lane outright — the in-flight
 * read and any trailing trigger — instead of letting the trailing read start
 * against a cleared entry. A later remount opens a fresh lane.
 */
function browserClientReadContext(action: BrowserClientReadAction) {
  const wsId = action.payload[0];
  return action.type === fetchWorkspaceBrowserClientRequested.type
    ? wsId
    : { context: wsId, cancel: true as const };
}

/**
 * Re-reads `client.list`. A presence change (any read after the initial
 * load) can also change what the daemon resolves for a workspace — a pinned
 * client going offline, or the default falling through to another client —
 * so the mounted workspaces' `workspace.getBrowserClient` is requested too.
 * Only the mounted workspaces (the lifecycle slice's session set, not every
 * workspace the global `browser:tab-*` / `workspace:updated` events touched)
 * are requested, and each request joins that workspace's single-flight
 * resolution lane, so a presence burst cannot start overlapping resolution
 * calls: one read is in flight and at most one trailing read follows it.
 */
function* readLiveClients(): SagaGenerator<void> {
  try {
    const presenceChange = yield* selectLiveClientsLoaded.effect();
    const clients = yield* call([appClient.clients, appClient.clients.list]);
    yield* put(liveClientsReceived(clients));
    if (!presenceChange) return;
    const mounted = yield* selectMountedWorkspaceIds.effect();
    for (const wsId of mounted) yield* put(fetchWorkspaceBrowserClientRequested(wsId));
  } catch (error) {
    logger.warn('client.list failed', { error: error instanceof Error ? error.message : error });
  }
}

function* readOwnClientId(): SagaGenerator<void> {
  try {
    const clientId = yield* call([appClient.clients, appClient.clients.ownClientId]);
    yield* put(ownClientIdReceived(clientId));
  } catch (error) {
    logger.warn('own clientId probe failed', {
      error: error instanceof Error ? error.message : error,
    });
  }
}

function* hydrate(): SagaGenerator<void> {
  yield* call(readOwnClientId);
  yield* put(refreshLiveClientsRequested());
}

function matchesWorkspaceCleanup(wsId: string) {
  return (action: { type: string; payload?: unknown }) =>
    (action.type === workspaceUnmounted.type ||
      action.type === workspaceDeleted.type ||
      action.type === removeWorkspaceEntity.type) &&
    Array.isArray(action.payload) &&
    action.payload[0] === wsId;
}

/**
 * Awaits `request` unless the workspace is torn down first. `{ cleanup: true }`
 * means the reply (if it ever lands) belongs to a cleared entry and must be
 * discarded; the daemon still applies the call.
 */
function* untilWorkspaceCleanup<T>(
  wsId: string,
  request: SagaGenerator<T>,
): SagaGenerator<{ result: T; cleanup?: undefined } | { result?: undefined; cleanup: true }> {
  const outcome = yield* race({ result: request, cleanup: take(matchesWorkspaceCleanup(wsId)) });
  return outcome.cleanup ? { cleanup: true } : { result: outcome.result as T };
}

/**
 * One resolution read. Runs inside the workspace's single-flight lane, so it
 * never overlaps another read of the same workspace, and the lane's teardown
 * cancel abandons it mid-RPC. A pin write that started or settled mid-read
 * makes the reply stale: it is dropped and the read re-queued as the lane's
 * trailing run, which then observes the daemon state after the write.
 */
function* readWorkspaceBrowserClient(
  epochs: PinWriteEpochs,
  action: BrowserClientReadAction,
): SagaGenerator<void> {
  if (action.type !== fetchWorkspaceBrowserClientRequested.type) return;
  const [wsId] = action.payload;
  try {
    const epoch = epochs[wsId] ?? 0;
    const result = yield* call([appClient.workspaces, appClient.workspaces.getBrowserClient], wsId);
    if ((epochs[wsId] ?? 0) !== epoch) {
      yield* put(fetchWorkspaceBrowserClientRequested(wsId));
      return;
    }
    yield* put(workspaceBrowserClientReceived(wsId, result));
  } catch (error) {
    logger.warn('workspace.getBrowserClient failed', {
      wsId,
      error: error instanceof Error ? error.message : error,
    });
  }
}

function* writeWorkspaceBrowserClient(
  epochs: PinWriteEpochs,
  action: ReturnType<typeof setWorkspaceBrowserClientRequested>,
): SagaGenerator<void> {
  const [wsId, clientId] = action.payload;
  epochs[wsId] = (epochs[wsId] ?? 0) + 1;
  try {
    const write = yield* untilWorkspaceCleanup(
      wsId,
      call([appClient.workspaces, appClient.workspaces.setBrowserClient], wsId, clientId),
    );
    if (write.cleanup) return;
    yield* put(workspaceBrowserClientReceived(wsId, write.result));
  } catch (error) {
    logger.warn('workspace.setBrowserClient failed', {
      wsId,
      clientId,
      error: error instanceof Error ? error.message : error,
    });
  } finally {
    epochs[wsId] = (epochs[wsId] ?? 0) + 1;
  }
}

function* readWorkspaceBrowserTabs(
  action: ReturnType<typeof fetchWorkspaceBrowserTabsRequested>,
): SagaGenerator<void> {
  const [wsId] = action.payload;
  try {
    for (let attempt = 0; attempt < MAX_TABS_READ_ATTEMPTS; attempt++) {
      const revision = yield* selectWorkspaceBrowserTabsRevision.effect(wsId);
      const read = yield* untilWorkspaceCleanup(
        wsId,
        call([appClient.browser, appClient.browser.listTabs], wsId),
      );
      if (read.cleanup) return;
      yield* put(workspaceBrowserTabsReceived(wsId, read.result, revision));
      if ((yield* selectWorkspaceBrowserTabsRevision.effect(wsId)) === revision) return;
    }
    logger.warn('browser.listTabs snapshot kept racing browser:tab-* events; keeping patches', {
      wsId,
    });
  } catch (error) {
    logger.warn('browser.listTabs failed', {
      wsId,
      error: error instanceof Error ? error.message : error,
    });
  }
}

async function toastError(message: string, description?: string): Promise<void> {
  try {
    const { toast } = await import('svelte-sonner');
    toast.error(message, description ? { description } : undefined);
  } catch {
    // Toasts are best-effort.
  }
}

/**
 * Forward a viewer navigation to the tab's host. The routed action envelope
 * reports a host-side failure as `success: false`; a transport error (host
 * offline, unknown tab) throws. Either way nothing local changes — the
 * mirror keeps the last canonical URL — and the user is told.
 */
function* forwardBrowserTabNavigation(
  action: ReturnType<typeof navigateBrowserTabRequested>,
): SagaGenerator<void> {
  const [tabId, url] = action.payload;
  try {
    const envelope = yield* call([appClient.browser, appClient.browser.navigateTab], tabId, url);
    if (envelope.success) return;
    logger.warn('browser.navigateTab was rejected by the host', { tabId, url, envelope });
    yield* call(toastError, m.browser_viewer_navigateFailed_error(), envelope.error);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logger.warn('browser.navigateTab failed', { tabId, url, error: message });
    yield* call(toastError, m.browser_viewer_navigateFailed_error(), message);
  }
}

function* closeRemoteBrowserTab(
  action: ReturnType<typeof closeBrowserTabRequested>,
): SagaGenerator<void> {
  const [tabId, force] = action.payload;
  try {
    yield* call(
      [appClient.browser, appClient.browser.closeTab],
      tabId,
      force ? { force } : undefined,
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logger.warn('browser.closeTab failed', { tabId, force, error: message });
    yield* call(toastError, m.browser_viewer_closeFailed_error(), message);
  }
}

function* onWorkspaceMounted(action: ReturnType<typeof workspaceMounted>): SagaGenerator<void> {
  const [wsId] = action.payload;
  if (!wsId) return;
  const ownClientId = yield* selectOwnClientId.effect();
  const liveClientsLoaded = yield* selectLiveClientsLoaded.effect();
  if (ownClientId === null || !liveClientsLoaded) yield* put(hydrateBrowserClientsRequested());
  yield* put(fetchWorkspaceBrowserClientRequested(wsId));
}

export function* browserClientsSaga(): SagaGenerator<void> {
  const pinWriteEpochs: PinWriteEpochs = {};
  yield* takeEvery(workspaceMounted, onWorkspaceMounted);
  yield* takeLatest(hydrateBrowserClientsRequested, hydrate);
  yield* takeSingleFlightInContext(
    refreshLiveClientsRequested,
    () => LIVE_CLIENTS_CONTEXT,
    readLiveClients,
  );
  yield* takeSingleFlightInContext(
    [
      fetchWorkspaceBrowserClientRequested,
      workspaceUnmounted,
      workspaceDeleted,
      removeWorkspaceEntity,
    ],
    browserClientReadContext,
    readWorkspaceBrowserClient,
    pinWriteEpochs,
  );
  yield* takeLatestByWorkspace(
    setWorkspaceBrowserClientRequested,
    writeWorkspaceBrowserClient,
    pinWriteEpochs,
  );
  yield* takeLatestByWorkspace(fetchWorkspaceBrowserTabsRequested, readWorkspaceBrowserTabs);
  yield* takeEvery(navigateBrowserTabRequested, forwardBrowserTabNavigation);
  yield* takeEvery(closeBrowserTabRequested, closeRemoteBrowserTab);
}
