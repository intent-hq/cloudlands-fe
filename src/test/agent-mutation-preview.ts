import { store } from '$store/renderer/store';
import { agentMutationSaga } from '$store/renderer/slices/agent-session/sagas/agent-mutation-saga';

/** Preview and CT roots omit app sagas; mount this scene's mutation owner only. */
export function setupAgentMutationPreview() {
  return store.runSaga(agentMutationSaga);
}
