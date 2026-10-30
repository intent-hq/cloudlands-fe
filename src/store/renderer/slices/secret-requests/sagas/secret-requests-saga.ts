import { call, fork, put, take, takeEvery, type SagaGenerator } from 'typed-redux-saga';
import { channel, type Channel } from 'redux-saga';
import { appClient } from '$lib/client';
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
 */
export function* secretRequestsSaga(): SagaGenerator<void> {
  const inFlight = new Set<string>();
  const trailing = new Map<string, { workspaceId: string; requestIds: Set<string> }>();
  const done: Channel<{ agentId: string }> = yield* call(channel<{ agentId: string }>);

  function* refresh(
    workspaceId: string,
    agentId: string,
    requestIds: string[],
  ): SagaGenerator<void> {
    try {
      const listing = yield* call([appClient.agents, appClient.agents.secretList], {
        workspaceId,
        agentId,
      });
      yield* put(
        listing ? secretListLoaded(agentId, listing, requestIds) : secretListFailed(agentId),
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
    yield* put(secretAnswerUpdated(requestId, 'sending'));
    let result;
    if (outcome === 'provided') {
      const value = takeSecretValue(requestId);
      if (value === undefined) {
        yield* put(secretAnswerUpdated(requestId, 'failed'));
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
    yield* put(
      secretAnswerUpdated(requestId, result.ok ? outcome : result.expired ? 'expired' : 'failed'),
    );
    yield* put(secretListRequested(workspaceId, agentId, [requestId]));
  });
}
