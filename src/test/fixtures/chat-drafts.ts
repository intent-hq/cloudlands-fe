import type { DraftsClient } from '$lib/client/app-client';

export function createDraftsFixture(seed?: {
  workspaceId: string;
  agentId: string;
  text: string;
}): DraftsClient {
  const records = new Map<string, NonNullable<Awaited<ReturnType<DraftsClient['get']>>>>();
  const key = (workspaceId: string, agentId: string) => JSON.stringify([workspaceId, agentId]);
  const updatedAt = '2026-09-29T12:00:00.000Z';
  if (seed?.text) records.set(key(seed.workspaceId, seed.agentId), { text: seed.text, updatedAt });
  return {
    get: async (workspaceId, agentId) => records.get(key(workspaceId, agentId)) ?? null,
    set: async (workspaceId, agentId, text, attachments) => {
      if (text || attachments?.length)
        records.set(key(workspaceId, agentId), {
          text,
          ...(attachments?.length ? { attachments } : {}),
          updatedAt,
        });
      else records.delete(key(workspaceId, agentId));
      return { ok: true, updatedAt };
    },
    clear: async (workspaceId, agentId) => {
      records.delete(key(workspaceId, agentId));
      return { ok: true };
    },
  };
}
