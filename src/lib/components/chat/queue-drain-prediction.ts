import type { QueuedMessage } from '$shared/types';
import { isQueuedMessageReadyForBatch } from '$lib/utils/queued-message-permissions';

/**
 * How long a predicted drain may show queued rows as sent. The daemon normally
 * starts the drained turn and replaces them with its own rows well within
 * this; a prediction that outlives it (a gate the client cannot see, such as a
 * quarantined runtime, or a turn that was not the drain) hands the rows back
 * to the queue card.
 */
export const QUEUE_DRAIN_PREDICTION_TIMEOUT_MS = 10_000;

interface QueueDrainPrediction {
  /** Queue entry ids shown as sent, in queue order. */
  ids: string[];
  startedAt: number;
}

export interface QueueDrainPredictorState {
  wasBusy: boolean;
  /** When this view saw the current turn start; null while idle. */
  busySince: number | null;
  /** A direct send was admitted during the current turn, so that turn was preempted. */
  preempted: boolean;
  prediction: QueueDrainPrediction | null;
}

export interface QueueDrainPredictorInput {
  /** The agent is in a turn (responding or streaming). */
  busy: boolean;
  /** A visible condition stops the daemon from draining (error, permission, retired). */
  blocked: boolean;
  /**
   * The turn was stopped or preempted (a local Stop in flight, or the final
   * assistant row marked `stopReason: "interrupted"`). Only a turn that ends
   * on its own drains the queue: Stop leaves it untouched and a preempting
   * message starts its own turn.
   */
  interrupted: boolean;
  /**
   * Admission time of the newest direct (unqueued) send still in flight, or
   * null. One admitted while a turn runs is a ⌘Enter force-send: the daemon
   * preempts the turn, runs that message next and keeps the queue for after it.
   */
  directSendAt: number | null;
  /** The full confirmed queue in daemon order, every origin included. */
  queue: readonly QueuedMessage[];
  /** Entries already shown by authoritative evidence (processing rows or transcript). */
  delivered: ReadonlySet<string>;
  now: number;
  timeoutMs?: number;
}

export const initialQueueDrainPredictorState: QueueDrainPredictorState = {
  wasBusy: false,
  busySince: null,
  preempted: false,
  prediction: null,
};

function isScriptMonitorWake(message: QueuedMessage): boolean {
  return message.messageMetadata?.type === 'script_monitor_wake';
}

/**
 * Entries the daemon flushes when the agent goes idle (PROTOCOL §5.5
 * "Queued-message flush"): every ready entry in queue order, or only the head
 * when a script-monitor wake forces the single-entry path. Entries requeued
 * after a terminal failure wait for an explicit retry, so they are not predicted.
 */
export function predictDrainedQueueIds(queue: readonly QueuedMessage[], now: number): string[] {
  if (queue.some(isScriptMonitorWake)) {
    const head = queue[0];
    return head && !isScriptMonitorWake(head) && isPredictable(head, now) ? [head.id] : [];
  }
  return queue.filter((message) => isPredictable(message, now)).map((message) => message.id);
}

/** Admission time of the newest direct send that is still being sent. */
export function latestDirectSendAt(
  sends: readonly { createdAt: number; status: string }[],
): number | null {
  let latest: number | null = null;
  for (const send of sends)
    if (
      (send.status === 'preparing' || send.status === 'sending') &&
      send.createdAt > (latest ?? -Infinity)
    )
      latest = send.createdAt;
  return latest;
}

function isPredictable(message: QueuedMessage, now: number): boolean {
  return !message.requeuedAfterFailure && isQueuedMessageReadyForBatch(message, now);
}

/**
 * Bridge the gap between a turn ending and the daemon starting the queued turn.
 *
 * Only the busy→idle edge of a turn that ended on its own starts a
 * prediction: that is the moment the daemon drains. An idle agent that merely
 * has queued work (a reload, a held entry) or whose turn was stopped is never
 * shown as sending. Predicted rows stay sent until authoritative evidence
 * replaces them or they leave the queue, and never past the timeout; while the
 * agent is idle a visible blocker or interruption also ends the prediction.
 *
 * A direct send admitted during a turn latches `preempted` until that turn's
 * idle edge, so the edge never predicts even when the forced message has
 * already reached the transcript. If the view sees no idle edge between the
 * preempted turn and the forced one, the forced turn's own end is not
 * predicted either; the rows then wait for the daemon's evidence.
 */
export function advanceQueueDrainPrediction(
  state: QueueDrainPredictorState,
  input: QueueDrainPredictorInput,
): QueueDrainPredictorState {
  const { busy, queue, delivered, now } = input;
  const blocked = input.blocked || input.interrupted;
  const timeoutMs = input.timeoutMs ?? QUEUE_DRAIN_PREDICTION_TIMEOUT_MS;
  let prediction = state.prediction;

  if (prediction) {
    const queued = new Set(queue.map((message) => message.id));
    const ids = prediction.ids.filter((id) => queued.has(id) && !delivered.has(id));
    const expired = now - prediction.startedAt >= timeoutMs;
    // A new idle edge re-predicts from the current queue below.
    const turnEnded = state.wasBusy && !busy;
    if (!ids.length || expired || (blocked && !busy) || turnEnded) prediction = null;
    else if (ids.length !== prediction.ids.length) prediction = { ...prediction, ids };
  }

  const ended = state.wasBusy && !busy;
  const turnStart = state.wasBusy ? state.busySince : busy ? now : null;
  const preempted =
    (state.wasBusy && state.preempted) ||
    (turnStart !== null && input.directSendAt !== null && input.directSendAt > turnStart);

  if (!prediction && ended && !blocked && !preempted) {
    const ids = predictDrainedQueueIds(queue, now).filter((id) => !delivered.has(id));
    if (ids.length) prediction = { ids, startedAt: now };
  }

  const next = {
    wasBusy: busy,
    busySince: busy ? turnStart : null,
    preempted: busy && preempted,
    prediction,
  };
  if (
    state.wasBusy === next.wasBusy &&
    state.busySince === next.busySince &&
    state.preempted === next.preempted &&
    state.prediction === next.prediction
  )
    return state;
  return next;
}
