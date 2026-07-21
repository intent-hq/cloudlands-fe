/**
 * Live models domain backed by the intentd daemon (PROTOCOL §5.30).
 *
 * `models.list` is global (no `workspaceId`) and returns the daemon-resolved
 * rich model catalog — `{ models: ModelInfo[], source: "auggie" | "static" }`.
 * The daemon does auggie CLI discovery (JSON → plain-text fallback), 5-minute
 * caching, legacy-model filtering, and priority sorting server-side and
 * degrades to the static tier catalog when the CLI is unavailable, so the
 * result is never empty (§5.30).
 *
 * Wire-boundary rename: the FE's `AuggieModel` keeps the historical
 * `value`/`label` names; the documented `id`→`value` / `name`→`label` mapping
 * lives in `$shared/models/wire-model-info.ts` (shared with the main-process
 * per-provider handlers).
 *
 * Failures fold to an empty list so a boot-time transport hiccup leaves the
 * model picker with the seeder/static fallback rather than a broken state.
 */
import type { AuggieModel } from "$features/auggie/auggie-models.client";
import {
  wireModelsToProviderModels,
  type WireModelsListResult,
} from "$shared/models/wire-model-info";
import type {
  AppClient,
  ModelsClient,
  SubscriptionHandler,
  Unsubscribe,
} from "../app-client";
import { backendRequest } from "./backend-transport";

export class LiveModelsClient implements ModelsClient {
  async list(): Promise<AuggieModel[]> {
    try {
      const result = await backendRequest<WireModelsListResult>("models.list");
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

// Tied to AppClient["models"] so the seam composition catches drift in CI.
const _interfaceCheck: AppClient["models"] | undefined = undefined as
  | LiveModelsClient
  | undefined;
void _interfaceCheck;
