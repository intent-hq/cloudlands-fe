import type { DraftsClient } from '$lib/client/app-client';
import type { store } from '$store/renderer/store';
import { chatDraftsSaga } from '$store/renderer/slices/chat-drafts/sagas/chat-drafts-saga';
import { questionUiPersistenceSaga } from '$store/renderer/slices/question-ui/sagas/question-ui-persistence-saga';

/**
 * Chat hosts omit application startup, but composers and question cards still
 * need their production workflow owners. Keep drafts local to this fixture;
 * other daemon reads retain the host's existing mock transport and error guards.
 * The caller owns cancellation alongside its other fixture sagas.
 */
export function startChatFixtureSagas(appStore: Pick<typeof store, 'runSaga'>) {
  const drafts = new Map<string, NonNullable<Awaited<ReturnType<DraftsClient['get']>>>>();
  const key = (workspaceId: string, agentId: string) => JSON.stringify([workspaceId, agentId]);
  const transport: Pick<DraftsClient, 'get' | 'set' | 'clear'> = {
    async get(workspaceId, agentId) {
      return drafts.get(key(workspaceId, agentId)) ?? null;
    },
    async set(workspaceId, agentId, text, attachments) {
      const updatedAt = new Date().toISOString();
      drafts.set(key(workspaceId, agentId), { text, attachments, updatedAt });
      return { ok: true, updatedAt };
    },
    async clear(workspaceId, agentId) {
      drafts.delete(key(workspaceId, agentId));
      return { ok: true };
    },
  };
  return [
    appStore.runSaga(function* fixtureChatDraftsSaga() {
      yield* chatDraftsSaga(transport);
    }),
    appStore.runSaga(questionUiPersistenceSaga),
  ];
}
