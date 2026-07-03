/**
 * Live workspaces domain backed by the intentd daemon.
 *
 * Reads resolve via `workspace.list` / `workspace.get` over the JSON-RPC bridge.
 * `subscribe` emits an initial snapshot, then refetches whenever a `workspace:*`
 * daemon event arrives (delivered as `events.event` notifications). Mutations
 * beyond reads are out of scope for this wave and are accepted as no-ops to
 * preserve existing UI behavior.
 */
import { WorkspaceStatus, createWorkspaceId } from "$shared/types";
import type { CreateWorkspaceRequest, Workspace } from "$shared/types";
import type {
  MutationResult,
  SubscriptionHandler,
  Unsubscribe,
  WorkspacesClient,
} from "../app-client";
import { backendRequest } from "./backend-transport";
import { createDeltaSubscription } from "./delta-subscription";
import { newIdempotencyKey, runMutation } from "./live-support";

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
  async create(request: CreateWorkspaceRequest): Promise<MutationResult> {
    // create requires an idempotencyKey (§5.6); the daemon ignores unknown
    // params, so the full request is forwarded for forward-compatibility.
    return runMutation("workspace.create", { ...request, idempotencyKey: newIdempotencyKey() });
  }

  async delete(id: string): Promise<MutationResult> {
    return runMutation("workspace.delete", { workspaceId: id });
  }

  async setActive(id: string): Promise<MutationResult> {
    return runMutation("workspace.setActive", { workspaceId: id });
  }

  // Recency is renderer/daemon state not yet exposed by the daemon; empty for now.
  async recentViews(): Promise<Record<string, number>> {
    return {};
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
