import type { DraftsClient } from '$lib/client/app-client';
import { store } from '$store/renderer/store';
import { chatDraftsSaga } from '$store/renderer/slices/chat-drafts/sagas/chat-drafts-saga';

export function setupChatDraftsPreview() {
  const drafts = new Map<string, NonNullable<Awaited<ReturnType<DraftsClient['get']>>>>();
  const pairKey = (workspaceId: string, agentId: string) => `${workspaceId}\u0000${agentId}`;
  const transport: DraftsClient = {
    get: async (workspaceId, agentId) => drafts.get(pairKey(workspaceId, agentId)) ?? null,
    set: async (workspaceId, agentId, text, attachments) => {
      const key = pairKey(workspaceId, agentId);
      const updatedAt = new Date().toISOString();
      if (!text && !attachments?.length) drafts.delete(key);
      else drafts.set(key, { text, attachments, updatedAt });
      return { ok: true, updatedAt };
    },
    clear: async (workspaceId, agentId) => {
      drafts.delete(pairKey(workspaceId, agentId));
      return { ok: true };
    },
  };
  return store.runSaga(() => chatDraftsSaga(transport));
}
