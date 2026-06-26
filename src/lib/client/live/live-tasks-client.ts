/**
 * Live tasks domain backed by the intentd daemon.
 *
 * The daemon exposes no dedicated `task.*` read methods today; task notes are
 * regular notes carrying `metadata.task`. This client therefore DERIVES the
 * canonical `WorkspaceTask` facts from `note.list` (filtering to notes that have
 * task metadata) — a live read, not a mock fallback. `subscribe` refetches on
 * `task:*` and `note:*` events (task status lives in note metadata).
 */
import type { TaskStatus, WorkspaceTask } from "$shared/types";
import type {
  SubscriptionHandler,
  TasksClient,
  Unsubscribe,
} from "../app-client";
import {
  backendRequest,
  backendSubscribe,
  backendUnsubscribe,
  onBackendNotification,
} from "./backend-transport";
import {
  isEventInFamily,
  listWorkspaceIds,
  rememberNoteWorkspace,
  resolveNoteWorkspaceId,
} from "./live-support";

/** Map a raw daemon note to a `WorkspaceTask` when it carries task metadata. */
function noteToTask(raw: Record<string, unknown>): WorkspaceTask | null {
  const metadata = raw.metadata as { task?: { status?: unknown } } | undefined;
  const task = metadata?.task;
  if (!task) return null;
  return {
    id: String(raw.id ?? ""),
    title: String(raw.title ?? ""),
    status: (typeof task.status === "string" ? task.status : "not_started") as TaskStatus,
    updatedAt:
      typeof raw.updatedAt === "string"
        ? raw.updatedAt
        : typeof raw.updated_at === "string"
          ? raw.updated_at
          : undefined,
  };
}

export class LiveTasksClient implements TasksClient {
  async list(workspaceId: string): Promise<WorkspaceTask[]> {
    const result = await backendRequest<{ notes?: unknown[] }>("note.list", { workspaceId });
    const notes = Array.isArray(result?.notes) ? result.notes : [];
    const tasks: WorkspaceTask[] = [];
    for (const note of notes) {
      const raw = note as Record<string, unknown>;
      const id = String(raw.id ?? "");
      if (id) rememberNoteWorkspace(id, workspaceId);
      const task = noteToTask(raw);
      if (task) tasks.push(task);
    }
    return tasks;
  }

  async get(taskId: string): Promise<WorkspaceTask | null> {
    const workspaceId = await resolveNoteWorkspaceId(taskId);
    if (!workspaceId) return null;
    try {
      const result = await backendRequest<{ note?: unknown } | unknown>("note.get", {
        workspaceId,
        noteId: taskId,
      });
      const raw =
        result && typeof result === "object" && "note" in result
          ? (result as { note?: unknown }).note
          : result;
      if (!raw || typeof raw !== "object") return null;
      return noteToTask(raw as Record<string, unknown>);
    } catch {
      return null;
    }
  }

  subscribe(handler: SubscriptionHandler<WorkspaceTask[]>): Unsubscribe {
    let disposed = false;
    let subscriptionId: string | undefined;

    const emit = () => {
      listWorkspaceIds()
        .then((ids) => Promise.all(ids.map((id) => this.list(id))))
        .then((perWorkspace) => {
          if (!disposed) handler(perWorkspace.flat());
        })
        .catch(() => {
          // Snapshot refresh failures are non-fatal for the subscription.
        });
    };

    emit();

    const off = onBackendNotification((n) => {
      if (isEventInFamily(n.method, n.params, "task") || isEventInFamily(n.method, n.params, "note"))
        emit();
    });

    backendSubscribe<{ subscriptionId?: string }>({
      eventTypes: ["task:status-changed", "task:ready-tasks-changed", "note:updated"],
    })
      .then((result) => {
        subscriptionId = result?.subscriptionId;
        if (disposed && subscriptionId) void backendUnsubscribe(subscriptionId);
      })
      .catch(() => {
        // Without a daemon subscription we still serve the initial snapshot.
      });

    return () => {
      disposed = true;
      off();
      if (subscriptionId) void backendUnsubscribe(subscriptionId);
    };
  }
}
