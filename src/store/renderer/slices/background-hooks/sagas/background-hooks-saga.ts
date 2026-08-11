import { END, buffers, channel as createChannel, type Channel } from 'redux-saga';
import { call, put, take, takeEvery, type SagaGenerator } from 'typed-redux-saga';

import {
  backendSubscribe,
  backendUnsubscribe,
  onBackendNotification,
  onBackendReconnected,
  type BackendNotification,
} from '$lib/client/live/backend-transport';
import { createLogger } from '$lib/utils/client-logger';
import {
  cancelHook,
  foldHookEvent,
  listHooks,
  runHookNow,
  type BackgroundHook,
  type HookEventData,
} from '$features/hooks/background-hooks-service';
import {
  backgroundHooksCleared,
  backgroundHooksRefetchRequested,
  backgroundHooksSubscribeRequested,
  backgroundHooksUnsubscribeRequested,
  backgroundHooksUpdated,
  cancelBackgroundHookRequested,
  runBackgroundHookRequested,
} from '../background-hooks-slice';
import { takeSingleFlightInContext } from '../../../utils/context-saga-effects';

const logger = createLogger('BackgroundHooksSaga');

type TransportMessage =
  { kind: 'notification'; notification: BackendNotification } | { kind: 'reconnected' };

type RefetchMessage =
  | { kind: 'refetch'; action: ReturnType<typeof backgroundHooksRefetchRequested> }
  | { kind: 'cancel'; workspaceId: string };

interface HookEventNotification {
  subscriptionId?: string;
  event?: { type?: string; workspaceId?: string; data?: HookEventData };
}

interface SubscriptionLease {
  subscriptionId?: string;
  cancelled: boolean;
}

interface ActiveWorkspace {
  count: number;
  generation: number;
  lease?: SubscriptionLease;
  hooks: BackgroundHook[];
}

interface TransportRuntime {
  unsubscribe?: () => void;
}

function openTransport(
  runtime: TransportRuntime,
  events: Channel<TransportMessage>,
  active: Map<string, ActiveWorkspace>,
): void {
  if (runtime.unsubscribe) return;
  const offNotification = onBackendNotification((notification) => {
    events.put({ kind: 'notification', notification });
  });
  const offReconnect = onBackendReconnected(() => {
    for (const entry of active.values()) {
      entry.generation += 1;
      if (entry.lease) {
        entry.lease.cancelled = true;
        entry.lease.subscriptionId = undefined;
      }
    }
    events.put({ kind: 'reconnected' });
  });
  runtime.unsubscribe = () => {
    offNotification();
    offReconnect();
    runtime.unsubscribe = undefined;
  };
}

function closeTransport(runtime: TransportRuntime): void {
  runtime.unsubscribe?.();
}

async function releaseSubscription(workspaceId: string, subscriptionId: string): Promise<void> {
  try {
    await backendUnsubscribe(subscriptionId);
  } catch (error) {
    logger.warn('events.unsubscribe (hook:*) failed', { workspaceId, error });
  }
}

async function subscribeWorkspace(workspaceId: string, lease: SubscriptionLease): Promise<boolean> {
  let subscriptionId: string | undefined;
  try {
    const result = await backendSubscribe<{ subscriptionId?: string }>({
      eventTypes: ['hook:*'],
      workspaceId,
    });
    subscriptionId =
      typeof result?.subscriptionId === 'string' && result.subscriptionId.length > 0
        ? result.subscriptionId
        : undefined;
  } catch (error) {
    if (!lease.cancelled) {
      logger.warn('events.subscribe (hook:*) failed', { workspaceId, error });
    }
    return !lease.cancelled;
  }

  if (lease.cancelled) {
    if (subscriptionId) await releaseSubscription(workspaceId, subscriptionId);
    return false;
  }
  lease.subscriptionId = subscriptionId;
  return true;
}

async function unsubscribeWorkspace(workspaceId: string, lease: SubscriptionLease): Promise<void> {
  lease.cancelled = true;
  const subscriptionId = lease.subscriptionId;
  lease.subscriptionId = undefined;
  if (subscriptionId) await releaseSubscription(workspaceId, subscriptionId);
}

function* subscribeActiveWorkspace(
  active: Map<string, ActiveWorkspace>,
  workspaceId: string,
  entry: ActiveWorkspace,
): SagaGenerator<void> {
  const generation = ++entry.generation;
  const lease: SubscriptionLease = { cancelled: false };
  entry.lease = lease;
  if (yield* call(subscribeWorkspace, workspaceId, lease)) {
    if (
      active.get(workspaceId) === entry &&
      entry.generation === generation &&
      entry.lease === lease
    ) {
      yield* put(backgroundHooksRefetchRequested(workspaceId));
    }
  }
}

function* refetchWorkspace(
  active: Map<string, ActiveWorkspace>,
  message: RefetchMessage,
): SagaGenerator<void> {
  if (message.kind !== 'refetch') return;
  const { action } = message;
  const [workspaceId] = action.payload;
  const entry = active.get(workspaceId);
  if (!entry) return;
  const generation = entry.generation;
  try {
    const hooks = yield* call(listHooks, workspaceId);
    if (active.get(workspaceId) === entry && entry.generation === generation) {
      entry.hooks = hooks;
      yield* put(backgroundHooksUpdated(workspaceId, hooks));
    }
  } catch (error) {
    logger.warn('hook.list failed', { workspaceId, error });
  }
}

function refetchContext(message: RefetchMessage) {
  return message.kind === 'cancel'
    ? ({ context: message.workspaceId, cancel: true } as const)
    : message.action.payload[0];
}

function* queueRefetch(
  refetchEvents: Channel<RefetchMessage>,
  action: ReturnType<typeof backgroundHooksRefetchRequested>,
): SagaGenerator<void> {
  yield* put(refetchEvents, { kind: 'refetch', action });
}

function* closeWorkspace(
  active: Map<string, ActiveWorkspace>,
  transport: TransportRuntime,
  refetchEvents: Channel<RefetchMessage>,
  workspaceId: string,
): SagaGenerator<void> {
  const entry = active.get(workspaceId);
  if (!entry) return;
  active.delete(workspaceId);
  entry.generation += 1;
  if (entry.lease) entry.lease.cancelled = true;
  yield* put(refetchEvents, { kind: 'cancel', workspaceId });
  yield* put(backgroundHooksCleared(workspaceId));
  if (active.size === 0) yield* call(closeTransport, transport);
  if (entry.lease) yield* call(unsubscribeWorkspace, workspaceId, entry.lease);
}

function* handleSubscribe(
  active: Map<string, ActiveWorkspace>,
  transport: TransportRuntime,
  events: Channel<TransportMessage>,
  action: ReturnType<typeof backgroundHooksSubscribeRequested>,
): SagaGenerator<void> {
  const [workspaceId] = action.payload;
  const current = active.get(workspaceId);
  if (current) {
    current.count += 1;
    return;
  }
  yield* call(openTransport, transport, events, active);
  const entry: ActiveWorkspace = { count: 1, generation: 0, hooks: [] };
  active.set(workspaceId, entry);
  yield* call(subscribeActiveWorkspace, active, workspaceId, entry);
}

function* handleUnsubscribe(
  active: Map<string, ActiveWorkspace>,
  transport: TransportRuntime,
  refetchEvents: Channel<RefetchMessage>,
  action: ReturnType<typeof backgroundHooksUnsubscribeRequested>,
): SagaGenerator<void> {
  const [workspaceId] = action.payload;
  const entry = active.get(workspaceId);
  if (entry && --entry.count <= 0) {
    yield* closeWorkspace(active, transport, refetchEvents, workspaceId);
  }
}

function* handleNotification(
  active: Map<string, ActiveWorkspace>,
  notification: BackendNotification,
): SagaGenerator<void> {
  if (notification.method !== 'events.event') return;
  const params = notification.params as HookEventNotification | undefined;
  const event = params?.event;
  if (!event?.type?.startsWith('hook:') || !event.workspaceId) return;
  const entry = active.get(event.workspaceId);
  if (!entry) return;
  const subscriptionId = entry.lease?.subscriptionId;
  if (subscriptionId && params?.subscriptionId && params.subscriptionId !== subscriptionId) return;
  const folded = foldHookEvent(entry.hooks, event.type, event.data ?? {});
  entry.hooks = folded.hooks;
  yield* put(backgroundHooksUpdated(event.workspaceId, entry.hooks));
  if (folded.needsRefetch) yield* put(backgroundHooksRefetchRequested(event.workspaceId));
}

function* runHookWorker(
  action: ReturnType<typeof runBackgroundHookRequested>,
): SagaGenerator<void> {
  const [workspaceId, hookId] = action.payload;
  try {
    yield* call(runHookNow, workspaceId, hookId);
  } catch (error) {
    logger.error('hook.runNow failed', { workspaceId, hookId, error });
  }
}

function* cancelHookWorker(
  action: ReturnType<typeof cancelBackgroundHookRequested>,
): SagaGenerator<void> {
  const [workspaceId, hookId] = action.payload;
  try {
    yield* call(cancelHook, workspaceId, hookId);
  } catch (error) {
    logger.error('hook.cancel failed', { workspaceId, hookId, error });
  }
}

export function* backgroundHooksSaga(): SagaGenerator<void> {
  const active = new Map<string, ActiveWorkspace>();
  const transport: TransportRuntime = {};
  const transportEvents = createChannel(buffers.expanding<TransportMessage>());
  const refetchEvents = createChannel(buffers.expanding<RefetchMessage>());
  yield* takeEvery(
    backgroundHooksSubscribeRequested,
    handleSubscribe,
    active,
    transport,
    transportEvents,
  );
  yield* takeEvery(
    backgroundHooksUnsubscribeRequested,
    handleUnsubscribe,
    active,
    transport,
    refetchEvents,
  );
  yield* takeEvery(backgroundHooksRefetchRequested, queueRefetch, refetchEvents);
  yield* takeSingleFlightInContext(refetchEvents, refetchContext, refetchWorkspace, active);
  yield* takeEvery(runBackgroundHookRequested, runHookWorker);
  yield* takeEvery(cancelBackgroundHookRequested, cancelHookWorker);
  try {
    while (true) {
      const message: TransportMessage = yield* take(transportEvents);
      if (message === (END as unknown as TransportMessage)) return;
      if (message.kind === 'reconnected') {
        for (const [workspaceId, entry] of active) {
          yield* call(subscribeActiveWorkspace, active, workspaceId, entry);
        }
      } else {
        yield* handleNotification(active, message.notification);
      }
    }
  } finally {
    transportEvents.close();
    for (const workspaceId of [...active.keys()]) {
      yield* closeWorkspace(active, transport, refetchEvents, workspaceId);
    }
    refetchEvents.close();
    closeTransport(transport);
    active.clear();
  }
}
