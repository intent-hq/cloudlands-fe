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
 * rosters of the open workspace tabs are seeded from `presence.snapshot` when
 * the backend is attached, when a tab opens, and again on reconnect (the
 * connection's presence and every event of the outage are gone). A snapshot
 * overtaken by a `presence:changed` for its workspace is dropped.
 *
 * Identity: `principal.me` is read per backend so the roster's own row can be
 * told apart; a backend switch resets every roster first.
 */

import { END, buffers, eventChannel, type EventChannel } from 'redux-saga';
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
  createChannelFromSelector,
  takeEveryFromSelector,
  takeLatestFromSelector,
  type SelectorChannelPayload,
} from '@augmentcode/themis/saga';

import { backendRequest, onBackendReconnected } from '$lib/client/live/backend-transport';
import { invoke } from '$lib/electron-bridge';
import { createLogger } from '$lib/utils/client-logger';
import { IPC_CHANNELS } from '$shared/ipc-registry';
import {
  isPresenceRoster,
  type PresenceReportParams,
  type PresenceReportResult,
  type PresenceRoster,
} from '$shared/types/presence';
import { selectCurrentConnectionId } from '../../connections/connections-selectors';
import { selectActiveWorkspaceIds } from '../../tab-state/tab-state-selectors';
import {
  presenceOwnPrincipalReceived,
  presenceOwnTypingSourceReceived,
  presenceReset,
  presenceRosterReceived,
  presenceTypingExpired,
  presenceTypingPulse,
  presenceTypingStopped,
  presenceWindowVisibilityChanged,
} from '../presence-slice';
import {
  selectOwnPresenceReport,
  selectOwnPresenceReportKey,
  selectPresenceLiveTyping,
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

async function readOwnPrincipalId(): Promise<string | null> {
  try {
    const result = await backendRequest<{ id?: unknown }>('principal.me', {});
    return typeof result?.id === 'string' ? result.id : null;
  } catch {
    return null;
  }
}

/** `null` for a non-member / unknown workspace or an older daemon; both leave the roster empty. */
async function readRosterSnapshot(workspaceId: string): Promise<PresenceRoster | null> {
  try {
    const result = await backendRequest<unknown>('presence.snapshot', { workspaceId });
    return isPresenceRoster(result) ? result : null;
  } catch (error) {
    logger.debug('presence.snapshot failed', { workspaceId, error: String(error) });
    return null;
  }
}

function supersedesSnapshot(action: ObservedAction, workspaceId: string): boolean {
  if (action.type === presenceReset.type) return true;
  return (
    action.type === presenceRosterReceived.type &&
    Array.isArray(action.payload) &&
    (action.payload[0] as PresenceRoster | undefined)?.workspaceId === workspaceId
  );
}

function createReconnectChannel(): EventChannel<true> {
  return eventChannel<true>((emit) => onBackendReconnected(() => emit(true)), buffers.sliding(1));
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

/** Debounced report: every change restarts the delay; only the last one sends. */
function* reportOnChange(): SagaGenerator<void> {
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
 * Seed one workspace's roster. A `presence:changed` for the workspace or a
 * backend switch that lands while the read is in flight is newer than
 * whatever the read returns, so that result is dropped.
 */
function* hydrateRoster(workspaceId: string): SagaGenerator<void> {
  const { roster } = yield* race({
    roster: call(readRosterSnapshot, workspaceId),
    superseded: take((action: ObservedAction) => supersedesSnapshot(action, workspaceId)),
  });
  if (roster) yield* put(presenceRosterReceived(roster));
}

function* hydrateRosters(workspaceIds: string[]): SagaGenerator<void> {
  yield* all(workspaceIds.map((workspaceId) => call(hydrateRoster, workspaceId)));
}

/** Opening a workspace tab publishes nothing daemon-side, so its roster is read. */
function* onDisplayedWorkspacesChanged({
  payload,
  prevPayload,
}: SelectorChannelPayload<string[]>): SagaGenerator<void> {
  const known = new Set(prevPayload ?? []);
  yield* hydrateRosters(payload.filter((workspaceId) => !known.has(workspaceId)));
}

/** Identity first, so the seeded rosters never show this window's own row. */
function* attachBackend(): SagaGenerator<void> {
  const principalId = yield* call(readOwnPrincipalId);
  yield* put(presenceOwnPrincipalReceived(principalId));
  const workspaceIds = yield* select(selectActiveWorkspaceIds.select);
  yield* hydrateRosters(workspaceIds);
}

/**
 * The selector channel emits its first value before anything can take it and
 * a local window's backend id never changes afterwards, so the current backend
 * is attached explicitly; a later change resets the rosters and attaches the
 * new one.
 */
function* watchBackend(): SagaGenerator<void> {
  const channel = yield* createChannelFromSelector(selectCurrentConnectionId);
  let backendId = yield* select(selectCurrentConnectionId.select);
  let attached = backendId ? yield* fork(attachBackend) : null;
  try {
    while (true) {
      const { payload } = yield* take(channel);
      if (attached) yield* cancel(attached);
      if (backendId) yield* put(presenceReset());
      backendId = payload;
      attached = backendId ? yield* fork(attachBackend) : null;
    }
  } finally {
    channel.close();
  }
}

/**
 * Main re-sends the merged `presence.update` when the pooled connection comes
 * back; this window re-reads identity and the displayed rosters, then reports
 * once so the connection's fresh `typingSource` is learned.
 */
function* watchReconnects(): SagaGenerator<void> {
  const channel = createReconnectChannel();
  try {
    while (true) {
      yield* take(channel);
      yield* attachBackend();
      yield* sendReport();
    }
  } finally {
    channel.close();
  }
}

export function* presenceSaga(): SagaGenerator<void> {
  const tasks = [
    yield* fork(watchVisibility),
    yield* fork(watchTypingPulses),
    yield* fork(watchBackend),
    yield* fork(watchReconnects),
    yield* takeLatestFromSelector(selectOwnPresenceReportKey, reportOnChange),
    yield* takeEveryFromSelector(selectPresenceLiveTyping, armTypingTimers),
    yield* takeEveryFromSelector(selectActiveWorkspaceIds, onDisplayedWorkspacesChanged),
  ];
  yield* all(tasks.map((task) => join(task)));
}
