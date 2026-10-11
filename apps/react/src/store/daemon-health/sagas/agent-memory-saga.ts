import type { SagaGenerator } from 'typed-redux-saga';
import { backendRequest } from '@/features/backend/backend-transport';
import { createAgentMemorySaga } from '../../../../../../src/store/renderer/slices/daemon-health/sagas/agent-memory-saga-factory';

/** The application root starts one memory-session owner after Store.init(). */
export function* agentMemorySaga(): SagaGenerator<void> {
  yield* createAgentMemorySaga({ backendRequest })();
}
