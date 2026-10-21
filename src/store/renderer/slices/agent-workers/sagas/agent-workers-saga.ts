import { buffers, eventChannel, type EventChannel } from 'redux-saga';
import { call, fork, put, select, take, takeEvery, type SagaGenerator } from 'typed-redux-saga';
import {
  subscribeAgentWorkers,
  type AgentWorkersChannel,
} from '$features/agent-workers/agent-workers-channel';
import type { AgentWorkersState } from '$features/agent-workers/types';
import { notify } from '$lib/components/patterns/notify';
import { m } from '$shared/paraglide/messages.js';
import {
  agentWorkerOperationUpdated,
  agentWorkerStopRequested,
  agentWorkersKey,
  agentWorkersRemoved,
  agentWorkersRetryRequested,
  agentWorkersSubscribeRequested,
  agentWorkersUnsubscribeRequested,
  agentWorkersUpdated,
} from '../agent-workers-slice';
import { selectAgentWorkers } from '../agent-workers-selectors';
import { connectionStatusChanged } from '../../daemon-health/daemon-health-slice';

type Lease = {
  count: number;
  service: AgentWorkersChannel;
  channel: EventChannel<AgentWorkersState>;
};

/** One `agent.workers.subscribe` channel per visible agent chat, shared by every lease. */
export function* agentWorkersSaga(): SagaGenerator<void> {
  const leases = new Map<string, Lease>();
  let nextStopRequest = 0;
  try {
    yield* takeEvery(
      agentWorkersSubscribeRequested,
      function* ({ payload: [workspaceId, agentId] }): SagaGenerator<void> {
        const key = agentWorkersKey(workspaceId, agentId);
        const previous = leases.get(key);
        if (previous) {
          previous.count++;
          return;
        }
        let service!: AgentWorkersChannel;
        const channel = eventChannel<AgentWorkersState>((emit) => {
          service = subscribeAgentWorkers(workspaceId, agentId, emit);
          return () => service.dispose();
        }, buffers.expanding());
        const lease: Lease = { count: 1, service, channel };
        leases.set(key, lease);
        yield* fork(function* (): SagaGenerator<void> {
          try {
            while (true) {
              const next = yield* take(channel);
              if (leases.get(key) !== lease) return;
              yield* put(agentWorkersUpdated(workspaceId, agentId, next));
            }
          } finally {
            channel.close();
          }
        });
      },
    );
    yield* takeEvery(
      agentWorkersUnsubscribeRequested,
      function* ({ payload: [workspaceId, agentId] }): SagaGenerator<void> {
        const key = agentWorkersKey(workspaceId, agentId);
        const lease = leases.get(key);
        if (lease && --lease.count === 0) {
          leases.delete(key);
          lease.channel.close();
          yield* put(agentWorkersRemoved(workspaceId, agentId));
        }
      },
    );
    yield* takeEvery(
      connectionStatusChanged,
      function* ({ payload: [status] }): SagaGenerator<void> {
        if (status !== 'disconnected' && status !== 'connecting') return;
        for (const lease of leases.values()) lease.service.disconnected();
      },
    );
    yield* takeEvery(
      agentWorkersRetryRequested,
      function* ({ payload: [workspaceId, agentId] }): SagaGenerator<void> {
        leases.get(agentWorkersKey(workspaceId, agentId))?.service.retry();
      },
    );
    yield* takeEvery(
      agentWorkerStopRequested,
      function* ({ payload: [workspaceId, agentId, asyncTaskId] }): SagaGenerator<void> {
        const key = agentWorkersKey(workspaceId, agentId);
        const lease = leases.get(key);
        if (!lease) return;
        const entry = yield* select(selectAgentWorkers.select, workspaceId, agentId);
        if (entry.operations[asyncTaskId]?.pending) return;
        const row = entry.snapshot?.workers.find((w) => w.identity.asyncTaskId === asyncTaskId);
        if (!row || row.status !== 'running' || !row.canStop) return;
        const requestId = ++nextStopRequest;
        yield* put(
          agentWorkerOperationUpdated(workspaceId, agentId, asyncTaskId, {
            pending: true,
            requestId,
          }),
        );
        // A reply settles only its own request: a newer Stop (e.g. after the lease was
        // replaced) owns the operation now, and the old reply must not touch it.
        const owns = function* (): SagaGenerator<boolean> {
          const current = yield* select(selectAgentWorkers.select, workspaceId, agentId);
          return current.operations[asyncTaskId]?.requestId === requestId;
        };
        try {
          const result = yield* call([lease.service, lease.service.stop], asyncTaskId);
          if (!(yield* owns())) return;
          yield* put(
            agentWorkerOperationUpdated(workspaceId, agentId, asyncTaskId, { pending: false }),
          );
          // On success the provider's own `stopped` report removes the row.
          if (!result.stopped && leases.get(key) === lease)
            yield* call(notify.info, m.chat_agentWorkers_alreadyEnded_description());
        } catch {
          if (!(yield* owns())) return;
          yield* put(
            agentWorkerOperationUpdated(workspaceId, agentId, asyncTaskId, {
              pending: false,
              error: true,
              message: m.chat_agentWorkers_stop_error(),
            }),
          );
        }
      },
    );
    // Keep the subscription owner alive until root-saga cancellation.
    yield* take(() => false);
  } finally {
    for (const lease of leases.values()) lease.channel.close();
    leases.clear();
  }
}
