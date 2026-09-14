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
 * Identity: `principal.me` is read per backend so the roster's own row can be
 * told apart; a backend switch resets every roster first.
 */

import { END, buffers, eventChannel, type EventChannel } from 'redux-saga';
import {
  all,
  call,
  delay,
  fork,
  join,
  put,
  select,
  take,
  type SagaGenerator,
} from 'typed-redux-saga';
import {
  takeEveryFromSelector,
  takeLatestFromSelector,
  type SelectorChannelPayload,
} from '@augmentcode/themis/saga';

import { backendRequest } from '$lib/client/live/backend-transport';
import { invoke } from '$lib/electron-bridge';
import { createLogger } from '$lib/utils/client-logger';
import { IPC_CHANNELS } from '$shared/ipc-registry';
import type { PresenceReportParams, PresenceReportResult } from '$shared/types/presence';
import { selectCurrentConnectionId } from '../../connections/connections-selectors';
import {
  presenceOwnPrincipalReceived,
  presenceOwnTypingSourceReceived,
  presenceReset,
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

async function readOwnPrincipalId(): Promise<string | null> {
  try {
    const result = await backendRequest<{ id?: unknown }>('principal.me', {});
    return typeof result?.id === 'string' ? result.id : null;
  } catch {
    return null;
  }
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

function* onBackendChanged({
  payload,
  prevPayload,
}: SelectorChannelPayload<string | null>): SagaGenerator<void> {
  if (prevPayload !== null && prevPayload !== undefined) yield* put(presenceReset());
  if (!payload) return;
  const principalId = yield* call(readOwnPrincipalId);
  yield* put(presenceOwnPrincipalReceived(principalId));
}

export function* presenceSaga(): SagaGenerator<void> {
  const tasks = [
    yield* fork(watchVisibility),
    yield* fork(watchTypingPulses),
    yield* takeLatestFromSelector(selectOwnPresenceReportKey, reportOnChange),
    yield* takeEveryFromSelector(selectPresenceLiveTyping, armTypingTimers),
    yield* takeLatestFromSelector(selectCurrentConnectionId, onBackendChanged),
  ];
  yield* all(tasks.map((task) => join(task)));
}
