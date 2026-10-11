import {
  END,
  buffers,
  channel as sagaChannel,
  eventChannel,
  type Channel,
  type EventChannel,
} from 'redux-saga';
import { actionChannel, call, cancel, flush, fork, join, put, race, take } from 'typed-redux-saga';

import type { AppliedSettingChange } from '$lib/client/settings-types';
import type { BackendNotification } from '$lib/client/live/backend-transport-types';
import type { BackendRuntime } from '$lib/client/live/backend-transport-runtime';
import type { SagaGenerator } from 'typed-redux-saga';
import type { ActionPattern } from 'redux-saga/effects';
import { createLogger } from '$lib/utils/client-logger';
import { settingsChangesReceived } from '../../settings-events/settings-events-slice';
import { daemonEventsSubscribed, daemonEventsSubscribing } from '../workspace-events-slice';

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
}

export interface DaemonEventsSagaDependencies extends Pick<
  BackendRuntime,
  'backendSubscribe' | 'backendUnsubscribe' | 'onBackendNotification' | 'onBackendReconnected'
> {
  eventTypes: readonly string[];
  subscriptionAttemptEffect: () => SagaGenerator<number>;
  routeNotification: (
    method: string,
    params: unknown,
    ids: readonly string[],
    overrides: { onSettingsChanges: (changes: AppliedSettingChange[], revision?: number) => void },
  ) => void;
  disposeRouting: () => void;
  refreshAfterReconnect: (workspaceId: string | null) => Promise<void>;
  subscriptionReady?: () => void;
  reconnecting?: () => void;
  scopedFiles?: {
    selectionActions: ActionPattern;
    workspaceIdEffect: () => SagaGenerator<string | null>;
  };
}
/** One lease owner shared by renderer bindings; scoped files are an optional app lifetime. */
export function createDaemonEventsSaga({
  backendSubscribe,
  backendUnsubscribe,
  onBackendNotification,
  onBackendReconnected,
  eventTypes,
  subscriptionAttemptEffect,
  routeNotification,
  disposeRouting,
  refreshAfterReconnect,
  subscriptionReady,
  reconnecting,
  scopedFiles,
}: DaemonEventsSagaDependencies) {
  function createDaemonEventsChannel(): EventChannel<DaemonChannelMessage> {
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
    lease.workspaceId = typeof params.workspaceId === 'string' ? params.workspaceId : undefined;
    try {
      const result = await backendSubscribe<{ subscriptionId?: string }>(params);
      const subscriptionId = result?.subscriptionId;
      if (typeof subscriptionId !== 'string' || subscriptionId.length === 0) {
        logger.warn('events.subscribe returned no subscriptionId', result);
        return;
      }
      if (lease.cancelled) {
        await backendUnsubscribe(subscriptionId, lease.workspaceId);
        return;
      }
      lease.subscriptionId = subscriptionId;
    } catch (error) {
      logger.error('events.subscribe failed', error);
    }
  }

  function* subscribeFirehose(lease: SubscriptionLease) {
    yield* put(daemonEventsSubscribing());
    lease.attempt = yield* subscriptionAttemptEffect();
    yield* call(subscribeLease, lease, { eventTypes: [...eventTypes] });
  }

  /**
   * Publish firehose readiness once the server-assigned id is held: sagas that
   * seed state from a snapshot (presence rosters) read it only after this, so
   * every later change is guaranteed to arrive as an event.
   */
  function* announceFirehoseSubscribed(lease: SubscriptionLease) {
    if (lease.subscriptionId && lease.attempt === (yield* subscriptionAttemptEffect())) {
      yield* put(daemonEventsSubscribed(lease.attempt));
      if (subscriptionReady) yield* call(subscriptionReady);
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
      await backendUnsubscribe(subscriptionId, lease.workspaceId);
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
    return Promise.all([
      unsubscribeLease(leases.firehose),
      unsubscribeLease(leases.scopedFile),
    ]).then(() => undefined);
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
    if (desiredWorkspaceId === tracking.workspaceId) return;
    tracking.workspaceId = desiredWorkspaceId;
    if (desiredWorkspaceId === null) {
      const lease = leases.scopedFile;
      leases.scopedFile = { cancelled: false };
      yield* call(unsubscribeLease, lease);
    } else {
      leases.scopedFile.cancelled = true;
      leases.scopedFile = { cancelled: false };
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
    const files = scopedFiles;
    if (!files) return;
    const workspaceChanges = yield* actionChannel(files.selectionActions, buffers.expanding());
    const tracking: ScopedLeaseTracking = { workspaceId: null };
    let desiredWorkspaceId: string | null = null;
    try {
      yield* take(start);
      desiredWorkspaceId = (yield* files.workspaceIdEffect()) || null;
      yield* call(convergeScopedFileLease, leases, tracking, desiredWorkspaceId);
      while (true) {
        const { workspaceChange, reconnect } = yield* race({
          workspaceChange: take(workspaceChanges),
          reconnect: take(reconnectSignals),
        });
        if (workspaceChange) {
          yield* flush(workspaceChanges);
          desiredWorkspaceId = (yield* files.workspaceIdEffect()) || null;
        }
        if (reconnect) {
          // The daemon dropped the subscription with the connection; retire the
          // stale lease and force a fresh subscribe for the current workspace.
          const staleLease = leases.scopedFile;
          leases.scopedFile = { cancelled: false };
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

  return function* daemonEventsSaga() {
    const channel = createDaemonEventsChannel();
    const leases: DaemonEventLeases = {
      firehose: { cancelled: false },
      scopedFile: { cancelled: false },
    };
    const reconnectSignals = sagaChannel<ScopedLeaseReconnectSignal>();
    const startScopedLease = sagaChannel<true>();
    let managerTask;
    try {
      // The scoped-lease manager forks BEFORE the awaited firehose subscribe:
      // its transition channel observes reducer-owned selection actions from
      // fork time, closing the startup window where a selection dispatched
      // during the initial subscribe round-trip was lost.
      if (scopedFiles)
        managerTask = yield* fork(
          manageScopedFileLease,
          leases,
          reconnectSignals,
          startScopedLease,
        );
      // Start the firehose request before releasing the scoped manager so wire
      // ordering stays deterministic while both leases may resolve concurrently.
      const firehoseTask = yield* fork(subscribeFirehose, leases.firehose);
      if (scopedFiles) yield* put(startScopedLease, true);
      // Listener-first closes the subscribe/fetch race; the expanding channel
      // retains every notification until the server-assigned id is available.
      yield* join(firehoseTask);
      yield* announceFirehoseSubscribed(leases.firehose);
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
          let settingsRevision: number | undefined;
          yield* call(routeNotification, method, params, expectedSubscriptionIds, {
            onSettingsChanges: (changes: AppliedSettingChange[], revision?: number) => {
              settingsChanges = changes;
              settingsRevision = revision;
            },
          });
          if (settingsChanges)
            yield* put(settingsChangesReceived(settingsChanges, settingsRevision));
          continue;
        }

        // The daemon drops per-connection subscriptions on disconnect. Dispose
        // the old firehose lease and subscribe it again, signal the scoped-lease
        // manager to replay its lease (RESUB-1 replays BOTH), and only then —
        // after the manager acks — converge snapshots.
        if (reconnecting) yield* call(reconnecting);
        yield* put(daemonEventsSubscribing());
        yield* call(unsubscribeLease, leases.firehose);
        leases.firehose = { cancelled: false };
        const ack = sagaChannel<ScopedLeaseReconnectResult>();
        if (scopedFiles) yield* put(reconnectSignals, { ack });
        yield* call(subscribeFirehose, leases.firehose);
        yield* announceFirehoseSubscribed(leases.firehose);
        const workspaceId = scopedFiles ? (yield* take(ack)).workspaceId : null;
        ack.close();
        yield* call(refreshAfterReconnect, workspaceId);
      }
    } finally {
      channel.close();
      // Cancel the manager BEFORE closing its signal channel: closing a channel
      // a forked task is still racing on during parent cancellation live-locks
      // the saga runtime. `cancel` is non-blocking, so the single reliably-run
      // blocking effect of a cancelled finally stays `unsubscribeAllLeases`.
      if (managerTask) yield* cancel(managerTask);
      reconnectSignals.close();
      startScopedLease.close();
      disposeRouting();
      yield* call(unsubscribeAllLeases, leases);
    }
  };
}
