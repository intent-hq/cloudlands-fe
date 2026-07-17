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

  async create(
    id: string,
    spec: SpecialistDef,
    scope?: "project" | "user",
    workspacePath?: string,
  ): Promise<SpecialistDef> {
    const params: { id: string; spec: SpecialistDef; scope?: string; workspacePath?: string } = {
      id,
      spec,
    };
    if (scope) params.scope = scope;
    if (workspacePath) params.workspacePath = workspacePath;

    const result = await backendRequest<{ specialist: SpecialistDef }>(
      "specialist.create",
      params,
    );
    return result.specialist;
  }

  async edit(
    id: string,
    spec: SpecialistDef,
    scope: "project" | "user",
    workspacePath?: string,
  ): Promise<SpecialistDef> {
    const params: { id: string; spec: SpecialistDef; scope: string; workspacePath?: string } = {
      id,
      spec,
      scope,
    };
    if (workspacePath) params.workspacePath = workspacePath;

    const result = await backendRequest<{ specialist: SpecialistDef }>("specialist.edit", params);
    return result.specialist;
  }

  async delete(
    id: string,
    scope: "project" | "user",
    workspacePath?: string,
  ): Promise<{ success: true }> {
    const params: { id: string; scope: string; workspacePath?: string } = {
      id,
      scope,
    };
    if (workspacePath) params.workspacePath = workspacePath;

    return await backendRequest<{ success: true }>("specialist.delete", params);
  }
}

// Tied to AppClient["specialists"] so the seam composition catches drift in CI.
const _interfaceCheck: AppClient["specialists"] | undefined = undefined as
  | LiveSpecialistsClient
  | undefined;
void _interfaceCheck;
