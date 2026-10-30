import { call, fork, put, select, take, takeEvery, type SagaGenerator } from 'typed-redux-saga';
import { channel, type Channel } from 'redux-saga';
import { appClient } from '$lib/client';
import { selectDaemonConnectionGeneration } from '../../daemon-health/daemon-health-selectors';
import { takeSecretValue } from '$lib/components/chat/secrets/secret-value-handoff';
import {
  secretAnswerRequested,
  secretAnswerUpdated,
  secretListFailed,
  secretListLoaded,
  secretListRequested,
} from '../secret-requests-slice';

/**
 * Secret requests (PROTOCOL §5.56). `secret.list` refreshes are single-flight
 * per agent with one trailing refresh; answers read the value from the
 * one-shot handoff, so it never passes through an action or the store.
 *
 * Each finished answer bumps an epoch. A listing records the epoch it started
 * at, so the reducer lets it replace only answers that finished before it (a
 * daemon restart then shows a provided-but-lost request as expired). A listing
 * whose connection changed mid-flight is dropped; the reconnect refresh
 * replaces it.
 */
export function* secretRequestsSaga(): SagaGenerator<void> {
  let epoch = 0;
  const inFlight = new Set<string>();
  const trailing = new Map<string, { workspaceId: string; requestIds: Set<string> }>();
  const done: Channel<{ agentId: string }> = yield* call(channel<{ agentId: string }>);

  function* refresh(
    workspaceId: string,
    agentId: string,
    requestIds: string[],
  ): SagaGenerator<void> {
    try {
      const answeredBefore = epoch;
      const generation = yield* select(selectDaemonConnectionGeneration.select);
      const listing = yield* call([appClient.agents, appClient.agents.secretList], {
        workspaceId,
        agentId,
      });
      if ((yield* select(selectDaemonConnectionGeneration.select)) !== generation) return;
      yield* put(
        listing
          ? secretListLoaded(agentId, listing, requestIds, answeredBefore)
          : secretListFailed(agentId),
      );
    } finally {
      yield* put(done, { agentId });
    }
  }

  yield* fork(function* trailingLoop(): SagaGenerator<void> {
    while (true) {
      const { agentId } = yield* take(done);
      inFlight.delete(agentId);
      const next = trailing.get(agentId);
      if (next !== undefined) {
        trailing.delete(agentId);
        inFlight.add(agentId);
        yield* fork(refresh, next.workspaceId, agentId, [...next.requestIds]);
      }
    }
  });

  yield* takeEvery(
    secretListRequested,
    function* onList({ payload: [workspaceId, agentId, requestIds] }) {
      if (inFlight.has(agentId)) {
        // Coalesce: the trailing refresh covers every id asked for meanwhile.
        const pending = trailing.get(agentId)?.requestIds ?? new Set<string>();
        for (const requestId of requestIds) pending.add(requestId);
        trailing.set(agentId, { workspaceId, requestIds: pending });
        return;
      }
      inFlight.add(agentId);
      yield* fork(refresh, workspaceId, agentId, requestIds);
    },
  );

  yield* takeEvery(secretAnswerRequested, function* onAnswer({ payload: [request] }) {
    const { workspaceId, agentId, requestId, outcome } = request;
    yield* put(secretAnswerUpdated(requestId, 'sending', epoch));
    let result;
    if (outcome === 'provided') {
      const value = takeSecretValue(requestId);
      if (value === undefined) {
        epoch += 1;
        yield* put(secretAnswerUpdated(requestId, 'failed', epoch));
        return;
      }
      result = yield* call([appClient.agents, appClient.agents.secretProvide], {
        workspaceId,
        requestId,
        value,
      });
    } else {
      result = yield* call([appClient.agents, appClient.agents.secretDismiss], {
        workspaceId,
        requestId,
      });
    }
    epoch += 1;
    yield* put(
      secretAnswerUpdated(
        requestId,
        result.ok ? outcome : result.expired ? 'expired' : 'failed',
        epoch,
      ),
    );
    yield* put(secretListRequested(workspaceId, agentId, [requestId]));
  });
}
