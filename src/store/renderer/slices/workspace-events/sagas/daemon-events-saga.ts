import {
  rendererEventRecovery,
  type RendererRecoveryScope,
} from '$features/events/renderer-event-recovery';
import type { RecoveryReduxStore } from '$features/events/renderer-recovery-owners';
import type { AdmittedEventLifetimes } from '$features/events/event-recovery-coordinator';
import { selectPrincipalActionContext } from '../../principal/principal-selectors';
import { END, buffers, channel as sagaChannel, eventChannel, type Channel } from 'redux-saga';
import {
  actionChannel,
  call,
  cancel,
  flush,
  fork,
  getContext,
  join,
  put,
  race,
  take,
} from 'typed-redux-saga';

import type { AppliedSettingChange } from '$lib/client/app-client';
import type { BackendNotification } from '$lib/client/live/backend-transport';
import {
  captureBackendEventRecovery,
  backendSubscribe,
  backendUnsubscribe,
  onBackendNotification,
  onBackendReconnected,
  onEventRecoveryReady,
} from '$lib/client/live/backend-transport';
import {
  DAEMON_EVENTS_SUBSCRIBE_TYPES,
  disposeDaemonEventsRoutingState,
  refreshDaemonEventsAfterReconnect,
  routeDaemonEventsNotification,
} from '$features/events/daemon-events-bridge.client';
import { notifyInterruptedAgentsSubscriptionReady } from '$features/agent/interrupted-agents-service';
import { createLogger } from '$lib/utils/client-logger';
import { settingsChangesReceived } from '$store/renderer/slices/settings-events/settings-events-slice';
import { selectCurrentWorkspaceTabId } from '../../tab-state/tab-state-selectors';
import { CURRENT_WORKSPACE_TAB_SELECTION_ACTIONS } from '../../tab-state/tab-state-slice';
import { daemonEventsSubscribed, daemonEventsSubscribing } from '../workspace-events-slice';
import { selectDaemonEventsSubscriptionAttempt } from '../workspace-events-selectors';

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
  | {
      kind: 'notification' | 'admitted';
      notification: BackendNotification;
      lifetimes?: AdmittedEventLifetimes;
      isCurrent?: () => boolean;
      settled?: () => void;
    }
  | { kind: 'reconnected' | 'ready' | 'retired' };

interface SubscriptionLease {
  scope?: RendererRecoveryScope;
  workspaceId?: string;
  subscriptionId?: string;
  cancelled: boolean;
  attempt?: number;
}

/**
 * The saga's two subscriptions on the socket: the global firehose and the
 * active-workspace-scoped `file:*` lease. Held in a shared mutable holder so
 * the notification loop and the active-workspace watcher see lease swaps.
 */
interface DaemonEventLeases {
  firehose: SubscriptionLease;
  scopedFile: SubscriptionLease;
  scope?: RendererRecoveryScope;
  recoveryPending?: boolean;
}

function createDaemonEventsChannel(enableRecovery: boolean) {
  let publish!: (message: DaemonChannelMessage) => void;
  const channel = eventChannel<DaemonChannelMessage>((emit) => {
    publish = emit;
    const offNotification = onBackendNotification((notification) => {
      emit({ kind: 'notification', notification });
    });
    const offReconnect = onBackendReconnected(() => emit({ kind: 'reconnected' }));
    const offReady = enableRecovery
      ? onEventRecoveryReady(() => emit({ kind: 'ready' }))
      : () => {};
    return () => {
      offNotification();
      offReconnect();
      offReady();
    };
  }, buffers.expanding<DaemonChannelMessage>());
  return { channel, publish };
}

async function subscribeLease(
  lease: SubscriptionLease,
  params: Record<string, unknown>,
): Promise<void> {
  lease.workspaceId = typeof params.workspaceId === 'string' ? params.workspaceId : undefined;
  try {
    const scope = lease.scope;
    const result = scope
      ? await scope.subscribe(
          params as unknown as Parameters<RendererRecoveryScope['subscribe']>[0],
          { recover: true },
        )
      : await backendSubscribe<{ subscriptionId?: string }>(params);
    const subscriptionId = scope
      ? (result as { id?: string })?.id
      : (result as { subscriptionId?: string })?.subscriptionId;
    if (typeof subscriptionId !== 'string' || subscriptionId.length === 0) {
      logger.warn('events.subscribe returned no subscriptionId', result);
      return;
    }
    if (lease.cancelled) {
      await (lease.scope
        ? lease.scope.unsubscribe(subscriptionId)
        : backendUnsubscribe(subscriptionId, lease.workspaceId));
      return;
    }
    lease.subscriptionId = subscriptionId;
  } catch (error) {
    logger.error('events.subscribe failed', error);
  }
}

function* subscribeFirehose(lease: SubscriptionLease) {
  yield* put(daemonEventsSubscribing());
  lease.attempt = yield* selectDaemonEventsSubscriptionAttempt.effect();
  yield* call(subscribeLease, lease, { eventTypes: [...DAEMON_EVENTS_SUBSCRIBE_TYPES] });
}

/**
 * Publish firehose readiness once the server-assigned id is held: sagas that
 * seed state from a snapshot (presence rosters) read it only after this, so
 * every later change is guaranteed to arrive as an event.
 */
function* announceFirehoseSubscribed(lease: SubscriptionLease) {
  if (
    lease.subscriptionId &&
    lease.attempt === (yield* selectDaemonEventsSubscriptionAttempt.effect())
  ) {
    yield* put(daemonEventsSubscribed(lease.attempt));
    yield* call(notifyInterruptedAgentsSubscriptionReady);
  }
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
    await (lease.scope
      ? lease.scope.unsubscribe(subscriptionId)
      : backendUnsubscribe(subscriptionId, lease.workspaceId));
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

/** Reconnect signal to the scoped-lease manager; `ack` carries the converged workspace. */
interface ScopedLeaseReconnectSignal {
  ack: Channel<ScopedLeaseReconnectResult>;
}

interface ScopedLeaseReconnectResult {
  workspaceId: string | null;
}

/** The workspace id the manager last issued a scoped subscribe (or clear) for. */
interface ScopedLeaseTracking {
  workspaceId: string | null;
}

/**
 * Drive the scoped `file:*` lease to match the saga-local desired workspace.
 * On a switch the §6.1 `replaceGroup` atomically
 * replaces the daemon-side subscription, so the only local bookkeeping is the
 * lease swap (a subscribe still in flight unsubscribes its own late-arriving
 * id); on a clear there is no replacing subscribe, so the lease must be
 * explicitly unsubscribed.
 */
function* convergeScopedFileLease(
  leases: DaemonEventLeases,
  tracking: ScopedLeaseTracking,
  desiredWorkspaceId: string | null,
) {
  if (leases.recoveryPending || desiredWorkspaceId === tracking.workspaceId) return;
  tracking.workspaceId = desiredWorkspaceId;
  if (desiredWorkspaceId === null) {
    const lease = leases.scopedFile;
    leases.scopedFile = { cancelled: false, scope: leases.scope };
    yield* call(unsubscribeLease, lease);
  } else {
    leases.scopedFile.cancelled = true;
    leases.scopedFile = { cancelled: false, scope: leases.scope };
    yield* call(subscribeScopedFileEvents, leases.scopedFile, desiredWorkspaceId);
  }
}

/**
 * Single writer for `leases.scopedFile`: workspace selection changes, the
 * startup selection, and reconnect replays are all serialized through this
 * one task so two subscribes can never race on the same lease. An expanding
 * action channel retains every canonical tab-selection transition that lands
 * during a wire call; buffered transitions are coalesced through a selector
 * read before the next convergence.
 */
function* manageScopedFileLease(
  leases: DaemonEventLeases,
  reconnectSignals: Channel<ScopedLeaseReconnectSignal>,
  start: Channel<true>,
) {
  const workspaceChanges = yield* actionChannel(
    CURRENT_WORKSPACE_TAB_SELECTION_ACTIONS,
    buffers.expanding(),
  );
  const tracking: ScopedLeaseTracking = { workspaceId: null };
  let desiredWorkspaceId: string | null = null;
  try {
    yield* take(start);
    desiredWorkspaceId = (yield* selectCurrentWorkspaceTabId.effect()) || null;
    yield* call(convergeScopedFileLease, leases, tracking, desiredWorkspaceId);
    while (true) {
      const { workspaceChange, reconnect } = yield* race({
        workspaceChange: take(workspaceChanges),
        reconnect: take(reconnectSignals),
      });
      if (workspaceChange) {
        yield* flush(workspaceChanges);
        desiredWorkspaceId = (yield* selectCurrentWorkspaceTabId.effect()) || null;
      }
      if (reconnect) {
        // The daemon dropped the subscription with the connection; retire the
        // stale lease and force a fresh subscribe for the current workspace.
        const staleLease = leases.scopedFile;
        leases.scopedFile = { cancelled: false, scope: leases.scope };
        tracking.workspaceId = null;
        yield* call(unsubscribeLease, staleLease);
      }
      yield* call(convergeScopedFileLease, leases, tracking, desiredWorkspaceId);
      if (reconnect) yield* put(reconnect.ack, { workspaceId: desiredWorkspaceId });
    }
  } finally {
    workspaceChanges.close();
    start.close();
  }
}

export function* daemonEventsSaga(enableRecovery = true) {
  const { channel, publish } = createDaemonEventsChannel(enableRecovery);
  const reduxStore = enableRecovery
    ? yield* getContext<RecoveryReduxStore | undefined>('reduxStore')
    : undefined;
  const pendingAdmissions = new Set<() => void>();
  let stopOwners = () => {};
  let ownersInstalled = false;
  let stopAuthority = () => {};
  let stopRetired = () => {};
  let authority: string | null = null;
  let hadAuthority = false;
  let refreshingAuthority = false;
  const leases: DaemonEventLeases = {
    firehose: { cancelled: false },
    scopedFile: { cancelled: false },
    recoveryPending: enableRecovery && !!reduxStore,
  };
  const reconnectSignals = sagaChannel<ScopedLeaseReconnectSignal>();
  const startScopedLease = sagaChannel<true>();
  let managerTask;
  const attach = async () => {
    if (!enableRecovery || !reduxStore) return;
    stopRetired();
    leases.recoveryPending = true;
    let session: Awaited<ReturnType<typeof captureBackendEventRecovery>>;
    try {
      session = await captureBackendEventRecovery();
    } catch (error) {
      logger.warn('Event recovery capture unavailable; awaiting readiness', error);
      return;
    }
    if (!session?.isCurrent()) {
      session?.dispose();
      return;
    }
    if (!session.supported) {
      session.dispose();
      rendererEventRecovery.dispose();
      leases.scope = undefined;
      leases.recoveryPending = false;
      return;
    }
    if (!ownersInstalled && reduxStore) {
      const { installRendererRecoveryOwners } =
        await import('$features/events/renderer-recovery-owners');
      if (!session.isCurrent()) {
        session.dispose();
        return;
      }
      stopOwners = rendererEventRecovery.onSession((scope) =>
        installRendererRecoveryOwners(scope, reduxStore),
      );
      ownersInstalled = true;
    }
    leases.scope = rendererEventRecovery.attach(session, (notification, lifetimes) => {
      const receipt = rendererEventRecovery.captureAuthority('daemon-ingress');
      return new Promise<void>((resolve) => {
        const settled = () => {
          pendingAdmissions.delete(settled);
          resolve();
        };
        pendingAdmissions.add(settled);
        publish({
          kind: 'admitted',
          notification,
          lifetimes,
          isCurrent: receipt.isCurrent,
          settled,
        });
      });
    });
    leases.firehose.scope = leases.scope;
    leases.scopedFile.scope = leases.scope;
    leases.recoveryPending = false;
    stopRetired = session.onRetired(() => {
      leases.recoveryPending = true;
      publish({ kind: 'retired' });
    });
  };
  try {
    if (reduxStore) {
      authority = selectPrincipalActionContext.select(reduxStore.getState());
      hadAuthority = authority !== null;
      stopAuthority = reduxStore.subscribe(() => {
        if (refreshingAuthority) return;
        const next = selectPrincipalActionContext.select(reduxStore.getState());
        if (next === authority) return;
        authority = next;
        refreshingAuthority = true;
        try {
          rendererEventRecovery.refreshAuthority(hadAuthority && next !== null);
        } finally {
          refreshingAuthority = false;
        }
        hadAuthority ||= next !== null;
      });
      yield* call(attach);
    }
    // The scoped-lease manager forks BEFORE the awaited firehose subscribe:
    // its transition channel observes reducer-owned selection actions from
    // fork time, closing the startup window where a selection dispatched
    // during the initial subscribe round-trip was lost.
    managerTask = yield* fork(manageScopedFileLease, leases, reconnectSignals, startScopedLease);
    // Start the firehose request before releasing the scoped manager so wire
    // ordering stays deterministic while both leases may resolve concurrently.
    const firehoseTask = !leases.recoveryPending
      ? yield* fork(subscribeFirehose, leases.firehose)
      : undefined;
    yield* put(startScopedLease, true);
    // Listener-first closes the subscribe/fetch race; the expanding channel
    // retains every notification until the server-assigned id is available.
    if (firehoseTask) yield* join(firehoseTask);
    yield* announceFirehoseSubscribed(leases.firehose);
    while (true) {
      const message: DaemonChannelMessage = yield* take(channel);
      if (message === (END as unknown as DaemonChannelMessage)) break;
      if (message.kind === 'retired') {
        if (leases.scope?.isCurrent()) continue;
        yield* put(daemonEventsSubscribing());
        continue;
      }
      if (message.kind === 'notification' || message.kind === 'admitted') {
        if (leases.recoveryPending || (message.isCurrent && !message.isCurrent())) {
          message.settled?.();
          continue;
        }
        try {
          const { method, params } = message.notification;
          const expectedSubscriptionIds = [
            leases.firehose.subscriptionId,
            leases.scopedFile.subscriptionId,
          ].filter((id): id is string => typeof id === 'string');
          let settingsChanges: AppliedSettingChange[] | undefined;
          let settingsRevision: number | undefined;
          yield* call(routeDaemonEventsNotification, method, params, expectedSubscriptionIds, {
            ...(message.kind === 'admitted'
              ? { lifetimes: message.lifetimes }
              : leases.scope
                ? { recovery: leases.scope }
                : {}),
            onSettingsChanges: (changes: AppliedSettingChange[], revision?: number) => {
              settingsChanges = changes;
              settingsRevision = revision;
            },
          });
          if (settingsChanges)
            yield* put(settingsChangesReceived(settingsChanges, settingsRevision));
        } finally {
          message.settled?.();
        }
        continue;
      }

      if (enableRecovery && leases.scope?.isCurrent()) continue;
      if (
        message.kind === 'ready' &&
        (!enableRecovery || (!leases.scope && !leases.recoveryPending))
      )
        continue;
      // The daemon drops per-connection subscriptions on disconnect. Dispose
      // the old firehose lease and subscribe it again, signal the scoped-lease
      // manager to replay its lease (RESUB-1 replays BOTH), and only then —
      // after the manager acks — converge snapshots.
      yield* put(daemonEventsSubscribing());
      yield* call(unsubscribeLease, leases.firehose);
      leases.firehose = { cancelled: false };
      yield* call(attach);
      if (leases.recoveryPending) continue;
      leases.firehose.scope = leases.scope;
      const ack = sagaChannel<ScopedLeaseReconnectResult>();
      yield* put(reconnectSignals, { ack });
      yield* call(subscribeFirehose, leases.firehose);
      yield* announceFirehoseSubscribed(leases.firehose);
      const { workspaceId } = yield* take(ack);
      yield* call(refreshDaemonEventsAfterReconnect, workspaceId);
    }
  } finally {
    stopAuthority();
    stopRetired();
    stopOwners();
    for (const settle of pendingAdmissions) settle();
    channel.close();
    // Cancel the manager BEFORE closing its signal channel: closing a channel
    // a forked task is still racing on during parent cancellation live-locks
    // the saga runtime. `cancel` is non-blocking, so the single reliably-run
    // blocking effect of a cancelled finally stays `unsubscribeAllLeases`.
    if (managerTask) yield* cancel(managerTask);
    reconnectSignals.close();
    disposeDaemonEventsRoutingState();
    yield* call(async () => {
      await unsubscribeAllLeases(leases);
      if (enableRecovery) rendererEventRecovery.dispose();
    });
  }
}
