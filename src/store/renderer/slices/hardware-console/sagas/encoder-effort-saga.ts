import { takeEveryFromSelector } from '@augmentcode/themis/saga';
import { call, fork, put, take, takeEvery } from 'typed-redux-saga';
import {
  applyReasoningEffort,
  markReasoningEffortIntent,
  releaseReasoningEffortIntent,
} from '$features/agent/reasoning-effort';
import { stepEncoderEffort } from '$features/hardware-console/encoder/effort-step';
import { store as appStore } from '../../../store';
import { updateSession } from '../../agent-session/agent-session-slice';
import {
  selectEncoderAgentIdentity,
  selectEncoderEffortTarget,
} from '../hardware-console-selectors';
import {
  encoderEffortHudShown,
  encoderEffortRotated,
  encoderHudHidden,
  encoderInputStopped,
} from '../hardware-console-slice';
import type { EncoderEffortFeedback } from '../hardware-console-types';

type PendingEffort = EncoderEffortFeedback & {
  previous: string | null;
  intent: number;
  /** Independent edits start a new sequence with their own rollback value. */
  generation: number;
  /** Earlier confirmed values whose delayed echoes may arrive during this save. */
  echoes: (string | null)[];
};

/**
 * Update the session/gauge immediately, but serialize wire writes. Turns during
 * a save collapse to the latest desired choice, with a confirmed rollback value
 * carried forward after each response. Every queued write keeps its selection
 * and model identity; changing context discards that unsent intent.
 */
export function* encoderEffortSaga() {
  let pending: PendingEffort | null = null;
  let busy = false;
  let live = true;
  let generation = 0;
  let inFlight: (PendingEffort & { valid: boolean; stopped: boolean }) | null = null;
  const readPending = (): PendingEffort | null => pending;
  const currentEffort = ({ target }: EncoderEffortFeedback) =>
    appStore.state.agentSessions.byAgentId[target.agentId]?.reasoningEffort ?? null;

  function sameAgentModel(request: EncoderEffortFeedback): boolean {
    const { workspaceId, agentId, key } = request.target;
    return selectEncoderAgentIdentity.select(appStore.state, workspaceId, agentId)?.key === key;
  }

  function recognizesEffort(request: PendingEffort): boolean {
    const current = currentEffort(request);
    return current === request.effort || request.echoes.includes(current);
  }

  function* discardPending() {
    const queued = pending;
    pending = null;
    if (queued)
      releaseReasoningEffortIntent(queued.target.agentId, queued.target.workspaceId, queued.intent);
    if (!queued || !sameAgentModel(queued) || currentEffort(queued) !== queued.effort) return;
    // Keep the already-sent value while its result is unresolved.
    const restore =
      inFlight?.valid &&
      inFlight.target.key === queued.target.key &&
      inFlight.generation === queued.generation
        ? inFlight.effort
        : queued.previous;
    yield* put(updateSession(queued.target.agentId, { reasoningEffort: restore }));
  }

  function* drain() {
    busy = true;
    try {
      while (pending) {
        const request: PendingEffort = pending;
        if (selectEncoderEffortTarget.select(appStore.state)?.key !== request.target.key) {
          yield* discardPending();
          continue;
        }
        pending = null;
        const { agentId, workspaceId } = request.target;
        const write = { ...request, valid: true, stopped: false };
        inFlight = write;
        const accepted = yield* call(
          applyReasoningEffort,
          agentId,
          workspaceId,
          request.effort,
          request.previous,
          {
            source: 'encoder' as const,
            intent: request.intent,
            canSend: () =>
              live &&
              write.valid &&
              selectEncoderEffortTarget.select(appStore.state)?.key === request.target.key,
            onConfirmedEffort: (effort: string | null) => {
              request.previous = effort;
              write.previous = effort;
              request.echoes = [...new Set([...request.echoes, effort])];
              write.echoes = request.echoes;
            },
            canReconcileAccepted: () =>
              write.stopped && sameAgentModel(write) && recognizesEffort(write),
            // Even an ABA turn sequence supersedes a failure rollback.
            canMutate: () =>
              live &&
              write.valid &&
              sameAgentModel(request) &&
              readPending()?.target.key !== request.target.key,
          },
        );
        inFlight = null;
        const queued = readPending();
        if (queued?.target.key === request.target.key && queued.generation === request.generation) {
          queued.previous = accepted ? request.effort : request.previous;
          queued.echoes = accepted
            ? [...new Set([...request.echoes, request.effort])]
            : request.echoes;
          // A daemon echo of the leading save is expected; unrelated edits win.
          if (currentEffort(queued) !== queued.effort && !recognizesEffort(request)) {
            pending = null;
            yield* put(encoderHudHidden());
          }
        } else if (write.valid && sameAgentModel(request)) {
          // The response settles our write even if a prior echo replaced its
          // optimistic field. Permission loss forbids new RPCs, not local cleanup.
          if (recognizesEffort(request)) {
            yield* put(
              updateSession(agentId, {
                reasoningEffort: accepted ? request.effort : request.previous,
              }),
            );
          }
          if (!accepted) {
            const feedback = appStore.state.hardwareConsole.encoderEffortFeedback;
            if (feedback?.target.key === request.target.key) yield* put(encoderHudHidden());
          }
        }
      }
    } finally {
      busy = false;
    }
  }

  function* rotate({ payload: [direction, workspaceId] }: ReturnType<typeof encoderEffortRotated>) {
    const target = selectEncoderEffortTarget.select(appStore.state);
    if (!target || target.workspaceId !== workspaceId) return;
    let queued = pending?.target.key === target.key ? pending : null;
    const writing = inFlight?.valid && inFlight.target.key === target.key ? inFlight : null;
    if (queued && !recognizesEffort(queued) && !(writing && recognizesEffort(writing))) {
      // A separate control changed the field; its value becomes the wheel cursor.
      pending = null;
      queued = null;
      yield* put(encoderHudHidden());
    }
    const intent = queued ?? (writing && recognizesEffort(writing) ? writing : null);
    // A separate edit owns the new baseline, even if later turns revisit an
    // older requested value. Replies from that earlier sequence cannot settle it.
    if (!intent && writing) writing.valid = false;
    const current = intent
      ? intent.effort
      : (appStore.state.agentSessions.byAgentId[target.agentId]?.reasoningEffort ?? null);
    const effort = stepEncoderEffort(current, target.levels, direction);
    if (effort === undefined) {
      // A detent at the end still rejects an older echo; it needs no extra RPC.
      if (intent && currentEffort(intent) !== current) {
        yield* put(updateSession(target.agentId, { reasoningEffort: current }));
      }
      return;
    }
    pending = {
      target,
      effort,
      intent: markReasoningEffortIntent(target.agentId, target.workspaceId),
      previous: intent ? intent.previous : current,
      generation: intent?.generation ?? ++generation,
      echoes: intent?.echoes ?? [current],
    };
    yield* put(updateSession(target.agentId, { reasoningEffort: effort }));
    yield* put(encoderEffortHudShown({ target, effort }));
    if (!busy) yield* fork(drain);
  }

  function* stopInput() {
    yield* discardPending();
    const write = inFlight;
    if (write?.valid) {
      write.stopped = true;
      write.valid = false;
      releaseReasoningEffortIntent(write.target.agentId, write.target.workspaceId, write.intent);
      // Remove optimistic device work now. An issued success still reconciles
      // through the shared writer, even when its only echo preceded teardown.
      if (sameAgentModel(write) && recognizesEffort(write)) {
        yield* put(updateSession(write.target.agentId, { reasoningEffort: write.previous }));
      }
    }
    yield* put(encoderHudHidden());
  }

  try {
    yield* takeEvery(updateSession, function* ({ payload: [agentId, , options] }) {
      if (options?.reasoningEffortSource !== 'control') return;
      // Explicit local edits supersede encoder intent even when they return to
      // Auto or another historical value that an untagged daemon echo can carry.
      if (pending?.target.agentId === agentId) pending = null;
      if (inFlight?.target.agentId === agentId) inFlight.valid = false;
      if (appStore.state.hardwareConsole.encoderEffortFeedback?.target.agentId === agentId) {
        yield* put(encoderHudHidden());
      }
    });
    yield* takeEveryFromSelector(selectEncoderEffortTarget, function* ({ payload: target }) {
      if (pending && pending.target.key !== target?.key) yield* discardPending();
      const feedback = appStore.state.hardwareConsole.encoderEffortFeedback;
      if (feedback && feedback.target.key !== target?.key) yield* put(encoderHudHidden());
    });
    yield* takeEvery(encoderInputStopped, stopInput);
    while (true) yield* rotate(yield* take(encoderEffortRotated));
  } finally {
    live = false;
    yield* stopInput();
  }
}
