import { principalReceived } from '../../principal/principal-slice';
import { selectPrincipalActionContext } from '../../principal/principal-selectors';
import {
  queueBrowserClientEvent,
  startBrowserClientEvent,
  completeBrowserClientEvent,
  cancelBrowserClientEvents,
  isBrowserClientEvent,
} from './browser-client-event-receipt';
/**
 * Browser Clients Saga (renderer)
 *
 * Wire I/O for the REV-2 browser-client mirror: the confirmed own-clientId observation
 * and `client.list` on hydrate, single-flight coalesced `client.list`
 * re-reads on `refreshLiveClientsRequested` (the bridge dispatches it for
 * every `client:connected` / `client:disconnected`, so a reconnect burst
 * collapses into one in-flight read plus at most one trailing read; each
 * such presence refresh also requests the mounted workspaces' daemon
 * browser-client resolution, since the pin or default may now resolve
 * differently), and the per-workspace `workspace.getBrowserClient` /
 * `setBrowserClient` calls keyed by workspace. Every
 * resolution read — mount, `workspace:updated`, presence — goes through one
 * single-flight lane per workspace (one in flight, at most one trailing), and
 * a read that overlapped a pin write in any way (started before it, or
 * during it and settled after) discards its reply and re-queues itself, so an
 * older read can never overwrite the write's echo or a newer read. Pin writes
 * are latest-wins per workspace, so a slow earlier pin write
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
import { rendererEventRecovery } from '$features/events/renderer-event-recovery';
import {
  getRecoveryAdmission,
  getRecoveryLifetime,
  withRecoveryLifetime,
} from '../../../middlewares/event-recovery';
import { BrowserClientRecovery, browserClientRecoveryKey } from './browser-client-recovery';
import { eventChannel, buffers } from 'redux-saga';
import { onBackendReconnected } from '$lib/client/live/backend-transport';
import { invalidateOwnClientId } from '$lib/client/live/live-clients-client';
import { connectionStatusChanged } from '../../daemon-health/daemon-health-slice';
import { appClient } from '$lib/client';
import { createLogger } from '$lib/utils/client-logger';
import { m } from '$shared/paraglide/messages.js';
import { call, put, race, take, takeEvery, fork, type SagaGenerator } from 'typed-redux-saga';

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
import { selectLiveClientsLoaded, selectOwnClientIdConfirmed } from '../browser-clients-selectors';
import {
  closeBrowserTabRequested,
  fetchWorkspaceBrowserClientRequested,
  hydrateBrowserClientsRequested,
  liveClientsReceived,
  browserConnectionInvalidated,
  navigateBrowserTabRequested,
  ownClientIdReceived,
  refreshLiveClientsRequested,
  setWorkspaceBrowserClientRequested,
  workspaceBrowserClientReceived,
  workspaceBrowserClientPinReceived,
} from '../browser-clients-slice';

const logger = createLogger('BrowserClientsSaga');
const LIVE_CLIENTS_CONTEXT = 'live-clients';
type BrowserConnection = {
  recovery: BrowserClientRecovery;
  epoch: number;
  nextRead: number;
  reads: Map<string, number>;
  mounted: Set<string>;
};

/**
 * Saga-local, per-workspace pin epoch, bumped when a pin write starts,
 * when it settles, and when a committed pin-change event arrives. A resolution
 * read captures it before its RPC; a different value afterwards means the pin
 * may have changed while the read
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
  if (action.type === fetchWorkspaceBrowserClientRequested.type) queueBrowserClientEvent(action);
  return action.type === fetchWorkspaceBrowserClientRequested.type
    ? wsId
    : { context: wsId, cancel: true as const };
}

/**
 * Re-reads `client.list`. A presence change (any read after the initial
 * load) can also change what the daemon resolves for a workspace — a pinned
 * client going offline, or the default falling through to another client —
 * so the mounted workspaces' `workspace.getBrowserClient` is requested too.
 * Only workspaces with an observed mount lifetime (not every
 * workspace the global `browser:tab-*` / `workspace:updated` events touched)
 * are requested, and each request joins that workspace's single-flight
 * resolution lane, so a presence burst cannot start overlapping resolution
 * calls: one read is in flight and at most one trailing read follows it.
 */
function* readLiveClients(
  connection: BrowserConnection,
  action:
    | ReturnType<typeof refreshLiveClientsRequested>
    | ReturnType<typeof workspaceUnmounted>
    | ReturnType<typeof workspaceDeleted>
    | ReturnType<typeof removeWorkspaceEntity>,
): SagaGenerator<void> {
  if (action.type !== refreshLiveClientsRequested.type) return;
  startBrowserClientEvent(action);
  const epoch = connection.epoch;
  try {
    // An admitted global event owns only the global roster. The bridge sends
    // separate receipts to mounted workspaces; never reuse this token for them.
    const mounted = action.payload[0]
      ? [action.payload[0]]
      : isBrowserClientEvent(action)
        ? []
        : [...connection.mounted];
    if (mounted.length === 0) {
      connection.recovery.ensure();
      if (connection.recovery.stale()) return;
      const admission = getRecoveryAdmission(action, browserClientRecoveryKey());
      if (admission === null) return;
      const receipt =
        admission ??
        getRecoveryLifetime(action) ??
        rendererEventRecovery.capture(browserClientRecoveryKey());
      const read = yield* race({
        clients: call([appClient.clients, appClient.clients.list]),
        invalidated: take(browserConnectionInvalidated),
      });
      if (
        read.clients !== undefined &&
        epoch === connection.epoch &&
        receipt.commit(() => undefined)
      )
        yield* put(withRecoveryLifetime(liveClientsReceived(read.clients), receipt));
    }
    // Own every target before awaiting another workspace. Cleanup/remount must
    // invalidate queued targets as well as requests already in flight.
    const targets = mounted.map((wsId) => {
      const version = ++connection.nextRead;
      connection.reads.set(wsId, version);
      return { wsId, version };
    });
    for (const { wsId, version } of targets) {
      if (epoch !== connection.epoch || connection.reads.get(wsId) !== version) continue;
      connection.recovery.ensure(wsId);
      if (connection.recovery.stale(wsId)) continue;
      const admission = getRecoveryAdmission(action, browserClientRecoveryKey(wsId));
      if (admission === null) continue;
      const receipt =
        admission ??
        getRecoveryLifetime(action) ??
        rendererEventRecovery.capture(browserClientRecoveryKey(wsId));
      const presenceChange = yield* selectLiveClientsLoaded.effect(wsId);
      const read = yield* untilWorkspaceCleanup(
        wsId,
        call([appClient.clients, appClient.clients.list], wsId),
      );
      if (
        read.cleanup ||
        epoch !== connection.epoch ||
        connection.reads.get(wsId) !== version ||
        !receipt.commit(() => undefined)
      )
        continue;
      yield* put(withRecoveryLifetime(liveClientsReceived(read.result, wsId), receipt));
      if (presenceChange && !isBrowserClientEvent(action))
        yield* put(fetchWorkspaceBrowserClientRequested(wsId));
    }
  } catch (error) {
    logger.warn('client.list failed', { error: error instanceof Error ? error.message : error });
  } finally {
    completeBrowserClientEvent(action);
  }
}

function* readOwnClientId(connection: { epoch: number }): SagaGenerator<void> {
  const epoch = connection.epoch;
  const receipt = rendererEventRecovery.capture('browser-identity');
  const authority = yield* selectPrincipalActionContext.effect();
  try {
    const result = yield* race({
      clientId: call([appClient.clients, appClient.clients.ownClientId]),
      invalidated: take(browserConnectionInvalidated),
    });
    if (
      result.clientId !== undefined &&
      epoch === connection.epoch &&
      receipt.commit(() => undefined) &&
      authority === (yield* selectPrincipalActionContext.effect())
    )
      yield* put(withRecoveryLifetime(ownClientIdReceived(result.clientId), receipt));
  } catch (error) {
    logger.warn('own clientId observation failed', {
      error: error instanceof Error ? error.message : error,
    });
  }
}

function* hydrate(
  connection: { epoch: number },
  action: ReturnType<typeof hydrateBrowserClientsRequested>,
): SagaGenerator<void> {
  const epoch = connection.epoch;
  yield* call(readOwnClientId, connection);
  if (epoch !== connection.epoch) return;
  yield* put(
    action.payload[0]
      ? refreshLiveClientsRequested(action.payload[0])
      : refreshLiveClientsRequested(),
  );
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
  const outcome = yield* race({
    result: request,
    cleanup: take(matchesWorkspaceCleanup(wsId)),
    invalidated: take(browserConnectionInvalidated),
  });
  return outcome.cleanup || outcome.invalidated
    ? { cleanup: true }
    : { result: outcome.result as T };
}

/**
 * One resolution read. Runs inside the workspace's single-flight lane, so it
 * never overlaps another read of the same workspace, and the lane's teardown
 * cancel abandons it mid-RPC. A pin write that started or settled mid-read
 * makes the reply stale: it is dropped and the read re-queued as the lane's
 * trailing run, which then observes the daemon state after the write.
 */
function* readWorkspaceBrowserClient(
  recovery: BrowserClientRecovery,
  epochs: PinWriteEpochs,
  action: BrowserClientReadAction,
): SagaGenerator<void> {
  if (action.type !== fetchWorkspaceBrowserClientRequested.type) return;
  startBrowserClientEvent(action);
  try {
    const [wsId] = action.payload;
    recovery.ensure(wsId);
    if (recovery.stale(wsId)) return;
    const admission = getRecoveryAdmission(action, browserClientRecoveryKey(wsId));
    if (admission === null) return;
    const receipt =
      admission ??
      getRecoveryLifetime(action) ??
      rendererEventRecovery.capture(browserClientRecoveryKey(wsId));
    try {
      const epoch = epochs[wsId] ?? 0;
      // The lane owns workspace teardown; racing it here would release a queued
      // trailing read before the lane processes its cancellation action.
      const read = yield* race({
        result: call([appClient.workspaces, appClient.workspaces.getBrowserClient], wsId),
        invalidated: take(browserConnectionInvalidated),
      });
      if (read.result === undefined) return;
      const result = read.result;
      if ((epochs[wsId] ?? 0) !== epoch) {
        yield* put(fetchWorkspaceBrowserClientRequested(wsId));
        return;
      }
      if (receipt.commit(() => undefined))
        yield* put(withRecoveryLifetime(workspaceBrowserClientReceived(wsId, result), receipt));
    } catch (error) {
      logger.warn('workspace.getBrowserClient failed', {
        wsId,
        error: error instanceof Error ? error.message : error,
      });
    }
  } finally {
    completeBrowserClientEvent(action);
  }
}

function* writeWorkspaceBrowserClient(
  recovery: BrowserClientRecovery,
  epochs: PinWriteEpochs,
  action: ReturnType<typeof setWorkspaceBrowserClientRequested>,
): SagaGenerator<void> {
  const [wsId, clientId] = action.payload;
  recovery.ensure(wsId);
  const key = browserClientRecoveryKey(wsId);
  rendererEventRecovery.push(key);
  const receipt = rendererEventRecovery.capture(key);
  let settled = false;
  epochs[wsId] = (epochs[wsId] ?? 0) + 1;
  const epoch = epochs[wsId];
  try {
    const write = yield* untilWorkspaceCleanup(
      wsId,
      call([appClient.workspaces, appClient.workspaces.setBrowserClient], wsId, clientId),
    );
    if (write.cleanup) return;
    settled = true;
    if (epochs[wsId] !== epoch) {
      yield* put(fetchWorkspaceBrowserClientRequested(wsId));
      return;
    }
    if (receipt.commit(() => undefined))
      yield* put(withRecoveryLifetime(workspaceBrowserClientReceived(wsId, write.result), receipt));
    else if (rendererEventRecovery.capture(key).key === receipt.key)
      rendererEventRecovery.invalidate(key);
  } catch (error) {
    logger.warn('workspace.setBrowserClient failed', {
      wsId,
      clientId,
      error: error instanceof Error ? error.message : error,
    });
  } finally {
    if (
      !settled &&
      rendererEventRecovery.capture(key).key === receipt.key &&
      !receipt.commit(() => undefined)
    )
      rendererEventRecovery.invalidate(key);
    epochs[wsId] = (epochs[wsId] ?? 0) + 1;
  }
}

async function toastError(message: string, description?: string): Promise<void> {
  try {
    const { notify } = await import('$lib/components/patterns/notify');
    notify.error(message, description ? { description } : undefined);
  } catch {
    // Toasts are best-effort.
  }
}

/**
 * Forward a viewer navigation to the tab's host. The routed action envelope
 * reports a host-side failure as `success: false`; a transport error (host
 * offline, unknown tab) throws. Either way nothing is stored — the canonical
 * URL follows the host's echo — the user is told, and the action's promise
 * rejects so the mirror can reload the canonical URL the host stayed on.
 */
function* forwardBrowserTabNavigation(
  action: ReturnType<typeof navigateBrowserTabRequested>,
): SagaGenerator<void> {
  const [tabId, url] = action.payload;
  try {
    const envelope = yield* call([appClient.browser, appClient.browser.navigateTab], tabId, url);
    if (envelope.success) {
      yield* put(action.success(undefined as never));
      return;
    }
    logger.warn('browser.navigateTab was rejected by the host', { tabId, url, envelope });
    yield* call(toastError, m.browser_viewer_navigateFailed_error(), envelope.error);
    yield* put(action.failure(new Error(envelope.error ?? 'browser.navigateTab rejected')));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logger.warn('browser.navigateTab failed', { tabId, url, error: message });
    yield* call(toastError, m.browser_viewer_navigateFailed_error(), message);
    yield* put(action.failure(error instanceof Error ? error : new Error(message)));
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
  const ownClientIdConfirmed = yield* selectOwnClientIdConfirmed.effect();
  if (!ownClientIdConfirmed) yield* put(hydrateBrowserClientsRequested(wsId));
  else yield* put(refreshLiveClientsRequested(wsId));
  yield* put(fetchWorkspaceBrowserClientRequested(wsId));
}

function* watchClientConnection(connection: BrowserConnection) {
  const channel = eventChannel<true>(
    (emit) =>
      onBackendReconnected(() => {
        connection.epoch++;
        invalidateOwnClientId();
        emit(true);
      }),
    buffers.sliding(1),
  );
  try {
    while (true) {
      yield* take(channel);
      yield* put(browserConnectionInvalidated());
      yield* put(hydrateBrowserClientsRequested());
      for (const wsId of connection.mounted) yield* put(fetchWorkspaceBrowserClientRequested(wsId));
    }
  } finally {
    channel.close();
  }
}

export function* browserClientsSaga(): SagaGenerator<void> {
  const recovery = new BrowserClientRecovery();
  try {
    const pinWriteEpochs: PinWriteEpochs = {};
    // A committed server event wins over reads and write echoes already in flight.
    yield* takeEvery(workspaceBrowserClientPinReceived, function* (action) {
      const [wsId] = action.payload;
      pinWriteEpochs[wsId] = (pinWriteEpochs[wsId] ?? 0) + 1;
    });
    // Warm phases are cleared on reconnect even while a workspace stays mounted.
    // Keep the mount lifetime independently; never infer it from cached tab rows.
    const connection: BrowserConnection = {
      recovery,
      epoch: 0,
      nextRead: 0,
      reads: new Map(),
      mounted: new Set(yield* selectMountedWorkspaceIds.effect()),
    };
    let admittedAuthority = yield* selectPrincipalActionContext.effect();
    yield* takeEvery(principalReceived, function* () {
      const authority = yield* selectPrincipalActionContext.effect();
      if (!authority || authority === admittedAuthority) return;
      admittedAuthority = authority;
      // Reads started before principal admission cannot publish into it. Rebind
      // the owners and replace those discarded reads once authority is ready.
      connection.epoch++;
      invalidateOwnClientId();
      yield* put(browserConnectionInvalidated());
      recovery.rebind();
      if (connection.mounted.size === 0) return;
      yield* put(hydrateBrowserClientsRequested());
      for (const wsId of connection.mounted) yield* put(fetchWorkspaceBrowserClientRequested(wsId));
    });
    yield* takeEvery(workspaceMounted, function* (action) {
      connection.mounted.add(action.payload[0]);
      recovery.ensure(action.payload[0]);
    });
    yield* takeEvery(
      [workspaceUnmounted, workspaceDeleted, removeWorkspaceEntity],
      function* (action) {
        recovery.remove(action.payload[0]);
        cancelBrowserClientEvents(action.payload[0]);
        connection.reads.delete(action.payload[0]);
        connection.mounted.delete(action.payload[0]);
      },
    );
    yield* takeEvery(connectionStatusChanged, function* (action) {
      if (action.payload[0] === 'connected') {
        // First connect has no reconnect marker. A delayed startup status may
        // have canceled admission; metadata for an admitted connection is a no-op.
        if (connection.mounted.size > 0 && !(yield* selectOwnClientIdConfirmed.effect())) {
          yield* put(hydrateBrowserClientsRequested());
          for (const wsId of connection.mounted)
            yield* put(fetchWorkspaceBrowserClientRequested(wsId));
        }
        return;
      }
      connection.epoch++;
      invalidateOwnClientId();
      yield* put(browserConnectionInvalidated());
    });
    yield* fork(watchClientConnection, connection);
    yield* takeEvery(workspaceMounted, onWorkspaceMounted);
    yield* takeSingleFlightInContext(
      hydrateBrowserClientsRequested,
      (action) => action.payload[0] ?? LIVE_CLIENTS_CONTEXT,
      hydrate,
      connection,
    );
    yield* takeSingleFlightInContext(
      [refreshLiveClientsRequested, workspaceUnmounted, workspaceDeleted, removeWorkspaceEntity],
      (action) => {
        // Account for every arrival before this lane coalesces its trailing read.
        if (action.type === refreshLiveClientsRequested.type) queueBrowserClientEvent(action);
        return action.type === refreshLiveClientsRequested.type
          ? (action.payload[0] ?? LIVE_CLIENTS_CONTEXT)
          : { context: action.payload[0] ?? LIVE_CLIENTS_CONTEXT, cancel: true as const };
      },
      readLiveClients,
      connection,
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
      recovery,
      pinWriteEpochs,
    );
    yield* takeLatestByWorkspace(
      setWorkspaceBrowserClientRequested,
      writeWorkspaceBrowserClient,
      recovery,
      pinWriteEpochs,
    );
    yield* takeEvery(navigateBrowserTabRequested, forwardBrowserTabNavigation);
    yield* takeEvery(closeBrowserTabRequested, closeRemoteBrowserTab);
    // Keep session factories alive for the root lifetime.
    yield* take(() => false);
  } finally {
    recovery.dispose();
    cancelBrowserClientEvents();
  }
}
