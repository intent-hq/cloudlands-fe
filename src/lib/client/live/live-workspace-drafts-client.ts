import type { WorkspaceDraft } from '$shared/types';
import type { WorkspaceDraftPromotionResult, WorkspaceDraftsClient } from '../app-client';
import { backendRequest } from './backend-transport';
import { normalizeAgent } from './live-agents-client';
import { normalizeWorkspace } from './live-workspaces-client';

const PROMOTE_TIMEOUT_MS = 120_000;

export class LiveWorkspaceDraftsClient implements WorkspaceDraftsClient {
  create(request: Parameters<WorkspaceDraftsClient['create']>[0] = {}) {
    return backendRequest<WorkspaceDraft>('workspaceDraft.create', request);
  }

  get(id: string) {
    return backendRequest<WorkspaceDraft | null>('workspaceDraft.get', { id });
  }

  list() {
    return backendRequest<WorkspaceDraft[]>('workspaceDraft.list', {});
  }

  update(
    id: string,
    expectedRevision: number,
    patch: Parameters<WorkspaceDraftsClient['update']>[2],
  ) {
    return backendRequest<WorkspaceDraft>('workspaceDraft.update', {
      id,
      expectedRevision,
      patch,
    });
  }

  async promote(
    id: string,
    expectedRevision: number,
    initialAgent?: Parameters<WorkspaceDraftsClient['promote']>[2],
  ): Promise<WorkspaceDraftPromotionResult> {
    const params = { id, expectedRevision, ...(initialAgent ? { initialAgent } : {}) };
    const result = await backendRequest<{
      draft: WorkspaceDraft;
      workspace: Record<string, unknown>;
      initialAgent?: Record<string, unknown>;
    }>('workspaceDraft.promote', params, { timeoutMs: PROMOTE_TIMEOUT_MS });
    return {
      draft: result.draft,
      workspace: normalizeWorkspace(result.workspace),
      ...(result.initialAgent ? { initialAgent: normalizeAgent(result.initialAgent) } : {}),
    };
  }

  markDelivery(id: string, delivery: Parameters<WorkspaceDraftsClient['markDelivery']>[1]) {
    return backendRequest<WorkspaceDraft>('workspaceDraft.markDelivery', { id, delivery });
  }

  delete(id: string) {
    return backendRequest<{ deleted: boolean }>('workspaceDraft.delete', { id });
  }
}
