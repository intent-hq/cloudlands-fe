/**
 * Live drafts client backed by the intentd daemon (PROTOCOL §5.16).
 */
import type { DraftsClient } from '../app-client';
import { backendRequest } from './backend-transport';

export class LiveDraftsClient implements DraftsClient {
  async get(workspaceId: string, agentId: string) {
    const result = await backendRequest<{ text: string; updatedAt: string } | null>(
      'drafts.get',
      { workspaceId, agentId }
    );
    return result ?? null;
  }

  async set(workspaceId: string, agentId: string, text: string) {
    return await backendRequest<{ ok: true; updatedAt: string }>(
      'drafts.set',
      { workspaceId, agentId, text }
    );
  }

  async clear(workspaceId: string, agentId: string) {
    return await backendRequest<{ ok: true }>(
      'drafts.clear',
      { workspaceId, agentId }
    );
  }
}
