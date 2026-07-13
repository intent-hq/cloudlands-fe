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
 * Wire-boundary rename: PROTOCOL §5.30 documents `id` on the wire as the
 * reference FE's `shortName`/`value` and `name` as `displayName`/`label`. The
 * FE's `AuggieModel` keeps the historical `value`/`label` names, so this
 * client performs the documented mapping — the FE never sees the wire names
 * mixed with the historical names elsewhere.
 *
 * Failures fold to an empty list so a boot-time transport hiccup leaves the
 * model picker with the seeder/static fallback rather than a broken state.
 */
import type { AuggieModel, AuggieModelBadge } from "$features/auggie/auggie-models.client";
import type {
  AppClient,
  ModelsClient,
  SubscriptionHandler,
  Unsubscribe,
} from "../app-client";
import { backendRequest } from "./backend-transport";

/** Wire `ModelInfo` (PROTOCOL §5.30) — the daemon's canonical row shape. */
interface WireModelInfo {
  id?: string;
  name?: string;
  provider?: string;
  description?: string;
  modelGroupPriority?: number;
  costTier?: number;
  badges?: AuggieModelBadge[];
  effortLevels?: string[];
  isDefault?: boolean;
  priority?: number;
}

/** Map a wire row to the FE `AuggieModel` shape; `null` when key fields are missing. */
function fromWire(wire: WireModelInfo): AuggieModel | null {
  if (typeof wire?.id !== "string" || !wire.id) return null;
  if (typeof wire?.name !== "string" || !wire.name) return null;
  const model: AuggieModel = { value: wire.id, label: wire.name };
  if (typeof wire.description === "string") model.description = wire.description;
  if (typeof wire.modelGroupPriority === "number") {
    model.modelGroupPriority = wire.modelGroupPriority;
  }
  if (typeof wire.costTier === "number") model.costTier = wire.costTier;
  if (Array.isArray(wire.badges)) model.badges = wire.badges;
  if (Array.isArray(wire.effortLevels)) model.effortLevels = wire.effortLevels;
  if (wire.isDefault === true) model.isDefault = true;
  if (typeof wire.priority === "number") model.priority = wire.priority;
  return model;
}

export class LiveModelsClient implements ModelsClient {
  async list(): Promise<AuggieModel[]> {
    try {
      const result = await backendRequest<{ models?: WireModelInfo[] }>("models.list");
      if (!Array.isArray(result?.models)) return [];
      return result.models.flatMap((row) => fromWire(row) ?? []);
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
