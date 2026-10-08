import type { DraftAttachment, DraftsClient } from '$lib/client/app-client';

export type DraftFixtureRequest = {
  method: 'drafts.get' | 'drafts.set' | 'drafts.clear';
  params: { workspaceId: string; agentId: string; text?: string; attachments?: DraftAttachment[] };
};

export function createChatDraftFixture(onRequest?: (request: DraftFixtureRequest) => void) {
  const drafts = new Map<string, NonNullable<Awaited<ReturnType<DraftsClient['get']>>>>();
  const key = (workspaceId: string, agentId: string) => JSON.stringify([workspaceId, agentId]);
  const updatedAt = '2026-09-29T12:00:00.000Z';
  const client: DraftsClient = {
    async get(workspaceId, agentId) {
      onRequest?.({ method: 'drafts.get', params: { workspaceId, agentId } });
      return structuredClone(drafts.get(key(workspaceId, agentId)) ?? null);
    },
    async set(workspaceId, agentId, text, attachments) {
      onRequest?.({ method: 'drafts.set', params: { workspaceId, agentId, text, attachments } });
      if (!text && !attachments?.length) drafts.delete(key(workspaceId, agentId));
      else
        drafts.set(
          key(workspaceId, agentId),
          structuredClone({ text, ...(attachments?.length ? { attachments } : {}), updatedAt }),
        );
      return { ok: true, updatedAt };
    },
    async clear(workspaceId, agentId) {
      onRequest?.({ method: 'drafts.clear', params: { workspaceId, agentId } });
      drafts.delete(key(workspaceId, agentId));
      return { ok: true };
    },
  };
  return {
    client,
    seed(workspaceId: string, agentId: string, text: string) {
      drafts.set(key(workspaceId, agentId), { text, updatedAt });
    },
  };
}

export function createDraftsFixture(seed?: {
  workspaceId: string;
  agentId: string;
  text: string;
}): DraftsClient {
  const fixture = createChatDraftFixture();
  if (seed?.text) fixture.seed(seed.workspaceId, seed.agentId, seed.text);
  return fixture.client;
}
