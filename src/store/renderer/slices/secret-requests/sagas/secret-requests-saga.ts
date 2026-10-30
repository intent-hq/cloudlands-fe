import { call, fork, put, take, takeEvery, type SagaGenerator } from 'typed-redux-saga';
import { channel, type Channel } from 'redux-saga';
import { appClient } from '$lib/client';
import { takeSecretValue } from '$lib/components/chat/secrets/secret-value-handoff';
import {
  secretAnswerRequested,
  secretAnswerUpdated,
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
  const trailing = new Map<string, string>();
  const done: Channel<{ agentId: string }> = yield* call(channel<{ agentId: string }>);

  function* refresh(workspaceId: string, agentId: string): SagaGenerator<void> {
    try {
      const listing = yield* call([appClient.agents, appClient.agents.secretList], {
        workspaceId,
        agentId,
      });
      if (listing) yield* put(secretListLoaded(agentId, listing));
    } finally {
      yield* put(done, { agentId });
    }
  }

  yield* fork(function* trailingLoop(): SagaGenerator<void> {
    while (true) {
      const { agentId } = yield* take(done);
      inFlight.delete(agentId);
      const workspaceId = trailing.get(agentId);
      if (workspaceId !== undefined) {
        trailing.delete(agentId);
        inFlight.add(agentId);
        yield* fork(refresh, workspaceId, agentId);
      }
    }
  });

  yield* takeEvery(secretListRequested, function* onList({ payload: [workspaceId, agentId] }) {
    if (inFlight.has(agentId)) {
      trailing.set(agentId, workspaceId);
      return;
    }
    inFlight.add(agentId);
    yield* fork(refresh, workspaceId, agentId);
  });

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
    yield* put(secretListRequested(workspaceId, agentId));
  });
}
