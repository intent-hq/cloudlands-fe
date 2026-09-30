/**
 * Presence Saga (multiplayer w5, PROTOCOL §5.46)
 *
 * Sender side: this window's focus set (current workspace tab + the agent /
 * note each panel shows) and typing target go to main over `presence:report`
 * — trailing-debounced on change, re-pulsed while typing keeps going, and
 * empty while the window is hidden. Main merges every window of the backend
 * into one `presence.update`; the reply carries the connection's
 * `typingSource` so the roster's own typing row can be dropped.
 *
 * Receiver side: one fire-and-forget 3 s timer per NEW `(workspace, source,
 * pulse)` pair; a timer whose pulse has since advanced is ignored by the
 * reducer, so nothing needs cancelling.
 *
 * Hydration: the daemon publishes `presence:changed` only on change, so the
 * rosters of the open workspace tabs are seeded from `presence.snapshot`. The
 * attach read waits for the daemon-events firehose subscription (boot and
 * every reconnect — the connection's presence and every event of the outage
 * are gone): a snapshot read before the subscription is live can miss a
 * change that lands between the read and the subscribe, with nothing to
 * correct it until the next change. Opening a tab reads its roster at once.
 * Reads are fenced per workspace: a pushed `presence:changed` or a backend
 * switch supersedes every read in flight, and a read superseded by a NEWER
 * read for the same workspace is dropped, whichever settles first.
 *
 * Membership: the roster only lists who is online, so the accepted members
 * of every open SHARED workspace tab (`memberCount > 1`) are read from
 * `workspace.members.list` (Member+) — on attach, when such a tab opens and
 * whenever the daemon's `workspace:updated` moves its `memberCount`. Reads
 * are fenced like the snapshots (a backend switch or a newer read of the
 * same workspace supersedes).
 *
 * Identity: reuse current admitted principal state. Multiplayer/presentation or
 * admission invalidation cancels every worker and clears ephemeral projections.
 */

import {
  END,
  buffers,
  channel,
  eventChannel,
  type Channel,
  type EventChannel,
  type Task,
} from 'redux-saga';
import {
  all,
  call,
  cancel,
  delay,
  fork,
  join,
  put,
  race,
  select,
  take,
  type SagaGenerator,
} from 'typed-redux-saga';
import {
  takeEveryFromSelector,
  takeLatestFromSelector,
  type SelectorChannelPayload,
} from '@themislib/themis/saga';

import {
  takeLatestInContext,
  takeSingleFlightInContext,
} from '../../../utils/context-saga-effects';
import { backendRequest } from '$lib/client/live/backend-transport';
import { invoke } from '$lib/electron-bridge';
import { createLogger } from '$lib/utils/client-logger';
import { IPC_CHANNELS } from '$shared/ipc-registry';
import {
  isPresenceRoster,
  isPresenceIdentity,
  type PresenceReportParams,
  type PresenceReportResult,
  type PresenceRoster,
} from '$shared/types/presence';
import { selectCurrentConnectionId } from '../../connections/connections-selectors';
import type { WorkspaceMembersListResult } from '../../guest-sessions/guest-sessions-types';
import { selectPrincipalSnapshot } from '../../principal/principal-selectors';
import {
  presenceMembersReceived,
  presenceContextReceived,
  presenceWorkspaceRemoved,
  presenceWorkspacesReceived,
  presenceOwnTypingSourceReceived,
  presenceReset,
  presenceRosterReceived,
  presenceSnapshotReceived,
  presenceTypingExpired,
  presenceTypingPulse,
  presenceTypingStopped,
  presenceWindowVisibilityChanged,
} from '../presence-slice';
import {
  selectPresenceContext,
  selectPresenceWorkspaceIds,
  selectOwnPresenceReport,
  selectOwnPresenceReportKey,
  selectPresenceLiveTyping,
  selectPresenceMembershipKeys,
} from '../presence-selectors';
import { PRESENCE_TYPING_EXPIRY_MS, type LiveTypingEntry } from '../presence-types';

const logger = createLogger('PresenceSaga');
const PRESENCE = IPC_CHANNELS.PRESENCE;

/** Trailing debounce on focus / visibility / typing-target changes. */
const PRESENCE_FOCUS_DEBOUNCE_MS = 250;
/** Re-pulse cadence while typing keeps going (well inside the 3 s receiver expiry). */
const PRESENCE_TYPING_PULSE_MS = 1500;
/** Composer idle for this long clears the typing target. */
const PRESENCE_TYPING_IDLE_MS = 2000;

async function invokeReport(params: PresenceReportParams): Promise<PresenceReportResult> {
  return invoke<PresenceReportResult>(PRESENCE.REPORT, params);
}

type ObservedAction = { type: string; payload?: unknown };

/** Saga-local ordinal of the latest read issued per workspace (one map per read kind). */
type RosterReads = Map<string, number>;

/** `null` for a non-member / unknown workspace or an older daemon; both leave the roster empty. */
async function readRosterSnapshot(workspaceId: string): Promise<PresenceRoster | null> {
  try {
    const result = await backendRequest<unknown>('presence.snapshot', { workspaceId });
    return isPresenceRoster(result) && result.workspaceId === workspaceId ? result : null;
  } catch (error) {
    logger.debug('presence.snapshot failed', { workspaceId, error: String(error) });
    return null;
  }
}

/** `null` for a non-member / unknown workspace or an older daemon; the membership stays unread. */
async function readMembership(workspaceId: string): Promise<WorkspaceMembersListResult | null> {
  try {
    const result = await backendRequest<WorkspaceMembersListResult>('workspace.members.list', {
      workspaceId,
    });
    return Array.isArray(result?.members) &&
      result.members.every(
        (member) =>
          isPresenceIdentity(member) &&
          (member.role === 'owner' || member.role === 'collaborator') &&
          typeof member.addedAt === 'string',
      )
      ? result
      : null;
  } catch (error) {
    logger.debug('workspace.members.list failed', { workspaceId, error: String(error) });
    return null;
  }
}

function supersedesSnapshot(action: ObservedAction, workspaceId: string): boolean {
  if (action.type === presenceReset.type) return true;
  if (
    action.type === presenceWorkspaceRemoved.type &&
    Array.isArray(action.payload) &&
    action.payload[0] === workspaceId
  )
    return true;
  return (
    action.type === presenceRosterReceived.type &&
    Array.isArray(action.payload) &&
    (action.payload[0] as PresenceRoster | undefined)?.workspaceId === workspaceId
  );
}

/** `visibilitychange` is a document event, so the window-event helper does not apply. */
function createVisibilityChannel(): EventChannel<boolean> {
  return eventChannel<boolean>((emit) => {
    if (typeof document === 'undefined') {
      emit(END as never);
      return () => {};
    }
    const handler = () => emit(document.visibilityState === 'visible');
    document.addEventListener('visibilitychange', handler);
    return () => document.removeEventListener('visibilitychange', handler);
  }, buffers.sliding<boolean>(1));
}

function* sendReport(): SagaGenerator<void> {
  const params = yield* select(selectOwnPresenceReport.select);
  try {
    const result = yield* call(invokeReport, params);
    yield* put(presenceOwnTypingSourceReceived(result.typingSource));
  } catch (error) {
    logger.debug('presence:report failed', { error: String(error) });
  }
}

function* watchVisibility(): SagaGenerator<void> {
  const channel = createVisibilityChannel();
  try {
    if (typeof document !== 'undefined')
      yield* put(presenceWindowVisibilityChanged(document.visibilityState === 'visible'));
    while (true) {
      const visible = yield* take(channel);
      if ((visible as unknown) === END) break;
      yield* put(presenceWindowVisibilityChanged(visible));
    }
  } finally {
    channel.close();
  }
}

/**
 * Debounced report: every change restarts the delay; only the last one sends.
 * The channel's initial emission is skipped — the boot report is owned by
 * `restartAttach`.
 */
function* reportOnChange({ prevPayload }: SelectorChannelPayload<string>): SagaGenerator<void> {
  if (prevPayload == null) return;
  yield* delay(PRESENCE_FOCUS_DEBOUNCE_MS);
  yield* sendReport();
}

/**
 * The FIRST pulse of an episode changes the typing target and rides the
 * debounced report; later pulses re-send the unchanged report at most every
 * PRESENCE_TYPING_PULSE_MS so the daemon's per-connection `pulse` keeps
 * advancing for the receivers' 3 s timers. Idle for PRESENCE_TYPING_IDLE_MS
 * ends the episode.
 */
function* watchTypingPulses(): SagaGenerator<void> {
  let lastPulseAt = 0;
  let episodeAgentId: string | null = null;
  let generation = 0;
  while (true) {
    const { payload } = yield* take(presenceTypingPulse);
    const [agentId] = payload;
    const now = Date.now();
    const current = ++generation;
    yield* fork(function* () {
      yield* delay(PRESENCE_TYPING_IDLE_MS);
      if (current !== generation) return;
      episodeAgentId = null;
      yield* put(presenceTypingStopped());
    });
    if (episodeAgentId !== agentId) {
      episodeAgentId = agentId;
      lastPulseAt = now;
      continue;
    }
    if (now - lastPulseAt < PRESENCE_TYPING_PULSE_MS) continue;
    lastPulseAt = now;
    yield* fork(sendReport);
  }
}

function* expireTypingLater(
  workspaceId: string,
  source: string,
  pulse: number,
): SagaGenerator<void> {
  yield* delay(PRESENCE_TYPING_EXPIRY_MS);
  yield* put(presenceTypingExpired(workspaceId, source, pulse));
}

type LiveTypingByWorkspace = Record<string, Record<string, LiveTypingEntry>>;

/**
 * The reducer keeps an entry's identity while its `(source, pulse)` pair is
 * unchanged, so a fresh timer is started exactly for the entries whose object
 * changed and are not already expired.
 */
function* armTypingTimers({
  payload,
  prevPayload,
}: SelectorChannelPayload<LiveTypingByWorkspace>): SagaGenerator<void> {
  for (const workspaceId of Object.keys(payload)) {
    const previous = prevPayload?.[workspaceId];
    for (const [source, entry] of Object.entries(payload[workspaceId])) {
      if (entry.expired || previous?.[source] === entry) continue;
      yield* fork(expireTypingLater, workspaceId, source, entry.pulse);
    }
  }
}

/**
 * Seed one workspace's roster. A pushed `presence:changed` for the workspace
 * or a backend switch that lands while the read is in flight is newer than
 * whatever the read returns, so that result is dropped. Two reads of the same
 * workspace are ordered by issue: only the latest one may apply, so an older
 * read settling later never overwrites a newer roster — and a snapshot result
 * is never mistaken for a push that would cancel the newer read.
 */
function* hydrateRoster(reads: RosterReads, workspaceId: string): SagaGenerator<void> {
  const ordinal = (reads.get(workspaceId) ?? 0) + 1;
  reads.set(workspaceId, ordinal);
  const { roster } = yield* race({
    roster: call(readRosterSnapshot, workspaceId),
    superseded: take((action: ObservedAction) => supersedesSnapshot(action, workspaceId)),
  });
  if (roster && reads.get(workspaceId) === ordinal) yield* put(presenceSnapshotReceived(roster));
}

function* hydrateRosters(reads: RosterReads, workspaceIds: string[]): SagaGenerator<void> {
  yield* all(workspaceIds.map((workspaceId) => call(hydrateRoster, reads, workspaceId)));
}

/** Opening a workspace tab publishes nothing daemon-side, so its roster is read. */
function onDisplayedWorkspacesChanged(reads: RosterReads, memberReads: RosterReads) {
  return function* ({ payload, prevPayload }: SelectorChannelPayload<string[]>) {
    if (prevPayload == null) return;
    yield* put(presenceWorkspacesReceived(payload));
    const known = new Set(prevPayload);
    for (const workspaceId of prevPayload.filter((id) => !payload.includes(id))) {
      reads.set(workspaceId, (reads.get(workspaceId) ?? 0) + 1);
      memberReads.set(workspaceId, (memberReads.get(workspaceId) ?? 0) + 1);
      yield* put(presenceWorkspaceRemoved(workspaceId));
    }
    yield* hydrateRosters(
      reads,
      payload.filter((workspaceId) => !known.has(workspaceId)),
    );
  };
}

function supersedesMembership(action: ObservedAction, workspaceId: string): boolean {
  return (
    action.type === presenceReset.type ||
    (action.type === presenceWorkspaceRemoved.type &&
      Array.isArray(action.payload) &&
      action.payload[0] === workspaceId)
  );
}

/**
 * Read one shared workspace's accepted membership. Only a backend switch
 * supersedes the read mid-flight (no push carries a membership); a read
 * superseded by a NEWER read of the same workspace is dropped.
 */
function* hydrateMembership(reads: RosterReads, workspaceId: string): SagaGenerator<void> {
  const ordinal = (reads.get(workspaceId) ?? 0) + 1;
  reads.set(workspaceId, ordinal);
  yield* put(presenceMembersReceived(workspaceId, []));
  const { membership } = yield* race({
    membership: call(readMembership, workspaceId),
    superseded: take((action: ObservedAction) => supersedesMembership(action, workspaceId)),
  });
  if (membership && reads.get(workspaceId) === ordinal)
    yield* put(presenceMembersReceived(workspaceId, membership.members));
}

/** A membership key is `${workspaceId}:${memberCount}`; the count only makes the key change. */
const membershipKeyWorkspaceId = (key: string): string => key.slice(0, key.lastIndexOf(':'));

function* hydrateMemberships(reads: RosterReads, keys: string[]): SagaGenerator<void> {
  yield* all(keys.map((key) => call(hydrateMembership, reads, membershipKeyWorkspaceId(key))));
}

/** A shared tab opened, or a displayed workspace's `memberCount` moved: its membership is re-read. */
function onMembershipKeysChanged(reads: RosterReads) {
  return function* ({ payload, prevPayload }: SelectorChannelPayload<string[]>) {
    if (prevPayload == null) return;
    const known = new Set(prevPayload);
    yield* hydrateMemberships(
      reads,
      payload.filter((key) => !known.has(key)),
    );
  };
}

type MembershipNotification =
  ReturnType<typeof presenceRosterReceived> | ReturnType<typeof presenceWorkspaceRemoved>;
type MembershipRefresh = { workspaceId: string; cancel: boolean };

function membershipNotificationWorkspace(action: MembershipNotification): string {
  const value = action.payload[0];
  return typeof value === 'string' ? value : value.workspaceId;
}

function* queueMembershipRefresh(
  notifications: Channel<MembershipRefresh>,
  action: MembershipNotification,
): SagaGenerator<void> {
  const workspaceId = membershipNotificationWorkspace(action);
  const removed = action.type === presenceWorkspaceRemoved.type;
  if (!removed) {
    if (!(yield* select(selectPresenceWorkspaceIds.select)).includes(workspaceId)) return;
    yield* delay(PRESENCE_FOCUS_DEBOUNCE_MS);
  }
  yield* put(notifications, { workspaceId, cancel: removed });
}

function* refreshNotifiedMembership(
  reads: RosterReads,
  { workspaceId }: MembershipRefresh,
): SagaGenerator<void> {
  if (
    (yield* select(selectPresenceMembershipKeys.select)).some(
      (key) => membershipKeyWorkspaceId(key) === workspaceId,
    )
  )
    yield* call(hydrateMembership, reads, workspaceId);
}

/** Refresh on an authorized workspace notification. Offline role changes also
 * require the daemon to emit that notification; host-global events cannot stand
 * in for delivery to guests. Debounce bursts, serialize reads per workspace and
 * discard pending work when that workspace leaves the current admission. */
function* watchMembershipNotifications(reads: RosterReads): SagaGenerator<void> {
  const notifications = channel<MembershipRefresh>(buffers.expanding());
  const refresh = yield* takeSingleFlightInContext(
    notifications,
    ({ workspaceId, cancel }) => (cancel ? { context: workspaceId, cancel: true } : workspaceId),
    refreshNotifiedMembership,
    reads,
  );
  const debounce = yield* takeLatestInContext(
    [presenceRosterReceived, presenceWorkspaceRemoved],
    membershipNotificationWorkspace,
    queueMembershipRefresh,
    notifications,
  );
  try {
    yield* join([refresh, debounce]);
  } finally {
    yield* cancel([refresh, debounce]);
    notifications.close();
  }
}

/** The admitted principal owns all workers and their pending reads/reports. */
function* runPresence({
  payload: context,
}: SelectorChannelPayload<string | null>): SagaGenerator<void> {
  yield* put(presenceReset());
  if (!context) return;
  const snapshot = yield* select(selectPrincipalSnapshot.select);
  if (!snapshot) return;
  const backendId = yield* select(selectCurrentConnectionId.select);
  yield* put(presenceContextReceived(context, snapshot.principal.id));
  const reads: RosterReads = new Map();
  const memberReads: RosterReads = new Map();
  const tasks: Task[] = [];
  yield* put(presenceWorkspacesReceived(yield* select(selectPresenceWorkspaceIds.select)));
  try {
    tasks.push(yield* fork(watchVisibility));
    tasks.push(yield* fork(watchTypingPulses));
    tasks.push(yield* fork(watchMembershipNotifications, memberReads));
    tasks.push(yield* takeLatestFromSelector(selectOwnPresenceReportKey, reportOnChange));
    tasks.push(yield* takeEveryFromSelector(selectPresenceLiveTyping, armTypingTimers));
    tasks.push(
      yield* takeEveryFromSelector(
        selectPresenceWorkspaceIds,
        onDisplayedWorkspacesChanged(reads, memberReads),
      ),
    );
    tasks.push(
      yield* takeEveryFromSelector(
        selectPresenceMembershipKeys,
        onMembershipKeysChanged(memberReads),
      ),
    );
    const workspaceIds = yield* select(selectPresenceWorkspaceIds.select);
    const membershipKeys = yield* select(selectPresenceMembershipKeys.select);
    yield* fork(hydrateRosters, reads, workspaceIds);
    yield* fork(hydrateMemberships, memberReads, membershipKeys);
    yield* sendReport();
    yield* all(tasks.map((task) => join(task)));
  } finally {
    for (const task of tasks) yield* cancel(task);
    yield* put(presenceReset());
    // Empty only this window's contribution. Never route old-host cleanup
    // through a window which has already switched to another backend.
    if (backendId === (yield* select(selectCurrentConnectionId.select))) {
      try {
        yield* call(invokeReport, { focus: [], typing: null });
      } catch {
        /* A disconnected connection already dropped its ephemeral state. */
      }
    }
  }
}

export function* presenceSaga(): SagaGenerator<void> {
  yield* takeLatestFromSelector(selectPresenceContext, runPresence);
}
