import {
  END,
  buffers,
  channel as createChannel,
  eventChannel,
  type Channel,
  type EventChannel,
  type Task,
} from 'redux-saga';
import { call, cancel, fork, put, take, type SagaGenerator } from 'typed-redux-saga';

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

const logger = createLogger('BackgroundHooksSaga');

type TransportMessage =
  { kind: 'notification'; notification: BackendNotification } | { kind: 'reconnected' };

interface HookEventNotification {
  subscriptionId?: string;
  event?: { type?: string; workspaceId?: string; data?: HookEventData };
}

interface SubscriptionLease {
  subscriptionId?: string;
  cancelled: boolean;
}

interface WorkspaceRuntimeState {
  hooks: BackgroundHook[];
}

interface ActiveWorkspace {
  count: number;
  task: Task;
  refetchChannel: Channel<true>;
}

type BackgroundHooksAction = { type: string; payload?: unknown };

function createTransportChannel(markDisconnected: () => void): EventChannel<TransportMessage> {
  return eventChannel<TransportMessage>((emit) => {
    const offNotification = onBackendNotification((notification) => {
      emit({ kind: 'notification', notification });
    });
    const offReconnect = onBackendReconnected(() => {
      markDisconnected();
      emit({ kind: 'reconnected' });
    });
    return () => {
      offNotification();
      offReconnect();
    };
  }, buffers.expanding<TransportMessage>());
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

function* refetchWorkspace(
  workspaceId: string,
  refetchChannel: Channel<true>,
  runtime: WorkspaceRuntimeState,
): SagaGenerator<void> {
  while (true) {
    const signal = yield* take(refetchChannel);
    if (signal === (END as unknown as true)) return;
    try {
      runtime.hooks = yield* call(listHooks, workspaceId);
      yield* put(backgroundHooksUpdated(workspaceId, runtime.hooks));
    } catch (error) {
      logger.warn('hook.list failed', { workspaceId, error });
    }
  }
}

function* runWorkspaceSubscription(
  workspaceId: string,
  refetchChannel: Channel<true>,
): SagaGenerator<void> {
  const runtime: WorkspaceRuntimeState = { hooks: [] };
  let lease: SubscriptionLease = { cancelled: false };
  const transportChannel = createTransportChannel(() => {
    lease.cancelled = true;
  });
  const refetchTask = yield* fork(refetchWorkspace, workspaceId, refetchChannel, runtime);

  try {
    if (yield* call(subscribeWorkspace, workspaceId, lease)) {
      yield* put(refetchChannel, true);
    }

    while (true) {
      const message: TransportMessage = yield* take(transportChannel);
      if (message === (END as unknown as TransportMessage)) return;
      if (message.kind === 'reconnected') {
        lease.subscriptionId = undefined;
        lease = { cancelled: false };
        if (yield* call(subscribeWorkspace, workspaceId, lease)) {
          yield* put(refetchChannel, true);
        }
        continue;
      }

      if (message.notification.method !== 'events.event') continue;
      const params = message.notification.params as HookEventNotification | undefined;
      const event = params?.event;
      if (!event?.type?.startsWith('hook:') || event.workspaceId !== workspaceId) continue;
      if (
        lease.subscriptionId &&
        params?.subscriptionId &&
        params.subscriptionId !== lease.subscriptionId
      ) {
        continue;
      }
      const folded = foldHookEvent(runtime.hooks, event.type, event.data ?? {});
      runtime.hooks = folded.hooks;
      yield* put(backgroundHooksUpdated(workspaceId, runtime.hooks));
      if (folded.needsRefetch) yield* put(refetchChannel, true);
    }
  } finally {
    transportChannel.close();
    refetchChannel.close();
    yield* cancel(refetchTask);
    yield* call(unsubscribeWorkspace, workspaceId, lease);
  }
}

function workspaceIdOf(action: BackgroundHooksAction): string | undefined {
  if (!Array.isArray(action.payload)) return undefined;
  const workspaceId = action.payload[0];
  return typeof workspaceId === 'string' && workspaceId.length > 0 ? workspaceId : undefined;
}

function hookRefOf(action: BackgroundHooksAction): [string, string] | undefined {
  if (!Array.isArray(action.payload)) return undefined;
  const [workspaceId, hookId] = action.payload;
  return typeof workspaceId === 'string' && typeof hookId === 'string'
    ? [workspaceId, hookId]
    : undefined;
}

function* closeWorkspace(
  active: Map<string, ActiveWorkspace>,
  workspaceId: string,
): SagaGenerator<void> {
  const entry = active.get(workspaceId);
  if (!entry) return;
  active.delete(workspaceId);
  yield* cancel(entry.task);
  yield* put(backgroundHooksCleared(workspaceId));
}

function* runHookWorker(workspaceId: string, hookId: string): SagaGenerator<void> {
  try {
    yield* call(runHookNow, workspaceId, hookId);
  } catch (error) {
    logger.error('hook.runNow failed', { workspaceId, hookId, error });
  }
}

function* cancelHookWorker(workspaceId: string, hookId: string): SagaGenerator<void> {
  try {
    yield* call(cancelHook, workspaceId, hookId);
  } catch (error) {
    logger.error('hook.cancel failed', { workspaceId, hookId, error });
  }
}

export function* backgroundHooksSaga(): SagaGenerator<void> {
  const active = new Map<string, ActiveWorkspace>();
  try {
    while (true) {
      const action: BackgroundHooksAction = yield* take([
        backgroundHooksSubscribeRequested,
        backgroundHooksUnsubscribeRequested,
        backgroundHooksRefetchRequested,
        runBackgroundHookRequested,
        cancelBackgroundHookRequested,
      ]);
      const workspaceId = workspaceIdOf(action);
      if (!workspaceId) continue;

      if (action.type === backgroundHooksSubscribeRequested.type) {
        const entry = active.get(workspaceId);
        if (entry) {
          entry.count += 1;
        } else {
          const refetchChannel = createChannel<true>(buffers.sliding<true>(1));
          const task = yield* fork(runWorkspaceSubscription, workspaceId, refetchChannel);
          active.set(workspaceId, { count: 1, task, refetchChannel });
        }
      } else if (action.type === backgroundHooksUnsubscribeRequested.type) {
        const entry = active.get(workspaceId);
        if (entry && --entry.count <= 0) yield* closeWorkspace(active, workspaceId);
      } else if (action.type === backgroundHooksRefetchRequested.type) {
        const entry = active.get(workspaceId);
        if (entry) yield* put(entry.refetchChannel, true);
      } else {
        const ref = hookRefOf(action);
        if (!ref) continue;
        if (action.type === runBackgroundHookRequested.type) {
          yield* fork(runHookWorker, ...ref);
        } else if (action.type === cancelBackgroundHookRequested.type) {
          yield* fork(cancelHookWorker, ...ref);
        }
      }
    }
  } finally {
    for (const workspaceId of [...active.keys()]) {
      yield* closeWorkspace(active, workspaceId);
    }
  }
}
