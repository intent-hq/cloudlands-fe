import type { BackendTransport } from './backend-transport-types';
import {
  wireModelsToProviderModels,
  type WireModelsListResult,
} from '$shared/models/wire-model-info';
import type {
  ProviderModelsEnvelope,
  ProviderModelsOptions,
} from '../../../features/providers/provider-models-types';

/** Per-provider read contract shared by source IPC and the direct React backend binding.
 * Unlike the active catalog reader, this legacy outcome carries provenance in the request key.
 */
export function createProviderModelCatalogRead(backendRequest: BackendTransport['request']) {
  return async function readProviderModelCatalog(
    providerId: string,
    options: ProviderModelsOptions = {},
  ): Promise<ProviderModelsEnvelope> {
    try {
      const result = await backendRequest<WireModelsListResult>('models.list', {
        providerId,
        ...(options.workspaceId ? { workspaceId: options.workspaceId } : {}),
        ...(options.forceRefresh === true ? { forceRefresh: true } : {}),
      });
      const envelope: ProviderModelsEnvelope = {
        success: true,
        data: wireModelsToProviderModels(result),
      };
      if (typeof result?.warning === 'string' && result.warning) envelope.warning = result.warning;
      if (result?.stale === true) envelope.stale = true;
      return envelope;
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
  };
}
