import {
  END,
  buffers,
  channel as sagaChannel,
  eventChannel,
  type Channel,
  type EventChannel,
} from 'redux-saga';
import {
  actionChannel,
  call,
  cancel,
  delay,
  flush,
  fork,
  join,
  put,
  race,
  take,
} from 'typed-redux-saga';

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
  resetScriptOutputDecoders,
  routeDaemonEventsNotification,
} from '$features/events/daemon-events-bridge.client';
import { notifyInterruptedAgentsSubscriptionReady } from '$features/agent/interrupted-agents-service';
import { createLogger } from '$lib/utils/client-logger';
import { settingsChangesReceived } from '$store/renderer/slices/settings-events/settings-events-slice';
import { selectCurrentWorkspaceTabId } from '../../tab-state/tab-state-selectors';
import { CURRENT_WORKSPACE_TAB_SELECTION_ACTIONS } from '../../tab-state/tab-state-slice';
import { daemonEventsSubscribed, daemonEventsSubscribing } from '../workspace-events-slice';
import { selectScriptOutputViewerWorkspaceIds } from '../../scripts/scripts-selectors';
import {
  removeScript,
  scriptOutputReleased,
  scriptOutputRequested,
  scriptOutputStreamInterrupted,
} from '../../scripts/scripts-slice';
import {
  workspaceDeleted,
  workspaceUnmounted,
} from '../../workspace-lifecycle/workspace-lifecycle-slice';
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

/** Event types of the per-workspace live script output leases. */
export const SCRIPT_OUTPUT_SUBSCRIBE_TYPES = ['script:output'] as const;

/** §6.1 replaceGroup per workspace, so a replayed subscribe never doubles a lease. */
export const scriptOutputReplaceGroup = (workspaceId: string) => `script-output:${workspaceId}`;

/**
 * How long a workspace's output lease outlives its last viewer. Viewers
 * release and re-request on every runtime transition and tab switches remount
 * them, so closing immediately would churn the subscription.
 */
export const SCRIPT_OUTPUT_LEASE_GRACE_MS = 2_000;

/** Delay before retrying a viewed workspace whose output subscribe failed. */
export const SCRIPT_OUTPUT_LEASE_RETRY_MS = 5_000;

type DaemonChannelMessage =
  { kind: 'notification'; notification: BackendNotification } | { kind: 'reconnected' };

interface SubscriptionLease {
  workspaceId?: string;
  subscriptionId?: string;
  cancelled: boolean;
  attempt?: number;
}

/**
 * The saga's subscriptions on the socket: the global firehose, the
 * active-workspace-scoped `file:*` lease, and one `script:output` lease per
 * workspace with a mounted output viewer. Held in a shared mutable holder so
 * the notification loop and the lease managers see lease swaps.
 */
interface DaemonEventLeases {
  firehose: SubscriptionLease;
  scopedFile: SubscriptionLease;
  /** Live `script:output` leases, keyed by workspace with a mounted viewer. */
  scriptOutput: Map<string, SubscriptionLease>;
}

function ownedSubscriptionIds(leases: DaemonEventLeases): string[] {
  return [
    leases.firehose.subscriptionId,
    leases.scopedFile.subscriptionId,
    ...[...leases.scriptOutput.values()].map((lease) => lease.subscriptionId),
  ].filter((id): id is string => typeof id === 'string');
}

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
    await backendUnsubscribe(subscriptionId, lease.workspaceId);
  } catch (error) {
    logger.warn('events.unsubscribe failed during saga cleanup', error);
  }
}

/**
 * Retire every lease in ONE blocking effect — a cancelled saga's finally block
 * only reliably runs a single blocking `call`, so the teardown must not chain
 * sequential unsubscribe effects.
 */
function unsubscribeAllLeases(leases: DaemonEventLeases): Promise<void> {
  const scriptOutput = [...leases.scriptOutput.values()];
  leases.scriptOutput.clear();
  return Promise.all([
    unsubscribeLease(leases.firehose),
    unsubscribeLease(leases.scopedFile),
    ...scriptOutput.map(unsubscribeLease),
  ]).then(() => undefined);
}

function subscribeScriptOutputLease(lease: SubscriptionLease, workspaceId: string): Promise<void> {
  return subscribeLease(lease, {
    eventTypes: [...SCRIPT_OUTPUT_SUBSCRIBE_TYPES],
    workspaceId,
    replaceGroup: scriptOutputReplaceGroup(workspaceId),
  });
}

/**
 * Open a lease for every viewed workspace that lacks one. A subscribe that
 * fails or returns no id leaves no entry, so a later pass retries it; returns
 * whether any did.
 *
 * Like the scoped file lease, the routing gate learns the id only once the
 * subscribe reply lands, so a chunk the daemon emits before that reply is
 * dropped. A viewer's retained `script.output` snapshot covers that window.
 */
function* openScriptOutputLeases(leases: DaemonEventLeases, desired: readonly string[]) {
  let failed = false;
  for (const workspaceId of desired) {
    if (leases.scriptOutput.has(workspaceId)) continue;
    const lease: SubscriptionLease = { cancelled: false };
    leases.scriptOutput.set(workspaceId, lease);
    yield* call(subscribeScriptOutputLease, lease, workspaceId);
    if (!lease.subscriptionId && leases.scriptOutput.get(workspaceId) === lease) {
      leases.scriptOutput.delete(workspaceId);
      failed = true;
    }
  }
  return failed;
}

/** Close one lease whose workspace no longer has a viewer; its buffers now have a gap. */
function* closeScriptOutputLease(leases: DaemonEventLeases, workspaceId: string) {
  const lease = leases.scriptOutput.get(workspaceId);
  if (!lease) return;
  leases.scriptOutput.delete(workspaceId);
  yield* call(unsubscribeLease, lease);
  yield* call(interruptScriptOutputStream, workspaceId);
}

/** The workspace's live stream has a gap: drop buffered chunks and partial decodes. */
function* interruptScriptOutputStream(workspaceId: string) {
  resetScriptOutputDecoders(workspaceId);
  yield* put(scriptOutputStreamInterrupted(workspaceId));
}

const SCRIPT_OUTPUT_VIEWER_ACTIONS = [
  scriptOutputRequested,
  scriptOutputReleased,
  removeScript,
  workspaceUnmounted,
  workspaceDeleted,
];

/**
 * Single writer for `leases.scriptOutput`: keeps one `script:output` lease per
 * workspace with a mounted output viewer. Opens are immediate; a lease whose
 * last viewer left closes only after {@link SCRIPT_OUTPUT_LEASE_GRACE_MS}
 * without the workspace being viewed again. A failed subscribe is retried
 * after {@link SCRIPT_OUTPUT_LEASE_RETRY_MS}. A reconnect drops every lease
 * (the daemon already forgot them) and replays the viewed set.
 */
function* manageScriptOutputLeases(
  leases: DaemonEventLeases,
  reconnectSignals: Channel<true>,
  start: Channel<true>,
) {
  const viewerChanges = yield* actionChannel(SCRIPT_OUTPUT_VIEWER_ACTIONS, buffers.expanding());
  // When each still-leased workspace lost its last viewer.
  const idleSince = new Map<string, number>();
  try {
    yield* take(start);
    while (true) {
      yield* flush(viewerChanges);
      const desired = yield* selectScriptOutputViewerWorkspaceIds.effect();
      const failed = yield* call(openScriptOutputLeases, leases, desired);
      const now = Date.now();
      let nextDeadline = failed ? now + SCRIPT_OUTPUT_LEASE_RETRY_MS : Number.POSITIVE_INFINITY;
      for (const workspaceId of [...leases.scriptOutput.keys()]) {
        if (desired.includes(workspaceId)) {
          idleSince.delete(workspaceId);
          continue;
        }
        const since = idleSince.get(workspaceId) ?? now;
        idleSince.set(workspaceId, since);
        if (now - since >= SCRIPT_OUTPUT_LEASE_GRACE_MS) {
          idleSince.delete(workspaceId);
          yield* call(closeScriptOutputLease, leases, workspaceId);
        } else {
          nextDeadline = Math.min(nextDeadline, since + SCRIPT_OUTPUT_LEASE_GRACE_MS);
        }
      }
      const { reconnect } = yield* race({
        change: take(viewerChanges),
        reconnect: take(reconnectSignals),
        ...(Number.isFinite(nextDeadline)
          ? { grace: delay(Math.max(0, nextDeadline - Date.now())) }
          : {}),
      });
      if (reconnect) {
        // The daemon dropped these with the old connection. Do not send
        // `events.unsubscribe` for them: a restarted daemon reuses
        // `ws-sub-<n>` ids, so a stale id could retire a new subscription.
        // Output emitted while disconnected is lost, so every leased buffer
        // now has a gap; the next pass re-subscribes the viewed workspaces.
        const stale = [...leases.scriptOutput];
        leases.scriptOutput.clear();
        idleSince.clear();
        for (const [workspaceId, lease] of stale) {
          lease.cancelled = true;
          lease.subscriptionId = undefined;
          yield* call(interruptScriptOutputStream, workspaceId);
        }
      }
    }
  } finally {
    viewerChanges.close();
    start.close();
  }
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

export function* daemonEventsSaga() {
  const channel = createDaemonEventsChannel();
  const leases: DaemonEventLeases = {
    firehose: { cancelled: false },
    scopedFile: { cancelled: false },
    scriptOutput: new Map(),
  };
  const reconnectSignals = sagaChannel<ScopedLeaseReconnectSignal>();
  const startScopedLease = sagaChannel<true>();
  const scriptOutputReconnects = sagaChannel<true>();
  const startScriptOutputLeases = sagaChannel<true>();
  let managerTask;
  let scriptOutputTask;
  try {
    // The scoped-lease manager forks BEFORE the awaited firehose subscribe:
    // its transition channel observes reducer-owned selection actions from
    // fork time, closing the startup window where a selection dispatched
    // during the initial subscribe round-trip was lost.
    managerTask = yield* fork(manageScopedFileLease, leases, reconnectSignals, startScopedLease);
    scriptOutputTask = yield* fork(
      manageScriptOutputLeases,
      leases,
      scriptOutputReconnects,
      startScriptOutputLeases,
    );
    // Start the firehose request before releasing the scoped manager so wire
    // ordering stays deterministic while both leases may resolve concurrently.
    const firehoseTask = yield* fork(subscribeFirehose, leases.firehose);
    yield* put(startScopedLease, true);
    yield* put(startScriptOutputLeases, true);
    // Listener-first closes the subscribe/fetch race; the expanding channel
    // retains every notification until the server-assigned id is available.
    yield* join(firehoseTask);
    yield* announceFirehoseSubscribed(leases.firehose);
    while (true) {
      const message: DaemonChannelMessage = yield* take(channel);
      if (message === (END as unknown as DaemonChannelMessage)) break;
      if (message.kind === 'notification') {
        const { method, params } = message.notification;
        const expectedSubscriptionIds = ownedSubscriptionIds(leases);
        let settingsChanges: AppliedSettingChange[] | undefined;
        let settingsRevision: number | undefined;
        yield* call(routeDaemonEventsNotification, method, params, expectedSubscriptionIds, {
          onSettingsChanges: (changes: AppliedSettingChange[], revision?: number) => {
            settingsChanges = changes;
            settingsRevision = revision;
          },
        });
        if (settingsChanges) yield* put(settingsChangesReceived(settingsChanges, settingsRevision));
        continue;
      }

      // The daemon drops per-connection subscriptions on disconnect. Dispose
      // the old firehose lease and subscribe it again, signal the scoped-lease
      // manager to replay its lease (RESUB-1 replays BOTH), and only then —
      // after the manager acks — converge snapshots.
      yield* put(daemonEventsSubscribing());
      yield* call(unsubscribeLease, leases.firehose);
      leases.firehose = { cancelled: false };
      const ack = sagaChannel<ScopedLeaseReconnectResult>();
      yield* put(reconnectSignals, { ack });
      yield* put(scriptOutputReconnects, true);
      yield* call(subscribeFirehose, leases.firehose);
      yield* announceFirehoseSubscribed(leases.firehose);
      const { workspaceId } = yield* take(ack);
      yield* call(refreshDaemonEventsAfterReconnect, workspaceId);
    }
  } finally {
    channel.close();
    // Cancel the manager BEFORE closing its signal channel: closing a channel
    // a forked task is still racing on during parent cancellation live-locks
    // the saga runtime. `cancel` is non-blocking, so the single reliably-run
    // blocking effect of a cancelled finally stays `unsubscribeAllLeases`.
    if (managerTask) yield* cancel(managerTask);
    if (scriptOutputTask) yield* cancel(scriptOutputTask);
    reconnectSignals.close();
    scriptOutputReconnects.close();
    disposeDaemonEventsRoutingState();
    yield* call(unsubscribeAllLeases, leases);
  }
}
