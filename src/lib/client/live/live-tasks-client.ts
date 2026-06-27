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
import { backendRequest } from "./backend-transport";
import { createDeltaSubscription } from "./delta-subscription";
import {
  isEventInFamily,
  listWorkspaceIds,
  newIdempotencyKey,
  rememberNoteWorkspace,
  resolveNoteWorkspaceId,
  runMutationWithId,
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
    // Optimistic-concurrency revision (§11.4-D): carried through when the daemon
    // returns it, left undefined otherwise (no behavior change → last-writer-wins).
    ...(typeof raw.rev === "number" ? { rev: raw.rev } : {}),
  };
}

/**
 * Normalize a raw delta-channel entity into a `WorkspaceTask`. Handles both a
 * task note (carrying `metadata.task`, via `noteToTask`) and a direct task
 * entity that exposes a top-level `status`. Returns `null` for anything that is
 * not task-like so non-task notes on a shared channel are never misread.
 */
function normalizeTaskEntity(raw: Record<string, unknown>): WorkspaceTask | null {
  const viaNote = noteToTask(raw);
  if (viaNote) return viaNote;
  if (typeof raw.status !== "string") return null;
  return {
    id: String(raw.id ?? ""),
    title: String(raw.title ?? ""),
    status: raw.status as TaskStatus,
    updatedAt:
      typeof raw.updatedAt === "string"
        ? raw.updatedAt
        : typeof raw.updated_at === "string"
          ? raw.updated_at
          : undefined,
    ...(typeof raw.rev === "number" ? { rev: raw.rev } : {}),
  };
}

/**
 * Normalize a daemon conflict's authoritative `current` into a `WorkspaceTask`.
 * The daemon may surface either a task note (carrying `metadata.task`) or an
 * already-shaped WorkspaceTask (status at the top level); handle both so the
 * write service always receives a typed entity with the advanced `rev`.
 */
function conflictToTask(raw: Record<string, unknown>): WorkspaceTask | null {
  const viaNote = noteToTask(raw);
  if (viaNote) return viaNote;
  if (typeof raw.status === "string") {
    return {
      id: String(raw.id ?? ""),
      title: String(raw.title ?? ""),
      status: raw.status as TaskStatus,
      ...(typeof raw.updatedAt === "string" ? { updatedAt: raw.updatedAt } : {}),
      ...(typeof raw.rev === "number" ? { rev: raw.rev } : {}),
    };
  }
  return null;
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
  // MutationResult (never throws, never fakes success). The §7.9 mutations all
  // return a WorkspaceTask, so the canonical id is surfaced on the result (via
  // `runMutationWithId`) for call sites that need it — e.g. createPrerequisite,
  // whose new note id is used to build the inline task link. State convergence
  // is left to the live `task:*`/`note:*` subscribe→refetch loop. `workspaceId`
  // is sent alongside `noteId` per the §7.8 KEEP decision (daemon ignores unknowns).

  async updateStatus(
    noteId: string,
    taskText: string,
    status: TaskCheckboxStatus,
    expectedVersion?: number,
  ): Promise<MutationResult> {
    return this.runTaskMutation(noteId, "task.updateStatus", { taskText, status }, expectedVersion);
  }

  async update(
    noteId: string,
    line: number,
    patch: TaskUpdatePatch,
    expectedVersion?: number,
  ): Promise<MutationResult> {
    return this.runTaskMutation(
      noteId,
      "task.update",
      {
        line,
        ...(patch.text !== undefined ? { text: patch.text } : {}),
        ...(patch.status !== undefined ? { status: patch.status } : {}),
        ...(patch.expected !== undefined ? { expected: patch.expected } : {}),
      },
      expectedVersion,
    );
  }

  async updateNoteStatus(
    noteId: string,
    status: TaskStatus,
    expectedVersion?: number,
  ): Promise<MutationResult> {
    return this.runTaskMutation(noteId, "task.updateNoteStatus", { status }, expectedVersion);
  }

  async markAsTask(
    noteId: string,
    status: TaskStatus,
    options?: MarkAsTaskOptions,
    expectedVersion?: number,
  ): Promise<MutationResult> {
    return this.runTaskMutation(
      noteId,
      "task.markAsTask",
      {
        status,
        ...(options?.acceptanceCriteria !== undefined
          ? { acceptanceCriteria: options.acceptanceCriteria }
          : {}),
        ...(options?.effort !== undefined ? { effort: options.effort } : {}),
      },
      expectedVersion,
    );
  }

  async assignAgent(
    noteId: string,
    agentId: string,
    expectedVersion?: number,
  ): Promise<MutationResult> {
    return this.runTaskMutation(noteId, "task.assignAgent", { agentId }, expectedVersion);
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
    return runMutationWithId("task.createPrerequisite", {
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
   * `{ workspaceId, noteId, ...params }`. `expectedVersion` (§11.4-D) is added to
   * the params ONLY when defined — when absent the daemon ignores it and
   * last-writer-wins applies, exactly as today. Returns a failed MutationResult
   * (never throws, never fakes success) when the workspace cannot be resolved.
   */
  private async runTaskMutation(
    noteId: string,
    method: string,
    params: Record<string, unknown>,
    expectedVersion?: number,
  ): Promise<MutationResult> {
    const workspaceId = await resolveNoteWorkspaceId(noteId);
    if (!workspaceId) {
      return { success: false, error: `Cannot resolve workspace for note ${noteId}` };
    }
    const result = await runMutationWithId(method, {
      workspaceId,
      noteId,
      ...params,
      ...(expectedVersion !== undefined ? { expectedVersion } : {}),
    });
    // On an optimistic-concurrency conflict (§11.4-D), normalize the raw
    // authoritative `current` into a `WorkspaceTask` so the write service can
    // reload-to-latest (advancing the threaded rev) without touching daemon shapes.
    const current = result.conflict?.current;
    if (current && typeof current === "object") {
      const task = conflictToTask(current as Record<string, unknown>);
      if (task) return { ...result, conflict: { current: task } };
    }
    return result;
  }

  subscribe(handler: SubscriptionHandler<WorkspaceTask[]>): Unsubscribe {
    return createDeltaSubscription<WorkspaceTask>({
      eventTypes: ["task:status-changed", "task:ready-tasks-changed", "note:updated"],
      matchLegacyEvent: (method, params) =>
        isEventInFamily(method, params, "task") || isEventInFamily(method, params, "note"),
      fetchAll: async () => {
        const ids = await listWorkspaceIds();
        const perWorkspace = await Promise.all(ids.map((id) => this.list(id)));
        return perWorkspace.flat();
      },
      getId: (raw) => String(raw.id ?? ""),
      normalize: (raw) => normalizeTaskEntity(raw),
      handler,
    });
  }
}
