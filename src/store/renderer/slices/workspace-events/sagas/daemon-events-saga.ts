import { END, buffers, eventChannel, type EventChannel } from 'redux-saga';
import { call, fork, put, take } from 'typed-redux-saga';

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
import { setActiveWorkspaceId } from '../../workspace/workspace-slice';
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

/** Subscribe the scoped `file:*` lease for the active workspace; no-op when none is active. */
function* subscribeScopedFileEventsForActiveWorkspace(leases: DaemonEventLeases) {
  const activeWorkspaceId = yield* selectActiveWorkspaceId.effect();
  if (!activeWorkspaceId) return;
  yield* call(subscribeScopedFileEvents, leases.scopedFile, String(activeWorkspaceId));
}

/**
 * Re-issue the scoped `file:*` subscribe on every workspace switch. The §6.1
 * `replaceGroup` atomically replaces the daemon-side subscription, so the only
 * local bookkeeping is the lease swap: the old lease is retired (a subscribe
 * still in flight unsubscribes its own late-arriving id) and a fresh lease
 * takes the slot.
 */
function* watchActiveWorkspaceForFileEvents(leases: DaemonEventLeases) {
  while (true) {
    const action = yield* take(setActiveWorkspaceId);
    const [workspaceId] = action.payload;
    leases.scopedFile.cancelled = true;
    leases.scopedFile = { cancelled: false };
    yield* call(subscribeScopedFileEvents, leases.scopedFile, workspaceId);
  }
}

export function* daemonEventsSaga() {
  const channel = createDaemonEventsChannel();
  const leases: DaemonEventLeases = {
    firehose: { cancelled: false },
    scopedFile: { cancelled: false },
  };
  try {
    // Listener-first closes the subscribe/fetch race; the expanding channel
    // retains every notification until the server-assigned id is available.
    yield* call(subscribeFirehose, leases.firehose);
    yield* call(subscribeScopedFileEventsForActiveWorkspace, leases);
    yield* fork(watchActiveWorkspaceForFileEvents, leases);
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
      // the old leases, subscribe again (RESUB-1 replays BOTH the firehose and
      // the scoped file lease), then converge snapshots.
      yield* call(unsubscribeLease, leases.firehose);
      yield* call(unsubscribeLease, leases.scopedFile);
      leases.firehose = { cancelled: false };
      leases.scopedFile = { cancelled: false };
      yield* call(subscribeFirehose, leases.firehose);
      yield* call(subscribeScopedFileEventsForActiveWorkspace, leases);
      yield* call(refreshDaemonEventsAfterReconnect);
    }
  } finally {
    channel.close();
    disposeDaemonEventsRoutingState();
    yield* call(unsubscribeAllLeases, leases);
  }
}
