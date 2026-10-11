import type { BackendTransport } from './backend-transport-types';
import type { SpecialistCatalog } from '../specialists-types';

/** Shared real specialist catalog read; subscriptions remain with their existing owner. */
export function createSpecialistCatalogRead(backendRequest: BackendTransport['request']) {
  return async function listCatalog(
    provider?: string,
    workspaceId?: string,
    options?: { includeProject?: boolean },
  ): Promise<SpecialistCatalog> {
    // Preview context belongs to this request; global subscriptions keep
    // using the daemon's default context rather than the last picker choice.
    const result =
      provider === undefined && workspaceId === undefined && !options?.includeProject
        ? await backendRequest<SpecialistCatalog>('specialist.list')
        : await backendRequest<SpecialistCatalog>('specialist.list', {
            ...(provider ? { provider } : {}),
            ...(workspaceId ? { workspaceId } : {}),
            ...(options?.includeProject ? { includeProject: true } : {}),
          });
    return {
      specialists: Array.isArray(result?.specialists) ? result.specialists : [],
      importDiagnostics: result?.importDiagnostics,
    };
  };
}
