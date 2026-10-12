import type { DraftAttachment, DraftsClient } from '$lib/client/app-client';

type Scope = { workspaceId: string; agentId: string };
export type ComposerDraftRequest =
  | { method: 'drafts.get' | 'drafts.clear'; params: Scope }
  | { method: 'drafts.set'; params: Scope & { text: string; attachments?: DraftAttachment[] } };

/** Controlled drafts client with the response shapes from PROTOCOL §5.16. */
export function createComposerDraftTransport(
  workspaceId: string,
  agentId: string,
  text = '',
  held = false,
  onRequest?: (request: ComposerDraftRequest) => void,
) {
  const updatedAt = '2026-08-23T12:00:00.000Z';
  const key = (workspace: string, agent: string) => JSON.stringify([workspace, agent]);
  type Draft = NonNullable<Awaited<ReturnType<DraftsClient['get']>>>;
  const saved = new Map<string, Draft>();
  if (text) saved.set(key(workspaceId, agentId), { text, updatedAt });
  let releaseRestore!: () => void;
  const restoreReady = new Promise<void>((resolve) => {
    releaseRestore = resolve;
  });
  if (!held) releaseRestore();
  let disposed = false;
  const transport: DraftsClient = {
    async get(workspaceId, agentId) {
      onRequest?.({ method: 'drafts.get', params: { workspaceId, agentId } });
      await restoreReady;
      return disposed ? null : structuredClone(saved.get(key(workspaceId, agentId)) ?? null);
    },
    async set(workspaceId, agentId, text, attachments) {
      const params = {
        workspaceId,
        agentId,
        text,
        ...(attachments?.length ? { attachments } : {}),
      };
      onRequest?.({ method: 'drafts.set', params });
      if (!text && !attachments?.length) saved.delete(key(workspaceId, agentId));
      else
        saved.set(
          key(workspaceId, agentId),
          structuredClone({ text, updatedAt, ...('attachments' in params ? { attachments } : {}) }),
        );
      return { ok: true, updatedAt };
    },
    async clear(workspaceId, agentId) {
      onRequest?.({ method: 'drafts.clear', params: { workspaceId, agentId } });
      saved.delete(key(workspaceId, agentId));
      return { ok: true };
    },
  };
  return {
    transport,
    releaseRestore,
    dispose() {
      disposed = true;
      releaseRestore();
    },
  };
}
