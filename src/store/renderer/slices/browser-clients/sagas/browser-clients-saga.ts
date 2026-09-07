/**
 * Browser Clients Saga (renderer)
 *
 * Wire I/O for the REV-2 browser-client mirror: the own-clientId hello probe
 * and `client.list` on hydrate, single-flight coalesced `client.list`
 * re-reads on `refreshLiveClientsRequested` (the bridge dispatches it for
 * every `client:connected` / `client:disconnected`, so a reconnect burst
 * collapses into one in-flight read plus at most one trailing read), and the
 * per-workspace `workspace.getBrowserClient` / `setBrowserClient` /
 * `browser.listTabs` reads keyed by workspace.
 */
import { appClient } from '$lib/client';
import { createLogger } from '$lib/utils/client-logger';
import { call, put, takeEvery, takeLatest, type SagaGenerator } from 'typed-redux-saga';

import {
  takeLatestByWorkspace,
  takeSingleFlightInContext,
} from '../../../utils/context-saga-effects';
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

function* readLiveClients(): SagaGenerator<void> {
  try {
    const clients = yield* call([appClient.clients, appClient.clients.list]);
    yield* put(liveClientsReceived(clients));
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

function* readWorkspaceBrowserClient(
  action: ReturnType<typeof fetchWorkspaceBrowserClientRequested>,
): SagaGenerator<void> {
  const [wsId] = action.payload;
  try {
    const browserClient = yield* call(
      [appClient.workspaces, appClient.workspaces.getBrowserClient],
      wsId,
    );
    yield* put(workspaceBrowserClientReceived(wsId, browserClient));
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
    const browserClient = yield* call(
      [appClient.workspaces, appClient.workspaces.setBrowserClient],
      wsId,
      clientId,
    );
    yield* put(workspaceBrowserClientReceived(wsId, browserClient));
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
    const tabs = yield* call([appClient.browser, appClient.browser.listTabs], wsId);
    yield* put(workspaceBrowserTabsReceived(wsId, tabs));
  } catch (error) {
    logger.warn('browser.listTabs failed', {
      wsId,
      error: error instanceof Error ? error.message : error,
    });
  }
}

export function* browserClientsSaga(): SagaGenerator<void> {
  yield* takeLatest(hydrateBrowserClientsRequested, hydrate);
  yield* takeSingleFlightInContext(
    refreshLiveClientsRequested,
    () => LIVE_CLIENTS_CONTEXT,
    readLiveClients,
  );
  yield* takeLatestByWorkspace(fetchWorkspaceBrowserClientRequested, readWorkspaceBrowserClient);
  yield* takeEvery(setWorkspaceBrowserClientRequested, writeWorkspaceBrowserClient);
  yield* takeLatestByWorkspace(fetchWorkspaceBrowserTabsRequested, readWorkspaceBrowserTabs);
}
