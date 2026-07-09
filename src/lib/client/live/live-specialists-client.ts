/**
 * Live specialists domain backed by the intentd daemon (PROTOCOL §5.11).
 *
 * `specialist.list` is global (no workspaceId) and returns the resolved
 * 3-tier view — project (`.augment/specialists/`) overrides user
 * (`~/.augment/specialists/`) overrides bundled — as `{ specialists:
 * SpecialistDef[] }`. The defs are surfaced verbatim; splitting bundled vs
 * file-backed entries into their store slices happens in the seeder. Reads
 * fold transport failures to an empty list so the specialist picker falls
 * back to the hardcoded `SPECIALISTS` constant instead of breaking.
 */
import type {
  AppClient,
  SpecialistDef,
  SpecialistsClient,
  SubscriptionHandler,
  Unsubscribe,
} from "../app-client";
import { backendRequest } from "./backend-transport";

export class LiveSpecialistsClient implements SpecialistsClient {
  async list(): Promise<SpecialistDef[]> {
    try {
      const result = await backendRequest<{ specialists?: unknown[] }>("specialist.list");
      return Array.isArray(result?.specialists)
        ? (result.specialists as SpecialistDef[])
        : [];
    } catch {
      return [];
    }
  }

  subscribe(handler: SubscriptionHandler<SpecialistDef[]>): Unsubscribe {
    // No `specialist:*` change events exist on the wire yet (PROTOCOL §6), so
    // the subscription is a one-shot snapshot of the current resolved view.
    let cancelled = false;
    void this.list().then((specialists) => {
      if (!cancelled) handler(specialists);
    });
    return () => {
      cancelled = true;
    };
  }
}

// Tied to AppClient["specialists"] so the seam composition catches drift in CI.
const _interfaceCheck: AppClient["specialists"] | undefined = undefined as
  | LiveSpecialistsClient
  | undefined;
void _interfaceCheck;
