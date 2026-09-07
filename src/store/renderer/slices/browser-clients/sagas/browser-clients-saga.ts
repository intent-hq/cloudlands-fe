/**
 * Browser Clients Saga (renderer)
 *
 * Wire I/O for the REV-2 browser-client mirror: the own-clientId hello probe
 * and `client.list` on hydrate, single-flight coalesced `client.list`
 * re-reads on `refreshLiveClientsRequested` (the bridge dispatches it for
 * every `client:connected` / `client:disconnected`, so a reconnect burst
 * collapses into one in-flight read plus at most one trailing read; each
 * such presence refresh also re-reads the mounted workspaces' daemon
 * browser-client resolution, since the pin or default may now resolve
 * differently), and the
 * per-workspace `workspace.getBrowserClient` / `setBrowserClient` /
 * `browser.listTabs` reads keyed by workspace (latest wins per workspace, so
 * a slow earlier pin write cannot overwrite a later daemon echo). A workspace
 * mount reads its browser client (the sidebar indicator's input) and, until
 * the own clientId and `client.list` are known, hydrates them once. Every
 * per-workspace call races the workspace's teardown (`workspaceUnmounted` /
 * `workspaceDeleted` / `removeWorkspaceEntity`): a reply that lands after the
 * reducer cleared the entry is dropped, so it can neither resurrect a deleted
 * workspace nor leak into a later remount.
 */
import { appClient } from '$lib/client';
import { createLogger } from '$lib/utils/client-logger';
import { call, put, race, take, takeEvery, takeLatest, type SagaGenerator } from 'typed-redux-saga';

import {
  takeLatestByWorkspace,
  takeSingleFlightInContext,
} from '../../../utils/context-saga-effects';
import { removeWorkspaceEntity } from '../../workspace/workspace-slice';
import {
  workspaceDeleted,
  workspaceMounted,
  workspaceUnmounted,
} from '../../workspace-lifecycle/workspace-lifecycle-slice';
import {
  selectLiveClientsLoaded,
  selectOwnClientId,
  selectTrackedBrowserClientWorkspaceIds,
  selectWorkspaceBrowserTabsRevision,
} from '../browser-clients-selectors';
import {
  fetchWorkspaceBrowserClientRequested,
  fetchWorkspaceBrowserTabsRequested,
  hydrateBrowserClientsRequested,
  liveClientsReceived,
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
 * Re-reads `client.list`. A presence change (any read after the initial
 * load) can also change what the daemon resolves for a workspace — a pinned
 * client going offline, or the default falling through to another client —
 * so the mounted workspaces' `workspace.getBrowserClient` is re-read too.
 * Only tracked (mounted) workspaces are re-read, never every stored one, and
 * each re-read keeps the per-workspace latest-wins and teardown protection.
 */
function* readLiveClients(): SagaGenerator<void> {
  try {
    const presenceChange = yield* selectLiveClientsLoaded.effect();
    const clients = yield* call([appClient.clients, appClient.clients.list]);
    yield* put(liveClientsReceived(clients));
    if (!presenceChange) return;
    for (const wsId of yield* selectTrackedBrowserClientWorkspaceIds.effect()) {
      yield* put(fetchWorkspaceBrowserClientRequested(wsId));
    }
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

function* readWorkspaceBrowserClient(
  action: ReturnType<typeof fetchWorkspaceBrowserClientRequested>,
): SagaGenerator<void> {
  const [wsId] = action.payload;
  try {
    const read = yield* untilWorkspaceCleanup(
      wsId,
      call([appClient.workspaces, appClient.workspaces.getBrowserClient], wsId),
    );
    if (read.cleanup) return;
    yield* put(workspaceBrowserClientReceived(wsId, read.result));
  } catch (error) {
    logger.warn('workspace.getBrowserClient failed', {
      wsId,
      error: error instanceof Error ? error.message : error,
    });
  }
}

function* writeWorkspaceBrowserClient(
  action: ReturnType<typeof setWorkspaceBrowserClientRequested>,
): SagaGenerator<void> {
  const [wsId, clientId] = action.payload;
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

function* onWorkspaceMounted(action: ReturnType<typeof workspaceMounted>): SagaGenerator<void> {
  const [wsId] = action.payload;
  if (!wsId) return;
  const ownClientId = yield* selectOwnClientId.effect();
  const liveClientsLoaded = yield* selectLiveClientsLoaded.effect();
  if (ownClientId === null || !liveClientsLoaded) yield* put(hydrateBrowserClientsRequested());
  yield* put(fetchWorkspaceBrowserClientRequested(wsId));
}

export function* browserClientsSaga(): SagaGenerator<void> {
  yield* takeEvery(workspaceMounted, onWorkspaceMounted);
  yield* takeLatest(hydrateBrowserClientsRequested, hydrate);
  yield* takeSingleFlightInContext(
    refreshLiveClientsRequested,
    () => LIVE_CLIENTS_CONTEXT,
    readLiveClients,
  );
  yield* takeLatestByWorkspace(fetchWorkspaceBrowserClientRequested, readWorkspaceBrowserClient);
  yield* takeLatestByWorkspace(setWorkspaceBrowserClientRequested, writeWorkspaceBrowserClient);
  yield* takeLatestByWorkspace(fetchWorkspaceBrowserTabsRequested, readWorkspaceBrowserTabs);
}
