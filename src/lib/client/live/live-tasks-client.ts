/**
 * Live tasks domain backed by the intentd daemon.
 *
 * `list()` calls `task.list` (PROTOCOL §5.4) which returns the canonical
 * `WorkspaceTask[]` projection AND the workspace-wide `taskStats` aggregate the
 * BE owns. The FE renders `stats` verbatim — it never re-derives task progress
 * from the task list (or from `note.list`). `subscribe` aggregates tasks
 * across workspaces, converging via one typed per-workspace `task.subscribe`
 * channel per workspace (PROTOCOL §6.9) — the sole data path
 * (intent-hq/monorepo#1697); there is no legacy `task:*`/`note:*`
 * events-driven refetch.
 */
import type { NoteId, TaskStatus, WorkspaceTask, WorkspaceTaskStats } from '$shared/types';
import type {
  CreatePrerequisiteOptions,
  MarkAsTaskOptions,
  MutationResult,
  SetRelationsParams,
  SubscriptionHandler,
  TaskCheckboxStatus,
  TaskUpdatePatch,
  TasksClient,
  Unsubscribe,
} from '../app-client';
import type {
  TaskAgentAssociation,
  TaskAgentAssociationsByTaskKey,
} from '$store/renderer/slices/task-agent-associations/task-agent-associations-types';
import { backendRequest } from './backend-transport';
import { createDeltaSubscription } from './delta-subscription';
import {
  newIdempotencyKey,
  rememberNoteWorkspace,
  resolveNoteWorkspaceId,
  runMutationWithId,
  subscribeWorkspaceIds,
} from './live-support';
import { createLogger } from '$lib/utils/client-logger';

const logger = createLogger('LiveTasksClient');

/**
 * Carry a wire string-array field through only when it is a non-empty string
 * array. A non-empty array with a non-string member is a contract divergence
 * (PROTOCOL §5.4 lists are task-note id strings) — it is discarded with a warn
 * so a BE-side break surfaces instead of vanishing silently.
 */
function stringArray(field: string, value: unknown): string[] | undefined {
  if (!Array.isArray(value) || value.length === 0) return undefined;
  if (!value.every((v) => typeof v === 'string')) {
    logger.warn(`discarding malformed ${field}: expected string[], got non-string member`, {
      value,
    });
    return undefined;
  }
  return value as string[];
}

/**
 * Relation fields (v6.8, presence-detected): `dependsOn` / `conflictsWith`
 * plus the daemon-computed `unmetDependsOn`, all read from the source shape —
 * top-level on `task.list` rows, `metadata.task` on note-shaped entities
 * (monorepo#1979).
 */
function relationFields(
  source: Record<string, unknown>,
): Pick<WorkspaceTask, 'dependsOn' | 'conflictsWith' | 'unmetDependsOn'> {
  const dependsOn = stringArray('dependsOn', source.dependsOn) as NoteId[] | undefined;
  const conflictsWith = stringArray('conflictsWith', source.conflictsWith) as NoteId[] | undefined;
  const unmetDependsOn = stringArray('unmetDependsOn', source.unmetDependsOn) as
    NoteId[] | undefined;
  return {
    ...(dependsOn ? { dependsOn } : {}),
    ...(conflictsWith ? { conflictsWith } : {}),
    ...(unmetDependsOn ? { unmetDependsOn } : {}),
  };
}

/**
 * `specLinked` (additive, PROTOCOL §5.4): carried through only when the wire
 * row has the boolean — an older daemon omits it and consumers keep their
 * legacy behavior on `undefined` (presence-detected like the relation fields).
 */
function specLinkedField(source: Record<string, unknown>): Pick<WorkspaceTask, 'specLinked'> {
  return typeof source.specLinked === 'boolean' ? { specLinked: source.specLinked } : {};
}

/** Map a raw daemon note to a `WorkspaceTask` when it carries task metadata. */
function noteToTask(raw: Record<string, unknown>): WorkspaceTask | null {
  const metadata = raw.metadata as { task?: { status?: unknown } } | undefined;
  const task = metadata?.task;
  if (!task) return null;
  return {
    id: String(raw.id ?? ''),
    title: String(raw.title ?? ''),
    status: (typeof task.status === 'string' ? task.status : 'not_started') as TaskStatus,
    updatedAt:
      typeof raw.updatedAt === 'string'
        ? raw.updatedAt
        : typeof raw.updated_at === 'string'
          ? raw.updated_at
          : undefined,
    // Optimistic-concurrency revision (§11.4-D): carried through when the daemon
    // returns it, left undefined otherwise (no behavior change → last-writer-wins).
    ...(typeof raw.rev === 'number' ? { rev: raw.rev } : {}),
    ...relationFields(task as Record<string, unknown>),
    ...specLinkedField(task as Record<string, unknown>),
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
  if (typeof raw.status !== 'string') return null;
  return {
    id: String(raw.id ?? ''),
    title: String(raw.title ?? ''),
    status: raw.status as TaskStatus,
    updatedAt:
      typeof raw.updatedAt === 'string'
        ? raw.updatedAt
        : typeof raw.updated_at === 'string'
          ? raw.updated_at
          : undefined,
    ...(typeof raw.rev === 'number' ? { rev: raw.rev } : {}),
    ...relationFields(raw),
    ...specLinkedField(raw),
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
  if (typeof raw.status === 'string') {
    return {
      id: String(raw.id ?? ''),
      title: String(raw.title ?? ''),
      status: raw.status as TaskStatus,
      ...(typeof raw.updatedAt === 'string' ? { updatedAt: raw.updatedAt } : {}),
      ...(typeof raw.rev === 'number' ? { rev: raw.rev } : {}),
    };
  }
  return null;
}

/** Zero-aggregate fallback for the synthesized `subscribe` snapshot (workspace not loaded). */
const EMPTY_STATS: WorkspaceTaskStats = { total: 0, completed: 0, inProgress: 0 };

/**
 * Normalize a daemon `TaskAgentLink` row into the renderer
 * `TaskAgentAssociation`. The daemon carries `workspaceId` on every row, but
 * the FE slice is already workspace-scoped, so we drop it. `taskKey` is always
 * populated by the daemon (`taskKey ?? taskText` at link time).
 */
function normalizeAgentLink(raw: unknown): TaskAgentAssociation | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const noteId = r.noteId;
  const taskKey = r.taskKey;
  const taskText = r.taskText;
  const agentId = r.agentId;
  const createdAt = r.createdAt;
  if (
    typeof noteId !== 'string' ||
    typeof taskKey !== 'string' ||
    typeof taskText !== 'string' ||
    typeof agentId !== 'string' ||
    typeof createdAt !== 'number'
  ) {
    return null;
  }
  return { noteId, taskKey, taskText, agentId, createdAt };
}

/**
 * Normalize the wire `stats` aggregate from `task.list` into the canonical
 * `WorkspaceTaskStats` shape. The daemon emits `{ total, completed, inProgress }`
 * verbatim per PROTOCOL §5.4 — this function is the explicit boundary that
 * defends the call site if a field is absent without re-deriving the rollup.
 */
function normalizeStats(raw: unknown): WorkspaceTaskStats {
  if (!raw || typeof raw !== 'object') return { ...EMPTY_STATS };
  const r = raw as Record<string, unknown>;
  return {
    total: typeof r.total === 'number' ? r.total : 0,
    completed: typeof r.completed === 'number' ? r.completed : 0,
    inProgress: typeof r.inProgress === 'number' ? r.inProgress : 0,
  };
}

export class LiveTasksClient implements TasksClient {
  /**
   * `task.list` (PROTOCOL §5.4) → `{ tasks, stats }`. The BE owns the
   * `taskStats` rollup; the FE renders it verbatim. Tasks are also remembered
   * by workspace so note-scoped mutations can resolve their owning workspace.
   */
  async list(workspaceId: string): Promise<{ tasks: WorkspaceTask[]; stats: WorkspaceTaskStats }> {
    const result = await backendRequest<{ tasks?: unknown[]; stats?: unknown }>('task.list', {
      workspaceId,
    });
    const rawTasks = Array.isArray(result?.tasks) ? result.tasks : [];
    const tasks: WorkspaceTask[] = [];
    for (const entry of rawTasks) {
      const task = normalizeTaskEntity(entry as Record<string, unknown>);
      if (!task) continue;
      if (task.id) rememberNoteWorkspace(task.id, workspaceId);
      tasks.push(task);
    }
    return { tasks, stats: normalizeStats(result?.stats) };
  }

  async get(taskId: string): Promise<WorkspaceTask | null> {
    const workspaceId = await resolveNoteWorkspaceId(taskId);
    if (!workspaceId) return null;
    try {
      const result = await backendRequest<{ note?: unknown } | unknown>('note.get', {
        workspaceId,
        noteId: taskId,
      });
      const raw =
        result && typeof result === 'object' && 'note' in result
          ? (result as { note?: unknown }).note
          : result;
      if (!raw || typeof raw !== 'object') return null;
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
    return this.runTaskMutation(noteId, 'task.updateStatus', { taskText, status }, expectedVersion);
  }

  async update(
    noteId: string,
    line: number,
    patch: TaskUpdatePatch,
    expectedVersion?: number,
  ): Promise<MutationResult> {
    return this.runTaskMutation(
      noteId,
      'task.update',
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
    return this.runTaskMutation(noteId, 'task.updateNoteStatus', { status }, expectedVersion);
  }

  async markAsTask(
    noteId: string,
    status: TaskStatus,
    options?: MarkAsTaskOptions,
    expectedVersion?: number,
  ): Promise<MutationResult> {
    return this.runTaskMutation(
      noteId,
      'task.markAsTask',
      {
        status,
        ...(options?.acceptanceCriteria !== undefined
          ? { acceptanceCriteria: options.acceptanceCriteria }
          : {}),
        ...(options?.effort !== undefined ? { effort: options.effort } : {}),
        ...(options?.dependsOn !== undefined ? { dependsOn: options.dependsOn } : {}),
        ...(options?.conflictsWith !== undefined ? { conflictsWith: options.conflictsWith } : {}),
      },
      expectedVersion,
    );
  }

  /**
   * `task.setRelations` (PROTOCOL §5.4, v6.8): replace the task's relation
   * lists. Omitted params are NOT sent — the daemon keeps the existing list;
   * `[]` is sent and clears it.
   */
  async setRelations(noteId: string, relations: SetRelationsParams): Promise<MutationResult> {
    return this.runTaskMutation(noteId, 'task.setRelations', {
      ...(relations.dependsOn !== undefined ? { dependsOn: relations.dependsOn } : {}),
      ...(relations.conflictsWith !== undefined ? { conflictsWith: relations.conflictsWith } : {}),
    });
  }

  async assignAgent(
    noteId: string,
    agentId: string,
    expectedVersion?: number,
  ): Promise<MutationResult> {
    return this.runTaskMutation(noteId, 'task.assignAgent', { agentId }, expectedVersion);
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
    return runMutationWithId('task.createPrerequisite', {
      workspaceId,
      dependentNoteId,
      title,
      ...(options?.content !== undefined ? { content: options.content } : {}),
      ...(options?.status !== undefined ? { status: options.status } : {}),
      idempotencyKey: newIdempotencyKey(),
    });
  }

  /**
   * `task.listAgentLinks` (PROTOCOL §5.4): the daemon returns both a flat
   * `links` array and the pre-grouped `linksByNoteId` map. We consume the map
   * directly (it matches the FE slice shape) and normalize each row into the
   * renderer `TaskAgentAssociation` — dropping the daemon-only `workspaceId`
   * field since the FE slice is already workspace-scoped.
   */
  async listAgentLinks(
    workspaceId: string,
  ): Promise<Record<string, TaskAgentAssociationsByTaskKey>> {
    const result = await backendRequest<{ linksByNoteId?: unknown }>('task.listAgentLinks', {
      workspaceId,
    });
    const raw = result?.linksByNoteId;
    if (!raw || typeof raw !== 'object') return {};
    const out: Record<string, TaskAgentAssociationsByTaskKey> = {};
    for (const [noteId, byKeyRaw] of Object.entries(raw as Record<string, unknown>)) {
      if (!byKeyRaw || typeof byKeyRaw !== 'object') continue;
      const byKey: TaskAgentAssociationsByTaskKey = {};
      for (const [taskKey, rowRaw] of Object.entries(byKeyRaw as Record<string, unknown>)) {
        const assoc = normalizeAgentLink(rowRaw);
        if (assoc) byKey[taskKey] = assoc;
      }
      if (Object.keys(byKey).length > 0) out[noteId] = byKey;
    }
    return out;
  }

  /**
   * `task.linkAgent` (PROTOCOL §5.4): forwards the FE `TaskAgentAssociation`
   * as `{ workspaceId, noteId, taskText, agentId, taskKey? }`. The daemon
   * always echoes `{ link: TaskAgentLink }` with the persisted row; we
   * normalize it back into the renderer shape so callers receive the exact
   * association the daemon stored (and that `task:agent-linked` will emit).
   */
  async linkAgent(
    workspaceId: string,
    noteId: string,
    association: TaskAgentAssociation,
  ): Promise<TaskAgentAssociation> {
    const result = await backendRequest<{ link?: unknown }>('task.linkAgent', {
      workspaceId,
      noteId,
      taskText: association.taskText,
      agentId: association.agentId,
      ...(association.taskKey !== undefined ? { taskKey: association.taskKey } : {}),
    });
    const normalized = normalizeAgentLink(result?.link);
    if (normalized) return normalized;
    // Daemon always echoes a link on success; fall back to the input association
    // (still workspace-scoped locally) so the caller has a usable shape.
    return { ...association, noteId };
  }

  /**
   * `task.unlinkAgent` (PROTOCOL §5.4): returns `{ removed: boolean }` where
   * `removed` is `true` only when a matching row existed. We surface the flag
   * so callers can distinguish a no-op removal from a real one.
   */
  async unlinkAgent(workspaceId: string, noteId: string, taskKey: string): Promise<boolean> {
    const result = await backendRequest<{ removed?: unknown }>('task.unlinkAgent', {
      workspaceId,
      noteId,
      taskKey,
    });
    return result?.removed === true;
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
    if (current && typeof current === 'object') {
      const task = conflictToTask(current as Record<string, unknown>);
      if (task) return { ...result, conflict: { current: task } };
    }
    return result;
  }

  /**
   * Subscribe to tasks across every workspace.
   *
   * Typed §6.9 channel: one per-workspace `task.subscribe`
   * (`{ workspaceId }`) is registered per id yielded by
   * `subscribeWorkspaceIds` — the sole data path (intent-hq/monorepo#1697).
   * The channel carries task notes; the BE emits `removedIds` when a note is
   * deleted OR demoted (its task metadata removed), which the reconciler
   * drops. Workspace add → a new channel registers and its snapshot merges
   * in; workspace delete → the channel unsubscribes and its tasks are
   * evicted.
   */
  subscribe(handler: SubscriptionHandler<WorkspaceTask[]>): Unsubscribe {
    return createDeltaSubscription<WorkspaceTask>({
      channel: {
        subscribeMethod: 'task.subscribe',
        unsubscribeMethod: 'task.unsubscribe',
        dynamic: {
          subscribeIds: subscribeWorkspaceIds,
          paramsForId: (id) => ({ workspaceId: id }),
        },
      },
      getId: (raw) => String(raw.id ?? ''),
      // Push-path entities are the daemon's task-filtered wire `Note` (§6.9),
      // which always carries `workspaceId` (camelCase serde) — remembered so
      // note-scoped task mutations can resolve their owning workspace.
      normalize: (raw) => {
        const task = normalizeTaskEntity(raw);
        if (task?.id && typeof raw.workspaceId === 'string' && raw.workspaceId) {
          rememberNoteWorkspace(task.id, raw.workspaceId);
        }
        return task;
      },
      handler,
    });
  }
}
