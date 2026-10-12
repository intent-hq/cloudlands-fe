import type { NoteId, TaskStatus, WorkspaceTask, WorkspaceTaskStats } from '../../../shared/types';
import type { TaskAgentAssociation } from '../../../store/renderer/slices/task-agent-associations/task-agent-associations-types';
import { createLogger } from '../../utils/client-logger';

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
 * Task relation fields (§5.4, presence-detected): `dependsOn` / `conflictsWith`
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
export function noteToTask(raw: Record<string, unknown>): WorkspaceTask | null {
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
export function normalizeTaskEntity(raw: Record<string, unknown>): WorkspaceTask | null {
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
export function conflictToTask(raw: Record<string, unknown>): WorkspaceTask | null {
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
export function normalizeAgentLink(raw: unknown): TaskAgentAssociation | null {
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
export function normalizeStats(raw: unknown): WorkspaceTaskStats {
  if (!raw || typeof raw !== 'object') return { ...EMPTY_STATS };
  const r = raw as Record<string, unknown>;
  return {
    total: typeof r.total === 'number' ? r.total : 0,
    completed: typeof r.completed === 'number' ? r.completed : 0,
    inProgress: typeof r.inProgress === 'number' ? r.inProgress : 0,
  };
}
