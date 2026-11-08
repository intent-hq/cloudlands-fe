import { describe, expect, it } from 'vitest';
import type { QueuedMessage } from '$shared/types';
import {
  advanceQueueDrainPrediction,
  initialQueueDrainPredictorState,
  hasPendingDirectSend,
  predictDrainedQueueIds,
  QUEUE_DRAIN_PREDICTION_TIMEOUT_MS,
  type QueueDrainPredictorInput,
  type QueueDrainPredictorState,
} from './queue-drain-prediction';

function queued(id: string, fields: Partial<QueuedMessage> = {}): QueuedMessage {
  return { id, content: id, queuedAt: '2026-11-03T00:00:00.000Z', position: 0, ...fields };
}

const none = new Set<string>();

function step(
  state: QueueDrainPredictorState,
  input: Partial<QueueDrainPredictorInput> & Pick<QueueDrainPredictorInput, 'queue'>,
): QueueDrainPredictorState {
  return advanceQueueDrainPrediction(state, {
    busy: false,
    blocked: false,
    interrupted: false,
    directSendPending: false,
    delivered: none,
    now: 1_000,
    ...input,
  });
}

/** An agent that was mid-turn when the queue was observed. */
function busyWith(queue: QueuedMessage[]): QueueDrainPredictorState {
  return step(initialQueueDrainPredictorState, { busy: true, queue, now: 0 });
}

describe('predictDrainedQueueIds', () => {
  it('flushes every ready entry in queue order', () => {
    expect(predictDrainedQueueIds([queued('a'), queued('b')], 0)).toEqual(['a', 'b']);
  });

  it('skips entries the daemon holds back', () => {
    const queue = [
      queued('editing', { editing: true }),
      queued('held', { holdKind: 'rate', holdUntil: '2030-01-01T00:00:00.000Z' }),
      queued('failed', { requeuedAfterFailure: true }),
      queued('ready'),
    ];
    expect(predictDrainedQueueIds(queue, Date.parse('2026-11-03T00:00:00.000Z'))).toEqual([
      'ready',
    ]);
  });

  it('treats an expired hold as ready', () => {
    const queue = [queued('a', { holdKind: 'rate', holdUntil: '2026-01-01T00:00:00.000Z' })];
    expect(predictDrainedQueueIds(queue, Date.parse('2026-11-03T00:00:00.000Z'))).toEqual(['a']);
  });

  it('predicts only the head when a script-monitor wake forces the single-entry path', () => {
    const wake = queued('wake', {
      messageMetadata: { type: 'script_monitor_wake', monitorId: 'm1' },
    });
    expect(predictDrainedQueueIds([queued('a'), wake, queued('b')], 0)).toEqual(['a']);
    expect(predictDrainedQueueIds([wake, queued('a')], 0)).toEqual([]);
  });
});

describe('advanceQueueDrainPrediction', () => {
  it('shows ready entries as sent when the turn ends', () => {
    const state = step(busyWith([queued('a'), queued('b')]), {
      queue: [queued('a'), queued('b')],
    });
    expect(state.prediction).toEqual({ ids: ['a', 'b'], startedAt: 1_000 });
  });

  it('never predicts for an agent that was already idle with queued work', () => {
    const state = step(initialQueueDrainPredictorState, { queue: [queued('a')] });
    expect(state.prediction).toBeNull();
  });

  it('does not predict while a visible blocker stops the drain', () => {
    const state = step(busyWith([queued('a')]), { queue: [queued('a')], blocked: true });
    expect(state.prediction).toBeNull();
  });

  it('keeps the prediction through the drained turn until the rows leave the queue', () => {
    let state = step(busyWith([queued('a')]), { queue: [queued('a')] });
    state = step(state, { queue: [queued('a')], busy: true, now: 2_000 });
    expect(state.prediction?.ids).toEqual(['a']);
    state = step(state, { queue: [], busy: true, now: 3_000 });
    expect(state.prediction).toBeNull();
  });

  it('hands the rows back at the timeout even when a turn that is not the drain is running', () => {
    let state = step(busyWith([queued('a')]), { queue: [queued('a')] });
    state = step(state, { queue: [queued('a')], busy: true, now: 2_000 });
    state = step(state, {
      queue: [queued('a')],
      busy: true,
      now: 1_000 + QUEUE_DRAIN_PREDICTION_TIMEOUT_MS,
    });
    expect(state.prediction).toBeNull();
  });

  it('does not predict when the turn was stopped or preempted', () => {
    const state = step(busyWith([queued('a')]), { queue: [queued('a')], interrupted: true });
    expect(state.prediction).toBeNull();
  });

  it('does not predict when a force-sent message preempts the turn', () => {
    const state = step(busyWith([queued('a')]), {
      queue: [queued('a')],
      directSendPending: true,
    });
    expect(state.prediction).toBeNull();
  });

  it('predicts on the next idle edge once the force-sent turn ends on its own', () => {
    let state = step(busyWith([queued('a')]), { queue: [queued('a')], directSendPending: true });
    state = step(state, { queue: [queued('a')], busy: true, now: 2_000 });
    state = step(state, { queue: [queued('a')], now: 3_000 });
    expect(state.prediction).toEqual({ ids: ['a'], startedAt: 3_000 });
  });

  it('keeps a running prediction when a later message is sent directly', () => {
    let state = step(busyWith([queued('a')]), { queue: [queued('a')] });
    state = step(state, { queue: [queued('a')], directSendPending: true, now: 1_200 });
    expect(state.prediction?.ids).toEqual(['a']);
  });

  it('ends an idle prediction when the interruption is reported after the turn ends', () => {
    let state = step(busyWith([queued('a')]), { queue: [queued('a')] });
    expect(state.prediction?.ids).toEqual(['a']);
    state = step(state, { queue: [queued('a')], interrupted: true, now: 1_050 });
    expect(state.prediction).toBeNull();
  });

  it('drops rows once authoritative evidence shows them', () => {
    let state = step(busyWith([queued('a'), queued('b')]), { queue: [queued('a'), queued('b')] });
    state = step(state, {
      queue: [queued('a'), queued('b')],
      busy: true,
      delivered: new Set(['a']),
    });
    expect(state.prediction?.ids).toEqual(['b']);
    state = step(state, {
      queue: [queued('a'), queued('b')],
      busy: true,
      delivered: new Set(['a', 'b']),
    });
    expect(state.prediction).toBeNull();
  });

  it('hands the rows back to the queue when no turn starts before the timeout', () => {
    let state = step(busyWith([queued('a')]), { queue: [queued('a')] });
    state = step(state, {
      queue: [queued('a')],
      now: 1_000 + QUEUE_DRAIN_PREDICTION_TIMEOUT_MS - 1,
    });
    expect(state.prediction?.ids).toEqual(['a']);
    state = step(state, { queue: [queued('a')], now: 1_000 + QUEUE_DRAIN_PREDICTION_TIMEOUT_MS });
    expect(state.prediction).toBeNull();
    // The same idle period never re-predicts.
    state = step(state, { queue: [queued('a')], now: 60_000 });
    expect(state.prediction).toBeNull();
  });

  it('ends the prediction when a blocker appears before the turn starts', () => {
    let state = step(busyWith([queued('a')]), { queue: [queued('a')] });
    state = step(state, { queue: [queued('a')], blocked: true, now: 1_500 });
    expect(state.prediction).toBeNull();
  });

  it('re-predicts from the current queue on the next idle edge', () => {
    let state = step(busyWith([queued('a')]), { queue: [queued('a')] });
    state = step(state, { queue: [queued('a'), queued('b')], busy: true, now: 2_000 });
    state = step(state, { queue: [queued('b')], now: 3_000 });
    expect(state.prediction).toEqual({ ids: ['b'], startedAt: 3_000 });
  });

  it('returns the same state object when nothing changed', () => {
    const state = step(busyWith([queued('a')]), { queue: [queued('a')] });
    expect(step(state, { queue: [queued('a')], now: 1_200 })).toBe(state);
  });
});

describe('hasPendingDirectSend', () => {
  const send = (
    id: string,
    status: 'preparing' | 'sending' | 'accepted' | 'uncertain' = 'sending',
  ) => ({ id, appMessageId: `app-${id}`, status });

  it('reports a direct send that has not reached the transcript', () => {
    expect(hasPendingDirectSend([send('f', 'preparing')], [])).toBe(true);
    expect(hasPendingDirectSend([send('f', 'accepted')], [{ id: 'other' }])).toBe(true);
  });

  it('ignores a send the transcript already shows', () => {
    expect(hasPendingDirectSend([send('f')], [{ id: 'row', appMessageId: 'app-f' }])).toBe(false);
    expect(hasPendingDirectSend([send('f')], [{ id: 'f' }])).toBe(false);
  });

  it('ignores a failed send, which starts no turn', () => {
    expect(hasPendingDirectSend([send('f', 'uncertain')], [])).toBe(false);
  });
});
