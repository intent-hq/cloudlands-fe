/**
 * Live models domain backed by the intentd daemon (PROTOCOL §5.30).
 *
 * Unscoped `models.list` is global (no `workspaceId`) and returns the daemon-resolved
 * rich model catalog — `{ models: ModelInfo[], source: "auggie" | "static" }`.
 * The daemon does auggie CLI discovery (JSON → plain-text fallback), catalog
 * caching (served indefinitely; it re-probes only on a cache miss, an adapter
 * version-key change, or `forceRefresh: true`), legacy-model filtering, and
 * priority sorting server-side and
 * degrades to the static tier catalog when the CLI is unavailable, so the
 * result is never empty (§5.30).
 *
 * Pass `providerId` to load a provider-specific catalog; omitting it retains
 * the legacy Auggie catalog for existing unscoped consumers.
 *
 * Wire-boundary rename: the FE's `AuggieModel` keeps the historical
 * `value`/`label` names; the documented `id`→`value` / `name`→`label` mapping
 * lives in `$shared/models/wire-model-info.ts` (shared with the main-process
 * per-provider handlers).
 *
 * Failures fold to an empty list so a boot-time transport hiccup leaves the
 * model picker with the seeder/static fallback rather than a broken state.
 */
import type { ProviderModelInfo as AuggieModel } from '$shared/models/wire-model-info';
import {
  wireModelsToProviderModels,
  type WireModelsListResult,
} from '$shared/models/wire-model-info';
import type { SubscriptionHandler, Unsubscribe } from '../client-types';
import type { BackendTransport } from './backend-transport-types';

export class BackendModelsClient {
  constructor(private readonly backendRequest: BackendTransport['request']) {}

  async list(providerId?: string, workspaceId?: string): Promise<AuggieModel[]> {
    try {
      const result =
        providerId || workspaceId
          ? await this.backendRequest<WireModelsListResult>('models.list', {
              ...(providerId ? { providerId } : {}),
              ...(workspaceId ? { workspaceId } : {}),
            })
          : await this.backendRequest<WireModelsListResult>('models.list');
      // Scoped replies identify their provider. Never attribute legacy unscoped
      // Auggie rows (or another provider's rows) to the requested provider.
      if (providerId && result.providerId !== providerId) return [];
      return wireModelsToProviderModels(result);
    } catch {
      return [];
    }
  }

  subscribe(handler: SubscriptionHandler<AuggieModel[]>): Unsubscribe {
    // No `models:*` change events exist on the wire yet (PROTOCOL §6); the
    // subscription surfaces a one-shot snapshot so call sites that opt into
    // the seam do not stall.
    let cancelled = false;
    void this.list().then((models) => {
      if (!cancelled) handler(models);
    });
    return () => {
      cancelled = true;
    };
  }
}
