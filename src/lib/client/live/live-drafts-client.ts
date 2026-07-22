/**
 * Live drafts client backed by the intentd daemon (PROTOCOL §5.16).
 */
import type { DraftAttachment, DraftsClient } from '../app-client';
import { backendRequest } from './backend-transport';

export class LiveDraftsClient implements DraftsClient {
  async get(workspaceId: string, agentId: string) {
    const result = await backendRequest<{
      text: string;
      attachments?: DraftAttachment[];
      updatedAt: string;
    } | null>('drafts.get', { workspaceId, agentId });
    return result ?? null;
  }

  async set(workspaceId: string, agentId: string, text: string, attachments?: DraftAttachment[]) {
    const params: {
      workspaceId: string;
      agentId: string;
      text: string;
      attachments?: DraftAttachment[];
    } = { workspaceId, agentId, text };
    if (attachments && attachments.length > 0) {
      params.attachments = attachments;
    }
    return await backendRequest<{ ok: true; updatedAt: string }>('drafts.set', params);
  }

  async clear(workspaceId: string, agentId: string) {
    return await backendRequest<{ ok: true }>(
      'drafts.clear',
      { workspaceId, agentId }
    );
  }
}
