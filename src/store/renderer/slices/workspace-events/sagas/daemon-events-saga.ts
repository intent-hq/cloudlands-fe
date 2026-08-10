import {
  END,
  buffers,
  channel as sagaChannel,
  eventChannel,
  type Channel,
  type EventChannel,
} from 'redux-saga';
import { call, cancel, fork, put, race, take } from 'typed-redux-saga';
import { createChannelFromSelector } from '@augmentcode/themis/saga';

import type { AppliedSettingChange } from '$lib/client/app-client';
import type { BackendNotification } from '$lib/client/live/backend-transport';
import {
  backendSubscribe,
  backendUnsubscribe,
  onBackendNotification,
  onBackendReconnected,
} from '$lib/client/live/backend-transport';
import {
  DAEMON_EVENTS_SUBSCRIBE_TYPES,
  disposeDaemonEventsRoutingState,
  refreshDaemonEventsAfterReconnect,
  routeDaemonEventsNotification,
} from '$features/events/daemon-events-bridge.client';
import { createLogger } from '$lib/utils/client-logger';
import { settingsChangesReceived } from '$store/renderer/slices/settings-events/settings-events-slice';
import { selectActiveWorkspaceId } from '../../workspace/workspace-selectors';

const logger = createLogger('DaemonEventsSaga');

/**
 * §6.1 replaceGroup key for the active-workspace-scoped `file:*` subscription
 * (monorepo#1853): each re-subscribe atomically replaces the previous scope on
 * the same connection, so a workspace switch never leaks a subscription.
 */
export const FILE_EVENTS_REPLACE_GROUP = 'file-events';

/**
 * Event types of the scoped subscription — the `file:*` family deliberately
 * removed from the global `DAEMON_EVENTS_SUBSCRIBE_TYPES` firehose so watcher
 * bursts from inactive workspaces never reach this window.
 */
export const FILE_EVENTS_SUBSCRIBE_TYPES = ['file:*'] as const;

type DaemonChannelMessage =
  { kind: 'notification'; notification: BackendNotification } | { kind: 'reconnected' };

interface SubscriptionLease {
  subscriptionId?: string;
  cancelled: boolean;
}

/**
 * The saga's two subscriptions on the socket: the global firehose and the
 * active-workspace-scoped `file:*` lease. Held in a shared mutable holder so
 * the notification loop and the active-workspace watcher see lease swaps.
 */
interface DaemonEventLeases {
  firehose: SubscriptionLease;
  scopedFile: SubscriptionLease;
}

export function createDaemonEventsChannel(): EventChannel<DaemonChannelMessage> {
  return eventChannel<DaemonChannelMessage>((emit) => {
    const offNotification = onBackendNotification((notification) => {
      emit({ kind: 'notification', notification });
    });
    const offReconnect = onBackendReconnected(() => emit({ kind: 'reconnected' }));
    return () => {
      offNotification();
      offReconnect();
    };
  }, buffers.expanding<DaemonChannelMessage>());
}

async function subscribeLease(
  lease: SubscriptionLease,
  params: Record<string, unknown>,
): Promise<void> {
  try {
    const result = await backendSubscribe<{ subscriptionId?: string }>(params);
    const subscriptionId = result?.subscriptionId;
    if (typeof subscriptionId !== 'string' || subscriptionId.length === 0) {
      logger.warn('events.subscribe returned no subscriptionId', result);
      return;
    }
    if (lease.cancelled) {
      await backendUnsubscribe(subscriptionId);
      return;
    }
    lease.subscriptionId = subscriptionId;
  } catch (error) {
    logger.error('events.subscribe failed', error);
  }
}

function subscribeFirehose(lease: SubscriptionLease): Promise<void> {
  return subscribeLease(lease, { eventTypes: [...DAEMON_EVENTS_SUBSCRIBE_TYPES] });
}

function subscribeScopedFileEvents(lease: SubscriptionLease, workspaceId: string): Promise<void> {
  return subscribeLease(lease, {
    eventTypes: [...FILE_EVENTS_SUBSCRIBE_TYPES],
    workspaceId,
    replaceGroup: FILE_EVENTS_REPLACE_GROUP,
  });
}

async function unsubscribeLease(lease: SubscriptionLease): Promise<void> {
  lease.cancelled = true;
  const subscriptionId = lease.subscriptionId;
  lease.subscriptionId = undefined;
  if (!subscriptionId) return;
  try {
    await backendUnsubscribe(subscriptionId);
  } catch (error) {
    logger.warn('events.unsubscribe failed during saga cleanup', error);
  }
}

/**
 * Retire both leases in ONE blocking effect — a cancelled saga's finally block
 * only reliably runs a single blocking `call`, so the teardown must not chain
 * two sequential unsubscribe effects.
 */
function unsubscribeAllLeases(leases: DaemonEventLeases): Promise<void> {
  return Promise.all([unsubscribeLease(leases.firehose), unsubscribeLease(leases.scopedFile)]).then(
    () => undefined,
  );
}

/** Reconnect signal to the scoped-lease manager; `ack` is put once the lease has converged. */
interface ScopedLeaseReconnectSignal {
  ack: Channel<true>;
}

/** The workspace id the manager last issued a scoped subscribe (or clear) for. */
interface ScopedLeaseTracking {
  workspaceId: string | null;
}

/**
 * Drive the scoped `file:*` lease to match `selectActiveWorkspaceId`,
 * re-reading the selector after every settled wire call so a switch that
 * lands while a subscribe is in flight converges instead of stranding the
 * lease on a stale workspace. On a switch the §6.1 `replaceGroup` atomically
 * replaces the daemon-side subscription, so the only local bookkeeping is the
 * lease swap (a subscribe still in flight unsubscribes its own late-arriving
 * id); on a clear there is no replacing subscribe, so the lease must be
 * explicitly unsubscribed.
 */
function* convergeScopedFileLease(leases: DaemonEventLeases, tracking: ScopedLeaseTracking) {
  while (true) {
    const activeWorkspaceId = yield* selectActiveWorkspaceId.effect();
    const desired = activeWorkspaceId ? String(activeWorkspaceId) : null;
    if (desired === tracking.workspaceId) return;
    tracking.workspaceId = desired;
    if (desired === null) {
      const lease = leases.scopedFile;
      leases.scopedFile = { cancelled: false };
      yield* call(unsubscribeLease, lease);
    } else {
      leases.scopedFile.cancelled = true;
      leases.scopedFile = { cancelled: false };
      yield* call(subscribeScopedFileEvents, leases.scopedFile, desired);
    }
  }
}

/**
 * Single writer for `leases.scopedFile`: workspace selection changes, the
 * startup selection, and reconnect replays are all serialized through this
 * one task so two subscribes can never race on the same lease. The selector
 * channel (store convention: react to selector changes, not raw actions)
 * wakes the loop on ANY reducer that moves `activeWorkspaceId` — switch,
 * clear, terminal-overlay open, workspace deletion, state reset. Emissions
 * that land while a wire call is in flight are absorbed by re-reading the
 * selector inside `convergeScopedFileLease` after every settled call, so a
 * selection can converge late but can never be dropped.
 */
function* manageScopedFileLease(
  leases: DaemonEventLeases,
  reconnectSignals: Channel<ScopedLeaseReconnectSignal>,
) {
  const selectionChannel = yield* createChannelFromSelector(selectActiveWorkspaceId);
  const tracking: ScopedLeaseTracking = { workspaceId: null };
  try {
    yield* call(convergeScopedFileLease, leases, tracking);
    while (true) {
      const { reconnect } = yield* race({
        selection: take(selectionChannel),
        reconnect: take(reconnectSignals),
      });
      if (reconnect) {
        // The daemon dropped the subscription with the connection; retire the
        // stale lease and force a fresh subscribe for the current workspace.
        const staleLease = leases.scopedFile;
        leases.scopedFile = { cancelled: false };
        tracking.workspaceId = null;
        yield* call(unsubscribeLease, staleLease);
      }
      yield* call(convergeScopedFileLease, leases, tracking);
      if (reconnect) yield* put(reconnect.ack, true);
    }
  } finally {
    selectionChannel.close();
  }
}

export function* daemonEventsSaga() {
  const channel = createDaemonEventsChannel();
  const leases: DaemonEventLeases = {
    firehose: { cancelled: false },
    scopedFile: { cancelled: false },
  };
  const reconnectSignals = sagaChannel<ScopedLeaseReconnectSignal>();
  let managerTask;
  try {
    // The scoped-lease manager forks BEFORE the awaited firehose subscribe:
    // its selector channel and converge loop observe selections from fork
    // time, closing the startup window where a selection dispatched during
    // the initial subscribe round-trip was lost.
    managerTask = yield* fork(manageScopedFileLease, leases, reconnectSignals);
    // Listener-first closes the subscribe/fetch race; the expanding channel
    // retains every notification until the server-assigned id is available.
    yield* call(subscribeFirehose, leases.firehose);
    while (true) {
      const message: DaemonChannelMessage = yield* take(channel);
      if (message === (END as unknown as DaemonChannelMessage)) break;
      if (message.kind === 'notification') {
        const { method, params } = message.notification;
        const expectedSubscriptionIds = [
          leases.firehose.subscriptionId,
          leases.scopedFile.subscriptionId,
        ].filter((id): id is string => typeof id === 'string');
        let settingsChanges: AppliedSettingChange[] | undefined;
        yield* call(routeDaemonEventsNotification, method, params, expectedSubscriptionIds, {
          onSettingsChanges: (changes: AppliedSettingChange[]) => {
            settingsChanges = changes;
          },
        });
        if (settingsChanges) yield* put(settingsChangesReceived(settingsChanges));
        continue;
      }

      // The daemon drops per-connection subscriptions on disconnect. Dispose
      // the old firehose lease and subscribe it again, signal the scoped-lease
      // manager to replay its lease (RESUB-1 replays BOTH), and only then —
      // after the manager acks — converge snapshots.
      yield* call(unsubscribeLease, leases.firehose);
      leases.firehose = { cancelled: false };
      const ack = sagaChannel<true>();
      yield* put(reconnectSignals, { ack });
      yield* call(subscribeFirehose, leases.firehose);
      yield* take(ack);
      yield* call(refreshDaemonEventsAfterReconnect);
    }
  } finally {
    channel.close();
    // Cancel the manager BEFORE closing its signal channel: closing a channel
    // a forked task is still racing on during parent cancellation live-locks
    // the saga runtime. `cancel` is non-blocking, so the single reliably-run
    // blocking effect of a cancelled finally stays `unsubscribeAllLeases`.
    if (managerTask) yield* cancel(managerTask);
    reconnectSignals.close();
    disposeDaemonEventsRoutingState();
    yield* call(unsubscribeAllLeases, leases);
  }
}
