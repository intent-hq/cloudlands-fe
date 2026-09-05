import type { WorkspaceDraft } from '$shared/types';
import type { WorkspaceDraftPromotionResult, WorkspaceDraftsClient } from '../app-client';
import { backendRequest } from './backend-transport';

const PROMOTE_TIMEOUT_MS = 120_000;

export class LiveWorkspaceDraftsClient implements WorkspaceDraftsClient {
  create(request: Parameters<WorkspaceDraftsClient['create']>[0] = {}) {
    return backendRequest<WorkspaceDraft>('workspaceDraft.create', request);
  }

  get(id: string) {
    return backendRequest<WorkspaceDraft>('workspaceDraft.get', { id });
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
    return backendRequest<WorkspaceDraftPromotionResult>('workspaceDraft.promote', params, {
      timeoutMs: PROMOTE_TIMEOUT_MS,
    });
  }

  markDelivery(id: string, delivery: Parameters<WorkspaceDraftsClient['markDelivery']>[1]) {
    return backendRequest<WorkspaceDraft>('workspaceDraft.markDelivery', { id, delivery });
  }

  delete(id: string) {
    return backendRequest<{ deleted: boolean }>('workspaceDraft.delete', { id });
  }
}
