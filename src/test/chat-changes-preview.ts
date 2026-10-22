import { store } from '$store/renderer/store';
import { chatChangesSaga } from '$store/renderer/slices/chat-changes/sagas/chat-changes-saga';
import { gitConsumerReadSaga } from '$store/renderer/slices/git/sagas/git-consumer-read-saga';

/** UI preview mode omits production roots; run only this scene's read owners. */
export function setupChatChangesPreview() {
  const stopChanges = store.runSaga(chatChangesSaga);
  const stopReads = store.runSaga(gitConsumerReadSaga);
  return () => {
    stopReads();
    stopChanges();
  };
}
