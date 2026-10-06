import type { DraftsClient } from '$lib/client/app-client';
import type { store } from '$store/renderer/store';
import { chatDraftsSaga } from '$store/renderer/slices/chat-drafts/sagas/chat-drafts-saga';

export function startChatDraftFixture(appStore: Pick<typeof store, 'runSaga'>) {
  type Draft = NonNullable<Awaited<ReturnType<DraftsClient['get']>>>;
  const drafts = new Map<string, Draft>();
  const key = (workspaceId: string, agentId: string) => `${workspaceId}\u0000${agentId}`;
  const client: DraftsClient = {
    async get(workspaceId, agentId) {
      return drafts.get(key(workspaceId, agentId)) ?? null;
    },
    async set(workspaceId, agentId, text, attachments) {
      const updatedAt = '2026-09-29T12:00:00Z';
      if (!text && !attachments?.length) drafts.delete(key(workspaceId, agentId));
      else drafts.set(key(workspaceId, agentId), { text, attachments, updatedAt });
      return { ok: true, updatedAt };
    },
    async clear(workspaceId, agentId) {
      drafts.delete(key(workspaceId, agentId));
      return { ok: true };
    },
  };
  return appStore.runSaga(chatDraftsSaga, client);
}
