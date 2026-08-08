import { END, buffers, eventChannel, type EventChannel } from 'redux-saga';
import { call, put, take } from 'typed-redux-saga';

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

const logger = createLogger('DaemonEventsSaga');

type DaemonChannelMessage =
  | { kind: 'notification'; notification: BackendNotification }
  | { kind: 'reconnected' };

interface SubscriptionLease {
  subscriptionId?: string;
  cancelled: boolean;
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

async function subscribeFirehose(lease: SubscriptionLease): Promise<void> {
  try {
    const result = await backendSubscribe<{ subscriptionId?: string }>({
      eventTypes: [...DAEMON_EVENTS_SUBSCRIBE_TYPES],
    });
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

async function unsubscribeFirehose(lease: SubscriptionLease): Promise<void> {
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

export function* daemonEventsSaga() {
  const channel = createDaemonEventsChannel();
  let lease: SubscriptionLease = { cancelled: false };
  try {
    // Listener-first closes the subscribe/fetch race; the expanding channel
    // retains every notification until the server-assigned id is available.
    yield* call(subscribeFirehose, lease);
    while (true) {
      const message: DaemonChannelMessage = yield* take(channel);
      if (message === (END as unknown as DaemonChannelMessage)) break;
      if (message.kind === 'notification') {
        const { method, params } = message.notification;
        let settingsChanges: AppliedSettingChange[] | undefined;
        yield* call(
          routeDaemonEventsNotification,
          method,
          params,
          lease.subscriptionId,
          {
            onSettingsChanges: (changes: AppliedSettingChange[]) => {
              settingsChanges = changes;
            },
          },
        );
        if (settingsChanges) yield* put(settingsChangesReceived(settingsChanges));
        continue;
      }

      // The daemon drops per-connection subscriptions on disconnect. Dispose
      // the old lease, subscribe again, then converge snapshots.
      yield* call(unsubscribeFirehose, lease);
      lease = { cancelled: false };
      yield* call(subscribeFirehose, lease);
      yield* call(refreshDaemonEventsAfterReconnect);
    }
  } finally {
    channel.close();
    disposeDaemonEventsRoutingState();
    yield* call(unsubscribeFirehose, lease);
  }
}