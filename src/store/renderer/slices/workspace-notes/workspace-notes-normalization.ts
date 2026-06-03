import type { Note, TaskStatus } from "$shared/types";

const TASK_STATUSES: TaskStatus[] = [
  "not_started",
  "waiting",
  "discussion_needed",
  "in_progress",
  "review_required",
  "complete",
  "cancelled",
];

export type NoteUpdateSource = "agent" | "external";

export function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

export function asString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

export function normalizeNoteUpdateSource(source: unknown): NoteUpdateSource {
  return source === "agent" ? "agent" : "external";
}

export function isTaskStatus(value: unknown): value is TaskStatus {
  return typeof value === "string" && TASK_STATUSES.includes(value as TaskStatus);
}

export function isFullNote(value: unknown): value is Note {
  if (!isRecord(value)) return false;

  return typeof value.id === "string" &&
    typeof value.workspaceId === "string" &&
    typeof value.title === "string" &&
    typeof value.content === "string" &&
    typeof value.contentType === "string" &&
    Array.isArray(value.tags) &&
    value.tags.every((tag) => typeof tag === "string") &&
    typeof value.isPinned === "boolean" &&
    typeof value.isArchived === "boolean" &&
    typeof value.visibility === "string" &&
    typeof value.createdAt === "string" &&
    typeof value.updatedAt === "string";
}

export function normalizeNoteEventContent(payload: unknown): string | undefined {
  if (!isRecord(payload)) return undefined;

  const directContent = asString(payload.content);
  if (directContent !== undefined) return directContent;

  const changes = payload.changes;
  return isRecord(changes) ? asString(changes.content) : undefined;
}

export function normalizeNoteUpdatePatch(updates: unknown): Partial<Note> {
  if (!isRecord(updates)) return {};

  const { content, title, source: _source, ...rest } = updates;
  const normalized: Record<string, unknown> = { ...rest };

  if (typeof content === "string") {
    normalized.content = content;
  }
  if (typeof title === "string") {
    normalized.title = title;
  }

  return normalized as Partial<Note>;
}