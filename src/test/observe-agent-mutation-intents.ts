import { call, takeEvery } from 'typed-redux-saga';
import { store } from '$store/renderer/store';
import { agentMutationUiRequested } from '$store/renderer/slices/agent-mutation-ui/agent-mutation-ui-slice';

/** Observe the production intent boundary without creating a second mutation owner. */
export function observeAgentMutationIntents(
  onRequested: (payload: Parameters<typeof agentMutationUiRequested>) => void,
) {
  return store.runSaga(function* () {
    yield* takeEvery(agentMutationUiRequested, function* (action) {
      yield* call(onRequested, action.payload);
    });
  });
}
