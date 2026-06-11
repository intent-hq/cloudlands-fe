import { buffers } from 'redux-saga';
import {
  actionChannel,
  delay,
  flush,
  fork,
  put,
  take,
  type SagaGenerator,
} from 'typed-redux-saga';
import {
  bulkUpsertSessions,
  upsertSession,
} from '../agent-session-slice';

const AGENT_SESSION_UPSERT_BATCH_MS = 100;
export const AGENT_SESSION_UPSERT_BUFFER_LIMIT = 1_000;

type UpsertSessionAction = ReturnType<typeof upsertSession>;

export function* watchBatchedAgentSessionUpsertsSaga(): SagaGenerator<void> {
  const upsertActions = yield* actionChannel<UpsertSessionAction>(
    upsertSession,
    buffers.sliding<UpsertSessionAction>(AGENT_SESSION_UPSERT_BUFFER_LIMIT),
  );
  try {
    while (true) {
      const firstAction = yield* take(upsertActions);
      yield* delay(AGENT_SESSION_UPSERT_BATCH_MS);
      const flushedActions = yield* flush(upsertActions);
      const sessions = [firstAction, ...flushedActions].map((action) => action.payload[0]);
      yield* put(bulkUpsertSessions(sessions, { preserveExplicitRuntimeFlags: false }));
    }
  } finally {
    upsertActions.close();
  }
}

export function* agentSessionSaga(): SagaGenerator<void> {
  yield* fork(watchBatchedAgentSessionUpsertsSaga);
}