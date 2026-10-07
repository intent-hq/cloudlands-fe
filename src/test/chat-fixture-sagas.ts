import type { DraftsClient } from '$lib/client/app-client';
import type { store } from '$store/renderer/store';
import { chatDraftsSaga } from '$store/renderer/slices/chat-drafts/sagas/chat-drafts-saga';
import { questionUiPersistenceSaga } from '$store/renderer/slices/question-ui/sagas/question-ui-persistence-saga';
import { createDraftsFixture } from './fixtures/chat-drafts';

/** The caller supplies the draft transport and cancels both fixture workflow owners. */
export function startChatFixtureSagas(
  appStore: Pick<typeof store, 'runSaga'>,
  transport: Pick<DraftsClient, 'get' | 'set' | 'clear'> = createDraftsFixture(),
) {
  return [
    appStore.runSaga(function* fixtureChatDraftsSaga() {
      yield* chatDraftsSaga(transport);
    }),
    appStore.runSaga(questionUiPersistenceSaga),
  ];
}
