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
   * A message sent straight to the conversation (a ⌘Enter force-send) has not
   * reached the transcript yet. The daemon runs it as the next turn and keeps
   * the queue for after it, so the turn it preempted ends without a drain.
   */
  directSendPending: boolean;
  /** The full confirmed queue in daemon order, every origin included. */
  queue: readonly QueuedMessage[];
  /** Entries already shown by authoritative evidence (processing rows or transcript). */
  delivered: ReadonlySet<string>;
  now: number;
  timeoutMs?: number;
}

export const initialQueueDrainPredictorState: QueueDrainPredictorState = {
  wasBusy: false,
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

/** A failed (`uncertain`) send starts no turn, so it never holds back a drain. */
export function hasPendingDirectSend(
  sends: readonly { id: string; appMessageId?: string; status: string }[],
  transcript: readonly { id: string; appMessageId?: string }[],
): boolean {
  return sends.some(
    (send) =>
      send.status !== 'uncertain' &&
      !transcript.some(
        (message) =>
          message.id === send.id ||
          (!!send.appMessageId && message.appMessageId === send.appMessageId),
      ),
  );
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

  if (!prediction && state.wasBusy && !busy && !blocked && !input.directSendPending) {
    const ids = predictDrainedQueueIds(queue, now).filter((id) => !delivered.has(id));
    if (ids.length) prediction = { ids, startedAt: now };
  }

  if (state.wasBusy === busy && state.prediction === prediction) return state;
  return { wasBusy: busy, prediction };
}
