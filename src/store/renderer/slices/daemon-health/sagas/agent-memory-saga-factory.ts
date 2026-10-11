import { call, delay, put, race, take, takeLeading } from 'typed-redux-saga';

import type { BackendTransport } from '$lib/client/live/backend-transport-types';
import {
  agentMemoryBreakdownClosed,
  agentMemoryBreakdownOpened,
  agentMemoryUsageFailed,
  agentMemoryUsageRequested,
  agentMemoryUsageSucceeded,
} from '../daemon-health-slice';
import type { AgentMemoryUsageWirePayload } from '../daemon-health-types';

const AGENT_MEMORY_REFRESH_INTERVAL_MS = 5_000;

/** Bind the canonical memory session to a renderer's real backend transport. */
export function createAgentMemorySaga({
  backendRequest,
}: {
  backendRequest: BackendTransport['request'];
}) {
  function* fetchAgentMemoryUsageSaga() {
    try {
      const usage = yield* call(backendRequest<AgentMemoryUsageWirePayload>, 'agent.memoryUsage');
      yield* put(agentMemoryUsageSucceeded(usage));
    } catch {
      yield* put(agentMemoryUsageFailed());
    }
  }

  /**
   * One open-dialog session: a single-flight request watcher plus the refresh
   * cadence (request now, then on a fixed interval). The watcher is
   * `takeLeading`, so a tick landing while a fetch is still in flight is dropped
   * rather than fanned out. It is forked inside the session so that cancelling
   * the session also cancels the watcher and any in-flight fetch — a request
   * started in one session can never complete into the next.
   */
  function* agentMemoryBreakdownSession() {
    yield* takeLeading(agentMemoryUsageRequested, fetchAgentMemoryUsageSaga);
    while (true) {
      yield* put(agentMemoryUsageRequested());
      yield* delay(AGENT_MEMORY_REFRESH_INTERVAL_MS);
    }
  }

  /**
   * A session runs only between an `agentMemoryBreakdownOpened` and the next
   * `agentMemoryBreakdownClosed`; there is no background polling. Each open
   * starts a fresh session with an immediate fetch.
   */
  return function* watchAgentMemoryBreakdown() {
    while (true) {
      yield* take(agentMemoryBreakdownOpened);
      yield* race({
        session: call(agentMemoryBreakdownSession),
        closed: take(agentMemoryBreakdownClosed),
      });
    }
  };
}
