/**
 * Live workspaces domain backed by the intentd daemon.
 *
 * Reads resolve via `workspace.list` / `workspace.get` over the JSON-RPC bridge.
 * `subscribe` emits an initial snapshot, then refetches whenever a `workspace:*`
 * daemon event arrives (delivered as `events.event` notifications). Mutations
 * (`workspace.create/update/delete/archive/unarchive`, §5.1) forward to the
 * daemon and fold outcomes into `MutationResult`.
 */
import { WorkspaceStatus, createWorkspaceId } from "$shared/types";
import type { CreateWorkspaceRequest, UpdateWorkspaceRequest, Workspace } from "$shared/types";
import type { TokenUsage } from "$features/token-usage/token-usage-types";
import type {
  MutationResult,
  SubscriptionHandler,
  Unsubscribe,
  WorkspaceCreateResult,
  WorkspacesClient,
  WorkspaceUpdateResult,
} from "../app-client";
import { backendRequest } from "./backend-transport";
import { createDeltaSubscription } from "./delta-subscription";
import { extractConflict, newIdempotencyKey, runMutation } from "./live-support";

/** Daemon status strings → renderer WorkspaceStatus enum. */
function toWorkspaceStatus(value: unknown): WorkspaceStatus {
  switch (String(value).toLowerCase()) {
    case "inactive":
      return WorkspaceStatus.Inactive;
    case "archived":
      return WorkspaceStatus.Archived;
    case "deleted":
      return WorkspaceStatus.Deleted;
    default:
      return WorkspaceStatus.Active;
  }
}

/** Coerce a raw daemon workspace object into the renderer `Workspace` shape. */
function normalizeWorkspace(raw: Record<string, unknown>): Workspace {
  const now = new Date().toISOString();
  const id = String(raw.id ?? raw.workspaceId ?? "");
  return {
    ...(raw as Partial<Workspace>),
    id: createWorkspaceId(id),
    title: String(raw.title ?? raw.name ?? id),
    branch: String(raw.branch ?? ""),
    status: toWorkspaceStatus(raw.status),
    changesets: Array.isArray(raw.changesets) ? (raw.changesets as Workspace["changesets"]) : [],
    timeline: Array.isArray(raw.timeline) ? (raw.timeline as Workspace["timeline"]) : [],
    conversationInfo: Array.isArray(raw.conversationInfo)
      ? (raw.conversationInfo as Workspace["conversationInfo"])
      : [],
    createdAt: String(raw.createdAt ?? now),
    updatedAt: String(raw.updatedAt ?? now),
  } as Workspace;
}

function isWorkspaceEvent(method: string, params: unknown): boolean {
  if (method !== "events.event") return false;
  const type = (params as { type?: unknown } | undefined)?.type;
  // Refetch on any workspace-scoped event; if the type is absent, refetch too.
  return typeof type !== "string" || type.startsWith("workspace");
}

export class LiveWorkspacesClient implements WorkspacesClient {
  async list(): Promise<Workspace[]> {
    const result = await backendRequest<{ workspaces?: unknown[] }>("workspace.list");
    const workspaces = Array.isArray(result?.workspaces) ? result.workspaces : [];
    return workspaces.map((w) => normalizeWorkspace(w as Record<string, unknown>));
  }

  async get(id: string): Promise<Workspace | null> {
    const result = await backendRequest<{ workspace?: unknown } | unknown>("workspace.get", {
      workspaceId: id,
    });
    const raw =
      result && typeof result === "object" && "workspace" in result
        ? (result as { workspace?: unknown }).workspace
        : result;
    if (!raw || typeof raw !== "object") return null;
    return normalizeWorkspace(raw as Record<string, unknown>);
  }

  // The daemon owns watcher/monitoring start-up that the legacy main-process
  // `workspace:open` handler used to drive (see ~/src/intent .../workspace.ipc.ts
  // → protocolAdapter.getWorkspace), so resolving the workspace via `workspace.get`
  // is the parity-preserving wire shape; side effects are intentionally not
  // ported here per FE Iteration #1 scope.
  async open(id: string): Promise<Workspace | null> {
    return this.get(id);
  }

  // Mutations forward to the daemon (§7.1) and fold the outcome into a
  // MutationResult; daemon `workspace:*` events drive the reactive refresh.
  /**
   * `workspace.create` (§5.1): requires an idempotencyKey (§5.6); the daemon
   * ignores unknown params, so the full request is forwarded for
   * forward-compatibility. The daemon returns `{ workspace }` — normalized and
   * surfaced on the result so the creation flow (legacy `workspace:create`
   * bridge) can hand callers the created entity without a follow-up read.
   */
  async create(request: CreateWorkspaceRequest): Promise<WorkspaceCreateResult> {
    try {
      const result = await backendRequest<{ workspace?: unknown }>("workspace.create", {
        ...request,
        idempotencyKey: newIdempotencyKey(),
      });
      const raw = result?.workspace;
      return raw && typeof raw === "object"
        ? { success: true, workspace: normalizeWorkspace(raw as Record<string, unknown>) }
        : { success: true };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const conflict = extractConflict(error);
      if (conflict) return { success: false, error: message, conflict };
      return { success: false, error: message };
    }
  }

  /**
   * `workspace.update` (§5.1): the FE request `id` maps to the wire
   * `workspaceId`; the remaining fields are forwarded verbatim. The daemon
   * returns `{ workspace }` — normalized and surfaced on the result so callers
   * can upsert the authoritative entity without a follow-up `workspace.get`.
   */
  async update(request: UpdateWorkspaceRequest): Promise<WorkspaceUpdateResult> {
    const { id, ...fields } = request;
    try {
      const result = await backendRequest<{ workspace?: unknown }>("workspace.update", {
        workspaceId: id,
        ...fields,
      });
      const raw = result?.workspace;
      return raw && typeof raw === "object"
        ? { success: true, workspace: normalizeWorkspace(raw as Record<string, unknown>) }
        : { success: true };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const conflict = extractConflict(error);
      if (conflict) return { success: false, error: message, conflict };
      return { success: false, error: message };
    }
  }

  async delete(id: string): Promise<MutationResult> {
    return runMutation("workspace.delete", { workspaceId: id });
  }

  async archive(id: string): Promise<MutationResult> {
    return runMutation("workspace.archive", { workspaceId: id });
  }

  async unarchive(id: string): Promise<MutationResult> {
    return runMutation("workspace.unarchive", { workspaceId: id });
  }

  async setActive(id: string): Promise<MutationResult> {
    return runMutation("workspace.setActive", { workspaceId: id });
  }

  // Recency is renderer/daemon state not yet exposed by the daemon; empty for now.
  async recentViews(): Promise<Record<string, number>> {
    return {};
  }

  /**
   * `workspace.getTokenUsage` (PROTOCOL §5.23): the daemon-owned usage rollup
   * written by its internal scan job. `null` when the workspace is unknown or
   * the result shape is unexpected; updated rollups arrive via the
   * `workspace:tokenUsage-changed` event handled in `daemon-events-bridge`.
   */
  async getTokenUsage(workspaceId: string): Promise<TokenUsage | null> {
    const result = await backendRequest<{ tokenUsage?: TokenUsage }>(
      "workspace.getTokenUsage",
      { workspaceId },
    );
    const usage = result?.tokenUsage;
    return usage && typeof usage === "object" ? usage : null;
  }

  subscribe(handler: SubscriptionHandler<Workspace[]>): Unsubscribe {
    return createDeltaSubscription<Workspace>({
      eventTypes: ["workspace:created", "workspace:updated", "workspace:deleted"],
      matchLegacyEvent: (method, params) => isWorkspaceEvent(method, params),
      fetchAll: () => this.list(),
      getId: (raw) => String(raw.id ?? raw.workspaceId ?? ""),
      normalize: (raw) => normalizeWorkspace(raw),
      handler,
    });
  }
}
