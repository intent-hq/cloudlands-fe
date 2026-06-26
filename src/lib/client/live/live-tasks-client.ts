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
  CreatePrerequisiteOptions,
  MarkAsTaskOptions,
  MutationResult,
  SubscriptionHandler,
  TaskCheckboxStatus,
  TaskUpdatePatch,
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
  newIdempotencyKey,
  rememberNoteWorkspace,
  resolveNoteWorkspaceId,
  runMutation,
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

  // ---- Mutations ----------------------------------------------------------
  // Tasks are note-scoped (a task is a note carrying `metadata.task`), so each
  // mutation resolves the owning workspace via `resolveNoteWorkspaceId` and
  // forwards the frozen §7.9 params to the daemon, folding the outcome into a
  // MutationResult (never throws, never fakes success). State convergence is
  // left to the live `task:*`/`note:*` subscribe→refetch loop. `workspaceId` is
  // sent alongside `noteId` per the §7.8 KEEP decision (daemon ignores unknowns).

  async updateStatus(
    noteId: string,
    taskText: string,
    status: TaskCheckboxStatus,
  ): Promise<MutationResult> {
    return this.runTaskMutation(noteId, "task.updateStatus", { taskText, status });
  }

  async update(noteId: string, line: number, patch: TaskUpdatePatch): Promise<MutationResult> {
    return this.runTaskMutation(noteId, "task.update", {
      line,
      ...(patch.text !== undefined ? { text: patch.text } : {}),
      ...(patch.status !== undefined ? { status: patch.status } : {}),
      ...(patch.expected !== undefined ? { expected: patch.expected } : {}),
    });
  }

  async updateNoteStatus(noteId: string, status: TaskStatus): Promise<MutationResult> {
    return this.runTaskMutation(noteId, "task.updateNoteStatus", { status });
  }

  async markAsTask(
    noteId: string,
    status: TaskStatus,
    options?: MarkAsTaskOptions,
  ): Promise<MutationResult> {
    return this.runTaskMutation(noteId, "task.markAsTask", {
      status,
      ...(options?.acceptanceCriteria !== undefined
        ? { acceptanceCriteria: options.acceptanceCriteria }
        : {}),
      ...(options?.effort !== undefined ? { effort: options.effort } : {}),
    });
  }

  async assignAgent(noteId: string, agentId: string): Promise<MutationResult> {
    return this.runTaskMutation(noteId, "task.assignAgent", { agentId });
  }

  async createPrerequisite(
    dependentNoteId: string,
    title: string,
    options?: CreatePrerequisiteOptions,
  ): Promise<MutationResult> {
    const workspaceId = await resolveNoteWorkspaceId(dependentNoteId);
    if (!workspaceId) {
      return { success: false, error: `Cannot resolve workspace for note ${dependentNoteId}` };
    }
    return runMutation("task.createPrerequisite", {
      workspaceId,
      dependentNoteId,
      title,
      ...(options?.content !== undefined ? { content: options.content } : {}),
      ...(options?.status !== undefined ? { status: options.status } : {}),
      idempotencyKey: newIdempotencyKey(),
    });
  }

  /**
   * Resolve a task note's workspace, then issue a note-scoped task mutation with
   * `{ workspaceId, noteId, ...params }`. Returns a failed MutationResult (never
   * throws, never fakes success) when the workspace cannot be resolved.
   */
  private async runTaskMutation(
    noteId: string,
    method: string,
    params: Record<string, unknown>,
  ): Promise<MutationResult> {
    const workspaceId = await resolveNoteWorkspaceId(noteId);
    if (!workspaceId) {
      return { success: false, error: `Cannot resolve workspace for note ${noteId}` };
    }
    return runMutation(method, { workspaceId, noteId, ...params });
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
