/**
 * Live notes domain backed by the intentd daemon.
 *
 * `list` resolves via `note.list({ workspaceId })`; `get` resolves the note's
 * workspace first (daemon `note.get` requires `workspaceId`, which the fixed
 * AppClient signature does not carry) then fetches it. Every listed note's
 * workspace is cached so note-scoped clients (tasks, comments) can resolve it.
 * `subscribe` aggregates notes across workspaces and refetches on `note:*`.
 */
import { ContentType, NoteVisibility } from "$shared/types";
import { NoteId, WorkspaceId } from "$shared/types/branded-ids";
import type { Note } from "$shared/types";
import type {
  NotesClient,
  SubscriptionHandler,
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

/** Coerce a raw daemon note object into the renderer `Note` shape. */
export function normalizeNote(raw: Record<string, unknown>, workspaceId: string): Note {
  const now = new Date().toISOString();
  const id = String(raw.id ?? "");
  return {
    ...(raw as Partial<Note>),
    id: NoteId(id),
    workspaceId: WorkspaceId(String(raw.workspaceId ?? workspaceId)),
    title: String(raw.title ?? ""),
    content: String(raw.content ?? ""),
    contentType: (typeof raw.contentType === "string"
      ? raw.contentType
      : ContentType.Markdown) as ContentType,
    tags: Array.isArray(raw.tags) ? (raw.tags as string[]) : [],
    isPinned: Boolean(raw.isPinned ?? raw.is_pinned ?? false),
    isArchived: Boolean(raw.isArchived ?? raw.is_archived ?? false),
    visibility: (typeof raw.visibility === "string"
      ? raw.visibility
      : NoteVisibility.Workspace) as NoteVisibility,
    createdAt: String(raw.createdAt ?? raw.created_at ?? now),
    updatedAt: String(raw.updatedAt ?? raw.updated_at ?? now),
  } as Note;
}

export class LiveNotesClient implements NotesClient {
  async list(workspaceId: string): Promise<Note[]> {
    const result = await backendRequest<{ notes?: unknown[] }>("note.list", { workspaceId });
    const notes = Array.isArray(result?.notes) ? result.notes : [];
    return notes.map((n) => {
      const note = normalizeNote(n as Record<string, unknown>, workspaceId);
      rememberNoteWorkspace(String(note.id), workspaceId);
      return note;
    });
  }

  async get(noteId: string): Promise<Note | null> {
    const workspaceId = await resolveNoteWorkspaceId(noteId);
    if (!workspaceId) return null;
    try {
      const result = await backendRequest<{ note?: unknown } | unknown>("note.get", {
        workspaceId,
        noteId,
      });
      const raw =
        result && typeof result === "object" && "note" in result
          ? (result as { note?: unknown }).note
          : result;
      if (!raw || typeof raw !== "object") return null;
      return normalizeNote(raw as Record<string, unknown>, workspaceId);
    } catch {
      return null;
    }
  }

  subscribe(handler: SubscriptionHandler<Note[]>): Unsubscribe {
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
      if (isEventInFamily(n.method, n.params, "note")) emit();
    });

    backendSubscribe<{ subscriptionId?: string }>({
      eventTypes: ["note:created", "note:updated", "note:deleted"],
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
